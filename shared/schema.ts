import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Users ───────────────────────────────────────────────────────────────────
// Status flow: pending → active. New signups land in `pending` and must be
// approved by an admin. `ADMIN_EMAIL` self-heals to admin+active on every boot
// via server/seedAdmin.ts.
export const users = sqliteTable("users", {
  id:           integer("id").primaryKey({ autoIncrement: true }),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name:         text("name").notNull(),
  role:         text("role").notNull().default("user"),     // "user" | "admin"
  status:       text("status").notNull().default("pending"), // "pending" | "active" | "blocked"
  createdAt:    text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  passwordHash: true,
}).extend({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Deals ───────────────────────────────────────────────────────────────────
// Principle (spec §4): STORE INPUTS, NEVER STORE COMPUTED OUTPUTS. Outputs are
// recomputed on every read so numbers can't go stale. `inputs` is the full
// DealInputs blob; the denormalized columns are a snapshot for the list view
// only — never read them for the detail page.
export const deals = sqliteTable("deals", {
  id:            text("id").primaryKey(),         // nanoid
  userId:        integer("user_id").notNull(),
  name:          text("name").notNull(),
  address:       text("address"),
  propertyType:  text("property_type"),
  status:        text("status").notNull().default("analyzing"), // analyzing | under_contract | closed | archived
  inputs:        text("inputs").notNull(),        // JSON DealInputs blob
  // denormalized snapshot for the list screen
  purchasePrice: integer("purchase_price"),
  units:         integer("units"),
  capRatePct:    real("cap_rate_pct"),
  cashFlowMo:    integer("cash_flow_mo"),
  createdAt:     text("created_at").notNull(),
  updatedAt:     text("updated_at").notNull(),
}, (t) => ({
  byUser: index("deals_user_idx").on(t.userId),
}));

export type Deal = typeof deals.$inferSelect;
export type InsertDeal = typeof deals.$inferInsert;

// ── Deal photos ─────────────────────────────────────────────────────────────
// Files live on the /data volume under /data/photos/<dealId>/<filename>.
export const dealPhotos = sqliteTable("deal_photos", {
  id:        integer("id").primaryKey({ autoIncrement: true }),
  dealId:    text("deal_id").notNull(),
  path:      text("path").notNull(),     // relative to /data/photos
  caption:   text("caption"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

// ── Deal shares ─────────────────────────────────────────────────────────────
// Public read-only report links (Phase 2 — table is here so we don't need a
// schema migration when we add /s/:token).
export const dealShares = sqliteTable("deal_shares", {
  id:        integer("id").primaryKey({ autoIncrement: true }),
  dealId:    text("deal_id").notNull(),
  token:     text("token").notNull().unique(),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull(),
});

// ── Deal reports ────────────────────────────────────────────────────────────
// AI Investor Reports are expensive and slow to generate (~45-90s+, sometimes
// 2-3min with web search). Generation runs in the background; the row is the
// source of truth for its progress. Status flow:
//   generating → ready    (PDF saved at `path`, sizeBytes set)
//   generating → failed   (errorMessage set; path empty)
// The client polls GET /api/reports/:id every ~1.5s to update a progress bar
// against the `stage` field.
export const dealReports = sqliteTable("deal_reports", {
  id:           text("id").primaryKey(),           // nanoid
  dealId:       text("deal_id").notNull(),
  userId:       integer("user_id").notNull(),
  kind:         text("kind").notNull().default("investor"), // "investor" | future kinds
  status:       text("status").notNull().default("ready"),  // "generating" | "ready" | "failed"
  stage:        text("stage").notNull().default("saved"),   // queued | ai_thinking | ai_searching | ai_writing | rendering | saving | saved | failed
  errorMessage: text("error_message"),
  filename:     text("filename").notNull(),        // disposition-ready filename
  path:         text("path").notNull().default(""),// relative to <dataDir>/reports; empty until status=ready
  sizeBytes:    integer("size_bytes").notNull().default(0),
  model:        text("model"),                     // e.g. "claude-opus-4-8"
  durationMs:   integer("duration_ms"),
  startedAt:    text("started_at"),
  createdAt:    text("created_at").notNull(),
});

// ── Activities (audit log) ─────────────────────────────────────────────────
export const activities = sqliteTable("activities", {
  id:        integer("id").primaryKey({ autoIncrement: true }),
  userId:    integer("user_id"),
  dealId:    text("deal_id"),
  type:      text("type").notNull(),      // "deal.created" | "deal.updated" | "deal.shared" | ...
  meta:      text("meta"),                // JSON blob
  createdAt: text("created_at").notNull(),
});
