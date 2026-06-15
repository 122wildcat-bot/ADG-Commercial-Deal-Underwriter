import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { z } from "zod";
import multer from "multer";

import { underwrite } from "../shared/engine/underwrite";
import type { DealInputs } from "../shared/types";
import { extractDealFromDocument, MAX_UPLOAD_BYTES } from "./aiExtract";
import { renderHtmlToPdf, slugifyForFilename } from "./pdfRender";
import { buildPrintHtml } from "./printTemplate";
import { generateAiReport, isReportConfigured } from "./aiReport";

import {
  createDeal,
  createUser,
  deleteDeal,
  deleteUser,
  getDealById,
  getUserByEmail,
  getUserById,
  countActiveAdmins,
  listDealsForUser,
  listUsers,
  logActivity,
  publicSummary,
  setUserRole,
  setUserStatus,
  updateDeal,
} from "./storage";
import {
  hashPassword,
  verifyPassword,
  signToken,
  safeUser,
  requireAuth,
  requireAdmin,
} from "./auth";
import { describeCrmMode } from "./crmClient";

// ── input validation ──────────────────────────────────────────────────────
// We only validate at the system boundary (route body). Internal code trusts
// these shapes after the parse. `inputs` itself is a freeform JSON blob — we
// just check it's an object so we don't store garbage. The engine handles
// missing fields with safe defaults.

// In-memory upload for the AI importer — the file is streamed to Claude and
// discarded, never written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const dealInputsShape = z.record(z.any());

const createDealBody = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).nullable().optional(),
  propertyType: z.string().max(40).nullable().optional(),
  inputs: dealInputsShape,
});

const updateDealBody = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  propertyType: z.string().max(40).nullable().optional(),
  status: z.string().max(40).optional(),
  inputs: dealInputsShape.optional(),
});

const signupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).max(120),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── helpers ───────────────────────────────────────────────────────────────
function denormForList(inputs: DealInputs) {
  try {
    const out = underwrite(inputs);
    return {
      purchasePrice: Math.round(out.purchasePrice),
      units: inputs.units,
      capRatePct: Number(out.ratiosY1.capRatePurchasePct.toFixed(2)),
      cashFlowMo: Math.round(out.year1.cashFlowMonthly),
    };
  } catch {
    return { purchasePrice: null, units: null, capRatePct: null, cashFlowMo: null };
  }
}

// ── routes ────────────────────────────────────────────────────────────────
export async function registerRoutes(_server: Server, app: Express): Promise<void> {
  // Health (Railway healthcheck — public)
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Public summary for the Suite tile
  app.get("/api/summary", (_req, res) => {
    const s = publicSummary();
    res.json({
      deals: s.deals,
      lastUpdated: s.lastUpdated,
      crmMode: describeCrmMode(),
    });
  });

  // ── auth ───────────────────────────────────────────────────────────────
  app.post("/api/auth/signup", async (req, res) => {
    const parsed = signupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      return;
    }
    const { email, password, name } = parsed.data;
    const existing = getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    const passwordHash = await hashPassword(password);
    const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
    const isOwner = adminEmail && email.toLowerCase() === adminEmail;
    const user = createUser({
      email,
      passwordHash,
      name,
      role: isOwner ? "admin" : "user",
      status: isOwner ? "active" : "pending",
    });
    logActivity("user.signup", { userId: user.id });
    const token = signToken(user);
    res.json({ token, user: safeUser(user) });
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const { email, password } = parsed.data;
    const user = getUserByEmail(email);
    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    if (user.status === "blocked") {
      res.status(403).json({ error: "Account is blocked" });
      return;
    }
    const token = signToken(user);
    res.json({ token, user: safeUser(user), pending: user.status === "pending" });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: safeUser(req.user!) });
  });

  // ── deals ─────────────────────────────────────────────────────────────
  app.get("/api/deals", requireAuth, (req, res) => {
    const list = listDealsForUser(req.user!.id, req.user!.role === "admin");
    res.json({
      deals: list.map((d) => ({
        id: d.id,
        name: d.name,
        address: d.address,
        propertyType: d.propertyType,
        status: d.status,
        purchasePrice: d.purchasePrice,
        units: d.units,
        capRatePct: d.capRatePct,
        cashFlowMo: d.cashFlowMo,
        updatedAt: d.updatedAt,
        createdAt: d.createdAt,
        userId: d.userId,
      })),
    });
  });

  app.post("/api/deals", requireAuth, (req, res) => {
    const parsed = createDealBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid deal" });
      return;
    }
    const denorm = denormForList(parsed.data.inputs as DealInputs);
    const deal = createDeal({
      userId: req.user!.id,
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      propertyType: parsed.data.propertyType ?? null,
      inputs: JSON.stringify(parsed.data.inputs),
      ...denorm,
    });
    logActivity("deal.created", { userId: req.user!.id, dealId: deal.id });
    res.json({ deal: { id: deal.id } });
  });

  app.get("/api/deals/:id", requireAuth, (req, res) => {
    const deal = getDealById(String(req.params.id));
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    let inputs: DealInputs;
    try {
      inputs = JSON.parse(deal.inputs) as DealInputs;
    } catch {
      res.status(500).json({ error: "Deal inputs are corrupt; cannot underwrite." });
      return;
    }
    // Outputs are ALWAYS computed live from the shared engine (spec §6).
    const outputs = underwrite(inputs);
    res.json({
      deal: {
        id: deal.id,
        name: deal.name,
        address: deal.address,
        propertyType: deal.propertyType,
        status: deal.status,
        createdAt: deal.createdAt,
        updatedAt: deal.updatedAt,
        userId: deal.userId,
      },
      inputs,
      outputs,
    });
  });

  app.put("/api/deals/:id", requireAuth, (req, res) => {
    const deal = getDealById(String(req.params.id));
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    const parsed = updateDealBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid update" });
      return;
    }
    const data = parsed.data;
    const patch: Parameters<typeof updateDeal>[1] = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.address !== undefined) patch.address = data.address;
    if (data.propertyType !== undefined) patch.propertyType = data.propertyType;
    if (data.status !== undefined) patch.status = data.status;
    if (data.inputs !== undefined) {
      patch.inputs = JSON.stringify(data.inputs);
      Object.assign(patch, denormForList(data.inputs as DealInputs));
    }
    const updated = updateDeal(deal.id, patch);
    logActivity("deal.updated", { userId: req.user!.id, dealId: deal.id });
    res.json({ deal: { id: updated!.id } });
  });

  app.delete("/api/deals/:id", requireAuth, (req, res) => {
    const deal = getDealById(String(req.params.id));
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    deleteDeal(deal.id);
    logActivity("deal.deleted", { userId: req.user!.id, dealId: deal.id });
    res.json({ ok: true });
  });

  app.post("/api/deals/:id/duplicate", requireAuth, (req, res) => {
    const deal = getDealById(String(req.params.id));
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    let inputs: DealInputs;
    try { inputs = JSON.parse(deal.inputs) as DealInputs; } catch {
      res.status(500).json({ error: "Cannot duplicate a corrupt deal." });
      return;
    }
    const denorm = denormForList(inputs);
    const dup = createDeal({
      userId: req.user!.id,
      name: `${deal.name} (copy)`,
      address: deal.address,
      propertyType: deal.propertyType,
      inputs: deal.inputs,
      ...denorm,
    });
    logActivity("deal.duplicated", { userId: req.user!.id, dealId: dup.id, meta: { from: deal.id } });
    res.json({ deal: { id: dup.id } });
  });

  // Stateless: compute outputs without saving (handy for quick what-ifs).
  app.post("/api/underwrite", requireAuth, (req, res) => {
    try {
      const out = underwrite(req.body as DealInputs);
      res.json({ outputs: out });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "Could not underwrite" });
    }
  });

  // ── Reports ──────────────────────────────────────────────────────────
  // GET /api/deals/:id/print.pdf — deterministic engine-data summary
  // (no API key required; instant; free per render).
  app.get("/api/deals/:id/print.pdf", requireAuth, async (req, res) => {
    const deal = getDealById(String(req.params.id));
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    let inputs: DealInputs;
    try { inputs = JSON.parse(deal.inputs) as DealInputs; } catch {
      res.status(500).json({ error: "Deal inputs are corrupt." });
      return;
    }
    try {
      const outputs = underwrite(inputs);
      const html = buildPrintHtml({ deal, inputs, outputs, generatedAt: new Date() });
      const pdf = await renderHtmlToPdf(html, {
        left: "ADG · The Adam Druck Group · Underwriting Summary",
        right: deal.name,
      });
      const filename = `ADG_Summary_${slugifyForFilename(deal.name)}.pdf`;
      logActivity("deal.print_summary", { userId: req.user!.id, dealId: deal.id });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.end(pdf);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || "Failed to render PDF" });
    }
  });

  // POST /api/deals/:id/report.pdf — AI-generated investor report.
  // Streams the deal to Claude with the buy-side system prompt + web_search,
  // renders the returned HTML to PDF via Puppeteer. Degrades gracefully
  // when no ANTHROPIC_API_KEY is set.
  app.post("/api/deals/:id/report.pdf", requireAuth, async (req, res) => {
    const deal = getDealById(String(req.params.id));
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    if (!isReportConfigured()) {
      res.status(503).json({
        configured: false,
        error: "AI Investor Report isn't configured. Set ANTHROPIC_API_KEY on this deployment to enable it. (The Print Summary still works.)",
      });
      return;
    }
    let inputs: DealInputs;
    try { inputs = JSON.parse(deal.inputs) as DealInputs; } catch {
      res.status(500).json({ error: "Deal inputs are corrupt." });
      return;
    }
    try {
      const outputs = underwrite(inputs);
      const result = await generateAiReport({ deal, inputs, outputs });
      const pdf = await renderHtmlToPdf(result.html, {
        left: "ADG · The Adam Druck Group · Investment Underwriting & Valuation",
        right: deal.name,
      });
      const filename = `ADG_Investor_Report_${slugifyForFilename(deal.name)}.pdf`;
      logActivity("deal.investor_report", {
        userId: req.user!.id,
        dealId: deal.id,
        meta: { model: result.model, durationMs: result.durationMs, usage: result.usage },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.end(pdf);
    } catch (e) {
      console.error("[investor-report] failed:", e);
      res.status(500).json({ error: (e as Error).message || "Report generation failed" });
    }
  });

  // AI document import — upload a PDF / image / CSV, get back a partial
  // DealInputs the editor pre-fills. Degrades gracefully when no API key is set.
  app.post("/api/extract", requireAuth, upload.single("file"), async (req, res) => {
    const f = (req as Request & { file?: { buffer: Buffer; mimetype: string; originalname: string } }).file;
    if (!f) {
      res.status(400).json({ error: "No file uploaded." });
      return;
    }
    try {
      const result = await extractDealFromDocument({
        buffer: f.buffer,
        mediaType: f.mimetype,
        filename: f.originalname,
      });
      logActivity("deal.extracted", {
        userId: req.user!.id,
        meta: { filename: f.originalname, ok: result.ok, configured: result.configured },
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || "Extraction failed" });
    }
  });

  // ── admin ─────────────────────────────────────────────────────────────
  app.get("/api/admin/users", requireAdmin, (_req, res) => {
    res.json({ users: listUsers().map(safeUser) });
  });

  app.post("/api/admin/users/:id/approve", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = getUserById(id);
    if (!u) { res.status(404).json({ error: "User not found" }); return; }
    setUserStatus(id, "active");
    res.json({ ok: true });
  });

  app.post("/api/admin/users/:id/block", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = getUserById(id);
    if (!u) { res.status(404).json({ error: "User not found" }); return; }
    // Safeguard: never block the last active admin.
    if (u.role === "admin" && u.status === "active" && countActiveAdmins() <= 1) {
      res.status(400).json({ error: "Cannot block the last active admin." });
      return;
    }
    setUserStatus(id, "blocked");
    res.json({ ok: true });
  });

  app.post("/api/admin/users/:id/promote", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = getUserById(id);
    if (!u) { res.status(404).json({ error: "User not found" }); return; }
    setUserRole(id, "admin");
    res.json({ ok: true });
  });

  app.post("/api/admin/users/:id/demote", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = getUserById(id);
    if (!u) { res.status(404).json({ error: "User not found" }); return; }
    if (u.role === "admin" && countActiveAdmins() <= 1) {
      res.status(400).json({ error: "Cannot demote the last active admin." });
      return;
    }
    setUserRole(id, "user");
    res.json({ ok: true });
  });

  app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = getUserById(id);
    if (!u) { res.status(404).json({ error: "User not found" }); return; }
    if (u.role === "admin" && countActiveAdmins() <= 1) {
      res.status(400).json({ error: "Cannot delete the last active admin." });
      return;
    }
    deleteUser(id);
    res.json({ ok: true });
  });
}
