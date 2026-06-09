/** Formatters used throughout the UI. Kept central so the report can match. */

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function money(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  const v = n ?? 0;
  if (!isFinite(v)) return "—";
  return opts.cents ? usd2.format(v) : usd0.format(Math.round(v));
}

export function pct(n: number | null | undefined, decimals = 1): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

export function num(n: number | null | undefined, decimals = 2): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(decimals);
}

export function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
