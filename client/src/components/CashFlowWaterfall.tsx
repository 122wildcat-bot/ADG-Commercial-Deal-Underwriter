import type { Year1CashFlow } from "@shared/types";
import { money } from "@/lib/format";

export function CashFlowWaterfall({ y1 }: { y1: Year1CashFlow }) {
  const lines = [
    { label: "Gross scheduled rent", value: y1.grossRent },
    { label: "Less vacancy", value: -y1.vacancy, subtle: true },
    { label: "Operating income (EGI)", value: y1.operatingIncome, isSubtotal: true },
    ...y1.expenseLines.map((l) => ({ label: `Less ${l.label.toLowerCase()}`, value: -l.amount, subtle: true })),
    { label: "Total operating expenses", value: -y1.operatingExpenses, isSubtotal: true },
    { label: "Net Operating Income (NOI)", value: y1.noi, isSubtotal: true, brand: true },
    { label: "Less annual debt service", value: -y1.debtService, subtle: true },
    { label: "Annual cash flow", value: y1.cashFlow, isTotal: true },
  ];

  return (
    <div className="space-y-1">
      {lines.map((row, i) => (
        <div
          key={i}
          className={`wf-row ${row.subtle ? "subtle" : ""} ${row.isTotal ? `total ${row.value >= 0 ? "positive" : "negative"}` : ""} ${row.isSubtotal && !row.isTotal ? "border border-slate-200 !bg-slate-50/60" : ""} ${row.brand && row.isSubtotal ? "!bg-[rgba(1,33,105,0.05)] border-[rgba(1,33,105,0.2)]" : ""}`}
        >
          <span>{row.label}</span>
          <span className="font-semibold">{money(row.value)}</span>
        </div>
      ))}
      <div className="text-xs text-[var(--muted-fg)] mt-2 text-right">
        Monthly cash flow {money(y1.cashFlowMonthly, { cents: true })} · per unit {money(y1.cashFlowPerUnit)}
      </div>
    </div>
  );
}
