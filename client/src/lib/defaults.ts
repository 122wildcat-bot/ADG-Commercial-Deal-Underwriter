import type { DealInputs } from "@shared/types";

/**
 * Sensible starting point for a new deal — small multi-family with a typical
 * expense set. The user immediately overrides everything via the editor.
 */
export function defaultDealInputs(): DealInputs {
  return {
    propertyType: "multi_family",
    units: 4,
    totalSqft: 0,

    purchasePrice: 500_000,
    arv: 500_000,
    purchaseCosts: { basis: "pct", value: 2.5 },
    rehab: { basis: "amount", value: 0 },

    landValue: 0,
    depreciationYears: 39, // commercial default; switch to 27.5 for residential rental ≤4 units

    rentEntryMode: "roll",
    simpleMonthlyRent: 0,

    rentRoll: [
      { id: rid(), label: "Unit 1", kind: "residential", monthlyRent: 1200 },
      { id: rid(), label: "Unit 2", kind: "residential", monthlyRent: 1200 },
      { id: rid(), label: "Unit 3", kind: "residential", monthlyRent: 1200 },
      { id: rid(), label: "Unit 4", kind: "residential", monthlyRent: 1200 },
    ],
    otherIncome: [],
    expenses: [
      { key: "taxes",        label: "Property Taxes",  basis: "amount",      value: 6_000 },
      { key: "insurance",    label: "Insurance",       basis: "amount",      value: 2_400 },
      { key: "management",   label: "Property Mgmt",   basis: "pct_of_rent", value: 8 },
      { key: "maintenance",  label: "Maintenance",     basis: "pct_of_rent", value: 5 },
      { key: "capex",        label: "CapEx Reserves",  basis: "pct_of_rent", value: 5 },
      { key: "utilities",    label: "Utilities",       basis: "amount",      value: 0 },
      { key: "hoa",          label: "HOA",             basis: "amount",      value: 0 },
      { key: "landscaping",  label: "Landscaping",     basis: "amount",      value: 0 },
      { key: "accounting",   label: "Accounting / Legal", basis: "amount",   value: 0 },
    ],
    loans: [
      {
        id: rid(),
        label: "Primary Loan",
        kind: "amortizing",
        ratePct: 7.0,
        termYears: 30,
        basis: "pct_of_price",
        value: 75,
      },
    ],
    assumptions: {
      vacancyPct: 5,
      appreciationPct: 3,
      incomeIncreasePct: 2,
      expenseIncreasePct: 2,
      sellingCostsPct: 6,
      holdYears: 10,
    },
  };
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const PROPERTY_TYPES: { value: DealInputs["propertyType"]; label: string }[] = [
  { value: "multi_family", label: "Multi-Family" },
  { value: "mixed_use",    label: "Mixed Use" },
  { value: "retail",       label: "Retail" },
  { value: "office",       label: "Office" },
  { value: "industrial",   label: "Industrial" },
  { value: "storage",      label: "Storage" },
  { value: "other",        label: "Other" },
];

export const UNIT_KINDS: { value: "residential"|"commercial"|"storage"|"other"; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "commercial",  label: "Commercial" },
  { value: "storage",     label: "Storage" },
  { value: "other",       label: "Other" },
];

export function nextId(): string { return rid(); }

/**
 * Overlay an AI-extracted partial deal (from POST /api/extract) onto the current
 * editor inputs. Untrusted, model-produced data — only well-typed values win;
 * rent-roll / loan rows get fresh ids. Returned by mergeExtractedInputs so the
 * editor can pre-fill without losing fields the document didn't mention.
 */
export function mergeExtractedInputs(current: DealInputs, ex: any): DealInputs {
  if (!ex || typeof ex !== "object") return current;
  const isNum = (v: any) => typeof v === "number" && isFinite(v);
  const next: DealInputs = {
    ...current,
    purchaseCosts: { ...current.purchaseCosts },
    rehab: { ...current.rehab },
    assumptions: { ...current.assumptions },
  };

  if (typeof ex.propertyType === "string") next.propertyType = ex.propertyType;
  if (isNum(ex.units)) next.units = ex.units;
  if (isNum(ex.totalSqft)) next.totalSqft = ex.totalSqft;
  if (isNum(ex.purchasePrice)) next.purchasePrice = ex.purchasePrice;
  if (isNum(ex.arv)) next.arv = ex.arv;
  if (isNum(ex.landValue)) next.landValue = ex.landValue;
  if (ex.depreciationYears === 27.5 || ex.depreciationYears === 39) next.depreciationYears = ex.depreciationYears;

  if (ex.purchaseCosts && (ex.purchaseCosts.basis === "pct" || ex.purchaseCosts.basis === "amount") && isNum(ex.purchaseCosts.value)) {
    next.purchaseCosts = { basis: ex.purchaseCosts.basis, value: ex.purchaseCosts.value };
  }
  if (ex.rehab && (ex.rehab.basis === "pct" || ex.rehab.basis === "amount") && isNum(ex.rehab.value)) {
    next.rehab = { basis: ex.rehab.basis, value: ex.rehab.value };
  }

  if (ex.rentEntryMode === "simple" || ex.rentEntryMode === "roll") next.rentEntryMode = ex.rentEntryMode;
  if (isNum(ex.simpleMonthlyRent)) next.simpleMonthlyRent = ex.simpleMonthlyRent;

  if (Array.isArray(ex.rentRoll) && ex.rentRoll.length) {
    next.rentRoll = ex.rentRoll.map((u: any) => ({
      id: nextId(),
      label: String(u?.label ?? "Unit"),
      kind: ["residential", "commercial", "storage", "other"].includes(u?.kind) ? u.kind : "residential",
      beds: isNum(u?.beds) ? u.beds : undefined,
      baths: isNum(u?.baths) ? u.baths : undefined,
      sqft: isNum(u?.sqft) ? u.sqft : undefined,
      monthlyRent: isNum(u?.monthlyRent) ? u.monthlyRent : 0,
    }));
    // If the document itemized units, present the roll unless it was explicitly a single total.
    if (ex.rentEntryMode !== "simple") next.rentEntryMode = "roll";
  }

  if (Array.isArray(ex.otherIncome) && ex.otherIncome.length) {
    next.otherIncome = ex.otherIncome.map((o: any) => ({
      label: String(o?.label ?? "Other"),
      monthly: isNum(o?.monthly) ? o.monthly : 0,
    }));
  }

  if (Array.isArray(ex.expenses) && ex.expenses.length) {
    next.expenses = ex.expenses.map((e: any, i: number) => ({
      key: String(e?.key ?? `custom-${i}`),
      label: String(e?.label ?? "Expense"),
      basis: e?.basis === "pct_of_rent" ? "pct_of_rent" : "amount",
      value: isNum(e?.value) ? e.value : 0,
    }));
  }

  if (Array.isArray(ex.loans) && ex.loans.length) {
    next.loans = ex.loans.map((l: any) => ({
      id: nextId(),
      label: String(l?.label ?? "Loan"),
      kind: l?.kind === "interest_only" ? "interest_only" : "amortizing",
      ratePct: isNum(l?.ratePct) ? l.ratePct : 0,
      termYears: isNum(l?.termYears) ? l.termYears : 30,
      basis: l?.basis === "amount" ? "amount" : "pct_of_price",
      value: isNum(l?.value) ? l.value : 0,
    }));
  }

  if (ex.assumptions && typeof ex.assumptions === "object") {
    const a = ex.assumptions;
    const merged = { ...next.assumptions };
    for (const k of ["vacancyPct", "appreciationPct", "incomeIncreasePct", "expenseIncreasePct", "sellingCostsPct", "holdYears"] as const) {
      if (isNum(a[k])) (merged as any)[k] = a[k];
    }
    next.assumptions = merged;
  }

  return next;
}
