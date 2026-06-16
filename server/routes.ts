import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { z } from "zod";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { underwrite } from "../shared/engine/underwrite";
import type { DealInputs } from "../shared/types";
import { extractDealFromDocument, MAX_UPLOAD_BYTES } from "./aiExtract";
import { renderHtmlToPdf, slugifyForFilename } from "./pdfRender";
import { buildPrintHtml } from "./printTemplate";
import { generateAiReportWithRetry, isReportConfigured } from "./aiReport";
import { saveReportPdf, readReportPdf, deleteReportPdf } from "./reportStorage";

import {
  createDeal,
  createUser,
  deleteDeal,
  deleteReport,
  deleteUser,
  getDealById,
  getReportById,
  getUserByEmail,
  getUserById,
  countActiveAdmins,
  listDealsForUser,
  listReportsForDeal,
  listUsers,
  logActivity,
  markReportFailed,
  markReportReady,
  publicSummary,
  setUserRole,
  setUserStatus,
  startReportJob,
  updateDeal,
  updateReportStage,
  updateUserProfile,
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

  // ── ADG Team Suite SSO ──────────────────────────────────────────────────
  // The Suite mints a 90s HS256 JWT signed with SSO_SHARED_SECRET (same
  // value on the Suite and every tool) and sends the user to /sso?token=…
  // We verify it, find-or-create the user by email, then mint our OWN JWT
  // and hand it to the SPA via /#sso=… (consumeSsoToken() in main.tsx picks
  // it up and stores it in localStorage). Mirrors flipiq's contract; the
  // standalone email/password login is untouched.
  const SSO_SHARED_SECRET = (process.env.SSO_SHARED_SECRET || "").trim();
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();
  app.get("/sso", async (req, res) => {
    const loginRedirect = "/#/login";
    try {
      const token = String(req.query.token || "");
      if (!token || !SSO_SHARED_SECRET) return res.redirect(loginRedirect);

      const payload = jwt.verify(token, SSO_SHARED_SECRET) as {
        email?: string;
        name?: string;
        role?: "admin" | "agent" | "user";
        suite_user_id?: string;
      };

      const email = String(payload.email || "").toLowerCase().trim();
      if (!email) return res.redirect(loginRedirect);
      const name = (payload.name && String(payload.name).trim()) || email.split("@")[0];

      // Map Suite role → underwriter role. ADMIN_EMAIL match also wins.
      const isAdmin = payload.role === "admin" || (ADMIN_EMAIL && email === ADMIN_EMAIL);
      const role: "user" | "admin" = isAdmin ? "admin" : "user";

      let user = getUserByEmail(email);
      if (!user) {
        // Auto-provision. Random hash satisfies NOT NULL; the user has no
        // usable password — they sign in only via the Suite handoff. Status
        // "active" because the Suite already approved them; no pending step.
        const passwordHash = await bcrypt.hash(`sso:${email}:${Date.now()}:${Math.random()}`, 12);
        user = createUser({ email, passwordHash, name, role, status: "active" });
      } else {
        // Repeat SSO: keep name/role in sync with the Suite; lift any
        // pending/blocked status back to active (Suite vetted them).
        if (user.name !== name || user.role !== role) {
          updateUserProfile(user.id, { name, role });
          user = getUserById(user.id) || user;
        }
        if (user.status !== "active") {
          setUserStatus(user.id, "active");
          user = getUserById(user.id) || user;
        }
      }

      const localToken = signToken(user);
      return res.redirect(`/#sso=${localToken}`);
    } catch {
      return res.redirect(loginRedirect);
    }
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

  // POST /api/deals/:id/report — kick off an AI Investor Report generation.
  // Returns { reportId } IMMEDIATELY; the actual generation runs in the
  // background and updates the report row's status/stage as it progresses.
  // This avoids Railway's edge timeout (~60-90s for idle connections), which
  // was killing long-running reports with a 502.
  //
  // The client polls GET /api/reports/:id every ~1.5s for status + stage and
  // renders a progress bar. When status flips to "ready", the client
  // downloads via GET /api/reports/:id/download.
  app.post("/api/deals/:id/report", requireAuth, async (req, res) => {
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

    const filename = `ADG_Investor_Report_${slugifyForFilename(deal.name)}_${new Date().toISOString().slice(0, 10)}.pdf`;
    const reportId = startReportJob({
      dealId: deal.id,
      userId: req.user!.id,
      kind: "investor",
      filename,
    });
    res.json({ reportId });

    // Fire-and-forget. Persist status/stage so the client polling can follow
    // along. Wrapped in a self-invoking async block so any unhandled rejection
    // surfaces in the log, not as an uncaughtException that kills the process.
    void (async () => {
      const t0 = Date.now();
      console.log(`[investor-report] report=${reportId} deal=${deal.id} starting…`);
      try {
        const outputs = underwrite(inputs);
        const result = await generateAiReportWithRetry({
          deal,
          inputs,
          outputs,
          onStage: (stage) => {
            console.log(`[investor-report] report=${reportId} stage=${stage} +${((Date.now() - t0) / 1000).toFixed(1)}s`);
            updateReportStage(reportId, stage);
          },
        });
        console.log(`[investor-report] report=${reportId} claude_ms=${result.durationMs} html_chars=${result.html.length} usage=${JSON.stringify(result.usage)}`);
        updateReportStage(reportId, "rendering");
        const tRender = Date.now();
        const pdf = await renderHtmlToPdf(result.html, {
          left: "ADG · The Adam Druck Group · Investment Underwriting & Valuation",
          right: deal.name,
        });
        console.log(`[investor-report] report=${reportId} render_ms=${Date.now() - tRender} pdf_bytes=${pdf.length}`);
        updateReportStage(reportId, "saving");
        const saved = await saveReportPdf({ dealId: deal.id, reportId, pdf });
        markReportReady(reportId, {
          path: saved.relPath,
          sizeBytes: saved.sizeBytes,
          model: result.model,
          durationMs: result.durationMs,
        });
        const totalMs = Date.now() - t0;
        console.log(`[investor-report] report=${reportId} ready bytes=${pdf.length} total_ms=${totalMs}`);
        logActivity("deal.investor_report", {
          userId: req.user!.id,
          dealId: deal.id,
          meta: { reportId, model: result.model, durationMs: result.durationMs, usage: result.usage },
        });
      } catch (e) {
        const totalMs = Date.now() - t0;
        const message = (e as Error).message || "Report generation failed";
        console.error(`[investor-report] report=${reportId} failed after ${totalMs}ms:`, e);
        markReportFailed(reportId, message);
      }
    })();
  });

  // GET /api/reports/:id — poll a report's status + stage (for the progress
  // bar). Returns the full metadata blob. Lightweight — no body, no file IO.
  app.get("/api/reports/:id", requireAuth, (req, res) => {
    const report = getReportById(String(req.params.id));
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    const deal = getDealById(report.dealId);
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.json({
      report: {
        id: report.id,
        dealId: report.dealId,
        kind: report.kind,
        status: report.status,
        stage: report.stage,
        filename: report.filename,
        sizeBytes: report.sizeBytes,
        model: report.model,
        durationMs: report.durationMs,
        errorMessage: report.errorMessage,
        startedAt: report.startedAt,
        createdAt: report.createdAt,
      },
    });
  });

  // GET /api/deals/:id/reports — list saved reports for a deal.
  app.get("/api/deals/:id/reports", requireAuth, (req, res) => {
    const deal = getDealById(String(req.params.id));
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    const reports = listReportsForDeal(deal.id).map((r) => ({
      id: r.id,
      kind: r.kind,
      filename: r.filename,
      sizeBytes: r.sizeBytes,
      model: r.model,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    }));
    res.json({ reports });
  });

  // GET /api/reports/:id/download — re-download a saved report PDF.
  app.get("/api/reports/:id/download", requireAuth, (req, res) => {
    const report = getReportById(String(req.params.id));
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    const deal = getDealById(report.dealId);
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    if (report.status !== "ready") {
      res.status(409).json({
        error:
          report.status === "generating"
            ? "Report is still generating. Wait for the progress bar to complete."
            : report.errorMessage || "Report generation failed.",
      });
      return;
    }
    try {
      const pdf = readReportPdf(report.path);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.end(pdf);
    } catch (e) {
      res.status(410).json({ error: (e as Error).message || "Report file missing" });
    }
  });

  // DELETE /api/reports/:id — remove a saved report (DB + disk).
  app.delete("/api/reports/:id", requireAuth, (req, res) => {
    const report = getReportById(String(req.params.id));
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    const deal = getDealById(report.dealId);
    if (!deal || (deal.userId !== req.user!.id && req.user!.role !== "admin")) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    deleteReportPdf(report.path);
    deleteReport(report.id);
    res.json({ ok: true });
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
