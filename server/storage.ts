import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, count } from "drizzle-orm";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { nanoid } from "nanoid";
import {
  users,
  deals,
  dealPhotos,
  dealShares,
  dealReports,
  activities,
  type User,
  type Deal,
} from "../shared/schema";
import { getDataDir } from "./dataDir";

// ── DB bootstrap ───────────────────────────────────────────────────────────
const DATA_DIR = getDataDir();
if (DATA_DIR && !existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, "underwriter.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Hand-rolled CREATE TABLEs so a fresh container boots without `drizzle-kit
// push`. Idempotent: `IF NOT EXISTS`. Keep in sync with shared/schema.ts.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    property_type TEXT,
    status TEXT NOT NULL DEFAULT 'analyzing',
    inputs TEXT NOT NULL,
    purchase_price INTEGER,
    units INTEGER,
    cap_rate_pct REAL,
    cash_flow_mo INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS deals_user_idx ON deals(user_id);

  CREATE TABLE IF NOT EXISTS deal_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id TEXT NOT NULL,
    path TEXT NOT NULL,
    caption TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deal_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deal_reports (
    id TEXT PRIMARY KEY,
    deal_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'investor',
    status TEXT NOT NULL DEFAULT 'ready',
    stage TEXT NOT NULL DEFAULT 'saved',
    error_message TEXT,
    filename TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    duration_ms INTEGER,
    started_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS deal_reports_deal_idx ON deal_reports(deal_id);

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    deal_id TEXT,
    type TEXT NOT NULL,
    meta TEXT,
    created_at TEXT NOT NULL
  );
`);

// Idempotent ALTER TABLE for existing deal_reports rows from before the
// background-generation columns existed. CREATE TABLE IF NOT EXISTS won't
// add columns to an existing table — only the first run creates everything.
function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
  if (!cols.includes(column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
addColumnIfMissing("deal_reports", "status",        "status TEXT NOT NULL DEFAULT 'ready'");
addColumnIfMissing("deal_reports", "stage",         "stage TEXT NOT NULL DEFAULT 'saved'");
addColumnIfMissing("deal_reports", "error_message", "error_message TEXT");
addColumnIfMissing("deal_reports", "started_at",    "started_at TEXT");
// `path` and `size_bytes` previously had NOT NULL with no default — old rows
// already have values, but new in-progress inserts need a default of empty/0.
// (Drizzle keeps NOT NULL on those columns; the default on insert is what
// matters.) No ALTER needed because the values are always provided on insert.

export const db = drizzle(sqlite);

// ── Users ──────────────────────────────────────────────────────────────────
export function getUserById(id: number): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function getUserByEmail(email: string): User | undefined {
  return db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
}

export function createUser(data: {
  email: string;
  passwordHash: string;
  name: string;
  role?: "user" | "admin";
  status?: "pending" | "active" | "blocked";
}): User {
  const now = new Date().toISOString();
  const result = db.insert(users).values({
    email: data.email.toLowerCase(),
    passwordHash: data.passwordHash,
    name: data.name,
    role: data.role ?? "user",
    status: data.status ?? "pending",
    createdAt: now,
  }).run();
  return getUserById(Number(result.lastInsertRowid))!;
}

export function setUserStatus(id: number, status: "pending" | "active" | "blocked"): void {
  db.update(users).set({ status }).where(eq(users.id, id)).run();
}

export function setUserRole(id: number, role: "user" | "admin"): void {
  db.update(users).set({ role }).where(eq(users.id, id)).run();
}

export function setUserPassword(id: number, passwordHash: string): void {
  db.update(users).set({ passwordHash }).where(eq(users.id, id)).run();
}

/** Sync name (and optionally role) on repeat SSO from the Suite. */
export function updateUserProfile(id: number, data: { name?: string; role?: "user" | "admin" }): void {
  const patch: Record<string, string> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.role !== undefined) patch.role = data.role;
  if (Object.keys(patch).length === 0) return;
  db.update(users).set(patch).where(eq(users.id, id)).run();
}

export function deleteUser(id: number): void {
  db.delete(users).where(eq(users.id, id)).run();
}

export function listUsers(): User[] {
  return db.select().from(users).orderBy(desc(users.createdAt)).all();
}

export function countActiveAdmins(): number {
  const row = db.select({ n: count() }).from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active"))).get();
  return Number(row?.n ?? 0);
}

// ── Deals ──────────────────────────────────────────────────────────────────
export function listDealsForUser(userId: number, isAdmin: boolean): Deal[] {
  if (isAdmin) {
    return db.select().from(deals).orderBy(desc(deals.updatedAt)).all();
  }
  return db.select().from(deals).where(eq(deals.userId, userId)).orderBy(desc(deals.updatedAt)).all();
}

export function getDealById(id: string): Deal | undefined {
  return db.select().from(deals).where(eq(deals.id, id)).get();
}

export interface CreateDealInput {
  userId: number;
  name: string;
  address?: string | null;
  propertyType?: string | null;
  status?: string;
  inputs: string; // JSON DealInputs
  // denormalized snapshot
  purchasePrice?: number | null;
  units?: number | null;
  capRatePct?: number | null;
  cashFlowMo?: number | null;
}

export function createDeal(data: CreateDealInput): Deal {
  const now = new Date().toISOString();
  const id = nanoid(12);
  db.insert(deals).values({
    id,
    userId: data.userId,
    name: data.name,
    address: data.address ?? null,
    propertyType: data.propertyType ?? null,
    status: data.status ?? "analyzing",
    inputs: data.inputs,
    purchasePrice: data.purchasePrice ?? null,
    units: data.units ?? null,
    capRatePct: data.capRatePct ?? null,
    cashFlowMo: data.cashFlowMo ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return getDealById(id)!;
}

export interface UpdateDealInput {
  name?: string;
  address?: string | null;
  propertyType?: string | null;
  status?: string;
  inputs?: string;
  purchasePrice?: number | null;
  units?: number | null;
  capRatePct?: number | null;
  cashFlowMo?: number | null;
}

export function updateDeal(id: string, data: UpdateDealInput): Deal | undefined {
  const now = new Date().toISOString();
  const existing = getDealById(id);
  if (!existing) return undefined;
  db.update(deals).set({ ...data, updatedAt: now }).where(eq(deals.id, id)).run();
  return getDealById(id);
}

export function deleteDeal(id: string): void {
  db.delete(deals).where(eq(deals.id, id)).run();
  db.delete(dealPhotos).where(eq(dealPhotos.dealId, id)).run();
  db.delete(dealShares).where(eq(dealShares.dealId, id)).run();
  db.delete(dealReports).where(eq(dealReports.dealId, id)).run();
  db.delete(activities).where(eq(activities.dealId, id)).run();
}

// ── Reports ──────────────────────────────────────────────────────────────
export interface StartReportInput {
  dealId: string;
  userId: number;
  kind?: "investor";
  filename: string; // filename we'll suggest at download time
}

/** Start a report job: insert the row in 'generating'/'queued' state. */
export function startReportJob(data: StartReportInput): string {
  const now = new Date().toISOString();
  const id = nanoid(12);
  db.insert(dealReports).values({
    id,
    dealId: data.dealId,
    userId: data.userId,
    kind: data.kind ?? "investor",
    status: "generating",
    stage: "queued",
    filename: data.filename,
    path: "",
    sizeBytes: 0,
    startedAt: now,
    createdAt: now,
  }).run();
  return id;
}

export type ReportStage =
  | "queued"
  | "ai_thinking"
  | "ai_searching"
  | "ai_writing"
  | "rendering"
  | "saving"
  | "saved"
  | "failed";

// Numeric rank for the monotonic stage advance guard below. Without this an
// out-of-order Anthropic stream event could make the UI progress bar jump
// backward — confusing for the user even if the underlying work is fine.
const STAGE_RANK: Record<ReportStage, number> = {
  queued: 0,
  ai_thinking: 1,
  ai_searching: 2,
  ai_writing: 3,
  rendering: 4,
  saving: 5,
  saved: 6,
  failed: 99, // terminal — always wins
};

/** Update a report job's stage. MONOTONIC: only advances forward (failed wins). */
export function updateReportStage(id: string, stage: ReportStage): void {
  const current = db.select({ stage: dealReports.stage }).from(dealReports).where(eq(dealReports.id, id)).get();
  if (!current) return;
  const currentRank = STAGE_RANK[current.stage as ReportStage] ?? 0;
  const nextRank = STAGE_RANK[stage] ?? 0;
  if (nextRank < currentRank) return; // ignore backward transitions
  db.update(dealReports).set({ stage }).where(eq(dealReports.id, id)).run();
}

/** Mark a report job as ready and store the on-disk pointer. */
export function markReportReady(id: string, data: {
  path: string;
  sizeBytes: number;
  model: string;
  durationMs: number;
}): void {
  db.update(dealReports).set({
    status: "ready",
    stage: "saved",
    path: data.path,
    sizeBytes: data.sizeBytes,
    model: data.model,
    durationMs: data.durationMs,
  }).where(eq(dealReports.id, id)).run();
}

/** Mark a report job as failed and store the error message. */
export function markReportFailed(id: string, errorMessage: string): void {
  db.update(dealReports).set({
    status: "failed",
    stage: "failed",
    errorMessage,
  }).where(eq(dealReports.id, id)).run();
}

export function getReportById(id: string) {
  return db.select().from(dealReports).where(eq(dealReports.id, id)).get();
}

export function listReportsForDeal(dealId: string) {
  return db.select().from(dealReports).where(eq(dealReports.dealId, dealId)).orderBy(desc(dealReports.createdAt)).all();
}

export function deleteReport(id: string): void {
  db.delete(dealReports).where(eq(dealReports.id, id)).run();
}

/**
 * On boot, any rows still in status="generating" are by definition orphaned
 * — the process that was running them no longer exists (Railway redeploy,
 * OOM crash, etc.). Mark them failed so the UI shows a clear error instead
 * of an indefinite spinner. Called once at server startup.
 */
export function cleanupOrphanedReports(log: (m: string) => void = (m) => console.log(m)): void {
  const orphans = db.select().from(dealReports).where(eq(dealReports.status, "generating")).all();
  if (orphans.length === 0) return;
  for (const r of orphans) {
    db.update(dealReports).set({
      status: "failed",
      stage: "failed",
      errorMessage: "Generation was interrupted by a server restart. Please try again.",
    }).where(eq(dealReports.id, r.id)).run();
  }
  log(`[report-cleanup] marked ${orphans.length} orphaned generating row(s) as failed.`);
}

// ── Activities ────────────────────────────────────────────────────────────
export function logActivity(
  type: string,
  opts: { userId?: number; dealId?: string; meta?: unknown } = {},
): void {
  const now = new Date().toISOString();
  db.insert(activities).values({
    type,
    userId: opts.userId ?? null,
    dealId: opts.dealId ?? null,
    meta: opts.meta == null ? null : JSON.stringify(opts.meta),
    createdAt: now,
  }).run();
}

// ── Summary (public) ──────────────────────────────────────────────────────
export function publicSummary(): { deals: number; lastUpdated: string | null } {
  const c = db.select({ n: count() }).from(deals).get();
  const latest = db.select({ updatedAt: deals.updatedAt }).from(deals).orderBy(desc(deals.updatedAt)).limit(1).get();
  return {
    deals: Number(c?.n ?? 0),
    lastUpdated: latest?.updatedAt ?? null,
  };
}

// Export the raw storage namespace too (used by seedAdmin).
export const storage = {
  getUserByEmail,
  createUser,
  setUserStatus,
  setUserRole,
  setUserPassword,
};
