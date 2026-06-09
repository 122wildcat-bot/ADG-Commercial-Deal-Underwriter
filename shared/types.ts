// Canonical input/output shape for the underwriting engine.
// Shared by the browser (live recompute as the user types) and the server
// (report, PDF, stateless /api/underwrite, share links).
//
// IMPORTANT: when extending these types, prefer additive fields with sensible
// defaults so older saved deals (stored as DealInputs JSON) keep underwriting.

export type ExpenseBasis = "amount" | "pct_of_rent";

export interface ExpenseLine {
  /** stable key for matching across edits/migrations (e.g. "taxes") */
  key: string;
  label: string;
  basis: ExpenseBasis;
  /** when basis=amount, dollars per year; when basis=pct_of_rent, a percent (5 = 5%) */
  value: number;
}

export type UnitKind = "residential" | "commercial" | "storage" | "other";

export interface RentUnit {
  id: string;
  label: string;
  kind: UnitKind;
  beds?: number;
  baths?: number;
  sqft?: number;
  monthlyRent: number;
}

export interface OtherIncomeLine {
  label: string;
  monthly: number;
}

export type LoanKind = "amortizing" | "interest_only";
export type LoanBasis = "pct_of_price" | "amount";

export interface Loan {
  id: string;
  label: string;
  kind: LoanKind;
  /** annual rate, percent (6.25 = 6.25%) */
  ratePct: number;
  termYears: number;
  basis: LoanBasis;
  /** if basis=pct_of_price, a percent (65 = 65%); if basis=amount, dollars */
  value: number;
  /** optional origination points, percent of loan amount */
  pointsPct?: number;
}

export interface Assumptions {
  /** percent (2 = 2%) */
  vacancyPct: number;
  appreciationPct: number;
  incomeIncreasePct: number;
  expenseIncreasePct: number;
  sellingCostsPct: number;
  /** hold period in years for sale analysis; projection still runs to 35 */
  holdYears: number;
}

export type PropertyType =
  | "multi_family"
  | "mixed_use"
  | "retail"
  | "office"
  | "industrial"
  | "storage"
  | "other";

export interface PercentOrAmount {
  basis: "pct" | "amount";
  /** when basis=pct, a percent (2.5 = 2.5%); when basis=amount, dollars */
  value: number;
}

export interface DealInputs {
  propertyType: PropertyType;
  units: number;
  totalSqft: number;

  purchasePrice: number;
  arv: number;

  purchaseCosts: PercentOrAmount;
  rehab: PercentOrAmount;

  landValue: number;
  /** depreciation period in years; default 39 (commercial), use 27.5 for residential rental */
  depreciationYears: number;

  rentRoll: RentUnit[];
  otherIncome: OtherIncomeLine[];
  expenses: ExpenseLine[];
  loans: Loan[];
  assumptions: Assumptions;
}

// ────────────────────────────────────────────────────────────────────────────
// Outputs
// ────────────────────────────────────────────────────────────────────────────

export interface Year1CashFlow {
  grossRent: number;
  vacancy: number;
  operatingIncome: number; // EGI
  expenseLines: { key: string; label: string; amount: number }[];
  operatingExpenses: number;
  noi: number;
  debtService: number;
  cashFlow: number;
  cashFlowMonthly: number;
  cashFlowPerUnit: number;
}

export interface RatiosYear1 {
  capRatePurchasePct: number;
  capRateMarketPct: number;
  cashOnCashPct: number;
  returnOnEquityPct: number;
  roiPct: number;
  irrPct: number;
  rentToValuePct: number;
  grossRentMultiplier: number;
  equityMultiple: number;
  breakEvenRatioPct: number;
  dscr: number;
  debtYieldPct: number;
  pricePerUnit: number;
  pricePerSqft: number;
  depreciationPerYear: number;
}

export interface YearRow {
  year: number;
  // income
  grossRent: number;
  vacancy: number;
  operatingIncome: number;
  expenseLines: { key: string; label: string; amount: number }[];
  operatingExpenses: number;
  noi: number;
  debtService: number;
  loanInterest: number; // sum of (payment − principal paid) for the year
  cashFlow: number;
  cashFlowPerUnit: number;
  cumulativeCashFlow: number;
  // tax / depreciation
  depreciation: number;
  // value, debt, equity
  propertyValue: number;
  loanBalance: number;
  ltvPct: number;
  equity: number;
  // sale
  sellingCosts: number;
  saleProceeds: number; // equity − sellingCosts
  totalProfit: number; // saleProceeds + cumCashFlow − totalCashNeeded
  // returns
  capRatePurchasePct: number;
  capRateMarketPct: number;
  cashOnCashPct: number;
  returnOnEquityPct: number;
  roiPct: number;
  equityMultiple: number;
}

export interface LoanSummary {
  id: string;
  label: string;
  amount: number;
  monthlyPayment: number;
  annualPayment: number;
  pointsCost: number;
}

export interface DealOutputs {
  // purchase summary
  purchasePrice: number;
  arv: number;
  purchaseCostsAmount: number;
  rehabAmount: number;
  totalLoanAmount: number;
  downPayment: number;
  totalCashNeeded: number;
  // loans (per-loan breakout)
  loans: LoanSummary[];
  // per-unit / per-sqft
  pricePerUnit: number;
  pricePerSqft: number;
  // depreciation
  depreciationBasis: number;
  depreciationPerYear: number;
  // year-1
  year1: Year1CashFlow;
  ratiosY1: RatiosYear1;
  // projection through max(holdYears, 35)
  projection: YearRow[];
  // convenience: the sale-year (holdYears) row, lifted out for headline metrics
  saleYear: YearRow;
}
