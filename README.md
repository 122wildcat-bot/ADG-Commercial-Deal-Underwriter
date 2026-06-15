# ADG Commercial Deal Underwriter

An ADG-branded commercial / multi-family buy-&-hold analysis engine. Enter a
deal (purchase, financing, rent roll, expenses, assumptions) and instantly get
the full DealCheck-style analysis: Year-1 cash flow, return metrics, 1–35yr
projection, tax/depreciation, equity & sale analysis, charts, branded report.

## Stack

- TypeScript · React + Vite (client) · Express (server) · Drizzle ORM +
  better-sqlite3
- The underwriting engine lives in `shared/engine/underwrite.ts` — a pure,
  deterministic function imported by both the browser (live recompute as the
  user types) and the server (report / PDF / stateless `/api/underwrite`).

## Local development

```bash
npm install
cp .env.example .env   # then fill in JWT_SECRET / ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev
```

Open http://localhost:5000 — the first signup that matches `ADMIN_EMAIL` is
auto-promoted to admin.

## Railway deployment

Each Railway service auto-deploys from its connected GitHub branch on push.

1. Create a new Railway service from this repo.
2. Set env vars from `.env.example` (`JWT_SECRET`, `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`, `APP_URL`, `NODE_ENV=production`).
3. **⚠️ Mount a Railway Volume at `/data`** — Service → Settings → Volumes →
   add new volume mounted at `/data`. Without this, every redeploy wipes the
   SQLite database and all saved deals are lost. The `getDataDir()` resolver in
   `server/dataDir.ts` honors:
   `DATA_DIR → RAILWAY_VOLUME_MOUNT_PATH → /data (on Railway) → cwd (local)`.
4. Healthcheck path: `/api/health`.

## Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | Railway healthcheck → `{ ok: true }` |
| `GET /api/summary` | none | Public summary for the Suite tile |
| `POST /api/auth/signup` | none | Create a new (pending) account |
| `POST /api/auth/login` | none | Issue a JWT |
| `GET /api/auth/me` | token | Current user |
| `GET /api/deals` | token | List deals (own + admin sees all) |
| `POST /api/deals` | token | Create deal |
| `GET /api/deals/:id` | token | `{ inputs, outputs }` — outputs computed live |
| `PUT /api/deals/:id` | token | Update inputs |
| `DELETE /api/deals/:id` | token | Delete |
| `POST /api/deals/:id/duplicate` | token | Clone a deal |
| `POST /api/underwrite` | token | Stateless underwrite (no save) |
| `POST /api/extract` | token | AI import: PDF / image / CSV → partial `DealInputs` |
| `GET /api/deals/:id/print.pdf` | token | Deterministic engine-data summary (no API key) |
| `POST /api/deals/:id/report.pdf` | token | Claude-generated investor report (needs `ANTHROPIC_API_KEY`) |

`outputs` are always computed live from the shared engine — they are never
stored, so numbers can never go stale.

## The engine

`shared/engine/underwrite.ts` implements every formula in
`docs/commercial-deal-underwriter-spec.md` §5. Critical non-obvious rules:

1. **Asymmetric compounding.** Income & expenses use `(year − 1)` growth
   periods (Year 1 = base); property value uses `(year)` periods (Year 1
   already includes one year of appreciation).
2. **Each expense line grows on its own basis** — fixed-`$` lines at
   `expenseIncreasePct`; `%-of-rent` lines (maintenance / %-mgmt / %-capex)
   track gross rent at `incomeIncreasePct`. Grow lines, then sum — never grow
   the prior total.
3. **Depreciation** = `(price + purchaseCosts − landValue) / depreciationYears`.
   Picker exposes 27.5 (residential rental, ≤ 4 units) and 39 (commercial).
4. **Loan interest deduction** = year's payments − principal paid that year.
   Payment → 0 the year after the term ends.
5. **Sale (year N):** `proceeds = equity − sellingCosts`;
   `profit = proceeds + cumulativeCashFlow − totalCashNeeded`.

### Golden-master test (ship-blocker)

`shared/engine/underwrite.test.ts` runs the engine against the Fallsview Rd
inputs from the spec and asserts the projected outputs to ±$2. CI fails on any
drift, so the engine cannot silently start lying.

```bash
npm test
```

## Rent entry: itemized roll or single total

The Rent Roll section has two modes (`inputs.rentEntryMode`):

- **Itemize by unit** (`"roll"`, the default) — per-unit rows sum to gross rent.
- **Single monthly total** (`"simple"`) — one `simpleMonthlyRent` figure stands
  in for the whole roll; handy at the start of a deal before the rent roll is
  known. The itemized roll is preserved in state, so switching back loses
  nothing. Other income is added on top in both modes.

The engine honors the mode; deals saved before this field existed (and the
golden master) behave exactly as before, since absent ⇒ `"roll"`.

## Investor Report & Print Summary

The deal analysis page has two report buttons:

- **Print Summary** — a deterministic, branded PDF of the engine's outputs
  (cover, Year-1 waterfall, ratio grid, projection table, sale analysis).
  No API key, instant, free. Source: `server/printTemplate.ts` + Puppeteer
  (`server/pdfRender.ts`).
- **Investor Report** — a Claude-generated, investor-grade narrative report
  with executive verdict, three-price framework (Ask / Walk-Away Ceiling /
  Buy Target), income normalization (Seller View vs. Lender-Underwritten),
  sensitivity / stress testing, comparable evidence, strategy & negotiation
  plan, and a due-diligence checklist. Mirrors the PVG (Property Valuation
  Generator) pattern, reframed for buy-side underwriting. Requires
  `ANTHROPIC_API_KEY`; web search is enabled (`web_search_20260209`, max 5
  queries) so the model can ground comps and market context. Latency
  ~45-90s. Source: `server/aiReport.ts` + `server/reportSystemPrompt.ts`.

Both PDFs use the same Puppeteer renderer (`server/pdfRender.ts`), which
points at the system Chromium installed by the Dockerfile.

### Switching to Dockerfile build (Railway)

Puppeteer needs Chromium and a handful of apt-installed libs. nixpacks
can't carry those cleanly, so this repo ships a multi-stage `Dockerfile`
and `railway.json` is set to `builder: "DOCKERFILE"`. Railway auto-detects
the change on first deploy after merging.

Local development outside Docker: install Chromium and set
`PUPPETEER_EXECUTABLE_PATH=/path/to/chromium`, or just let Puppeteer
download its own bundled Chromium (`npm install` without
`PUPPETEER_SKIP_DOWNLOAD=true`).

## AI document import

Click **Import** in the deal editor to upload a PDF, image, or CSV (an MLS
sheet, offering memo, rent roll, T-12, …). Claude extracts a partial
`DealInputs` (via forced tool use) that pre-fills the editor for review — it
never auto-saves, and it omits fields it can't find rather than guessing.

- Module: `server/aiExtract.ts`. Default model is the most capable Claude,
  overridable via `ANTHROPIC_MODEL` (e.g. `claude-sonnet-4-6` to cut cost);
  key via `ANTHROPIC_API_KEY`.
- **Degrades gracefully** (fleet convention): with no key, Import shows a clear
  "not configured" note and manual entry is unaffected — core flows never block
  on the API.
- Uploads are held in memory, streamed to the API, and discarded (15 MB cap).

## Tech notes

- **Auth.** Standalone email+password (bcrypt + JWT bearer in localStorage),
  pending → approved by admin, `ADMIN_EMAIL` self-heals to admin on every boot
  via `server/seedAdmin.ts`. Structured so a Suite SSO hook
  (`#sso=<signed-jwt>`) can drop in later.
- **CRM.** A typed CRM client (`server/crmClient.ts`) with `CRM_MODE=mock`
  default. Live integration deferred to a later additive PR — endpoints we'll
  need from the CRM are documented as TODOs in `crmClient.ts`.
- **Data persistence.** SQLite at `${DATA_DIR}/underwriter.db`. Photos under
  `${DATA_DIR}/photos/`.

## Suite tile follow-up

Once the live Railway URL is human-verified, add the tile to
`adg-team-suite-/server/tools.js`:

```js
{
  name: "Commercial Deal Underwriter",
  tagline: "Commercial / Multi-Family",
  description: "Underwrite commercial buy-&-hold deals with a full DealCheck-style analysis.",
  url: "https://<verified-railway-url>",
  initials: "CU",
  verifyUrl: true, // remove once Adam confirms from the browser
  feed: "/api/summary",
  summarize: (data) => `${data.deals} deals`,
}
```

Per fleet convention, the sandbox cannot reach `*.up.railway.app`; Adam
verifies the live URL from a browser before the `verifyUrl: true` is removed.
