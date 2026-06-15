// server/aiExtract.ts
//
// AI document import (Phase 3, spec §9.1): upload a PDF / image / CSV and Claude
// returns a validated, partial DealInputs the editor pre-fills. Fleet convention
// — degrade gracefully: when ANTHROPIC_API_KEY is missing or the call fails, the
// importer is disabled and manual entry is unaffected. Core flows never block on
// the API.
//
// Structured output is forced via tool use (tool_choice → save_deal_inputs): the
// model must return a single tool call whose validated input we map onto
// DealInputs. The frozen system prompt is marked with cache_control so repeated
// imports reuse the cached prefix.

import Anthropic from "@anthropic-ai/sdk";
import type { DealInputs } from "../shared/types";

// Most capable Claude by default (accuracy matters — wrong numbers in an
// underwriter are costly). Override via ANTHROPIC_MODEL to trade for cost.
const DEFAULT_MODEL = "claude-opus-4-8";

// Inline document/image base64 rides in the request body (~32MB API cap, base64
// inflates ~33%); cap raw uploads well under that. Enforced again in the route.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const PDF_TYPES = new Set(["application/pdf"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_TYPES = new Set(["text/plain", "text/csv", "application/csv", "text/markdown"]);

export interface ExtractResult {
  /** false when ANTHROPIC_API_KEY is unset — the importer is simply off */
  configured: boolean;
  /** true when we got a usable extraction */
  ok: boolean;
  inputs?: Partial<DealInputs> & { name?: string; address?: string };
  warnings: string[];
  model?: string;
  message?: string;
}

const SYSTEM_PROMPT = `You are a commercial real estate underwriting data extractor for the Adam Druck Group.

You receive a document about an income property (an MLS sheet, offering memorandum, rent roll, T-12 / operating statement, or similar) and extract the inputs needed to underwrite a buy-and-hold deal. Call the save_deal_inputs tool exactly once with whatever you can determine.

Rules:
- Only include fields the document actually supports. OMIT anything you cannot find — never invent or estimate a value.
- Money is annual unless stated otherwise. Rents are typically quoted monthly; if a figure is annual, divide by 12 for monthly fields.
- Rent entry: if the document itemizes rent per unit, return rentRoll and set rentEntryMode to "roll". If it only gives a single total (e.g. "gross monthly rent" or "scheduled gross income"), set rentEntryMode to "simple" and put the monthly figure in simpleMonthlyRent (convert an annual total to monthly).
- Operating expenses: each line is either a fixed dollar amount per year (basis "amount") or a percent of gross rent (basis "pct_of_rent"). Use the line's own basis; do not convert one to the other.
- Loan terms: capture rate, amortization term in years, and the loan amount either as a percent of price (basis "pct_of_price", e.g. 75 for 75% LTV) or a dollar amount (basis "amount").
- Depreciation: residential rental (1-4 units) is 27.5 years; commercial is 39. Only set it if the document makes the property type clear.
- Be conservative. A partially-filled, correct extraction is far better than a complete but fabricated one.`;

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "save_deal_inputs",
  description:
    "Save the commercial real estate deal inputs extracted from the document. Call exactly once. Omit any field not supported by the document.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "A short name for the deal (e.g. the property name or street address)." },
      address: { type: "string", description: "Full property address." },
      propertyType: {
        type: "string",
        enum: ["multi_family", "mixed_use", "retail", "office", "industrial", "storage", "other"],
      },
      units: { type: "number", description: "Number of units." },
      totalSqft: { type: "number", description: "Total building square footage." },
      purchasePrice: { type: "number", description: "Purchase / asking price in dollars." },
      arv: { type: "number", description: "After-repair value or current market value in dollars." },
      landValue: { type: "number", description: "Land value in dollars (excluded from depreciation)." },
      depreciationYears: { type: "number", enum: [27.5, 39] },
      purchaseCosts: {
        type: "object",
        properties: {
          basis: { type: "string", enum: ["pct", "amount"] },
          value: { type: "number", description: "Percent of price (e.g. 2.5) or dollar amount." },
        },
      },
      rehab: {
        type: "object",
        properties: {
          basis: { type: "string", enum: ["pct", "amount"] },
          value: { type: "number" },
        },
      },
      rentEntryMode: { type: "string", enum: ["roll", "simple"] },
      simpleMonthlyRent: { type: "number", description: "Total gross monthly rent (use with rentEntryMode 'simple')." },
      rentRoll: {
        type: "array",
        description: "Per-unit rent (use with rentEntryMode 'roll').",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            kind: { type: "string", enum: ["residential", "commercial", "storage", "other"] },
            beds: { type: "number" },
            baths: { type: "number" },
            sqft: { type: "number" },
            monthlyRent: { type: "number" },
          },
        },
      },
      otherIncome: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            monthly: { type: "number" },
          },
        },
      },
      expenses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "Stable key, e.g. taxes / insurance / management / maintenance / capex / utilities / hoa." },
            label: { type: "string" },
            basis: { type: "string", enum: ["amount", "pct_of_rent"] },
            value: { type: "number", description: "Dollars per year (amount) or percent of gross rent (pct_of_rent)." },
          },
        },
      },
      loans: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            kind: { type: "string", enum: ["amortizing", "interest_only"] },
            ratePct: { type: "number", description: "Annual interest rate, percent." },
            termYears: { type: "number" },
            basis: { type: "string", enum: ["pct_of_price", "amount"] },
            value: { type: "number", description: "Percent of price (LTV) or dollar amount." },
          },
        },
      },
      assumptions: {
        type: "object",
        properties: {
          vacancyPct: { type: "number" },
          appreciationPct: { type: "number" },
          incomeIncreasePct: { type: "number" },
          expenseIncreasePct: { type: "number" },
          sellingCostsPct: { type: "number" },
          holdYears: { type: "number" },
        },
      },
    },
  },
};

export async function extractDealFromDocument(file: {
  buffer: Buffer;
  mediaType: string;
  filename: string;
}): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      ok: false,
      warnings: [],
      message:
        "AI import isn't configured. Set ANTHROPIC_API_KEY on this deployment to enable it — manual entry still works.",
    };
  }

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey, timeout: 60_000 });
  const mt = file.mediaType.toLowerCase();

  let docBlock: Anthropic.ContentBlockParam;
  if (PDF_TYPES.has(mt)) {
    docBlock = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") },
    };
  } else if (IMAGE_TYPES.has(mt)) {
    docBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: mt as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: file.buffer.toString("base64"),
      },
    };
  } else if (TEXT_TYPES.has(mt) || /\.(csv|txt|md)$/i.test(file.filename)) {
    const text = file.buffer.toString("utf-8").slice(0, 200_000);
    docBlock = { type: "text", text: `Document contents:\n\n${text}` };
  } else {
    return {
      configured: true,
      ok: false,
      warnings: [`Unsupported file type "${file.mediaType}". Upload a PDF, an image, or a CSV/text file.`],
    };
  }

  const instruction = `Extract the deal details from the attached document (filename: ${file.filename}) and call save_deal_inputs exactly once. Omit anything you cannot find rather than guessing.`;

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "save_deal_inputs" },
      messages: [{ role: "user", content: [docBlock, { type: "text", text: instruction }] }],
    });

    if (resp.stop_reason === "refusal") {
      return { configured: true, ok: false, warnings: ["The model declined to process this document."], model };
    }

    const toolUse = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "save_deal_inputs",
    );
    if (!toolUse) {
      return {
        configured: true,
        ok: false,
        warnings: ["Couldn't extract structured data from this document. Enter the deal manually."],
        model,
      };
    }

    const { inputs, warnings } = coerce(toolUse.input as Record<string, unknown>);
    if (Object.keys(inputs).length === 0) {
      warnings.push("No recognizable deal fields were found in the document.");
    }
    return { configured: true, ok: true, inputs, warnings, model };
  } catch (e) {
    // Never throw into the request path — surface a friendly message instead.
    return { configured: true, ok: false, warnings: [`AI import failed: ${(e as Error).message}`], model };
  }
}

// ── coercion ────────────────────────────────────────────────────────────────
// The tool input is model-produced and untrusted. Copy only well-typed values
// onto a partial DealInputs; the client merges this onto the editor defaults
// (and assigns ids to rent-roll / loan rows).

type AnyRec = Record<string, unknown>;

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,%\s]/g, ""));
    if (v.trim() && isFinite(n)) return n;
  }
  return undefined;
}
function toStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function coerce(raw: AnyRec): {
  inputs: Partial<DealInputs> & { name?: string; address?: string };
  warnings: string[];
} {
  const warnings: string[] = [];
  const out: Partial<DealInputs> & { name?: string; address?: string } = {};

  const name = toStr(raw.name);
  if (name) out.name = name;
  const address = toStr(raw.address);
  if (address) out.address = address;

  const pt = toStr(raw.propertyType);
  if (pt) out.propertyType = pt as DealInputs["propertyType"];

  const units = toNum(raw.units);
  if (units !== undefined) out.units = units;
  const totalSqft = toNum(raw.totalSqft);
  if (totalSqft !== undefined) out.totalSqft = totalSqft;
  const price = toNum(raw.purchasePrice);
  if (price !== undefined) out.purchasePrice = price;
  const arv = toNum(raw.arv);
  if (arv !== undefined) out.arv = arv;
  const land = toNum(raw.landValue);
  if (land !== undefined) out.landValue = land;
  const dep = toNum(raw.depreciationYears);
  if (dep === 27.5 || dep === 39) out.depreciationYears = dep;

  const poa = (v: unknown): DealInputs["purchaseCosts"] | undefined => {
    if (v && typeof v === "object") {
      const o = v as AnyRec;
      const value = toNum(o.value);
      if ((o.basis === "pct" || o.basis === "amount") && value !== undefined) {
        return { basis: o.basis as "pct" | "amount", value };
      }
    }
    return undefined;
  };
  const pc = poa(raw.purchaseCosts);
  if (pc) out.purchaseCosts = pc;
  const rehab = poa(raw.rehab);
  if (rehab) out.rehab = rehab;

  if (raw.rentEntryMode === "simple" || raw.rentEntryMode === "roll") {
    out.rentEntryMode = raw.rentEntryMode;
  }
  const simple = toNum(raw.simpleMonthlyRent);
  if (simple !== undefined) out.simpleMonthlyRent = simple;

  if (Array.isArray(raw.rentRoll)) {
    const rows = raw.rentRoll
      .map((u) => {
        const o = (u || {}) as AnyRec;
        const kind = ["residential", "commercial", "storage", "other"].includes(o.kind as string)
          ? (o.kind as DealInputs["rentRoll"][number]["kind"])
          : "residential";
        return {
          id: "",
          label: toStr(o.label) || "Unit",
          kind,
          beds: toNum(o.beds),
          baths: toNum(o.baths),
          sqft: toNum(o.sqft),
          monthlyRent: toNum(o.monthlyRent) ?? 0,
        };
      })
      .filter((r) => r);
    if (rows.length) out.rentRoll = rows;
  }

  if (Array.isArray(raw.otherIncome)) {
    const rows = raw.otherIncome.map((o) => {
      const r = (o || {}) as AnyRec;
      return { label: toStr(r.label) || "Other", monthly: toNum(r.monthly) ?? 0 };
    });
    if (rows.length) out.otherIncome = rows;
  }

  if (Array.isArray(raw.expenses)) {
    const rows = raw.expenses.map((e, i) => {
      const r = (e || {}) as AnyRec;
      const label = toStr(r.label) || "Expense";
      const key = toStr(r.key) || label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `custom-${i}`;
      return {
        key,
        label,
        basis: r.basis === "pct_of_rent" ? ("pct_of_rent" as const) : ("amount" as const),
        value: toNum(r.value) ?? 0,
      };
    });
    if (rows.length) out.expenses = rows;
  }

  if (Array.isArray(raw.loans)) {
    const rows = raw.loans.map((l) => {
      const r = (l || {}) as AnyRec;
      return {
        id: "",
        label: toStr(r.label) || "Loan",
        kind: r.kind === "interest_only" ? ("interest_only" as const) : ("amortizing" as const),
        ratePct: toNum(r.ratePct) ?? 0,
        termYears: toNum(r.termYears) ?? 30,
        basis: r.basis === "amount" ? ("amount" as const) : ("pct_of_price" as const),
        value: toNum(r.value) ?? 0,
      };
    });
    if (rows.length) out.loans = rows;
  }

  if (raw.assumptions && typeof raw.assumptions === "object") {
    const a = raw.assumptions as AnyRec;
    const as: Partial<DealInputs["assumptions"]> = {};
    for (const k of [
      "vacancyPct",
      "appreciationPct",
      "incomeIncreasePct",
      "expenseIncreasePct",
      "sellingCostsPct",
      "holdYears",
    ] as const) {
      const n = toNum(a[k]);
      if (n !== undefined) as[k] = n;
    }
    if (Object.keys(as).length) out.assumptions = as as DealInputs["assumptions"];
  }

  return { inputs: out, warnings };
}
