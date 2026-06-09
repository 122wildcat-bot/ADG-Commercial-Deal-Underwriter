import { useMemo, useState } from "react";
import type { YearRow } from "@shared/types";
import { money, pct } from "@/lib/format";

const PRESET_YEARS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 35];

export function ProjectionTable({ rows }: { rows: YearRow[] }) {
  const available = useMemo(() => PRESET_YEARS.filter((y) => rows.some((r) => r.year === y)), [rows]);
  const [selectedYears, setSelectedYears] = useState<number[]>([1, 3, 5, 10, 20, 30].filter((y) => rows.some((r) => r.year === y)));

  function toggle(year: number) {
    setSelectedYears((s) => s.includes(year) ? s.filter((y) => y !== year) : [...s, year].sort((a, b) => a - b));
  }

  const selectedRows = rows.filter((r) => selectedYears.includes(r.year));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {available.map((y) => {
          const on = selectedYears.includes(y);
          return (
            <button
              key={y}
              type="button"
              onClick={() => toggle(y)}
              className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-[var(--cb-blue)] text-white border-[var(--cb-blue)]" : "bg-white text-[var(--muted-fg)] border-slate-200 hover:border-[var(--celestial)]"}`}
            >
              Year {y}
            </button>
          );
        })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left">
              <Th>Year</Th>
              <Th right>Gross rent</Th>
              <Th right>Op. expenses</Th>
              <Th right>NOI</Th>
              <Th right>Debt service</Th>
              <Th right>Cash flow</Th>
              <Th right>Property value</Th>
              <Th right>Loan balance</Th>
              <Th right>Equity</Th>
              <Th right>Cap rate</Th>
              <Th right>CoC</Th>
              <Th right>Total profit</Th>
            </tr>
          </thead>
          <tbody>
            {selectedRows.map((r) => (
              <tr key={r.year} className="border-t border-slate-100">
                <Td>{r.year}</Td>
                <Td right>{money(r.grossRent)}</Td>
                <Td right>{money(r.operatingExpenses)}</Td>
                <Td right>{money(r.noi)}</Td>
                <Td right>{money(r.debtService)}</Td>
                <Td right positive={r.cashFlow >= 0}>{money(r.cashFlow)}</Td>
                <Td right>{money(r.propertyValue)}</Td>
                <Td right>{money(r.loanBalance)}</Td>
                <Td right>{money(r.equity)}</Td>
                <Td right>{pct(r.capRatePurchasePct, 2)}</Td>
                <Td right>{pct(r.cashOnCashPct, 2)}</Td>
                <Td right positive={r.totalProfit >= 0}>{money(r.totalProfit)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`kicker pb-2 px-2 ${right ? "text-right" : ""}`}>{children}</th>;
}
function Td({ children, right, positive }: { children: React.ReactNode; right?: boolean; positive?: boolean }) {
  return (
    <td className={`py-1.5 px-2 tabular-nums ${right ? "text-right" : ""} ${positive === true ? "text-green-700" : positive === false ? "text-red-700" : ""}`}>
      {children}
    </td>
  );
}
