import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Sparkles, Loader2, Download, Trash2 } from "lucide-react";
import type { DealInputs, DealOutputs } from "@shared/types";
import { api, downloadPdf, ApiError } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { money, pct, shortDate } from "@/lib/format";
import { CashFlowWaterfall } from "@/components/CashFlowWaterfall";
import { RatioGrid } from "@/components/RatioGrid";
import { ProjectionTable } from "@/components/ProjectionTable";
import { ProjectionCharts } from "@/components/ProjectionCharts";

interface SavedReport {
  id: string;
  kind: "investor";
  status: "generating" | "ready" | "failed";
  stage: "queued" | "ai_thinking" | "ai_searching" | "ai_writing" | "rendering" | "saving" | "saved" | "failed";
  filename: string;
  sizeBytes: number;
  model: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  createdAt: string;
}

// Each stage maps to (a) a target percent on the progress bar and (b) a
// human-readable label. Percentages are deliberately spaced so the bar
// moves visibly between stages without ever jumping backward.
const STAGE_META: Record<SavedReport["stage"], { pct: number; label: string }> = {
  queued:        { pct:  5, label: "Queued…" },
  ai_thinking:   { pct: 15, label: "Claude is analyzing the deal…" },
  ai_searching:  { pct: 35, label: "Researching comps and market context…" },
  ai_writing:    { pct: 65, label: "Drafting the investor report…" },
  rendering:     { pct: 85, label: "Rendering PDF…" },
  saving:        { pct: 95, label: "Saving to your reports…" },
  saved:         { pct: 100, label: "Done." },
  failed:        { pct: 0, label: "Failed." },
};

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

  // Hooks MUST come before any early return — Rules of Hooks.
  const [printing, setPrinting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<SavedReport["stage"] | null>(null);

  const reportsQuery = useQuery({
    queryKey: ["reports", id],
    queryFn: () => api.get<{ reports: SavedReport[] }>(`/api/deals/${id}/reports`),
    // While a job is running we poll the list too so completed/failed reports
    // appear in real time.
    refetchInterval: reporting ? 2_000 : false,
  });
  const deleteReport = useMutation({
    mutationFn: (rid: string) => api.del(`/api/reports/${rid}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", id] }),
  });

  if (isLoading) return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">Loading…</div>;
  if (error || !data) return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-red-700">{(error as Error)?.message || "Not found"}</div>;

  const { deal, inputs, outputs } = data;
  const sale = outputs.saleYear;

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
    setReportNote(null);
    setActiveStage("queued");
    try {
      // 1. Kick off the background job. Retry the POST on transient network
      //    failures — Railway sometimes drops a request during a deploy.
      const reportId = await retryNetwork(async () => {
        const r = await api.post<{ reportId: string }>(`/api/deals/${id}/report`);
        return r.reportId;
      });
      queryClient.invalidateQueries({ queryKey: ["reports", id] });

      // 2. Poll status until ready / failed. A single failed poll (network
      //    blip, deploy) shouldn't abort the whole flow — tolerate up to
      //    20 consecutive failures (~30s) before giving up.
      const startedAt = Date.now();
      const TIMEOUT_MS = 15 * 60_000;
      let pollErrors = 0;
      while (true) {
        await new Promise((r) => setTimeout(r, 1_500));
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setReportNote(
            "The report has been running for more than 15 minutes — leaving it in the background. It will show up in Saved Reports below once it finishes, or with an error if it doesn't.",
          );
          break;
        }
        let report: SavedReport;
        try {
          const r = await api.get<{ report: SavedReport }>(`/api/reports/${reportId}`);
          report = r.report;
          pollErrors = 0;
        } catch (pollErr) {
          pollErrors += 1;
          if (pollErrors >= 20) {
            setReportNote(
              "Lost connection to the server while watching the report. It may still be generating — check Saved Reports below in a minute or two.",
            );
            break;
          }
          continue; // try again on the next tick
        }
        setActiveStage(report.stage);
        if (report.status === "ready") {
          // Surface download errors instead of silently swallowing them —
          // the previous .catch(() => {}) hid genuine failures (file
          // missing, browser blocking the programmatic click, etc.) behind
          // a fake "downloaded and saved" message.
          try {
            await downloadPdf(`/api/reports/${reportId}/download`, "GET", report.filename);
            setReportNote("Investor report ready — downloaded and saved.");
          } catch (dlErr) {
            const msg = dlErr instanceof ApiError ? dlErr.message : (dlErr as Error).message || "Unknown error";
            setReportNote(
              `Investor report finished and is saved, but the automatic download didn't trigger (${msg}). Click the Download button on the row below.`,
            );
          }
          break;
        }
        if (report.status === "failed") {
          setReportNote(`Report failed: ${report.errorMessage || "Unknown error."}`);
          break;
        }
      }
    } catch (err) {
      // POST itself failed even after retries.
      const msg = err instanceof ApiError ? err.message : (err as Error).message || "Report failed.";
      const isNetworkErr = /Failed to fetch|NetworkError|ERR_NETWORK/i.test(msg);
      setReportNote(
        isNetworkErr
          ? "Lost connection to the server. The Underwriter may be mid-deploy — wait a minute and try again, or check Saved Reports below in case the report is already running."
          : msg,
      );
    } finally {
      setReporting(false);
      setActiveStage(null);
      queryClient.invalidateQueries({ queryKey: ["reports", id] });
    }
  }

  // Retry an async call on transient network errors. Returns the first success;
  // re-throws the last error after 3 attempts. ApiError responses (the server
  // replied with a non-2xx) are NOT retried — those are real, surface them.
  async function retryNetwork<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (e instanceof ApiError) throw e; // server replied; not a network issue
        const msg = (e as Error)?.message || "";
        const isNetwork = /Failed to fetch|NetworkError|ERR_NETWORK|TypeError/i.test(msg);
        if (!isNetwork) throw e;
        // 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, 1_000 * Math.pow(2, attempt)));
      }
    }
    throw lastErr;
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

      {/* Progress bar — visible while the Investor Report is generating. */}
      {(reporting || activeStage) && activeStage && (
        <div className="mb-4 bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--celestial)]" />
              {STAGE_META[activeStage].label}
            </span>
            <span className="text-xs text-[var(--muted-fg)] tabular-nums">
              {STAGE_META[activeStage].pct}%
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--celestial)] transition-all duration-500 ease-out"
              style={{ width: `${STAGE_META[activeStage].pct}%` }}
            />
          </div>
          <p className="text-xs text-[var(--muted-fg)] mt-2">
            Generation runs in the background — you can stay on this page, navigate away, or even close the tab.
            The finished report will appear in <strong>Saved Reports</strong> below.
          </p>
        </div>
      )}

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

      {/* Saved Reports */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold">Saved investor reports</h2>
          <span className="text-xs text-[var(--muted-fg)]">
            {reportsQuery.data ? `${reportsQuery.data.reports.length} on file` : ""}
          </span>
        </div>
        {reportsQuery.isLoading && <p className="text-sm text-[var(--muted-fg)]">Loading…</p>}
        {reportsQuery.data && reportsQuery.data.reports.length === 0 && (
          <p className="text-sm text-[var(--muted-fg)]">
            No saved reports yet. Click <strong>Investor Report</strong> above to generate one — it'll appear here when done.
          </p>
        )}
        {reportsQuery.data && reportsQuery.data.reports.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {reportsQuery.data.reports.map((r) => (
              <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {r.filename}
                    {r.status === "generating" && (
                      <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-[var(--cb-blue)] border border-blue-200 rounded px-1.5 py-0.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> {STAGE_META[r.stage].label}
                      </span>
                    )}
                    {r.status === "failed" && (
                      <span className="text-xs bg-red-50 text-red-700 border border-red-200 rounded px-1.5 py-0.5">
                        Failed
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--muted-fg)] tabular-nums">
                    {shortDate(r.createdAt)}
                    {r.model && ` · ${r.model}`}
                    {r.sizeBytes > 0 && ` · ${(r.sizeBytes / 1024).toFixed(0)} KB`}
                    {r.durationMs && ` · ${(r.durationMs / 1000).toFixed(0)}s`}
                    {r.errorMessage && r.status === "failed" && ` · ${r.errorMessage}`}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={r.status !== "ready"}
                    onClick={async () => {
                      try {
                        await downloadPdf(`/api/reports/${r.id}/download`, "GET", r.filename);
                        setReportNote(null);
                      } catch (dlErr) {
                        const msg = dlErr instanceof ApiError ? dlErr.message : (dlErr as Error).message || "Unknown error";
                        setReportNote(`Download failed: ${msg}`);
                      }
                    }}
                    className="btn btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                    title={r.status === "ready" ? "Download" : "Not ready yet"}
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete "${r.filename}"? This cannot be undone.`)) {
                        deleteReport.mutate(r.id);
                      }
                    }}
                    className="btn btn-ghost text-xs text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
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
