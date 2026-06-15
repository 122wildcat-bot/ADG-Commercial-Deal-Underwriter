// server/reportStorage.ts
//
// PDF persistence for AI Investor Reports. PDFs live on the /data volume
// under reports/<dealId>/<reportId>.pdf. Saving the file BEFORE returning
// the HTTP response means a Railway-edge 502 during delivery (long reports
// can exceed the proxy's idle-connection ceiling) doesn't lose the work —
// the user can find and re-download the report from the Saved Reports
// list.

import { mkdirSync, readFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./dataDir";

const REPORTS_SUBDIR = "reports";

function reportsRoot(): string {
  const root = path.join(getDataDir(), REPORTS_SUBDIR);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Save a PDF buffer under reports/<dealId>/<reportId>.pdf and return the
 * relative path (suitable for storing in the DB).
 */
export async function saveReportPdf(args: {
  dealId: string;
  reportId: string;
  pdf: Buffer;
}): Promise<{ relPath: string; sizeBytes: number }> {
  const dir = path.join(reportsRoot(), args.dealId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `${args.reportId}.pdf`;
  const abs = path.join(dir, filename);
  await writeFile(abs, args.pdf);
  return {
    relPath: path.posix.join(args.dealId, filename),
    sizeBytes: args.pdf.length,
  };
}

/**
 * Read a stored report PDF by its relative path (the value stored in the
 * `path` column of deal_reports). Throws if the file is missing.
 */
export function readReportPdf(relPath: string): Buffer {
  const abs = path.join(reportsRoot(), relPath);
  if (!existsSync(abs)) {
    throw new Error("Report file is missing from disk. It may have been deleted.");
  }
  return readFileSync(abs);
}

/** Best-effort: remove a report PDF from disk. Never throws. */
export function deleteReportPdf(relPath: string): void {
  try {
    const abs = path.join(reportsRoot(), relPath);
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    // best effort — the DB record is the source of truth
  }
}

/** Diagnostic helper — verify on-disk size matches the DB record. */
export function statReportPdf(relPath: string): { exists: boolean; size?: number } {
  try {
    const abs = path.join(reportsRoot(), relPath);
    if (!existsSync(abs)) return { exists: false };
    return { exists: true, size: statSync(abs).size };
  } catch {
    return { exists: false };
  }
}
