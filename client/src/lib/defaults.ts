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
