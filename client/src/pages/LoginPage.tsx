import { useState } from "react";
import { useLocation, Link } from "wouter";
import { api, ApiError } from "@/lib/api";
import { setStoredUser, setToken, type CurrentUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";

interface LoginResp { token: string; user: CurrentUser; pending?: boolean }

export function LoginPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<LoginResp>("/api/auth/login", { email, password });
      setToken(data.token);
      setStoredUser(data.user);
      navigate(data.pending ? "/pending" : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in" subtitle="Underwrite a commercial deal in seconds.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email">
          <input type="email" required className="field-input" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" required className="field-input" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary w-full">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-sm text-[var(--muted-fg)] text-center">
          No account yet? <Link href="/signup" className="text-[var(--cb-blue)] font-semibold hover:underline">Request access</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-6">
          <Logo size={56} />
          <div className="text-center">
            <h1 className="font-display text-2xl font-semibold text-[var(--cb-blue)]">Commercial Deal Underwriter</h1>
            <p className="text-xs uppercase tracking-wider text-[var(--muted-fg)] mt-1">Adam Druck Group</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold mb-1">{title}</h2>
          {subtitle && <p className="text-sm text-[var(--muted-fg)] mb-5">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
