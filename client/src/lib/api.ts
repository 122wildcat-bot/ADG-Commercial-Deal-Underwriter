import { clearAuth, getToken } from "./auth";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401) {
      // Stale or invalid token — wipe and let the router bounce to /login.
      clearAuth();
    }
    throw new ApiError(res.status, data?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  get:  <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b),
  put:  <T>(p: string, b?: unknown) => request<T>("PUT", p, b),
  del:  <T>(p: string) => request<T>("DELETE", p),
};
