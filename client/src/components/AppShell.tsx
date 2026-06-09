import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "./Logo";
import { clearAuth, getStoredUser } from "@/lib/auth";

export function AppShell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const user = getStoredUser();

  function signOut() {
    clearAuth();
    navigate("/login");
  }

  return (
    <div className="min-h-full flex flex-col bg-[var(--paper)]">
      <header className="brand-stripe sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} />
            <div className="hidden sm:block">
              <div className="font-display text-lg leading-tight">Commercial Deal Underwriter</div>
              <div className="text-xs text-white/70 -mt-0.5">Adam Druck Group</div>
            </div>
          </Link>
          {user && (
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className={`px-3 py-1.5 rounded-md ${location === "/" ? "bg-white/10" : "hover:bg-white/10"}`}
              >
                Deals
              </Link>
              {user.role === "admin" && (
                <Link
                  href="/admin"
                  className={`px-3 py-1.5 rounded-md ${location === "/admin" ? "bg-white/10" : "hover:bg-white/10"}`}
                >
                  Admin
                </Link>
              )}
              <button onClick={signOut} className="px-3 py-1.5 rounded-md hover:bg-white/10">
                Sign out
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="text-xs text-[var(--muted-fg)] text-center py-4">
        Adam Druck Group · Commercial Deal Underwriter
      </footer>
    </div>
  );
}
