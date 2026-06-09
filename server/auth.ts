import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { getUserById } from "./storage";
import type { User as UserRow } from "../shared/schema";

const TOKEN_TTL = "30d";

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    // We refuse to issue tokens with a weak/missing secret rather than ship
    // an insecure default. The local dev .env.example sets a real one.
    throw new Error("JWT_SECRET is not set or is too short (need ≥16 chars). See .env.example.");
  }
  return s;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

export function signToken(user: UserRow): string {
  return jwt.sign({ userId: user.id }, jwtSecret(), { expiresIn: TOKEN_TTL });
}

export function safeUser(u: UserRow) {
  // Strip the password hash before returning a user blob to the client.
  const { passwordHash: _ph, ...rest } = u;
  return rest;
}

// ── middleware ────────────────────────────────────────────────────────────
//
// Bearer-in-Authorization-header style (matches FlipIQ). The browser stores
// the token in localStorage and adds the header on every fetch. This makes a
// future Suite SSO bridge trivial: the Suite issues a JWT with the same
// secret and the browser drops it into localStorage via the #sso=… hash.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      userId?: number;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  let payload: { userId: number };
  try {
    payload = jwt.verify(token, jwtSecret()) as { userId: number };
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  const user = getUserById(payload.userId);
  if (!user) {
    res.status(401).json({ error: "Account no longer exists" });
    return;
  }
  if (user.status === "blocked") {
    res.status(403).json({ error: "Account is blocked" });
    return;
  }
  if (user.status === "pending") {
    res.status(403).json({ error: "Account is pending approval" });
    return;
  }
  req.user = user;
  req.userId = user.id;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    next();
  });
}

// Re-export getUserById so routes don't reach into storage for the lookup.
export { getUserById };
