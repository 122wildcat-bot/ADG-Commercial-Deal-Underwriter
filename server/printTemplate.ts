// server/printTemplate.ts
//
// Deterministic print summary. Engine outputs rendered as a clean, print-
// optimized HTML page; no API key, no LLM, no network. The "Print Summary"
// button hits this and the user gets an instant PDF download.
//
// Same Puppeteer renderer the AI report uses, just a different HTML source.

import type { Deal } from "../shared/schema";
import type { DealInputs, DealOutputs, YearRow } from "../shared/types";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const MONEY2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => MONEY.format(Math.round(n));
const moneyc = (n: number) => MONEY2.format(n);
const pct = (n: number, d = 1) => (isFinite(n) ? `${n.toFixed(d)}%` : "—");
const num = (n: number, d = 2) => (isFinite(n) ? n.toFixed(d) : "—");

function escape(s: string | null | undefined): string {
  return (s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

const PRESET_YEARS = [1, 2, 3, 5, 10, 15, 20, 25, 30];

export interface PrintTemplateArgs {
  deal: Pick<Deal, "name" | "address" | "propertyType">;
  inputs: DealInputs;
  outputs: DealOutputs;
  generatedAt: Date;
}

export function buildPrintHtml({ deal, inputs, outputs, generatedAt }: PrintTemplateArgs): string {
  const dateStr = generatedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const projection = outputs.projection.filter((r) => PRESET_YEARS.includes(r.year));
  const sale = outputs.saleYear;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>${escape(deal.name)} — Underwriting Summary</title>
<style>
  @page { size: letter; margin: 0.55in; }
  :root {
    --cb-blue: #012169;
    --celestial: #418FDE;
    --ink: #0c1024;
    --muted: #5b6478;
    --rule: #d8dde6;
    --soft: #f4f6fa;
  }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.45; margin: 0; }
  .display { font-family: 'Fraunces', Georgia, serif; }
  .kicker { font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  h1, h2, h3 { color: var(--cb-blue); margin: 0; }
  h2 { font-family: 'Fraunces', Georgia, serif; font-size: 18pt; font-weight: 600; margin: 18pt 0 6pt; page-break-after: avoid; }
  h2 .eyebrow { display: block; font-family: 'Inter', sans-serif; font-size: 8pt; letter-spacing: 0.18em; text-transform: uppercase; color: var(--celestial); font-weight: 700; margin-bottom: 2pt; }
  .cover {
    background: linear-gradient(180deg, var(--cb-blue) 0%, #021a52 100%);
    color: white;
    padding: 36pt 28pt 28pt;
    margin: -0.55in -0.55in 18pt;
    page-break-after: avoid;
  }
  .cover .brand { font-size: 9pt; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255,255,255,0.7); }
  .cover h1 { color: white; font-family: 'Fraunces', Georgia, serif; font-size: 32pt; font-weight: 600; line-height: 1.05; margin: 8pt 0; }
  .cover h1 .accent { color: var(--celestial); font-style: italic; }
  .cover .meta { display: flex; gap: 20pt; margin-top: 16pt; flex-wrap: wrap; }
  .cover .meta div .lbl { font-size: 7.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.7); font-weight: 600; }
  .cover .meta div .val { font-size: 14pt; font-weight: 600; font-family: 'Fraunces', Georgia, serif; }
  .cover .footer-line { margin-top: 14pt; font-size: 8pt; color: rgba(255,255,255,0.6); letter-spacing: 0.12em; text-transform: uppercase; }
  .grid { display: grid; gap: 6pt; }
  .grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .kpi { border: 1pt solid var(--rule); border-radius: 4pt; padding: 8pt 10pt; page-break-inside: avoid; }
  .kpi .lbl { font-size: 7.5pt; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .kpi .val { font-family: 'Fraunces', Georgia, serif; font-size: 16pt; font-weight: 600; margin-top: 2pt; font-variant-numeric: tabular-nums; color: var(--ink); }
  .kpi .val.pos { color: #15803d; }
  .kpi .val.neg { color: #b91c1c; }
  .kpi .val.brand { color: var(--cb-blue); }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; font-variant-numeric: tabular-nums; page-break-inside: avoid; margin-top: 4pt; }
  th, td { padding: 5pt 6pt; border-bottom: 0.5pt solid var(--rule); text-align: right; vertical-align: top; }
  th:first-child, td:first-child { text-align: left; }
  thead th { background: var(--cb-blue); color: white; font-weight: 600; font-size: 8.5pt; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 0; }
  tbody tr:nth-child(even) td { background: var(--soft); }
  tfoot td { font-weight: 700; border-top: 1pt solid var(--cb-blue); border-bottom: 0; background: white; }
  .wf-row { display: flex; justify-content: space-between; align-items: center; padding: 4pt 8pt; border-radius: 3pt; font-variant-numeric: tabular-nums; }
  .wf-row:nth-child(odd) { background: var(--soft); }
  .wf-row.subtle { color: var(--muted); font-size: 9.5pt; }
  .wf-row.total { background: rgba(1,33,105,0.06); border: 1pt solid rgba(1,33,105,0.18); font-weight: 700; padding: 6pt 8pt; }
  .wf-row.total.pos { background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.28); color: #15803d; }
  .wf-row.total.neg { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.28); color: #b91c1c; }
  .wf-label { font-size: 9.5pt; }
  .wf-value { font-weight: 600; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16pt; align-items: start; }
  .note { font-size: 8.5pt; color: var(--muted); margin-top: 4pt; }
  .section { margin-top: 14pt; page-break-inside: avoid; }
  .keep { page-break-inside: avoid; }
  .keep-with { page-break-after: avoid; }
</style></head>
<body>
  <div class="cover">
    <div class="brand">ADG · The Adam Druck Group · Commercial Deal Underwriter</div>
    <h1>${escape(deal.name)} <span class="accent">underwriting summary</span></h1>
    ${deal.address ? `<div style="font-size:11pt;margin-top:4pt;">${escape(deal.address)}</div>` : ""}
    ${deal.propertyType ? `<div style="font-size:9pt;margin-top:2pt;opacity:0.8;">${escape(deal.propertyType.replace(/_/g, " "))} · ${inputs.units} unit${inputs.units === 1 ? "" : "s"}${inputs.totalSqft ? ` · ${inputs.totalSqft.toLocaleString()} sqft` : ""}</div>` : ""}
    <div class="meta">
      <div><div class="lbl">Purchase price</div><div class="val">${money(outputs.purchasePrice)}</div></div>
      <div><div class="lbl">Cap rate (yr 1)</div><div class="val">${pct(outputs.ratiosY1.capRatePurchasePct, 2)}</div></div>
      <div><div class="lbl">Cash flow / mo</div><div class="val">${money(outputs.year1.cashFlowMonthly)}</div></div>
      <div><div class="lbl">Total profit (yr ${inputs.assumptions.holdYears})</div><div class="val">${money(sale.totalProfit)}</div></div>
    </div>
    <div class="footer-line">Generated ${escape(dateStr)} · Confidential — for investor review</div>
  </div>

  <div class="section">
    <h2><span class="eyebrow">01 · Year-1 Cash Flow</span>Operating economics</h2>
    <div class="two-col">
      <div class="keep">
        ${y1Waterfall(outputs)}
      </div>
      <div class="keep">
        ${y1RatioGrid(outputs)}
      </div>
    </div>
  </div>

  <div class="section">
    <h2><span class="eyebrow">02 · Buy-&-Hold Projection</span>1-, 5-, 10-, 20-, 30-year horizon</h2>
    ${projectionTable(projection)}
    <div class="note">Income and expenses grow on their own basis per spec §5.4 (Year 1 is the base; property value already includes one year of appreciation at Year 1).</div>
  </div>

  <div class="section">
    <h2><span class="eyebrow">03 · Sale Analysis · Year ${inputs.assumptions.holdYears}</span>What you keep when you sell</h2>
    <div class="grid cols-4">
      ${kpi("Property value", money(sale.propertyValue))}
      ${kpi("Loan balance", money(sale.loanBalance))}
      ${kpi("Equity", money(sale.equity))}
      ${kpi("Selling costs", money(sale.sellingCosts))}
      ${kpi("Sale proceeds", money(sale.saleProceeds))}
      ${kpi("Cumulative cash flow", money(sale.cumulativeCashFlow))}
      ${kpi("Total profit", money(sale.totalProfit), sale.totalProfit >= 0 ? "pos" : "neg")}
      ${kpi("Equity multiple", `${sale.equityMultiple.toFixed(2)}×`)}
    </div>
  </div>

  <div class="section">
    <h2><span class="eyebrow">04 · Purchase Structure</span>Capital stack and assumptions</h2>
    <div class="two-col">
      <div class="keep">
        <table>
          <thead><tr><th>Source</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td>Purchase price</td><td>${money(outputs.purchasePrice)}</td></tr>
            <tr><td>Purchase costs</td><td>${money(outputs.purchaseCostsAmount)}</td></tr>
            <tr><td>Rehab</td><td>${money(outputs.rehabAmount)}</td></tr>
            <tr><td>Total loan amount</td><td>${money(outputs.totalLoanAmount)}</td></tr>
            <tr><td>Down payment</td><td>${money(outputs.downPayment)}</td></tr>
            <tr><td>Depreciation basis</td><td>${money(outputs.depreciationBasis)}</td></tr>
          </tbody>
          <tfoot><tr><td>Total cash needed</td><td>${money(outputs.totalCashNeeded)}</td></tr></tfoot>
        </table>
      </div>
      <div class="keep">
        <table>
          <thead><tr><th>Assumption</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Vacancy</td><td>${pct(inputs.assumptions.vacancyPct, 1)}</td></tr>
            <tr><td>Appreciation / yr</td><td>${pct(inputs.assumptions.appreciationPct, 1)}</td></tr>
            <tr><td>Income increase / yr</td><td>${pct(inputs.assumptions.incomeIncreasePct, 1)}</td></tr>
            <tr><td>Expense increase / yr</td><td>${pct(inputs.assumptions.expenseIncreasePct, 1)}</td></tr>
            <tr><td>Selling costs</td><td>${pct(inputs.assumptions.sellingCostsPct, 1)}</td></tr>
            <tr><td>Depreciation period</td><td>${num(inputs.depreciationYears, 1)} yrs</td></tr>
            <tr><td>Hold years</td><td>${inputs.assumptions.holdYears}</td></tr>
          </tbody>
        </table>
        ${outputs.loans.length ? `<div class="note" style="margin-top:8pt;"><strong>Financing:</strong> ${outputs.loans.map((l) => `${escape(l.label)} — ${money(l.amount)} @ ${moneyc(l.monthlyPayment)}/mo`).join("; ")}</div>` : ""}
      </div>
    </div>
  </div>

  <div class="section keep">
    <p class="note" style="margin-top:24pt;font-size:8pt;line-height:1.4;">
      Prepared by The Adam Druck Group at Coldwell Banker Realty. This summary reflects the entered deal inputs and the
      underwriting engine's deterministic output; figures are estimates and not a guarantee of future performance.
      Confirm operating expenses, rents, financing terms, and tax exposure through formal due diligence before transacting.
      Not an appraisal; not legal, tax, or accounting advice.
    </p>
  </div>
</body></html>`;
}

function kpi(label: string, value: string, tone?: "pos" | "neg" | "brand"): string {
  const cls = tone ? ` ${tone}` : "";
  return `<div class="kpi"><div class="lbl">${escape(label)}</div><div class="val${cls}">${escape(value)}</div></div>`;
}

function y1Waterfall(outputs: DealOutputs): string {
  const y1 = outputs.year1;
  const rows = [
    { label: "Gross scheduled rent", value: y1.grossRent },
    { label: "Less vacancy", value: -y1.vacancy, subtle: true },
    { label: "Operating income (EGI)", value: y1.operatingIncome, isSubtotal: true },
    ...y1.expenseLines.map((l) => ({ label: `Less ${l.label.toLowerCase()}`, value: -l.amount, subtle: true })),
    { label: "Total operating expenses", value: -y1.operatingExpenses, isSubtotal: true },
    { label: "Net Operating Income (NOI)", value: y1.noi, isSubtotal: true },
    { label: "Less annual debt service", value: -y1.debtService, subtle: true },
  ];
  const totalCls = y1.cashFlow >= 0 ? "pos" : "neg";
  return [
    `<div>`,
    ...rows.map(
      (r) => `<div class="wf-row ${r.subtle ? "subtle" : ""}"><span class="wf-label">${escape(r.label)}</span><span class="wf-value">${money(r.value)}</span></div>`,
    ),
    `<div class="wf-row total ${totalCls}"><span class="wf-label">Annual cash flow</span><span class="wf-value">${money(y1.cashFlow)}</span></div>`,
    `<div class="note" style="text-align:right;margin-top:4pt;">${money(y1.cashFlowMonthly)} / month · ${money(y1.cashFlowPerUnit)} per unit</div>`,
    `</div>`,
  ].join("");
}

function y1RatioGrid(outputs: DealOutputs): string {
  const r = outputs.ratiosY1;
  const cells = [
    ["Cap rate (purchase)", pct(r.capRatePurchasePct, 2)],
    ["Cap rate (market)", pct(r.capRateMarketPct, 2)],
    ["Cash on cash", pct(r.cashOnCashPct, 2)],
    ["DSCR", num(r.dscr, 2)],
    ["Debt yield", pct(r.debtYieldPct, 2)],
    ["Break-even ratio", pct(r.breakEvenRatioPct, 1)],
    ["ROE (yr 1)", pct(r.returnOnEquityPct, 2)],
    ["ROI / IRR (yr 1)", pct(r.roiPct, 2)],
    ["Gross rent multiplier", num(r.grossRentMultiplier, 2)],
    ["Rent to value", pct(r.rentToValuePct, 2)],
    ["Equity multiple (yr 1)", `${r.equityMultiple.toFixed(2)}×`],
    ["Depreciation / yr", money(r.depreciationPerYear)],
  ];
  return `<div class="grid cols-2">${cells.map(([l, v]) => kpi(l, v)).join("")}</div>`;
}

function projectionTable(rows: YearRow[]): string {
  return `<table>
    <thead><tr>
      <th>Year</th><th>Gross rent</th><th>Op. expenses</th><th>NOI</th>
      <th>Debt service</th><th>Cash flow</th><th>Property value</th>
      <th>Equity</th><th>Cap rate</th><th>Total profit</th>
    </tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <td>${r.year}</td>
        <td>${money(r.grossRent)}</td>
        <td>${money(r.operatingExpenses)}</td>
        <td>${money(r.noi)}</td>
        <td>${money(r.debtService)}</td>
        <td>${money(r.cashFlow)}</td>
        <td>${money(r.propertyValue)}</td>
        <td>${money(r.equity)}</td>
        <td>${pct(r.capRatePurchasePct, 2)}</td>
        <td>${money(r.totalProfit)}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}
