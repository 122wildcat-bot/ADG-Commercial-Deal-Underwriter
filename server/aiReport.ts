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
// When the primary model is overloaded, the last retry attempt switches to
// this fallback. Different model → different load pool, so a Sonnet attempt
// often succeeds when Opus is overloaded. Same API surface, ~2-3x faster,
// half the cost. The user can override with ANTHROPIC_FALLBACK_MODEL.
const FALLBACK_MODEL = "claude-sonnet-4-6";
// 64K (well below Opus 4.8's 128K ceiling). At 32K with adaptive thinking
// + the newer web_search_20260209's dynamic filtering, the model burned
// the entire budget on reasoning + tool calls and ran out of room for
// the actual HTML — saw 33,075 output_tokens for only ~2,500 chars of
// text in one production run.
const MAX_TOKENS = 64_000;
// Bumped down again — the older web_search_20250305 (used below) doesn't
// recurse into code_execution like 20260209 does, so each search is much
// cheaper. Two real searches is plenty for a comp + market-rent check.
const MAX_WEB_SEARCH_USES = 2;
const REQUEST_TIMEOUT_MS = 10 * 60_000;

export interface GenerateReportArgs {
  deal: Pick<Deal, "name" | "address" | "propertyType">;
  inputs: DealInputs;
  outputs: DealOutputs;
  agent?: AgentBrand;
  /** When true (default), Claude is given web_search to research comps and market context. */
  enableWebSearch?: boolean;
  /** Stage transitions during generation — for the polling progress bar. */
  onStage?: (stage: "ai_thinking" | "ai_searching" | "ai_writing") => void;
  /** Override the default model (used by the retry path for overload fallback). */
  modelOverride?: string;
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

/**
 * Wrap generateAiReport with retry-on-transient-error logic. The Anthropic
 * SDK auto-retries 5xx errors at the HTTP layer, but only BEFORE a stream
 * has started — once we're streaming, a mid-flight 500 is not retried.
 * This higher-level wrapper restarts the whole generation from scratch on
 * transient failures (5xx, overloaded, rate-limited) with exponential
 * backoff. After exhausting retries it re-throws the last error with a
 * user-friendly message.
 */
export async function generateAiReportWithRetry(args: GenerateReportArgs): Promise<GenerateReportResult> {
  const RETRIES = 2;
  let lastErr: unknown;
  let sawOverloaded = false;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      if (attempt > 0) console.log(`[aiReport] retry attempt ${attempt + 1}/${RETRIES + 1}…`);
      // Final attempt + we've been bouncing on overloaded errors → switch to
      // the fallback model. Different load pool, often available when the
      // primary is overloaded.
      const useFallback = attempt === RETRIES && sawOverloaded;
      if (useFallback) {
        const fb = process.env.ANTHROPIC_FALLBACK_MODEL || FALLBACK_MODEL;
        console.log(`[aiReport] previous attempts hit overloaded; falling back to ${fb}`);
        return await generateAiReport({ ...args, modelOverride: fb });
      }
      return await generateAiReport(args);
    } catch (e) {
      lastErr = e;
      const msg = ((e as Error).message || "").slice(0, 300);
      const transient = isTransientApiError(e);
      if (/overloaded/i.test(msg)) sawOverloaded = true;
      console.log(`[aiReport] attempt ${attempt + 1} failed: ${msg} (transient=${transient}, sawOverloaded=${sawOverloaded})`);
      if (!transient || attempt === RETRIES) break;
      // 5s, 10s. Anthropic 5xx incidents typically clear within seconds.
      const backoffMs = 5_000 * Math.pow(2, attempt);
      console.log(`[aiReport] backing off ${backoffMs}ms before retry…`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error(friendlyError(lastErr));
}

function isTransientApiError(e: unknown): boolean {
  const msg = (e as Error)?.message || "";
  if (/Internal server error/i.test(msg)) return true;
  if (/overloaded_error/i.test(msg)) return true;
  if (/api_error/i.test(msg)) return true;
  if (/rate.?limit/i.test(msg)) return true;
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(msg)) return true;
  const anyErr = e as { status?: number };
  const status = anyErr?.status;
  if (typeof status === "number" && (status === 408 || status === 409 || status === 429 || status >= 500)) return true;
  return false;
}

/** Translate raw SDK / API errors into a one-line message safe to surface in the UI. */
function friendlyError(e: unknown): string {
  const raw = (e as Error)?.message || String(e);
  // Anthropic returns the API error response JSON inside the SDK error message.
  // Try to pull out request_id + a short reason; fall back to the raw string.
  let reason = "";
  let requestId = "";
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      reason = j?.error?.message || j?.error?.type || "";
      requestId = j?.request_id || "";
    }
  } catch { /* ignore */ }
  if (/Internal server error/i.test(reason) || /Internal server error/i.test(raw)) {
    return requestId
      ? `Claude's API hit a transient error after multiple retries. This usually clears up within a few minutes — try again. (Anthropic ref: ${requestId})`
      : "Claude's API hit a transient error after multiple retries. Try again in a few minutes.";
  }
  if (/overloaded/i.test(reason) || /overloaded/i.test(raw)) {
    return "Claude is overloaded right now. Try again in a few minutes.";
  }
  if (/rate.?limit/i.test(reason) || /rate.?limit/i.test(raw)) {
    return "Hit Anthropic's rate limit. Try again in a minute.";
  }
  if (reason) return `Report generation failed: ${reason}${requestId ? ` (ref: ${requestId})` : ""}`;
  return raw.slice(0, 300);
}

export async function generateAiReport(args: GenerateReportArgs): Promise<GenerateReportResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("AI report is not configured. Set ANTHROPIC_API_KEY on this deployment.");
  }
  const model = args.modelOverride || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });

  const system = buildReportSystemPrompt(args.agent);

  // Streaming so we can comfortably set max_tokens at 64k without bumping into
  // SDK HTTP timeouts (a full 8-9 page HTML report is ~25-40k characters of
  // visible output, but thinking/tool-use tokens push the total much higher).
  //
  // ── Why these choices ──
  // - thinking: "disabled". A production run with adaptive thinking burned
  //   the entire 32K output budget on thinking blocks + dynamic-filter
  //   code_execution scripts and never wrote the HTML. With thinking off
  //   on Opus 4.8 the system prompt does the steering directly.
  // - web_search_20250305 (NOT _20260209). The newer 20260209 ships with
  //   dynamic filtering that spawns internal code_execution / bash /
  //   text_editor calls to filter results — observed nine such calls in
  //   addition to three actual searches in the failed run, plus ~9 minutes
  //   of compounded latency. The older 20250305 is just "search → results";
  //   plenty for our use case.
  const useSearch = args.enableWebSearch !== false;
  const tools: Anthropic.Messages.ToolUnion[] = useSearch
    ? [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCH_USES }]
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

  args.onStage?.("ai_thinking");
  const t0 = Date.now();
  const stream = client.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: "disabled" },
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
              `- Use the web_search tool sparingly (≤${MAX_WEB_SEARCH_USES} queries) to ground local comps, rents, and tax / assessment context.\n` +
              `- **Respond ONLY with the HTML document.** No preamble, no explanation, no markdown fences, no meta-commentary about your process. Start the response with <!DOCTYPE html> and end with </html>. Anything else is a failed report.\n\n` +
              `Payload:\n\`\`\`json\n${JSON.stringify(userPayload, null, 2)}\n\`\`\``,
          },
        ],
      },
    ],
  });

  // Bridge Anthropic stream events → stage updates AND detailed timing logs.
  // Two subtle points on the stage logic:
  //
  //  - Claude can emit reasoning preamble TEXT blocks *before* it calls web
  //    search. If we emit "ai_writing" on the first text block, the bar
  //    jumps to 65% and then back to 35% once the search starts. So we only
  //    emit "ai_writing" once we've already passed "ai_searching" (or web
  //    search is disabled entirely).
  //
  //  - updateReportStage is monotonic (only advances, never reverses) as a
  //    belt-and-suspenders guard against any out-of-order callbacks.
  //
  // The block-level logs are deliberately verbose — they're the diagnostic
  // we need to see WHERE long generations spend their time (e.g. 14 min
  // silent between ai_searching and final output).
  let sawSearch = false;
  let sawText = false;
  let textBlockChars = 0;
  let searchCallNum = 0;
  let textBlockNum = 0;
  const tStart = Date.now();
  const elapsed = () => ((Date.now() - tStart) / 1000).toFixed(1) + "s";

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start") {
      const cb = (event as { content_block?: { type?: string; name?: string } }).content_block;
      if (!cb) return;
      if (cb.type === "server_tool_use") {
        searchCallNum += 1;
        console.log(`[aiReport] +${elapsed()} web_search call ${searchCallNum} start (name=${cb.name})`);
        if (!sawSearch) {
          sawSearch = true;
          args.onStage?.("ai_searching");
        }
      } else if (cb.type === "web_search_tool_result") {
        console.log(`[aiReport] +${elapsed()} web_search call ${searchCallNum} result received`);
      } else if (cb.type === "thinking") {
        console.log(`[aiReport] +${elapsed()} thinking block start`);
      } else if (cb.type === "text") {
        textBlockNum += 1;
        textBlockChars = 0;
        const pastSearch = sawSearch || !useSearch;
        console.log(`[aiReport] +${elapsed()} text block ${textBlockNum} start (pastSearch=${pastSearch})`);
        if (pastSearch && !sawText) {
          sawText = true;
          args.onStage?.("ai_writing");
        }
      }
    } else if (event.type === "content_block_delta") {
      const delta = (event as { delta?: { type?: string; text?: string } }).delta;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        textBlockChars += delta.text.length;
      }
    } else if (event.type === "content_block_stop") {
      if (textBlockChars > 0) {
        console.log(`[aiReport] +${elapsed()} text block ${textBlockNum} stop (chars=${textBlockChars})`);
        textBlockChars = 0;
      }
    } else if (event.type === "message_delta") {
      const usage = (event as { usage?: { output_tokens?: number } }).usage;
      if (usage?.output_tokens != null) {
        console.log(`[aiReport] +${elapsed()} message_delta output_tokens=${usage.output_tokens}`);
      }
    }
  });

  console.log(`[aiReport] +${elapsed()} stream opened (model=${model}, web_search=${useSearch ? `≤${MAX_WEB_SEARCH_USES}` : "off"})`);
  const finalMessage = await stream.finalMessage();
  console.log(`[aiReport] +${elapsed()} finalMessage received, stop_reason=${finalMessage.stop_reason}, searches=${searchCallNum}, text_blocks=${textBlockNum}`);
  const durationMs = Date.now() - t0;

  if (finalMessage.stop_reason === "refusal") {
    throw new Error("The model declined to generate this report.");
  }

  // Pull all text blocks; the report itself is in the final assistant text.
  // (Tool-use turns and tool results may also appear in content for web_search.)
  const textBlocks = finalMessage.content.filter(
    (b): b is Anthropic.Messages.TextBlock => b.type === "text",
  );
  const fullText = textBlocks.map((b) => b.text).join("\n").trim();

  // Slice exactly from <!DOCTYPE html> to </html>. Anything before is preamble
  // (Opus 4.8 with thinking disabled sometimes leaks "I'll research X first…"
  // reasoning into the visible response; the API guide warns about this).
  // Anything after </html> is similarly trimmed.
  const docStart = fullText.search(/<!doctype html/i);
  if (docStart === -1) {
    console.error(`[aiReport] no <!DOCTYPE html> in ${fullText.length}-char response. First 400 chars: ${fullText.slice(0, 400)}`);
    throw new Error("The model did not return an HTML document.");
  }
  let html = fullText.slice(docStart);
  const closeIdx = html.lastIndexOf("</html>");
  if (closeIdx !== -1) html = html.slice(0, closeIdx + "</html>".length);
  html = html.trim();

  const preambleChars = docStart;
  if (preambleChars > 0) {
    console.log(`[aiReport] stripped ${preambleChars}-char preamble before <!DOCTYPE html>: "${fullText.slice(0, Math.min(200, preambleChars))}…"`);
  }

  // Belt + suspenders: the model also occasionally leaks reasoning INSIDE
  // the body, as a stray text node before the first real child element. The
  // first child of <body> should always be an element (the cover div, a
  // header, etc.) — never raw text. Strip any text-content that sits
  // between <body> and the first '<'.
  html = html.replace(
    /(<body[^>]*>)([^<]+)/i,
    (_match, openTag: string, leaked: string) => {
      if (leaked.trim().length > 0) {
        console.log(`[aiReport] stripped ${leaked.length}-char leaked text inside <body>: "${leaked.trim().slice(0, 200)}"`);
      }
      return openTag;
    },
  );
  // Also strip stray text between </head> and <body> (rare but possible).
  html = html.replace(
    /(<\/head>)([^<]+)(<body)/i,
    (_match, headClose: string, leaked: string, bodyOpen: string) => {
      if (leaked.trim().length > 0) {
        console.log(`[aiReport] stripped ${leaked.length}-char leaked text between </head> and <body>: "${leaked.trim().slice(0, 200)}"`);
      }
      return headClose + bodyOpen;
    },
  );

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
