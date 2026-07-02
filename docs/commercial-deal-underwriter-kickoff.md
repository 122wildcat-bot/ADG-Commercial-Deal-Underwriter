# Claude Code Kickoff — ADG Commercial Deal Underwriter

> Paste this as the first message in Claude Code after creating the repo, or
> commit it as `CLAUDE.md`. It is self-contained: it encodes the ADG fleet
> conventions plus this tool's Phase-1 scope. The full reference is
> `docs/commercial-deal-underwriter-spec.md` (commit it alongside this file).

You are building a new tool in the **Adam Druck Group (ADG) fleet**: the
**Commercial Deal Underwriter** — an ADG-branded clone of DealCheck's
commercial / multi-family buy-&-hold analysis engine. Enter a deal; get the full
DealCheck-style analysis (Year-1 cash flow, return metrics, 1–35yr projection,
tax/depreciation, equity & sale analysis, charts, branded report).

## Fleet conventions — follow exactly
- **Repo:** under `122wildcat-bot`, default branch `main`. Do all work on branch
  **`claude/adg-team-suite-dashboard-cPeze`** (create from `main`). One change
  per PR.
- **Stack:** TypeScript · React + Vite (client) · Express (server) · Drizzle ORM
  + better-sqlite3. Mirror the structure of `flipiq` / `adg-listing-launchpad`.
- **Storage:** implement a `getDataDir()` resolver honoring
  `DATA_DIR → RAILWAY_VOLUME_MOUNT_PATH → /data → ./.data` (local fallback).
  Reference `adg-listing-launchpad/server/dataDir.ts`. The SQLite file and any
  uploads live under that dir. README must say: **mount a Railway Volume at
  `/data`** (Railway wipes the container FS on every redeploy).
- **Health:** `GET /api/health` → `{ ok: true }` (Railway healthcheck).
- **Public summary:** `GET /api/summary` (no auth) → small JSON for the Suite
  tile, e.g. `{ deals: <count>, lastUpdated: <iso> }`.
- **Graceful root:** `/` handles logged-out visitors (login page or redirect) —
  never a raw 401.
- **Secrets:** never commit. Railway env vars only; `.env.example` documents
  names. Include `app.set("trust proxy", 1)`; secure cookies when
  `NODE_ENV=production`.
- **Mobile-first** UI. **Branding:** CB Blue `#012169`, Celestial `#418FDE`,
  Fraunces (display) + Inter (body), ADG logo mark — match adamdruckgroup.com.
- **Railway:** `nixpacks.toml` + `railway.json`, healthcheck `/api/health`.
- ⚠️ The sandbox cannot reach `*.up.railway.app` or live domains. **Do not claim
  a live URL works** — say it needs human verification.

## The engine is the point — it must tie out to the dollar
Put a **pure, deterministic** `underwrite(inputs: DealInputs): DealOutputs` in
`shared/engine/underwrite.ts` so the **same code runs in the browser** (live
recompute as the user types) **and on the server** (report/PDF). No I/O in the
engine. See spec §5 for every formula.

**Critical non-obvious rules (these silently break clones — spec §5.4):**
1. **Asymmetric compounding:** income & expenses use `(year−1)` growth periods
   (Year 1 = base); **property value uses `(year)`** periods
   (`value_Y = ARV·(1+appr)^Y`, so Year 1 already has one year of appreciation).
2. **Grow each expense line on its own basis, then sum** — fixed-`$` lines at
   `expenseIncrease%`; `%-of-rent` lines (maintenance/%-mgmt/%-capex) track gross
   rent at `incomeIncrease%`. Never grow the prior total.
3. **Depreciation** = `(price + purchaseCosts − landValue) / depreciationYears`,
   straight-line; default **39** (commercial), make it an input.
4. **Loan interest deduction** = year's payments − principal paid that year;
   payment → 0 the year after term ends.
5. **Sale (yr N):** `proceeds = equity − sellingCosts`;
   `profit = proceeds + cumulativeCashFlow − totalCashNeeded`.

## Phase 1 deliverable (this kickoff) — scope tightly
1. Repo scaffold (client + server + shared), `getDataDir()`, `/api/health`,
   `.env.example`, `nixpacks.toml`, `railway.json`, README with the `/data`
   volume note.
2. Drizzle schema: `deals` (with `inputs` JSON + denormalized
   `purchasePrice/units/capRatePct/cashFlowMo`), `deal_photos`, `deal_shares`,
   `activities` (spec §4).
3. The shared `underwrite()` engine (spec §5).
4. **Golden-master test (ship-blocker):** unit-test the engine with the
   **Fallsview Rd** inputs and assert the expected outputs (spec §5.5) to ±$2.
   Wire it into CI; CI fails on drift.
5. Deal CRUD API (spec §6): `GET/POST /api/deals`, `GET/PUT/DELETE
   /api/deals/:id`, `POST /api/deals/:id/duplicate`, `POST /api/underwrite`
   (stateless), `GET /api/summary`. `GET /api/deals/:id` returns
   `{ inputs, outputs }` with outputs **computed live** from the shared engine.
6. UI: login/graceful root → deals list → deal editor (collapsible sections,
   **sticky live results bar** recomputing via the shared engine) → analysis view
   (Year-1 cash-flow waterfall, ratio grid, projection table w/ year selector,
   **Cash Flow Over Time** + **Equity Over Time** charts via Recharts).
7. **CRM-ready, mock first:** typed CRM client with `CRM_MODE=mock` fallback
   (`CRM_BASE_URL` + `CRM_API_KEY` env vars). Don't call the live CRM yet;
   document needed endpoints as a spec note for a later additive PR.

**Out of scope for Phase 1** (later PRs, spec §3/§10): branded print report &
photos UI, public share links, lease schedules + NNN recoveries, max-offer /
reverse valuation, side-by-side comparison, AI deal extraction, MVE/CRM live
integration. Auth: see "Open decision" below.

## Auth (open decision — ask before building)
Spec §11: (a) standalone email+password (copy FlipIQ/Suite pattern: bcrypt, JWT
cookie, pending→approved, `ADMIN_EMAIL` owner self-heal) — matches current fleet
reality; or (b) SSO via signed JWT from the ADG Team Suite. **Default to (a),
structured so an SSO hook drops in later.** Confirm with Adam before wiring.

## AI features — Phase 3, degrade gracefully (don't build yet)
When added: fall back to non-AI whenever `ANTHROPIC_API_KEY` is missing/the call
fails. Default model `claude-opus-4-8` (override `ANTHROPIC_MODEL`; latest:
Opus 4.8 `claude-opus-4-8`, Sonnet 4.6, Haiku 4.5 `claude-haiku-4-5`). Strict
JSON schema (`output_config.format`); `cache_control` on the frozen system
prompt.

## Definition of done (Phase 1)
- `npm run typecheck` and the test suite pass; **golden-master test green.**
- App runs locally; `/` is graceful when logged out; `/api/health` and
  `/api/summary` respond.
- You can create a deal, edit it with live-updating metrics, and view the full
  analysis + projection + charts; the Fallsview deal reproduces the report.
- README documents env vars and the **`/data` Railway Volume** requirement.
- State the Suite-tile step (add to `adg-team-suite-/server/tools.js` with
  `verifyUrl: true`, `feed: "/api/summary"`, a `summarize`) as the follow-up,
  and note the live URL must be human-verified.
