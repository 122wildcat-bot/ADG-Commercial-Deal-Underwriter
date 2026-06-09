import type { DealOutputs } from "@shared/types";
import { money, pct } from "@/lib/format";

interface Props {
  outputs: DealOutputs | null;
  busy?: boolean;
}

/**
 * The DealCheck "feel" — always-visible Year-1 metrics that update live as the
 * user types. Recomputed by the shared engine on every keystroke (the parent
 * holds the DealInputs state, calls underwrite(), and passes the outputs).
 */
export function StickyResultsBar({ outputs, busy }: Props) {
  return (
    <div className="sticky top-[60px] z-20 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <LiveStat label="Cap Rate" value={outputs ? pct(outputs.ratiosY1.capRatePurchasePct, 2) : "—"} />
          <LiveStat label="Cash on Cash" value={outputs ? pct(outputs.ratiosY1.cashOnCashPct, 2) : "—"} />
          <LiveStat
            label="Cash Flow / mo"
            value={outputs ? money(outputs.year1.cashFlowMonthly) : "—"}
            tone={outputs && outputs.year1.cashFlowMonthly >= 0 ? "good" : "bad"}
          />
          <LiveStat label="DSCR" value={outputs ? outputs.ratiosY1.dscr.toFixed(2) : "—"} />
        </div>
        {busy && <p className="text-[10px] text-[var(--muted-fg)] mt-1">Saving…</p>}
      </div>
    </div>
  );
}

function LiveStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-700" : "text-[var(--ink)]";
  return (
    <div className="flex items-baseline gap-2">
      <span className="kicker">{label}</span>
      <span className={`font-display text-base font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
