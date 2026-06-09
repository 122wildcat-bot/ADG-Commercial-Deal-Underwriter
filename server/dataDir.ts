import path from "node:path";

/**
 * Resolves the data directory using the fleet convention:
 *   DATA_DIR  →  RAILWAY_VOLUME_MOUNT_PATH  →  /data (on Railway)  →  cwd (local)
 *
 * Mount a Railway Volume at /data or every deal is wiped on redeploy.
 * Reference: docs/commercial-deal-underwriter-kickoff.md.
 */
export function getDataDir() {
  const explicit = process.env.DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);

  const railwayVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (railwayVolume) return path.resolve(railwayVolume);

  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) {
    return "/data";
  }

  return process.cwd();
}
