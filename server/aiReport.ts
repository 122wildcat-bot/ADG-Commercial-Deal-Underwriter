// server/aiReport.ts
//
// AI Investor Report (Phase 2, spec §8 + §9). Sends the deal payload to Claude
// with a detailed buy-side underwriting system prompt + web_search tool, gets
// back a complete HTML document, and hands it to the Puppeteer renderer.
//
// Degrades gracefully — the route returns a configured-false JSON when no
// ANTHROPIC_API_KEY is set. The "Print Summary" button uses printTemplate.ts
// and works without any API key.

import Anthropic from "@anthropic-ai/sdk";
import type { Deal } from "../shared/schema";
import type { DealInputs, DealOutputs } from "../shared/types";
import { buildReportSystemPrompt, type AgentBrand } from "./reportSystemPrompt";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 32_000;

export interface GenerateReportArgs {
  deal: Pick<Deal, "name" | "address" | "propertyType">;
  inputs: DealInputs;
  outputs: DealOutputs;
  agent?: AgentBrand;
  /** When true (default), Claude is given web_search to research comps and market context. */
  enableWebSearch?: boolean;
}

export interface GenerateReportResult {
  /** Always true when this function returns; absence is signalled at the route. */
  configured: true;
  html: string;
  model: string;
  durationMs: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

export function isReportConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function generateAiReport(args: GenerateReportArgs): Promise<GenerateReportResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("AI report is not configured. Set ANTHROPIC_API_KEY on this deployment.");
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey, timeout: 5 * 60_000 });

  const system = buildReportSystemPrompt(args.agent);

  // Streaming so we can comfortably set max_tokens at 32k without bumping into
  // SDK HTTP timeouts (a full 8-9 page HTML report is ~25-40k characters).
  // Adaptive thinking lets the model decide how much to reason per request.
  const useSearch = args.enableWebSearch !== false;
  const tools: Anthropic.Messages.ToolUnion[] = useSearch
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]
    : [];

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const userPayload = {
    deal_name: args.deal.name,
    deal_address: args.deal.address,
    deal_property_type: args.deal.propertyType,
    today,
    rent_entry_mode: args.inputs.rentEntryMode ?? "roll",
    simple_monthly_rent: args.inputs.simpleMonthlyRent ?? null,
    rent_roll: args.inputs.rentRoll.map((u) => ({
      label: u.label,
      kind: u.kind,
      beds: u.beds ?? null,
      baths: u.baths ?? null,
      sqft: u.sqft ?? null,
      monthly_rent: u.monthlyRent,
    })),
    inputs: args.inputs,
    engine_outputs: args.outputs,
  };

  const t0 = Date.now();
  const stream = client.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Generate the full Investment Underwriting & Valuation report for the deal payload below.\n\n` +
              `RULES:\n` +
              `- Engine outputs are AUTHORITATIVE for the as-entered scenario — use them verbatim.\n` +
              `- Apply lender-style normalization where warranted and produce a Seller View vs. Lender-Underwritten table when the gap is material.\n` +
              `- Use the web_search tool sparingly (≤5 queries) to ground local comps, rents, and tax / assessment context.\n` +
              `- Return ONLY the HTML document. No markdown fences. Start with <!DOCTYPE html>.\n\n` +
              `Payload:\n\`\`\`json\n${JSON.stringify(userPayload, null, 2)}\n\`\`\``,
          },
        ],
      },
    ],
  });

  const finalMessage = await stream.finalMessage();
  const durationMs = Date.now() - t0;

  if (finalMessage.stop_reason === "refusal") {
    throw new Error("The model declined to generate this report.");
  }

  // Pull all text blocks; the report itself is in the final assistant text.
  // (Tool-use turns and tool results may also appear in content for web_search.)
  const textBlocks = finalMessage.content.filter(
    (b): b is Anthropic.Messages.TextBlock => b.type === "text",
  );
  const html = textBlocks.map((b) => b.text).join("\n").trim();
  if (!html || !/<!doctype html/i.test(html)) {
    throw new Error("The model did not return an HTML document.");
  }

  return {
    configured: true,
    html,
    model,
    durationMs,
    usage: {
      input_tokens: finalMessage.usage.input_tokens,
      output_tokens: finalMessage.usage.output_tokens,
      cache_read_input_tokens: finalMessage.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: finalMessage.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
