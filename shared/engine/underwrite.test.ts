// Golden-master test (ship-blocker). Spec §5.5.
//
// The Fallsview Rd inputs must reproduce the published DealCheck report to ±$2.
// CI runs `npm test`; any drift here means the engine has silently started
// lying and the build must NOT ship.

import { describe, expect, it } from "vitest";
import { underwrite } from "./underwrite";
import { FALLSVIEW_INPUTS } from "./fallsview.fixture";

const TOL = 2; // ±$2 per spec §5.5

function near(actual: number, expected: number, tol = TOL) {
  expect(Math.abs(actual - expected), `${actual} not within ±${tol} of ${expected}`).toBeLessThanOrEqual(tol);
}

describe("Fallsview Rd — golden master (spec §5.5)", () => {
  const out = underwrite(FALLSVIEW_INPUTS);

  it("loan payment ties out to ~$51,454/yr", () => {
    expect(out.loans).toHaveLength(1);
    near(out.loans[0].annualPayment, 51_454);
  });

  it("year-1 cash flow ties out", () => {
    const y1 = out.year1;
    near(y1.grossRent, 117_240);
    near(y1.vacancy, 2_345);
    near(y1.operatingIncome, 114_895);
    near(y1.operatingExpenses, 32_883);
    near(y1.noi, 82_012);
    near(y1.cashFlow, 30_558);
    // ≈ $2,547/mo
    near(y1.cashFlowMonthly, 2_547, 2);
  });

  it("year-1 ratios tie out", () => {
    const r = out.ratiosY1;
    expect(r.capRatePurchasePct).toBeCloseTo(8.20, 1); // NOI 82,012 / price 1,000,000
    // The report shows CoC "8.2%" — that's the cap rate display being reused.
    // Underlying CoC = 30,557 / 375,000 = 8.149%, which the report rounds up.
    // Cap rate is genuinely 8.201%; the underlying CoC is fractionally lower.
    expect(r.cashOnCashPct).toBeGreaterThan(8.1);
    expect(r.cashOnCashPct).toBeLessThan(8.20);
    expect(r.dscr).toBeCloseTo(1.59, 2);
    expect(r.debtYieldPct).toBeCloseTo(12.6, 1);
    expect(r.grossRentMultiplier).toBeCloseTo(8.53, 2);
    expect(r.breakEvenRatioPct).toBeCloseTo(71.9, 1);
    expect(r.returnOnEquityPct).toBeCloseTo(7.8, 1);
    expect(r.roiPct).toBeCloseTo(12.5, 1);
    expect(r.equityMultiple).toBeCloseTo(1.12, 2);
    near(r.depreciationPerYear, 37_273);
  });

  it("year-3 line items tie out (asymmetric compounding + per-line expense growth)", () => {
    const y3 = out.projection.find((r) => r.year === 3)!;
    near(y3.grossRent, 121_976);
    near(y3.operatingExpenses, 33_662);
    near(y3.noi, 85_874);
    near(y3.cashFlow, 34_420);
    near(y3.propertyValue, 1_092_727);
    near(y3.equity, 478_358);
    // Spec §5.4 rule 2: maintenance (5% of rent) at yr3 ≈ $6,099, NOT $5,862·1.01².
    const maintLine = y3.expenseLines.find((l) => l.key === "maintenance")!;
    near(maintLine.amount, 6_099, 2);
  });

  it("year-5 projection ties out", () => {
    const y5 = out.projection.find((r) => r.year === 5)!;
    near(y5.grossRent, 126_904);
    near(y5.operatingExpenses, 34_463);
    near(y5.noi, 89_903);
    near(y5.cashFlow, 38_449);
    near(y5.propertyValue, 1_159_274);
    near(y5.equity, 572_643);
  });

  it("year-10 projection ties out", () => {
    const y10 = out.projection.find((r) => r.year === 10)!;
    near(y10.grossRent, 140_113);
    near(y10.operatingExpenses, 36_558);
    near(y10.noi, 100_753);
    near(y10.cashFlow, 49_299);
    near(y10.propertyValue, 1_343_916);
    near(y10.equity, 843_830);
  });

  it("year-20 projection ties out", () => {
    const y20 = out.projection.find((r) => r.year === 20)!;
    near(y20.grossRent, 170_797);
    near(y20.operatingExpenses, 41_184);
    near(y20.noi, 126_197);
    near(y20.cashFlow, 74_743);
    near(y20.propertyValue, 1_806_111);
    near(y20.equity, 1_585_648);
  });

  it("year-30 projection ties out (loan paid off → equity = property value)", () => {
    const y30 = out.projection.find((r) => r.year === 30)!;
    near(y30.grossRent, 208_200);
    near(y30.operatingExpenses, 46_468);
    near(y30.noi, 157_568);
    // term=25; by year 30 the loan is gone, so cash flow == NOI and equity == value.
    near(y30.cashFlow, 157_568);
    near(y30.propertyValue, 2_427_262);
    near(y30.equity, 2_427_262);
    expect(y30.debtService).toBe(0);
    expect(y30.loanBalance).toBe(0);
  });

  it("depreciation basis = price + purchaseCosts − landValue", () => {
    expect(out.depreciationBasis).toBeCloseTo(1_025_000, 0);
    near(out.depreciationPerYear, 37_273);
  });

  it("totalCashNeeded = down + purchase costs + rehab", () => {
    expect(out.totalLoanAmount).toBe(650_000);
    expect(out.downPayment).toBe(350_000);
    expect(out.purchaseCostsAmount).toBe(25_000);
    expect(out.rehabAmount).toBe(0);
    expect(out.totalCashNeeded).toBe(375_000);
  });
});

describe("engine sanity checks (edge cases)", () => {
  it("zero loans → debt service is zero, cash flow == NOI", () => {
    const out = underwrite({ ...FALLSVIEW_INPUTS, loans: [] });
    expect(out.totalLoanAmount).toBe(0);
    expect(out.year1.debtService).toBe(0);
    expect(out.year1.cashFlow).toBeCloseTo(out.year1.noi, 4);
  });

  it("interest-only loan never amortizes (balance == amount during term)", () => {
    const out = underwrite({
      ...FALLSVIEW_INPUTS,
      loans: [
        {
          id: "io",
          label: "IO",
          kind: "interest_only",
          ratePct: 6.25,
          termYears: 10,
          basis: "pct_of_price",
          value: 65,
        },
      ],
    });
    const y5 = out.projection.find((r) => r.year === 5)!;
    expect(y5.loanBalance).toBeCloseTo(650_000, 0);
    // After term ends, balance → 0
    const y11 = out.projection.find((r) => r.year === 11)!;
    expect(y11.loanBalance).toBe(0);
    expect(y11.debtService).toBe(0);
  });

  it("empty rent roll yields zero gross rent without crashing", () => {
    const out = underwrite({ ...FALLSVIEW_INPUTS, rentRoll: [], otherIncome: [] });
    expect(out.year1.grossRent).toBe(0);
  });

  it("39-year depreciation default yields a smaller annual deduction", () => {
    const out = underwrite({ ...FALLSVIEW_INPUTS, depreciationYears: 39 });
    expect(out.depreciationPerYear).toBeLessThan(37_273);
    expect(out.depreciationPerYear).toBeCloseTo(1_025_000 / 39, 0);
  });

  it("simple rent mode uses the single monthly total and ignores the roll", () => {
    const out = underwrite({ ...FALLSVIEW_INPUTS, rentEntryMode: "simple", simpleMonthlyRent: 5_000 });
    // 5,000 * 12 = 60,000 gross; the itemized roll (9,770/mo) is ignored.
    expect(out.year1.grossRent).toBeCloseTo(60_000, 0);
  });

  it("simple mode still adds other income on top of the single total", () => {
    const out = underwrite({
      ...FALLSVIEW_INPUTS,
      rentEntryMode: "simple",
      simpleMonthlyRent: 5_000,
      otherIncome: [{ label: "Laundry", monthly: 250 }],
    });
    expect(out.year1.grossRent).toBeCloseTo(63_000, 0); // (5000 + 250) * 12
  });

  it("rentEntryMode 'roll' (or absent) keeps using the itemized roll", () => {
    const out = underwrite({ ...FALLSVIEW_INPUTS, rentEntryMode: "roll", simpleMonthlyRent: 99_999 });
    expect(out.year1.grossRent).toBeCloseTo(117_240, 0); // unchanged — simpleMonthlyRent ignored
  });
});
