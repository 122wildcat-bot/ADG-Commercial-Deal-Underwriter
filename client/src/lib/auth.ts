const TOKEN_KEY = "underwriter_token";
const USER_KEY = "underwriter_user";

export interface CurrentUser {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin";
  status: "pending" | "active" | "blocked";
}

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch {}
}
export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
}
export function getStoredUser(): CurrentUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as CurrentUser) : null;
  } catch { return null; }
}
export function setStoredUser(u: CurrentUser) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {}
}

/**
 * If the URL has `#sso=<token>`, store the token and rewrite the URL to
 * `#/app` so the rest of the SPA picks up the authenticated session.
 */
export function consumeSsoToken(): boolean {
  try {
    const hash = window.location.hash || "";
    const m = hash.match(/(?:^#|[#&])sso=([^&]+)/);
    if (!m) return false;
    const token = decodeURIComponent(m[1]);
    if (!token) return false;
    setToken(token);
    const url = window.location.pathname + window.location.search + "#/";
    window.history.replaceState(null, "", url);
    return true;
  } catch {
    return false;
  }
}
