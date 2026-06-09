import type { DealOutputs } from "@shared/types";
import { money, num, pct } from "@/lib/format";

export function RatioGrid({ outputs }: { outputs: DealOutputs }) {
  const r = outputs.ratiosY1;
  const cells = [
    { label: "Cap rate (purchase)", value: pct(r.capRatePurchasePct, 2) },
    { label: "Cap rate (market)",   value: pct(r.capRateMarketPct, 2) },
    { label: "Cash on cash",        value: pct(r.cashOnCashPct, 2) },
    { label: "Return on equity",    value: pct(r.returnOnEquityPct, 2) },
    { label: "ROI / IRR (yr 1)",    value: pct(r.roiPct, 2) },
    { label: "DSCR",                value: num(r.dscr, 2) },
    { label: "Debt yield",          value: pct(r.debtYieldPct, 2) },
    { label: "Break-even ratio",    value: pct(r.breakEvenRatioPct, 1) },
    { label: "Gross rent multiplier", value: num(r.grossRentMultiplier, 2) },
    { label: "Rent to value",       value: pct(r.rentToValuePct, 2) },
    { label: "Equity multiple",     value: num(r.equityMultiple, 2) + "×" },
    { label: "Depreciation / yr",   value: money(r.depreciationPerYear) },
    { label: "Price per unit",      value: money(r.pricePerUnit) },
    { label: "Total cash needed",   value: money(outputs.totalCashNeeded) },
    { label: "Loan amount",         value: money(outputs.totalLoanAmount) },
    { label: "Down payment",        value: money(outputs.downPayment) },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="kpi">
          <div className="kpi-label">{c.label}</div>
          <div className="kpi-value">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
