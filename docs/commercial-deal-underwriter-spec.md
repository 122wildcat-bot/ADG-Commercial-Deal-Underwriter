# ADG Commercial Deal Underwriter — Build Spec

> Drop this in the new repo at `docs/commercial-deal-underwriter-spec.md`.
> It is the authoritative reference for what we're building and *why the
> numbers must tie out*. Pairs with `commercial-deal-underwriter-kickoff.md`
> (the Claude Code kickoff prompt).

---

## 1. What it is

A **commercial / multi-family deal underwriter** — an ADG-branded clone of the
DealCheck buy-&-hold analysis engine, focused on income-producing commercial and
multi-family property. You enter a deal (purchase, financing, rent roll,
expenses, assumptions) and it instantly returns the full DealCheck-style
analysis: Year-1 cash flow, dozens of return metrics, a 1–35 year buy-&-hold
projection, tax/depreciation, equity accumulation, sale/exit analysis, charts,
and a branded, shareable PDF-quality report.

**North star:** a deal you've underwritten in DealCheck produces *identical
numbers* here. We've already proven the engine ties out to the dollar against
the Fallsview Rd report (see §5.4 golden master).

**Fits the fleet as:** a sibling to FlipIQ. FlipIQ analyzes flips; this analyzes
commercial buy-&-hold. Same stack, same conventions, linked from the Suite.

---

## 2. Fleet placement & conventions (non-negotiable)

- **Repo:** new repo under `122wildcat-bot`. Suggested name
  `adg-commercial-underwriter`. Default branch `main`. Do work on
  `claude/adg-team-suite-dashboard-cPeze` (create from `main`).
- **Stack:** TypeScript, React + Vite (frontend), Express (backend),
  Drizzle ORM + SQLite (better-sqlite3). Same shape as FlipIQ / Listing
  Launchpad.
- **Storage:** `getDataDir()` resolver honoring
  `DATA_DIR → RAILWAY_VOLUME_MOUNT_PATH → /data → local fallback`. Reference
  `adg-listing-launchpad/server/dataDir.ts`. **Mount a Railway Volume at
  `/data`** or every deal is wiped on redeploy.
- **Health:** `GET /api/health` → `{ ok: true }` for Railway's healthcheck.
- **Public summary:** `GET /api/summary` (no auth) → small JSON so the Suite
  tile can show a live stat via `feed` / `summarize`.
- **Graceful root:** `/` must handle logged-out visitors (login page or
  redirect) — never a raw 401.
- **Secrets:** Railway env vars only. `.env.example` documents names.
- **`app.set("trust proxy", 1)`** so secure cookies work behind Railway TLS.
- **Mobile-first UI.** The team is mobile-heavy.
- **Branding:** CB Blue `#012169` + Celestial `#418FDE`, Fraunces (display) +
  Inter (body), ADG logo mark. Match adamdruckgroup.com.
- **Railway:** `nixpacks.toml` + `railway.json`, healthcheck path `/api/health`.
- **Suite tile:** add to `adg-team-suite-/server/tools.js` with
  `verifyUrl: true` until the live URL is confirmed from the browser (never
  guess a Railway URL), plus `feed: "/api/summary"` and a `summarize()`.
- The sandbox can't reach `*.up.railway.app` — **Adam verifies live URLs.**

---

## 3. Feature inventory (mapped from DealCheck)

DealCheck's commercial calculator advertises: detailed rent rolls & lease
schedules; cash-flow + returns; 35-year projections (cash flow, returns, equity
accumulation, tax deductions); per-year sale analysis; creative financing
scenarios; rehab worksheet; after-tax income; side-by-side comparison; custom
purchase criteria; branded shareable PDF reports; sales/rental comps; max-offer
(reverse) calculator; owner lookup; cloud sync.

We phase these so v1 ships the engine + report (the irreplaceable core), then
layer commercial-specific and data-dependent features.

### Phase 1 — Core underwriter (the must-have)
1. **Deal entry** — address, property type (multi-family / mixed-use / retail /
   office / industrial / storage), unit count, total sqft.
2. **Rent roll** — per-unit rows: label, type (residential/commercial/storage),
   beds/baths/sqft, monthly rent. Totals roll up.
3. **Purchase & rehab** — price, ARV, purchase costs (% or $), rehab (% or $),
   land value, depreciation period.
4. **Financing** — one or more loans: amortizing/interest-only, rate, term,
   amount as % of price or $, points/fees. (v1: one conventional loan + the
   amortization math; multi-loan stack is a small extension.)
5. **Operating expenses** — full DealCheck line set, **each line $ or % of
   gross rent**: property taxes, insurance, property management, maintenance,
   capex, HOA, utilities, landscaping, accounting & legal, + custom lines.
6. **Other income** — laundry, parking, storage, billboard/cell, misc.
7. **Assumptions** — vacancy %, appreciation %/yr, income increase %/yr,
   expense increase %/yr, selling costs %, hold period.
8. **Results: Year-1 cash flow** — gross → vacancy → operating income →
   operating expenses → NOI → debt service → cash flow → per-unit.
9. **Results: returns & ratios** — cap rate (purchase & market), CoC, ROE, ROI,
   IRR, rent-to-value, GRM, equity multiple, break-even ratio, DSCR, debt yield,
   price/unit, price/sqft.
10. **Results: buy-&-hold projection** — selectable years (1,2,3,5,10,20,30,
    up to 35): rental income, opex, cash flow, tax deductions (incl. loan
    interest + depreciation), equity accumulation (value, loan balance, LTV,
    equity), sale analysis (equity, selling costs, proceeds, cumulative cash
    flow, total profit), and the same returns over time.
11. **Charts** — Cash Flow Over Time, Equity Over Time (Recharts).
12. **Photos** — upload property photos (stored on `/data` volume).
13. **Branded report** — print-optimized, shareable HTML report that mirrors the
    DealCheck PDF layout (cover, description, purchase analysis, cash flow,
    projections, charts, photos). Browser "print to PDF" produces a clean file.
14. **Save / list / duplicate / delete** deals, scoped per agent.

### Phase 2 — Commercial depth + sharing
- **Lease schedules** — per-unit lease type (Gross / Modified Gross / NNN),
  start/end dates, annual escalation %, free-rent.
- **Expense reimbursements (NNN recoveries)** — tenants reimburse a pro-rata
  share of opex; increases effective income. *This is the main thing the
  residential model doesn't capture.*
- **Public share links** — `/s/:token` read-only report (like
  `dealcheck.io/s/...`), optional expiry.
- **Max-offer / reverse valuation** — solve for the highest purchase price that
  still hits a target (cap rate, CoC, cash flow, or DSCR).
- **Side-by-side deal comparison** + custom purchase criteria / pass-fail badges.
- **After-tax cash flow** with a configurable tax rate.
- **Server-rendered PDF** (if browser-print isn't enough) via a light renderer.

### Phase 3 — Fleet data integrations (don't rebuild what you have)
- **ARV / value from MVE or Valuator** instead of manual ARV entry.
- **Import candidate deals from Deal Finder / Auction Finder.**
- **Push closed/under-contract deals to the ADG CRM** (system of record) and
  hand off to Closing Desk.
- **AI deal extraction** from an uploaded MLS sheet / cbmoxi page / PDF
  (see §9).

---

## 4. Data model (Drizzle + SQLite)

Principle: **store inputs, never store computed outputs.** The engine is the
single source of truth; outputs are recomputed on every read so numbers can
never go stale. Nested inputs that are always edited together live in JSON
columns; headline/searchable fields are real columns.

```ts
// shared/types.ts — the canonical input shape (used by engine + UI + API)
export type ExpenseBasis = "amount" | "pct_of_rent";
export interface ExpenseLine { key: string; label: string; basis: ExpenseBasis; value: number; }
export interface RentUnit { id: string; label: string; kind: "residential"|"commercial"|"storage"|"other";
  beds?: number; baths?: number; sqft?: number; monthlyRent: number; }
export interface OtherIncomeLine { label: string; monthly: number; }
export interface Loan { id: string; label: string; kind: "amortizing"|"interest_only";
  ratePct: number; termYears: number; basis: "pct_of_price"|"amount"; value: number; pointsPct?: number; }
export interface Assumptions { vacancyPct: number; appreciationPct: number;
  incomeIncreasePct: number; expenseIncreasePct: number; sellingCostsPct: number; holdYears: number; }
export interface DealInputs {
  propertyType: string; units: number; totalSqft: number;
  purchasePrice: number; arv: number;
  purchaseCosts: { basis: "pct"|"amount"; value: number };
  rehab: { basis: "pct"|"amount"; value: number };
  landValue: number; depreciationYears: number;   // 27.5 resi / 39 commercial
  rentRoll: RentUnit[]; otherIncome: OtherIncomeLine[];
  expenses: ExpenseLine[]; loans: Loan[]; assumptions: Assumptions;
}
```

```
deals
  id            text pk
  userId        text         -- agent scope (from auth); admin sees all
  name          text
  address       text
  propertyType  text
  status        text         -- analyzing | under_contract | closed | archived
  inputs        text (json)  -- the full DealInputs blob
  purchasePrice integer      -- denormalized for list/sort/search
  units         integer
  capRatePct    real         -- denormalized snapshot for the list view only
  cashFlowMo    integer      -- "
  createdAt / updatedAt  integer

deal_photos   (id, dealId fk, path, caption, sortOrder, createdAt)
deal_shares   (id, dealId fk, token unique, expiresAt, createdAt)
activities    (id, userId, dealId, type, meta json, createdAt)   -- audit log
```

Denormalized `capRatePct`/`cashFlowMo` are a convenience snapshot for the list
screen; the deal detail/report always recompute from `inputs`.

---

## 5. The underwriting engine (the heart — get this exactly right)

### 5.1 Contract
A **pure, deterministic** function, no I/O, lives in `shared/` so the **same
code runs in the browser** (instant recompute as the user types) **and on the
server** (report/PDF/share). This is what makes the tool feel like DealCheck.

```ts
// shared/engine/underwrite.ts
export function underwrite(inputs: DealInputs): DealOutputs { ... }
```

`DealOutputs` = purchase summary, financing, Year-1 cash flow, ratios, and a
`projection: YearRow[]` array (one row per year through `holdYears`/35).

### 5.2 Core formulas
- **Loan amount** = basis `pct_of_price` → `price * pct`, else the `$` amount.
- **Down payment** = `price − Σ loan amounts`.
- **Purchase costs / rehab** = `% of price` or `$`.
- **Total cash needed** = `down payment + purchase costs + rehab`.
- **Loan payment (amortizing)** = standard amortization
  `M = P · r(1+r)^n / ((1+r)^n − 1)`, `r = rate/12`, `n = termYears·12`.
  Interest-only → `P · r`.
- **Loan balance after k months** = `P(1+r)^k − M·((1+r)^k − 1)/r`.
- **Gross scheduled rent** = `Σ rentRoll.monthlyRent · 12 + Σ otherIncome · 12`.
  *(In the report, garage/storage rent is just a rent-roll line.)*
- **Vacancy** = `gross · vacancyPct`.
- **Operating income (EGI)** = `gross − vacancy`.
- **Operating expense line** = `basis==="amount" ? value : value · grossRent`.
  (Maintenance in the report = **5% of gross rent**; taxes/insurance/utilities/
  landscaping were fixed `$`.)
- **Operating expenses** = `Σ lines`.
- **NOI** = `operating income − operating expenses`.
- **Debt service** = `Σ loan payments` (until each loan's payoff year).
- **Cash flow** = `NOI − debt service`.   **Per unit** = `cash flow / units`.

### 5.3 Ratios (Year 1)
| Metric | Formula |
|---|---|
| Cap rate (purchase) | `NOI / purchasePrice` |
| Cap rate (market) | `NOI / propertyValue` (Yr1 value, i.e. ARV·appreciation) |
| Cash on cash | `cashFlow / totalCashNeeded` |
| Return on equity | `cashFlow / endOfYearEquity` |
| ROI (year N) | `totalProfitₙ / totalCashNeeded` |
| IRR | money-weighted across the hold (Yr1 ROI == Yr1 IRR) |
| Rent to value | `monthlyGrossRent / propertyValue` |
| Gross rent multiplier | `purchasePrice / annualGrossRent` |
| Equity multiple (yr N) | `(cumCashFlowₙ + saleProceedsₙ) / totalCashNeeded` |
| Break-even ratio | `(operatingExpenses + debtService) / grossRent` |
| DSCR | `NOI / debtService` |
| Debt yield | `NOI / loanAmount` |
| Price per unit | `purchasePrice / units` |
| Depreciation/yr | `(purchasePrice + purchaseCosts − landValue) / depreciationYears` |

### 5.4 ⚠️ The non-obvious rules that make numbers tie out
These are the details that silently break a clone. Verified against the report:

1. **Asymmetric compounding by year index.**
   - Income & expenses use **(year − 1)** growth periods → **Year 1 = base**
     (`gross_Y = baseGross · (1+incomeInc)^(Y−1)`).
   - Property value uses **(year)** periods → **Year 1 already includes one year
     of appreciation** (end-of-year valuation):
     `value_Y = ARV · (1+appreciation)^Y`. (Report Yr1 value = $1,030,000.)

2. **Each expense line grows on its own basis — not the total.**
   - Fixed-`$` lines grow at **expense increase %**.
   - `% of rent` lines (maintenance, % mgmt, % capex) **track gross rent**, so
     they grow at **income increase %**. (Report Yr3 maintenance = 5% of the
     grown rent = $6,099, *not* $5,862·1.01².) Grow line items, then sum — never
     grow the prior total.

3. **Depreciation basis = price + purchase costs − land value**, straight-line
   over the chosen period (27.5 here; default **39 for commercial**, make it an
   input). Land is not depreciated.

4. **Loan interest deduction** = that year's total payments − principal paid
   that year. **Loan stops** (payment → 0) the year after the term ends; in the
   payoff year equity = full property value.

5. **Sale analysis (year N):**
   `saleProceeds = equity − sellingCosts`;
   `totalProfit = saleProceeds + cumulativeCashFlow − totalCashNeeded`.

### 5.5 Golden-master acceptance test (ship-blocker)
Unit-test the engine with the **Fallsview Rd** deal and assert outputs match the
report. CI must fail on any drift. Inputs:

```
purchasePrice 1,000,000 · arv 1,000,000 · loan 65% · rate 6.25% · term 25y amortizing
purchaseCosts 2.5% · rehab 0 · landValue 0 · depreciationYears 27.5
rentRoll: 1350, 1050, 7370 (monthly) · units 3
expenses: taxes $19,463 · insurance $4,558 · utilities $1,200 · landscaping $1,800
          · maintenance 5% of gross rent
assumptions: vacancy 2% · appreciation 3% · incomeInc 2% · expenseInc 1% · sellingCosts 0%
```

Expected (assert to ±$2 for rounding):

```
Loan pmt/yr 51,454 · Year-1: gross 117,240 · vacancy 2,345 · EGI 114,895
  · opex 32,883 · NOI 82,012 · cash flow 30,558 (≈2,547/mo)
Ratios: cap 8.2% · CoC 8.2% · DSCR 1.59 · debt yield 12.6% · GRM 8.53
  · break-even 71.9% · ROE 7.8% · ROI/IRR 12.5% · equity multiple 1.12
Projection (gross / opex / NOI / cash flow / value / equity):
  Yr1  117,240 / 32,883 /  82,012 /  30,558 / 1,030,000 /   391,145
  Yr3  121,976 / 33,662 /  85,874 /  34,420 / 1,092,727 /   478,358
  Yr5  126,904 / 34,463 /  89,903 /  38,449 / 1,159,274 /   572,643
  Yr10 140,113 / 36,558 / 100,753 /  49,299 / 1,343,916 /   843,830
  Yr20 170,797 / 41,184 / 126,197 /  74,743 / 1,806,111 / 1,585,648
  Yr30 208,200 / 46,468 / 157,568 / 157,568 / 2,427,262 / 2,427,262
Depreciation/yr 37,273
```

---

## 6. API surface

```
GET  /api/health                      -> { ok: true }                 (no auth)
GET  /api/summary                     -> { deals, lastUpdated }        (no auth, for Suite tile)
GET  /api/deals                       -> list (scoped to user; admin = all)
POST /api/deals                       -> create
GET  /api/deals/:id                   -> { inputs, outputs }  (outputs computed live)
PUT  /api/deals/:id                   -> update inputs
DELETE /api/deals/:id
POST /api/deals/:id/duplicate
POST /api/underwrite                  -> stateless compute (no save)   (handy for quick calcs)
GET  /api/deals/:id/report            -> branded print HTML report     (auth)
POST /api/deals/:id/share             -> { token }                     (Phase 2)
GET  /s/:token                        -> public read-only report       (Phase 2, graceful)
POST /api/deals/:id/photos            -> upload (writes to /data)
POST /api/deals/:id/extract           -> AI: PDF/MLS -> DealInputs      (Phase 3, optional)
```

Everything computed (`outputs`) is derived from `inputs` via the shared engine —
the server imports the same `underwrite()` the browser uses.

---

## 7. Frontend / screens (mobile-first)

- **Login / graceful root.**
- **Deals list** — cards: name, address, price, cap rate, cash flow/mo,
  pass/fail badge vs. criteria. New / duplicate / delete.
- **Deal editor** — sectioned, collapsible accordions on mobile: Property,
  Rent Roll, Purchase & Financing, Expenses, Other Income, Assumptions. A
  **sticky results bar** (cap rate · CoC · cash flow/mo) recomputes live via the
  shared engine as you type — the DealCheck "feel."
- **Analysis view** — Year-1 cash-flow waterfall, ratio grid, projection table
  with a year selector, the two charts, photos.
- **Report view** — branded, print-optimized, paginated like the DealCheck PDF.

---

## 8. Branded report (mirror the DealCheck layout)

Recreate the report sections from the attached PDF: cover (ADG logo, headline
metrics, prepared-by block, map/photo), property description + rent roll,
purchase analysis & returns, Year-1 cash flow, buy-&-hold projections, the two
charts, property photos, footer. Use print CSS (`@media print`, page breaks) so
the same HTML is both the on-screen report and a clean browser-printed PDF. ADG
palette/fonts throughout. Add server-side PDF only if browser print proves
insufficient.

---

## 9. AI features (degrade gracefully — fleet convention)

Always fall back to a non-AI path when `ANTHROPIC_API_KEY` is missing or a call
fails; never block core flows on the API. Default model **`claude-opus-4-8`**
(the report generator falls back to `claude-sonnet-4-6` when Opus is
overloaded), overridable via `ANTHROPIC_MODEL` (latest: Opus 4.8
`claude-opus-4-8`, Sonnet 4.6 `claude-sonnet-4-6`, Haiku 4.5
`claude-haiku-4-5`). Use a strict JSON schema
(`output_config.format`) for structured output and `cache_control` on the frozen
system prompt.

1. **Deal extraction (Phase 3, highest value):** upload an MLS sheet / cbmoxi
   page / DealCheck-style PDF → Claude returns a validated `DealInputs` JSON →
   pre-fills the editor. Fallback: manual entry. (Mirrors the Listing Launchpad
   Phase-2 and Closing Desk contract-extraction patterns.)
2. **Investment narrative (Phase 2):** Claude drafts a short thesis + risk
   bullets for the report / LP presentation. Fallback: a templated summary built
   from the computed metrics.

---

## 10. Build phases (suggested PRs)

- **PR 1 — Scaffold + engine + golden test.** Repo skeleton (FlipIQ shape),
  `getDataDir()`, `/api/health`, Drizzle schema, the shared `underwrite()`
  engine, and the §5.5 golden-master test passing in CI. *No UI yet.*
- **PR 2 — Manual deal CRUD + live editor + analysis view + charts.**
- **PR 3 — Branded print report + photos.**
- **PR 4 — Suite tile** in `adg-team-suite-/server/tools.js`
  (`verifyUrl: true`, `feed: "/api/summary"`, `summarize`).
- **PR 5+ — Phase 2/3:** lease schedules + NNN recoveries, share links,
  max-offer, comparison, AI extraction, MVE/CRM integrations.

---

## 11. Open decisions for Adam

1. **Auth model.** Two options, both fleet-consistent:
   (a) **Standalone auth** — copy the proven pattern from FlipIQ / the Suite
   (email+password, bcrypt, JWT cookie, pending→approved, `ADMIN_EMAIL` owner
   self-heal). Matches the *current* fleet reality (each tool has its own login).
   (b) **SSO** — accept a signed short-lived JWT from the ADG Team Suite as the
   identity provider. Lower friction once the Suite SSO route is live.
   *Recommendation: build (a) now, structured so an SSO hook drops in later.*
2. **Depreciation default** — 39 yr (commercial) vs 27.5 (the report used 27.5).
   Make it an input; pick the default.
3. **Comps/value** — manual ARV in v1, then pull from **MVE/Valuator** in Phase
   3 rather than building a comps feed. Confirm that's the intended source.
4. **Report PDF** — start with print-to-PDF (zero heavy deps), or require a
   true server-side PDF from day one?
