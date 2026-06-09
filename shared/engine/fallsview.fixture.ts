// Fallsview Rd — golden master fixture from
// docs/commercial-deal-underwriter-spec.md §5.5.
//
// 3-unit deal; ties out to the published DealCheck report. If you change this
// fixture, also update the expected values in underwrite.test.ts.

import type { DealInputs } from "../types";

export const FALLSVIEW_INPUTS: DealInputs = {
  propertyType: "multi_family",
  units: 3,
  totalSqft: 0,
  purchasePrice: 1_000_000,
  arv: 1_000_000,
  purchaseCosts: { basis: "pct", value: 2.5 },
  rehab: { basis: "amount", value: 0 },
  landValue: 0,
  // Report used 27.5 (3-unit qualifies as residential rental).
  depreciationYears: 27.5,
  rentRoll: [
    { id: "u1", label: "Unit 1", kind: "residential", monthlyRent: 1350 },
    { id: "u2", label: "Unit 2", kind: "residential", monthlyRent: 1050 },
    { id: "u3", label: "Unit 3", kind: "commercial",  monthlyRent: 7370 },
  ],
  otherIncome: [],
  expenses: [
    { key: "taxes",       label: "Property Taxes",  basis: "amount",       value: 19_463 },
    { key: "insurance",   label: "Insurance",       basis: "amount",       value:  4_558 },
    { key: "utilities",   label: "Utilities",       basis: "amount",       value:  1_200 },
    { key: "landscaping", label: "Landscaping",     basis: "amount",       value:  1_800 },
    { key: "maintenance", label: "Maintenance",     basis: "pct_of_rent",  value:      5 },
  ],
  loans: [
    {
      id: "primary",
      label: "Conventional",
      kind: "amortizing",
      ratePct: 6.25,
      termYears: 25,
      basis: "pct_of_price",
      value: 65,
    },
  ],
  assumptions: {
    vacancyPct: 2,
    appreciationPct: 3,
    incomeIncreasePct: 2,
    expenseIncreasePct: 1,
    sellingCostsPct: 0,
    holdYears: 30,
  },
};
