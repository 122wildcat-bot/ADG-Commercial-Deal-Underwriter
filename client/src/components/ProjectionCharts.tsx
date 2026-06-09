import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from "recharts";
import type { YearRow } from "@shared/types";
import { money } from "@/lib/format";

export function ProjectionCharts({ rows, holdYears }: { rows: YearRow[]; holdYears: number }) {
  const data = rows
    .filter((r) => r.year <= Math.max(holdYears, 30))
    .map((r) => ({ year: r.year, cashFlow: Math.round(r.cashFlow), equity: Math.round(r.equity) }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Cash Flow Over Time">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis dataKey="year" stroke="#64748b" fontSize={12} />
            <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => money(v)} labelFormatter={(l) => `Year ${l}`} />
            <Line type="monotone" dataKey="cashFlow" stroke="#418FDE" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Equity Over Time">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#012169" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#012169" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis dataKey="year" stroke="#64748b" fontSize={12} />
            <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => money(v)} labelFormatter={(l) => `Year ${l}`} />
            <Area type="monotone" dataKey="equity" stroke="#012169" strokeWidth={2} fill="url(#equityFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4">
      <h3 className="font-display text-base font-semibold mb-2">{title}</h3>
      {children}
    </div>
  );
}
