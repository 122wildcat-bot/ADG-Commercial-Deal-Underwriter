import { useState } from "react";
import { useLocation, Link } from "wouter";
import { api, ApiError } from "@/lib/api";
import { setStoredUser, setToken, type CurrentUser } from "@/lib/auth";
import { AuthLayout } from "./LoginPage";

interface SignupResp { token: string; user: CurrentUser }

export function SignupPage() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<SignupResp>("/api/auth/signup", { email, password, name });
      setToken(data.token);
      setStoredUser(data.user);
      navigate(data.user.status === "active" ? "/" : "/pending");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Request access" subtitle="New accounts are approved by an ADG admin.">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="field-label">Your name</span>
          <input type="text" required className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Email</span>
          <input type="email" required className="field-input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Password</span>
          <input type="password" required minLength={8} className="field-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="text-xs text-[var(--muted-fg)] mt-1 block">Minimum 8 characters.</span>
        </label>
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary w-full">
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="text-sm text-[var(--muted-fg)] text-center">
          Already have an account? <Link href="/login" className="text-[var(--cb-blue)] font-semibold hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
