// shared/engine/underwrite.ts
//
// Pure, deterministic underwriting engine. NO I/O. Runs in the browser (live
// recompute as the user types) and on the server (report / PDF / stateless
// /api/underwrite). The contract is `underwrite(inputs) -> outputs`.
//
// Every formula here is sourced from docs/commercial-deal-underwriter-spec.md
// §5. Five rules silently break clones — see §5.4 and the inline notes below.
//
// Golden master: underwrite.test.ts asserts the Fallsview Rd deal to ±$2 vs
// the published report; CI fails on any drift.

import type {
  Assumptions,
  DealInputs,
  DealOutputs,
  ExpenseLine,
  Loan,
  LoanSummary,
  PercentOrAmount,
  RatiosYear1,
  YearRow,
  Year1CashFlow,
} from "../types";

const MONTHS = 12;
/** Projection always runs through at least this many years for the table view. */
const PROJECTION_HORIZON_YEARS = 35;

// ─── small helpers ─────────────────────────────────────────────────────────

const safeDiv = (n: number, d: number) => (d === 0 || !isFinite(d) ? 0 : n / d);

function pctOrAmount(price: number, x: PercentOrAmount): number {
  if (!x) return 0;
  return x.basis === "amount" ? x.value : price * (x.value / 100);
}

function loanAmount(price: number, loan: Loan): number {
  return loan.basis === "amount" ? loan.value : price * (loan.value / 100);
}

/**
 * Standard amortization payment.
 *   M = P · r · (1+r)^n / ((1+r)^n − 1),   r = ratePct / 12 / 100,  n = termYears · 12
 * Interest-only: M = P · r.
 */
function monthlyPayment(P: number, ratePct: number, termYears: number, kind: Loan["kind"]): number {
  const r = ratePct / 100 / MONTHS;
  if (kind === "interest_only") return P * r;
  const n = termYears * MONTHS;
  if (n === 0) return 0;
  if (r === 0) return P / n;
  const pow = Math.pow(1 + r, n);
  return (P * r * pow) / (pow - 1);
}

/** Outstanding balance after `monthsElapsed` payments. Clamped at zero. */
function balanceAfter(
  P: number,
  ratePct: number,
  payment: number,
  monthsElapsed: number,
  kind: Loan["kind"],
): number {
  if (monthsElapsed <= 0) return P;
  const r = ratePct / 100 / MONTHS;
  if (kind === "interest_only") return P; // never amortizes during term
  if (r === 0) return Math.max(0, P - payment * monthsElapsed);
  const pow = Math.pow(1 + r, monthsElapsed);
  const bal = P * pow - payment * ((pow - 1) / r);
  return Math.max(0, bal);
}

// ─── core stages ───────────────────────────────────────────────────────────

interface DerivedLoan {
  input: Loan;
  amount: number;
  monthly: number;
  annual: number;
  pointsCost: number;
}

function deriveLoans(inputs: DealInputs): DerivedLoan[] {
  return inputs.loans.map((l) => {
    const amount = loanAmount(inputs.purchasePrice, l);
    const monthly = monthlyPayment(amount, l.ratePct, l.termYears, l.kind);
    return {
      input: l,
      amount,
      monthly,
      annual: monthly * MONTHS,
      pointsCost: amount * ((l.pointsPct ?? 0) / 100),
    };
  });
}

function baseGrossRent(inputs: DealInputs): number {
  const rentRoll = inputs.rentRoll.reduce((acc, u) => acc + (u.monthlyRent || 0), 0) * MONTHS;
  const other = inputs.otherIncome.reduce((acc, o) => acc + (o.monthly || 0), 0) * MONTHS;
  return rentRoll + other;
}

/**
 * Grow each expense line on ITS OWN basis (spec §5.4 rule 2):
 *   - basis=amount     → grow at expense increase % over (year−1) periods
 *   - basis=pct_of_rent → tracks gross rent (which grows at income increase %)
 * Then sum. NEVER grow the prior total.
 */
function projectExpenses(
  expenses: ExpenseLine[],
  grossRentForYear: number,
  expGrowMult: number,
): { lines: { key: string; label: string; amount: number }[]; total: number } {
  const lines = expenses.map((e) => {
    const amount =
      e.basis === "amount"
        ? (e.value || 0) * expGrowMult
        : (e.value / 100) * grossRentForYear;
    return { key: e.key, label: e.label, amount };
  });
  const total = lines.reduce((acc, l) => acc + l.amount, 0);
  return { lines, total };
}

// ─── year-by-year projection ───────────────────────────────────────────────

interface YearContext {
  inputs: DealInputs;
  loans: DerivedLoan[];
  totalLoanAmount: number;
  totalCashNeeded: number;
  baseGross: number;
  depreciationPerYear: number;
}

function buildYearRow(year: number, ctx: YearContext, cumCashFlowBefore: number): YearRow {
  const { inputs, loans, totalLoanAmount, totalCashNeeded, baseGross, depreciationPerYear } = ctx;
  const a: Assumptions = inputs.assumptions;

  // ── Asymmetric compounding (spec §5.4 rule 1) ───────────────────────────
  // Income & expenses: (year−1) periods → Year 1 = base.
  // Property value:    (year)   periods → Year 1 already has one year of appreciation.
  const incomeMult = Math.pow(1 + a.incomeIncreasePct / 100, year - 1);
  const expGrowMult = Math.pow(1 + a.expenseIncreasePct / 100, year - 1);
  const valueMult = Math.pow(1 + a.appreciationPct / 100, year);

  const grossRent = baseGross * incomeMult;
  const vacancy = grossRent * (a.vacancyPct / 100);
  const operatingIncome = grossRent - vacancy;

  const expensesProjected = projectExpenses(inputs.expenses, grossRent, expGrowMult);
  const operatingExpenses = expensesProjected.total;

  const noi = operatingIncome - operatingExpenses;

  // ── Debt service (spec §5.4 rule 4) ─────────────────────────────────────
  // Loan stops the year AFTER the term ends. During the term: full year of
  // payments. After the term: payment → 0; balance → 0.
  let debtService = 0;
  let loanBalance = 0;
  let loanInterest = 0;
  for (const dl of loans) {
    const inTerm = year <= dl.input.termYears;
    const yearStartMonths = (year - 1) * MONTHS;
    const yearEndMonths = year * MONTHS;
    const balanceStart = inTerm
      ? balanceAfter(dl.amount, dl.input.ratePct, dl.monthly, yearStartMonths, dl.input.kind)
      : 0;
    const balanceEnd = inTerm
      ? balanceAfter(dl.amount, dl.input.ratePct, dl.monthly, yearEndMonths, dl.input.kind)
      : 0;
    const annualPayment = inTerm ? dl.annual : 0;
    const principalPaid = inTerm ? Math.max(0, balanceStart - balanceEnd) : 0;
    debtService += annualPayment;
    loanBalance += balanceEnd;
    // Interest = year's payments − principal paid that year.
    loanInterest += annualPayment - principalPaid;
  }

  const cashFlow = noi - debtService;
  const cashFlowPerUnit = safeDiv(cashFlow, inputs.units || 1);
  const cumulativeCashFlow = cumCashFlowBefore + cashFlow;

  const propertyValue = inputs.arv * valueMult;
  const equity = propertyValue - loanBalance;
  const ltvPct = safeDiv(loanBalance, propertyValue) * 100;

  // ── Sale analysis (spec §5.4 rule 5) ────────────────────────────────────
  const sellingCosts = propertyValue * (a.sellingCostsPct / 100);
  const saleProceeds = equity - sellingCosts;
  const totalProfit = saleProceeds + cumulativeCashFlow - totalCashNeeded;

  // ── Returns over time ───────────────────────────────────────────────────
  const capRatePurchasePct = safeDiv(noi, inputs.purchasePrice) * 100;
  const capRateMarketPct = safeDiv(noi, propertyValue) * 100;
  const cashOnCashPct = safeDiv(cashFlow, totalCashNeeded) * 100;
  const returnOnEquityPct = safeDiv(cashFlow, equity) * 100;
  const roiPct = safeDiv(totalProfit, totalCashNeeded) * 100;
  const equityMultiple = safeDiv(cumulativeCashFlow + saleProceeds, totalCashNeeded);

  return {
    year,
    grossRent,
    vacancy,
    operatingIncome,
    expenseLines: expensesProjected.lines,
    operatingExpenses,
    noi,
    debtService,
    loanInterest,
    cashFlow,
    cashFlowPerUnit,
    cumulativeCashFlow,
    depreciation: depreciationPerYear,
    propertyValue,
    loanBalance,
    ltvPct,
    equity,
    sellingCosts,
    saleProceeds,
    totalProfit,
    capRatePurchasePct,
    capRateMarketPct,
    cashOnCashPct,
    returnOnEquityPct,
    roiPct,
    equityMultiple,
  };
}

// ─── public entry point ────────────────────────────────────────────────────

export function underwrite(inputs: DealInputs): DealOutputs {
  const purchaseCostsAmount = pctOrAmount(inputs.purchasePrice, inputs.purchaseCosts);
  const rehabAmount = pctOrAmount(inputs.purchasePrice, inputs.rehab);

  const derived = deriveLoans(inputs);
  const totalLoanAmount = derived.reduce((acc, l) => acc + l.amount, 0);
  const downPayment = Math.max(0, inputs.purchasePrice - totalLoanAmount);
  const totalCashNeeded = downPayment + purchaseCostsAmount + rehabAmount;

  const baseGross = baseGrossRent(inputs);

  // Depreciation (spec §5.4 rule 3): straight-line, land excluded.
  const depreciationBasis = Math.max(0, inputs.purchasePrice + purchaseCostsAmount - inputs.landValue);
  const depreciationPerYear = inputs.depreciationYears > 0 ? depreciationBasis / inputs.depreciationYears : 0;

  const ctx: YearContext = {
    inputs,
    loans: derived,
    totalLoanAmount,
    totalCashNeeded,
    baseGross,
    depreciationPerYear,
  };

  // Build projection. We always go at least to PROJECTION_HORIZON_YEARS so the
  // table can show 1/2/3/5/10/20/30/35; the saleYear is the holdYears row.
  const horizon = Math.max(PROJECTION_HORIZON_YEARS, Math.max(1, inputs.assumptions.holdYears));
  const projection: YearRow[] = [];
  let cum = 0;
  for (let y = 1; y <= horizon; y++) {
    const row = buildYearRow(y, ctx, cum);
    projection.push(row);
    cum = row.cumulativeCashFlow;
  }
  const saleYear =
    projection.find((r) => r.year === inputs.assumptions.holdYears) ?? projection[0];

  // Year-1 summary lifted from the projection plus the line breakdown.
  const y1 = projection[0];
  const year1: Year1CashFlow = {
    grossRent: y1.grossRent,
    vacancy: y1.vacancy,
    operatingIncome: y1.operatingIncome,
    expenseLines: y1.expenseLines,
    operatingExpenses: y1.operatingExpenses,
    noi: y1.noi,
    debtService: y1.debtService,
    cashFlow: y1.cashFlow,
    cashFlowMonthly: y1.cashFlow / MONTHS,
    cashFlowPerUnit: y1.cashFlowPerUnit,
  };

  const annualGrossRentBase = baseGross;
  const monthlyGrossRentBase = baseGross / MONTHS;

  const ratiosY1: RatiosYear1 = {
    capRatePurchasePct: y1.capRatePurchasePct,
    capRateMarketPct: y1.capRateMarketPct,
    cashOnCashPct: y1.cashOnCashPct,
    returnOnEquityPct: y1.returnOnEquityPct,
    roiPct: y1.roiPct, // Yr1 ROI == Yr1 IRR (spec §5.3 note)
    irrPct: y1.roiPct,
    rentToValuePct: safeDiv(monthlyGrossRentBase, y1.propertyValue) * 100,
    grossRentMultiplier: safeDiv(inputs.purchasePrice, annualGrossRentBase),
    equityMultiple: y1.equityMultiple,
    breakEvenRatioPct: safeDiv(y1.operatingExpenses + y1.debtService, annualGrossRentBase) * 100,
    dscr: safeDiv(y1.noi, y1.debtService),
    debtYieldPct: safeDiv(y1.noi, totalLoanAmount) * 100,
    pricePerUnit: safeDiv(inputs.purchasePrice, inputs.units || 1),
    pricePerSqft: safeDiv(inputs.purchasePrice, inputs.totalSqft || 1),
    depreciationPerYear,
  };

  const loans: LoanSummary[] = derived.map((dl) => ({
    id: dl.input.id,
    label: dl.input.label,
    amount: dl.amount,
    monthlyPayment: dl.monthly,
    annualPayment: dl.annual,
    pointsCost: dl.pointsCost,
  }));

  return {
    purchasePrice: inputs.purchasePrice,
    arv: inputs.arv,
    purchaseCostsAmount,
    rehabAmount,
    totalLoanAmount,
    downPayment,
    totalCashNeeded,
    loans,
    pricePerUnit: safeDiv(inputs.purchasePrice, inputs.units || 1),
    pricePerSqft: safeDiv(inputs.purchasePrice, inputs.totalSqft || 1),
    depreciationBasis,
    depreciationPerYear,
    year1,
    ratiosY1,
    projection,
    saleYear,
  };
}
