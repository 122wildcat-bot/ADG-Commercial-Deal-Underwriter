// Typed CRM client.
//
// Phase 1 ships with CRM_MODE=mock so no live calls are made — the rest of the
// app (and the future "Push to CRM" buttons) can be built against this
// interface, and we flip CRM_MODE to "live" later in an additive PR.
//
// Endpoints we'll need on the CRM (documented here so the live PR is small):
//   POST /api/ingest        — create / upsert a deal + contact + property
//     headers: Authorization: Bearer <CRM_API_KEY>
//     body:    { agentEmail, source: "underwriter", link, property{…}, contact{…}, deal{…}, activityBody }
//   GET  /api/health        — probe used by the Suite tile
//
// The shape below mirrors FlipIQ's existing CRM ingest contract so the CRM
// side doesn't have to learn a new schema.

export type CrmMode = "mock" | "live";

export interface CrmDealPayload {
  agentEmail: string;
  agentName?: string;
  source: "underwriter";
  link?: string;
  property: {
    addressNormalized: string;
    units: number;
    propertyType: string;
    purchasePrice: number;
    capRatePct: number;
    cashFlowMonthly: number;
    links: { underwriter: string };
  };
  contact: { name: string; type: "lead" };
  deal: { stage: "New"; value: number | null };
  activityBody: string;
}

export interface CrmIngestResult {
  ok: boolean;
  mode: CrmMode;
  ownerId?: string;
  contactId?: string;
  propertyId?: string;
  dealId?: string;
  message?: string;
}

function mode(): CrmMode {
  const m = (process.env.CRM_MODE || "mock").toLowerCase();
  return m === "live" ? "live" : "mock";
}

export async function pushDealToCrm(payload: CrmDealPayload): Promise<CrmIngestResult> {
  if (mode() === "mock") {
    return {
      ok: true,
      mode: "mock",
      dealId: `mock-deal-${Date.now()}`,
      message:
        "CRM_MODE=mock — no live call was made. Set CRM_MODE=live and CRM_API_KEY to push to the real CRM.",
    };
  }

  const apiKey = process.env.CRM_API_KEY;
  if (!apiKey) {
    throw new Error("CRM is not configured: CRM_MODE=live requires CRM_API_KEY.");
  }
  const baseUrl = (process.env.CRM_BASE_URL || "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("CRM is not configured: CRM_MODE=live requires CRM_BASE_URL.");
  }

  const url = `${baseUrl}/api/ingest`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(`Could not reach the CRM ingest endpoint (${url}): ${(e as Error).message}`);
  }

  let data: Partial<CrmIngestResult> = {};
  try {
    data = (await res.json()) as Partial<CrmIngestResult>;
  } catch {
    // Tolerate non-JSON bodies; status drives the decision below.
  }

  if (!res.ok) {
    throw new Error(data.message || `CRM returned HTTP ${res.status}.`);
  }

  return { ...data, ok: true, mode: "live" };
}

/** For the Suite tile / status checks: are we live or mock right now? */
export function describeCrmMode(): string {
  return mode() === "live" ? "live" : "mock (Phase 1 default)";
}
