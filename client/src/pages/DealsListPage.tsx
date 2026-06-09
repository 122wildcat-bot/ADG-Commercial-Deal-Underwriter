import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import { money, pct, shortDate } from "@/lib/format";
import { queryClient } from "@/lib/queryClient";

interface DealRow {
  id: string;
  name: string;
  address: string | null;
  propertyType: string | null;
  status: string;
  purchasePrice: number | null;
  units: number | null;
  capRatePct: number | null;
  cashFlowMo: number | null;
  updatedAt: string;
  userId: number;
}

export function DealsListPage() {
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["deals"],
    queryFn: () => api.get<{ deals: DealRow[] }>("/api/deals"),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<{ deal: { id: string } }>(`/api/deals/${id}/duplicate`),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      navigate(`/deals/${r.deal.id}/edit`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/deals/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals"] }),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Your deals</h1>
          <p className="text-sm text-[var(--muted-fg)]">Underwrite commercial buy-&-hold to the dollar.</p>
        </div>
        <Link href="/deals/new" className="btn btn-primary">New deal</Link>
      </div>

      {isLoading && <p className="text-sm text-[var(--muted-fg)]">Loading…</p>}

      {!isLoading && data && data.deals.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <h2 className="font-display text-lg font-semibold mb-2">No deals yet</h2>
          <p className="text-sm text-[var(--muted-fg)] mb-4">Start by underwriting your first deal — the engine reproduces the DealCheck-style report.</p>
          <Link href="/deals/new" className="btn btn-primary">Start a deal</Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data?.deals.map((d) => (
          <article key={d.id} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-[var(--celestial)] transition">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Link href={`/deals/${d.id}`} className="block">
                  <h3 className="font-display text-lg font-semibold truncate">{d.name}</h3>
                  {d.address && <p className="text-xs text-[var(--muted-fg)] truncate">{d.address}</p>}
                </Link>
              </div>
              <span className="kicker shrink-0">{(d.propertyType || "—").replace("_", " ")}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
              <Stat label="Price" value={money(d.purchasePrice)} />
              <Stat label="Cap rate" value={pct(d.capRatePct)} />
              <Stat label="CF / mo" value={money(d.cashFlowMo)} colored={(d.cashFlowMo ?? 0) >= 0} />
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-[var(--muted-fg)]">Updated {shortDate(d.updatedAt)}</span>
              <div className="flex gap-1.5 text-xs">
                <Link href={`/deals/${d.id}/edit`} className="btn btn-ghost px-2 py-1">Edit</Link>
                <button onClick={() => duplicate.mutate(d.id)} className="btn btn-ghost px-2 py-1">Duplicate</button>
                <button onClick={() => {
                  if (confirm(`Delete "${d.name}"? This cannot be undone.`)) remove.mutate(d.id);
                }} className="btn btn-ghost px-2 py-1 text-red-600">Delete</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, colored }: { label: string; value: string; colored?: boolean }) {
  return (
    <div>
      <div className="kicker">{label}</div>
      <div className={`font-semibold tabular-nums ${colored === true ? "text-green-700" : colored === false ? "text-red-700" : ""}`}>
        {value}
      </div>
    </div>
  );
}
