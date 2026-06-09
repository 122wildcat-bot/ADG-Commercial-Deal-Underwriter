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
