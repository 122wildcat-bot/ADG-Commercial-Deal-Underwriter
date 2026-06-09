import { useLocation } from "wouter";
import { AuthLayout } from "./LoginPage";
import { clearAuth } from "@/lib/auth";

export function PendingPage() {
  const [, navigate] = useLocation();
  function signOut() {
    clearAuth();
    navigate("/login");
  }
  return (
    <AuthLayout title="Pending approval" subtitle="Your account is waiting for an ADG admin to approve it.">
      <p className="text-sm text-[var(--muted-fg)] mb-5">
        Once an admin approves you, sign in again and you'll land on your deals dashboard.
      </p>
      <button onClick={signOut} className="btn btn-secondary w-full">Sign out</button>
    </AuthLayout>
  );
}
