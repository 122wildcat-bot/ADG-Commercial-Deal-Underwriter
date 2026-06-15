import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Sparkles, Loader2 } from "lucide-react";
import type { DealInputs, DealOutputs } from "@shared/types";
import { api, downloadPdf, ApiError } from "@/lib/api";
import { money, pct } from "@/lib/format";
import { CashFlowWaterfall } from "@/components/CashFlowWaterfall";
import { RatioGrid } from "@/components/RatioGrid";
import { ProjectionTable } from "@/components/ProjectionTable";
import { ProjectionCharts } from "@/components/ProjectionCharts";

interface Resp {
  deal: { id: string; name: string; address: string | null; propertyType: string | null; status: string; updatedAt: string };
  inputs: DealInputs;
  outputs: DealOutputs;
}

export function DealAnalysisPage({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["deal", id],
    queryFn: () => api.get<Resp>(`/api/deals/${id}`),
  });

  if (isLoading) return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">Loading…</div>;
  if (error || !data) return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-red-700">{(error as Error)?.message || "Not found"}</div>;

  const { deal, inputs, outputs } = data;
  const sale = outputs.saleYear;

  const [printing, setPrinting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState<string | null>(null);

  async function onPrintSummary() {
    setPrinting(true);
    setReportNote(null);
    try {
      await downloadPdf(`/api/deals/${id}/print.pdf`, "GET", `ADG_Summary_${deal.name}.pdf`);
    } catch (err) {
      setReportNote(err instanceof ApiError ? err.message : (err as Error).message || "Print failed.");
    } finally {
      setPrinting(false);
    }
  }

  async function onInvestorReport() {
    setReporting(true);
    setReportNote("Generating investor report. Claude is researching comps and underwriting the deal — this takes 45-90 seconds.");
    try {
      await downloadPdf(`/api/deals/${id}/report.pdf`, "POST", `ADG_Investor_Report_${deal.name}.pdf`);
      setReportNote("Investor report downloaded.");
    } catch (err) {
      setReportNote(err instanceof ApiError ? err.message : (err as Error).message || "Report failed.");
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-tight">{deal.name}</h1>
          {deal.address && <p className="text-sm text-[var(--muted-fg)]">{deal.address}</p>}
          <p className="text-xs uppercase tracking-wider text-[var(--muted-fg)] mt-1">
            {(deal.propertyType || "—").replace("_", " ")} · {inputs.units} units
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPrintSummary}
            disabled={printing || reporting}
            className="btn btn-secondary"
            title="Deterministic engine-data summary (instant, no AI)"
          >
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {printing ? "Rendering…" : "Print Summary"}
          </button>
          <button
            type="button"
            onClick={onInvestorReport}
            disabled={printing || reporting}
            className="btn btn-primary"
            title="Claude-generated investor-grade report with comps research, normalization, and negotiation plan"
          >
            {reporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {reporting ? "Generating…" : "Investor Report"}
          </button>
          <Link href={`/deals/${id}/edit`} className="btn btn-secondary">Edit</Link>
          <Link href="/" className="btn btn-ghost">Back to deals</Link>
        </div>
      </div>

      {reportNote && (
        <p className="mb-4 text-sm text-[var(--cb-blue)] bg-blue-50 border border-blue-200 rounded px-3 py-2">
          {reportNote}
        </p>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Headline label="Purchase price" value={money(outputs.purchasePrice)} />
        <Headline label="Cap rate (yr 1)" value={pct(outputs.ratiosY1.capRatePurchasePct, 2)} />
        <Headline label="Cash flow / mo" value={money(outputs.year1.cashFlowMonthly)} tone={outputs.year1.cashFlowMonthly >= 0 ? "positive" : "negative"} />
        <Headline label={`Total profit (yr ${inputs.assumptions.holdYears})`} value={money(sale.totalProfit)} tone={sale.totalProfit >= 0 ? "positive" : "negative"} />
      </div>

      {/* Year-1 cash flow + ratios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="font-display text-lg font-semibold mb-3">Year-1 cash flow</h2>
          <CashFlowWaterfall y1={outputs.year1} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="font-display text-lg font-semibold mb-3">Returns & ratios</h2>
          <RatioGrid outputs={outputs} />
        </div>
      </div>

      {/* Projection */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
        <h2 className="font-display text-lg font-semibold mb-3">Buy-&-hold projection</h2>
        <ProjectionTable rows={outputs.projection} />
      </div>

      {/* Charts */}
      <ProjectionCharts rows={outputs.projection} holdYears={inputs.assumptions.holdYears} />

      {/* Sale analysis */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mt-6">
        <h2 className="font-display text-lg font-semibold mb-3">Sale analysis (year {inputs.assumptions.holdYears})</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="kpi"><div className="kpi-label">Property value</div><div className="kpi-value">{money(sale.propertyValue)}</div></div>
          <div className="kpi"><div className="kpi-label">Loan balance</div><div className="kpi-value">{money(sale.loanBalance)}</div></div>
          <div className="kpi"><div className="kpi-label">Equity</div><div className="kpi-value">{money(sale.equity)}</div></div>
          <div className="kpi"><div className="kpi-label">Selling costs</div><div className="kpi-value">{money(sale.sellingCosts)}</div></div>
          <div className="kpi"><div className="kpi-label">Sale proceeds</div><div className="kpi-value">{money(sale.saleProceeds)}</div></div>
          <div className="kpi"><div className="kpi-label">Cumulative cash flow</div><div className="kpi-value">{money(sale.cumulativeCashFlow)}</div></div>
          <div className="kpi"><div className="kpi-label">Total profit</div><div className={`kpi-value ${sale.totalProfit >= 0 ? "positive" : "negative"}`}>{money(sale.totalProfit)}</div></div>
          <div className="kpi"><div className="kpi-label">Equity multiple</div><div className="kpi-value">{sale.equityMultiple.toFixed(2)}×</div></div>
        </div>
      </div>
    </div>
  );
}

function Headline({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const color = tone === "positive" ? "positive" : tone === "negative" ? "negative" : "brand";
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${color}`}>{value}</div>
    </div>
  );
}
