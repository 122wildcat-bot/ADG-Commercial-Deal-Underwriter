import { storage } from "./storage";
import { hashPassword, verifyPassword } from "./auth";

// ────────────────────────────────────────────────────────────────────────────
// Admin account seeding from environment variables.
// ────────────────────────────────────────────────────────────────────────────
//
// Even with a Railway Volume mounted at /data, we still want a known good
// admin account on every boot — that way a forgotten password or a fresh
// container in a new region is recoverable without DB surgery.
//
// Behaviour (idempotent; runs on every startup):
//   ADMIN_EMAIL + ADMIN_PASSWORD unset → no-op (so local dev isn't noisy).
//   User missing                       → create it as an active admin.
//   User exists, password matches      → ensure role=admin, status=active.
//   User exists, password differs      → reset the hash + re-activate.

const MIN_PASSWORD_LEN = 8;

export async function seedAdminFromEnv(
  log: (m: string) => void = (m) => console.log(m),
): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || "Admin";

  if (!email && !password) return;

  if (!email || !password) {
    log("[seed-admin] Skipped: set BOTH ADMIN_EMAIL and ADMIN_PASSWORD to seed a bootstrap admin.");
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    log("[seed-admin] Skipped: ADMIN_EMAIL is not a valid email address.");
    return;
  }
  if (password.length < MIN_PASSWORD_LEN) {
    log(`[seed-admin] Skipped: ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LEN} characters.`);
    return;
  }

  try {
    const existing = storage.getUserByEmail(email);

    if (!existing) {
      const passwordHash = await hashPassword(password);
      storage.createUser({
        email,
        passwordHash,
        name: displayName,
        role: "admin",
        status: "active",
      });
      log(`[seed-admin] Created bootstrap admin ${email}.`);
      return;
    }

    if (existing.role !== "admin") {
      storage.setUserRole(existing.id, "admin");
      log(`[seed-admin] Promoted ${email} to admin.`);
    }
    if (existing.status !== "active") {
      storage.setUserStatus(existing.id, "active");
      log(`[seed-admin] Activated ${email}.`);
    }

    const ok = await verifyPassword(password, existing.passwordHash);
    if (!ok) {
      const passwordHash = await hashPassword(password);
      storage.setUserPassword(existing.id, passwordHash);
      log(`[seed-admin] Reset password for ${email} to match ADMIN_PASSWORD.`);
      return;
    }

    log(`[seed-admin] Bootstrap admin ${email} already present and current.`);
  } catch (err) {
    // Never let seeding crash startup — the app must still serve.
    log(`[seed-admin] Failed: ${(err as Error)?.message ?? err}`);
  }
}
