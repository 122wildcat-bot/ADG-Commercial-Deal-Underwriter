import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { shortDate } from "@/lib/format";

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin";
  status: "pending" | "active" | "blocked";
  createdAt: string;
}

export function AdminPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<{ users: AdminUser[] }>("/api/admin/users"),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      action === "delete"
        ? api.del(`/api/admin/users/${id}`)
        : api.post(`/api/admin/users/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="font-display text-2xl font-semibold mb-1">Admin</h1>
      <p className="text-sm text-[var(--muted-fg)] mb-5">Approve new signups, promote, block, or delete accounts.</p>

      {isLoading && <p className="text-sm text-[var(--muted-fg)]">Loading…</p>}
      {act.error && <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{(act.error as Error).message}</p>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="kicker text-left p-3">User</th>
              <th className="kicker text-left p-3">Role</th>
              <th className="kicker text-left p-3">Status</th>
              <th className="kicker text-left p-3">Joined</th>
              <th className="kicker text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="p-3">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-[var(--muted-fg)]">{u.email}</div>
                </td>
                <td className="p-3"><RoleBadge role={u.role} /></td>
                <td className="p-3"><StatusBadge status={u.status} /></td>
                <td className="p-3 text-[var(--muted-fg)] text-xs">{shortDate(u.createdAt)}</td>
                <td className="p-3 text-right space-x-1">
                  {u.status === "pending" && <button className="btn btn-secondary text-xs" onClick={() => act.mutate({ id: u.id, action: "approve" })}>Approve</button>}
                  {u.status === "active" && <button className="btn btn-ghost text-xs" onClick={() => act.mutate({ id: u.id, action: "block" })}>Block</button>}
                  {u.status === "blocked" && <button className="btn btn-secondary text-xs" onClick={() => act.mutate({ id: u.id, action: "approve" })}>Unblock</button>}
                  {u.role === "user"  && <button className="btn btn-ghost text-xs" onClick={() => act.mutate({ id: u.id, action: "promote" })}>Promote</button>}
                  {u.role === "admin" && <button className="btn btn-ghost text-xs" onClick={() => act.mutate({ id: u.id, action: "demote" })}>Demote</button>}
                  <button className="btn btn-ghost text-xs text-red-600"
                    onClick={() => {
                      if (confirm(`Delete ${u.email}? This cannot be undone.`)) act.mutate({ id: u.id, action: "delete" });
                    }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: AdminUser["role"] }) {
  const color = role === "admin" ? "bg-[var(--cb-blue)] text-white" : "bg-slate-100 text-slate-700";
  return <span className={`text-xs font-semibold rounded px-2 py-0.5 ${color}`}>{role}</span>;
}
function StatusBadge({ status }: { status: AdminUser["status"] }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    active: "bg-green-100 text-green-800",
    blocked: "bg-red-100 text-red-800",
  };
  return <span className={`text-xs font-semibold rounded px-2 py-0.5 ${map[status]}`}>{status}</span>;
}
