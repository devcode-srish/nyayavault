import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Badge } from "../components/ui";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/users")
      .then(({ data }) => setUsers(data.users))
      .catch((e) => setError(e?.response?.data?.error || "Failed to load users"));
  }, []);

  return (
    <div>
      <PageHeader title="Users" subtitle="Admin-only — enforced server-side, not just hidden in the sidebar" />
      <div className="p-8">
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <div className="bg-vault-900 border border-vault-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-vault-800/50 text-vault-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vault-800">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2 text-vault-200">{u.name}</td>
                  <td className="px-4 py-2 text-vault-400">{u.email}</td>
                  <td className="px-4 py-2 text-vault-300">{u.role.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2">
                    <Badge text={u.isActive ? "Active" : "Disabled"} tone={u.isActive ? "good" : "danger"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
