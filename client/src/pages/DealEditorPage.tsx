import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Trash2, Plus, Upload, Loader2 } from "lucide-react";
import type { DealInputs, ExpenseLine, Loan, OtherIncomeLine, RentUnit } from "@shared/types";
import { underwrite } from "@shared/engine/underwrite";
import { api, uploadExtract } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Section } from "@/components/Section";
import { StickyResultsBar } from "@/components/StickyResultsBar";
import { defaultDealInputs, mergeExtractedInputs, PROPERTY_TYPES, UNIT_KINDS, nextId } from "@/lib/defaults";

interface Props { id?: string }

interface FetchedDeal {
  deal: { id: string; name: string; address: string | null; propertyType: string | null; status: string };
  inputs: DealInputs;
}

export function DealEditorPage({ id }: Props) {
  const [, navigate] = useLocation();
  const isNew = !id;

  const { data, isLoading } = useQuery({
    queryKey: ["deal", id],
    queryFn: () => api.get<FetchedDeal>(`/api/deals/${id}`),
    enabled: !isNew,
  });

  const [name, setName] = useState("New Commercial Deal");
  const [address, setAddress] = useState("");
  const [inputs, setInputs] = useState<DealInputs>(() => defaultDealInputs());
  const initializedRef = useRef(false);

  // AI document import
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isNew && data && !initializedRef.current) {
      setName(data.deal.name);
      setAddress(data.deal.address ?? "");
      setInputs(data.inputs);
      initializedRef.current = true;
    }
  }, [data, isNew]);

  // Live recompute — runs in the browser on every keystroke (spec §5.1).
  const outputs = useMemo(() => {
    try { return underwrite(inputs); } catch { return null; }
  }, [inputs]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return api.post<{ deal: { id: string } }>("/api/deals", {
          name,
          address: address || null,
          propertyType: inputs.propertyType,
          inputs,
        });
      }
      return api.put<{ deal: { id: string } }>(`/api/deals/${id}`, {
        name,
        address: address || null,
        propertyType: inputs.propertyType,
        inputs,
      });
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deal", id || r.deal.id] });
      navigate(`/deals/${r.deal.id}`);
    },
  });

  if (!isNew && isLoading) {
    return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">Loading deal…</div>;
  }

  // ─── input mutators ─────────────────────────────────────────────────────
  function patch(p: Partial<DealInputs>) { setInputs((s) => ({ ...s, ...p })); }
  function patchAssumptions(p: Partial<DealInputs["assumptions"]>) {
    setInputs((s) => ({ ...s, assumptions: { ...s.assumptions, ...p } }));
  }

  // Upload a PDF / image / CSV → Claude extracts the deal → pre-fill the editor.
  // Degrades gracefully: an unconfigured key or a failed read just shows a note.
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setImporting(true);
    setImportNote(null);
    try {
      const res = await uploadExtract(file);
      if (!res.configured) {
        setImportNote(res.message || "AI import isn't configured.");
        return;
      }
      if (!res.ok || !res.inputs) {
        setImportNote(res.warnings?.[0] || "Couldn't read that document — enter the deal manually.");
        return;
      }
      if (res.inputs.name) setName(res.inputs.name);
      if (res.inputs.address) setAddress(res.inputs.address);
      setInputs((s) => mergeExtractedInputs(s, res.inputs));
      const n = res.warnings?.length ? ` (${res.warnings.length} note${res.warnings.length > 1 ? "s" : ""})` : "";
      setImportNote(`Imported from ${file.name}${n}. Review the fields below, then Save & analyze.`);
    } catch (err) {
      setImportNote((err as Error).message || "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <StickyResultsBar outputs={outputs} busy={save.isPending} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
        <div className="flex flex-wrap gap-2 items-start justify-between mb-4">
          <div className="flex-1 min-w-[200px]">
            <input
              className="font-display text-2xl font-semibold w-full bg-transparent border-0 outline-none focus:outline-none focus:bg-white rounded px-1 -mx-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Deal name"
            />
            <input
              className="text-sm text-[var(--muted-fg)] w-full bg-transparent border-0 outline-none focus:outline-none focus:bg-white rounded px-1 -mx-1 mt-1"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Property address"
            />
          </div>
          <div className="flex gap-2 shrink-0 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.txt,.md,application/pdf,image/*,text/csv,text/plain"
              className="hidden"
              onChange={onPickFile}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              title="Import a PDF, image, or CSV and let AI fill the deal"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? "Reading…" : "Import"}
            </button>
            <Link href={id ? `/deals/${id}` : "/"} className="btn btn-secondary">Cancel</Link>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              {save.isPending ? "Saving…" : "Save & analyze"}
            </button>
          </div>
        </div>

        {save.isError && (
          <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {(save.error as Error).message}
          </p>
        )}

        {importNote && (
          <p className="mb-3 text-sm text-[var(--cb-blue)] bg-blue-50 border border-blue-200 rounded px-3 py-2">
            {importNote}
          </p>
        )}

        {/* Property */}
        <Section title="Property" subtitle="Type, units, and total square footage.">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Property type">
              <select className="field-select" value={inputs.propertyType}
                onChange={(e) => patch({ propertyType: e.target.value as DealInputs["propertyType"] })}>
                {PROPERTY_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Units">
              <NumberInput value={inputs.units} onChange={(v) => patch({ units: v })} min={0} step={1} />
            </Field>
            <Field label="Total sqft">
              <NumberInput value={inputs.totalSqft} onChange={(v) => patch({ totalSqft: v })} min={0} step={100} />
            </Field>
          </div>
        </Section>

        {/* Rent Roll */}
        <Section title="Rent Roll" subtitle="Itemize per unit, or drop in a single gross monthly total.">
          <div className="mb-3 inline-flex rounded-md border border-slate-200 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => patch({ rentEntryMode: "roll" })}
              className={`px-3 py-1.5 ${(inputs.rentEntryMode ?? "roll") === "roll" ? "bg-[var(--cb-blue)] text-white" : "bg-white text-[var(--muted-fg)] hover:text-[var(--ink)]"}`}
            >
              Itemize by unit
            </button>
            <button
              type="button"
              onClick={() => patch({ rentEntryMode: "simple" })}
              className={`px-3 py-1.5 border-l border-slate-200 ${inputs.rentEntryMode === "simple" ? "bg-[var(--cb-blue)] text-white" : "bg-white text-[var(--muted-fg)] hover:text-[var(--ink)]"}`}
            >
              Single monthly total
            </button>
          </div>

          {inputs.rentEntryMode === "simple" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <Field label="Total gross monthly rent">
                <NumberInput value={inputs.simpleMonthlyRent ?? 0} onChange={(v) => patch({ simpleMonthlyRent: v })} min={0} step={50} />
              </Field>
              <p className="text-xs text-[var(--muted-fg)] pb-2">
                Your itemized rent roll is kept — switch back to "Itemize by unit" any time.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {inputs.rentRoll.map((u, idx) => (
                <RentUnitRow
                  key={u.id}
                  unit={u}
                  onChange={(next) => {
                    const list = [...inputs.rentRoll]; list[idx] = next; patch({ rentRoll: list });
                  }}
                  onRemove={() => patch({ rentRoll: inputs.rentRoll.filter((x) => x.id !== u.id) })}
                />
              ))}
              <button type="button" className="btn btn-secondary text-sm"
                onClick={() => patch({
                  rentRoll: [...inputs.rentRoll, {
                    id: nextId(),
                    label: `Unit ${inputs.rentRoll.length + 1}`,
                    kind: "residential",
                    monthlyRent: 0,
                  }],
                })}>
                <Plus className="h-4 w-4" /> Add unit
              </button>
              <div className="flex justify-between border-t border-slate-100 pt-3 mt-3 text-sm">
                <span className="text-[var(--muted-fg)]">Total monthly gross</span>
                <span className="font-semibold tabular-nums">
                  ${Math.round(inputs.rentRoll.reduce((a, u) => a + (u.monthlyRent || 0), 0)).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </Section>

        {/* Purchase & Financing */}
        <Section title="Purchase & Financing" subtitle="Price, costs, and the loan stack.">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Purchase price"><NumberInput value={inputs.purchasePrice} onChange={(v) => patch({ purchasePrice: v })} min={0} /></Field>
            <Field label="ARV / market value"><NumberInput value={inputs.arv} onChange={(v) => patch({ arv: v })} min={0} /></Field>
            <Field label="Land value (excl. from depreciation)">
              <NumberInput value={inputs.landValue} onChange={(v) => patch({ landValue: v })} min={0} />
            </Field>
            <PctOrAmountField
              label="Purchase costs"
              value={inputs.purchaseCosts}
              onChange={(v) => patch({ purchaseCosts: v })}
            />
            <PctOrAmountField
              label="Rehab"
              value={inputs.rehab}
              onChange={(v) => patch({ rehab: v })}
            />
            <Field label="Depreciation period (yrs)">
              <select
                className="field-select"
                value={String(inputs.depreciationYears)}
                onChange={(e) => patch({ depreciationYears: Number(e.target.value) })}
              >
                <option value="27.5">27.5 (residential rental)</option>
                <option value="39">39 (commercial)</option>
              </select>
            </Field>
          </div>

          <h4 className="kicker mt-5 mb-2">Loans</h4>
          <div className="space-y-3">
            {inputs.loans.map((loan, idx) => (
              <LoanRow
                key={loan.id}
                loan={loan}
                onChange={(next) => {
                  const list = [...inputs.loans]; list[idx] = next; patch({ loans: list });
                }}
                onRemove={() => patch({ loans: inputs.loans.filter((x) => x.id !== loan.id) })}
              />
            ))}
            <button type="button" className="btn btn-secondary text-sm"
              onClick={() => patch({
                loans: [...inputs.loans, {
                  id: nextId(),
                  label: `Loan ${inputs.loans.length + 1}`,
                  kind: "amortizing",
                  ratePct: 7,
                  termYears: 30,
                  basis: "pct_of_price",
                  value: 0,
                }],
              })}>
              <Plus className="h-4 w-4" /> Add loan
            </button>
          </div>
        </Section>

        {/* Operating Expenses */}
        <Section title="Operating Expenses" subtitle="Fixed dollars or % of gross rent.">
          <div className="space-y-2">
            {inputs.expenses.map((line, idx) => (
              <ExpenseRow
                key={line.key + idx}
                line={line}
                onChange={(next) => {
                  const list = [...inputs.expenses]; list[idx] = next; patch({ expenses: list });
                }}
                onRemove={() => patch({ expenses: inputs.expenses.filter((_, i) => i !== idx) })}
              />
            ))}
            <button type="button" className="btn btn-secondary text-sm"
              onClick={() => patch({
                expenses: [...inputs.expenses, {
                  key: `custom-${Date.now()}`,
                  label: "Custom",
                  basis: "amount",
                  value: 0,
                }],
              })}>
              <Plus className="h-4 w-4" /> Add expense
            </button>
          </div>
        </Section>

        {/* Other Income */}
        <Section title="Other Income" subtitle="Laundry, parking, storage, billboards, etc." defaultOpen={false}>
          <div className="space-y-2">
            {inputs.otherIncome.map((o, idx) => (
              <OtherIncomeRow
                key={idx}
                line={o}
                onChange={(next) => {
                  const list = [...inputs.otherIncome]; list[idx] = next; patch({ otherIncome: list });
                }}
                onRemove={() => patch({ otherIncome: inputs.otherIncome.filter((_, i) => i !== idx) })}
              />
            ))}
            <button type="button" className="btn btn-secondary text-sm"
              onClick={() => patch({ otherIncome: [...inputs.otherIncome, { label: "Other", monthly: 0 }] })}>
              <Plus className="h-4 w-4" /> Add other income
            </button>
          </div>
        </Section>

        {/* Assumptions */}
        <Section title="Assumptions" subtitle="Vacancy, growth, hold period.">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <PctField label="Vacancy"           value={inputs.assumptions.vacancyPct}        onChange={(v) => patchAssumptions({ vacancyPct: v })} />
            <PctField label="Appreciation / yr" value={inputs.assumptions.appreciationPct}   onChange={(v) => patchAssumptions({ appreciationPct: v })} />
            <PctField label="Income inc. / yr"  value={inputs.assumptions.incomeIncreasePct} onChange={(v) => patchAssumptions({ incomeIncreasePct: v })} />
            <PctField label="Expense inc. / yr" value={inputs.assumptions.expenseIncreasePct} onChange={(v) => patchAssumptions({ expenseIncreasePct: v })} />
            <PctField label="Selling costs"     value={inputs.assumptions.sellingCostsPct}   onChange={(v) => patchAssumptions({ sellingCostsPct: v })} />
            <Field label="Hold years">
              <NumberInput value={inputs.assumptions.holdYears} onChange={(v) => patchAssumptions({ holdYears: v })} min={1} max={35} step={1} />
            </Field>
          </div>
        </Section>
      </div>
    </>
  );
}

// ─── small input primitives ────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="field-label">{label}</span>{children}</label>;
}

function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      className="field-input"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step ?? "any"}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  );
}

function PctField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <div className="relative">
        <NumberInput value={value} onChange={onChange} step={0.1} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-fg)] pointer-events-none">%</span>
      </div>
    </Field>
  );
}

function PctOrAmountField({ label, value, onChange }: {
  label: string;
  value: { basis: "pct" | "amount"; value: number };
  onChange: (v: { basis: "pct" | "amount"; value: number }) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-1.5">
        <NumberInput value={value.value} onChange={(v) => onChange({ ...value, value: v })} min={0} step={value.basis === "pct" ? 0.1 : 1} />
        <select className="field-select w-20" value={value.basis}
          onChange={(e) => onChange({ ...value, basis: e.target.value as "pct" | "amount" })}>
          <option value="pct">%</option>
          <option value="amount">$</option>
        </select>
      </div>
    </Field>
  );
}

function RentUnitRow({ unit, onChange, onRemove }: { unit: RentUnit; onChange: (u: RentUnit) => void; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-12 gap-1.5 items-end">
      <div className="col-span-4">
        <input className="field-input" placeholder="Unit label" value={unit.label} onChange={(e) => onChange({ ...unit, label: e.target.value })} />
      </div>
      <div className="col-span-4">
        <select className="field-select" value={unit.kind} onChange={(e) => onChange({ ...unit, kind: e.target.value as RentUnit["kind"] })}>
          {UNIT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div className="col-span-3">
        <NumberInput value={unit.monthlyRent} onChange={(v) => onChange({ ...unit, monthlyRent: v })} min={0} step={50} />
      </div>
      <button type="button" className="col-span-1 text-red-600 hover:text-red-700 flex justify-center p-2" onClick={onRemove} title="Remove">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function ExpenseRow({ line, onChange, onRemove }: { line: ExpenseLine; onChange: (l: ExpenseLine) => void; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-12 gap-1.5 items-end">
      <div className="col-span-5">
        <input className="field-input" placeholder="Expense label" value={line.label} onChange={(e) => onChange({ ...line, label: e.target.value })} />
      </div>
      <div className="col-span-3">
        <select className="field-select" value={line.basis} onChange={(e) => onChange({ ...line, basis: e.target.value as ExpenseLine["basis"] })}>
          <option value="amount">Fixed $</option>
          <option value="pct_of_rent">% of rent</option>
        </select>
      </div>
      <div className="col-span-3">
        <NumberInput value={line.value} onChange={(v) => onChange({ ...line, value: v })} min={0} step={line.basis === "amount" ? 50 : 0.1} />
      </div>
      <button type="button" className="col-span-1 text-red-600 hover:text-red-700 flex justify-center p-2" onClick={onRemove} title="Remove">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function OtherIncomeRow({ line, onChange, onRemove }: { line: OtherIncomeLine; onChange: (l: OtherIncomeLine) => void; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-12 gap-1.5 items-end">
      <div className="col-span-8">
        <input className="field-input" placeholder="e.g. Laundry" value={line.label} onChange={(e) => onChange({ ...line, label: e.target.value })} />
      </div>
      <div className="col-span-3">
        <NumberInput value={line.monthly} onChange={(v) => onChange({ ...line, monthly: v })} min={0} step={25} />
      </div>
      <button type="button" className="col-span-1 text-red-600 hover:text-red-700 flex justify-center p-2" onClick={onRemove} title="Remove">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function LoanRow({ loan, onChange, onRemove }: { loan: Loan; onChange: (l: Loan) => void; onRemove: () => void }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-start gap-2 mb-2">
        <input className="field-input flex-1" placeholder="Loan label" value={loan.label} onChange={(e) => onChange({ ...loan, label: e.target.value })} />
        <button type="button" className="text-red-600 hover:text-red-700 p-2" onClick={onRemove} title="Remove">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Field label="Kind">
          <select className="field-select" value={loan.kind} onChange={(e) => onChange({ ...loan, kind: e.target.value as Loan["kind"] })}>
            <option value="amortizing">Amortizing</option>
            <option value="interest_only">Interest only</option>
          </select>
        </Field>
        <Field label="Rate (APR)">
          <div className="relative">
            <NumberInput value={loan.ratePct} onChange={(v) => onChange({ ...loan, ratePct: v })} min={0} step={0.125} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-fg)] pointer-events-none">%</span>
          </div>
        </Field>
        <Field label="Term (yrs)">
          <NumberInput value={loan.termYears} onChange={(v) => onChange({ ...loan, termYears: v })} min={1} max={40} step={1} />
        </Field>
        <Field label={loan.basis === "pct_of_price" ? "LTV" : "Amount"}>
          <div className="flex gap-1.5">
            <NumberInput value={loan.value} onChange={(v) => onChange({ ...loan, value: v })} min={0} step={loan.basis === "pct_of_price" ? 1 : 1000} />
            <select className="field-select w-20" value={loan.basis}
              onChange={(e) => onChange({ ...loan, basis: e.target.value as Loan["basis"] })}>
              <option value="pct_of_price">%</option>
              <option value="amount">$</option>
            </select>
          </div>
        </Field>
      </div>
    </div>
  );
}
