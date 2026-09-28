import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Badge, EmptyState } from "../components/ui";

const ACTIONS = [
  "", "LOGIN", "LOGOUT", "DOCUMENT_UPLOADED", "DOCUMENT_VIEWED", "DOCUMENT_DOWNLOADED",
  "VERSION_CREATED", "ACCESS_REQUESTED", "ACCESS_APPROVED", "ACCESS_REJECTED",
  "DOCUMENT_SHARED", "DOCUMENT_SIGNED", "SIGNATURE_VERIFIED", "INTEGRITY_CHECK",
  "INTEGRITY_MISMATCH", "TAMPER_SIMULATED", "EVIDENCE_TRANSFERRED", "USER_CREATED",
  "ROLE_CHANGED", "CASE_CREATED", "AI_QUERY",
];

export default function Audit() {
  const [logs, setLogs] = useState<any[]>([]);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .get("/audit", { params: action ? { action } : {} })
      .then(({ data }) => setLogs(data.logs))
      .catch((e) => setError(e?.response?.data?.error || "Failed to load audit log"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="System-wide activity trail" />
      <div className="p-8">
        <div className="mb-4">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{a ? a.replace(/_/g, " ") : "All actions"}</option>
            ))}
          </select>
        </div>

        {loading && <p className="text-slate-500 dark:text-vault-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!loading && logs.length === 0 && <EmptyState text="No matching audit events." />}
        {logs.length > 0 && (
          <div className="bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-vault-800/50 text-slate-500 dark:text-vault-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Action</th>
                  <th className="text-left px-4 py-2">Actor</th>
                  <th className="text-left px-4 py-2">Document</th>
                  <th className="text-left px-4 py-2">Notes</th>
                  <th className="text-left px-4 py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-vault-800">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2">
                      <Badge
                        text={l.action.replace(/_/g, " ")}
                        tone={l.action === "INTEGRITY_MISMATCH" ? "danger" : "neutral"}
                      />
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-vault-300">{l.actor?.name || "—"}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-vault-400">{l.document?.name || "—"}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-vault-500 text-xs">{l.notes || "—"}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-vault-500 text-xs">{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
