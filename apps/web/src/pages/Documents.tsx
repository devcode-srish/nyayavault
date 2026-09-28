import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Lock } from "lucide-react";
import { PageHeader, Badge, EmptyState } from "../components/ui";

export default function Documents() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/documents")
      .then(({ data }) => setDocuments(data.documents))
      .catch((e) => setError(e?.response?.data?.error || "Failed to load documents"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Documents" subtitle="Across all cases you have access to" />
      <div className="p-8">
        {loading && (
          <div className="space-y-4 animate-pulse">
            <div className="h-10 w-full bg-slate-200 dark:bg-vault-800 rounded-t-xl"></div>
            <div className="h-64 w-full bg-slate-100 dark:bg-vault-800/50 rounded-b-xl"></div>
          </div>
        )}
        {error && <p className="text-red-600 dark:text-red-400 text-sm font-medium p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">{error}</p>}
        {!loading && documents.length === 0 && <EmptyState text="No documents yet." />}
        {documents.length > 0 && (
          <div className="bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-vault-800/50 text-slate-500 dark:text-vault-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-6 py-4 font-semibold">Name</th>
                  <th className="text-left px-6 py-4 font-semibold">Case</th>
                  <th className="text-left px-6 py-4 font-semibold">Type</th>
                  <th className="text-left px-6 py-4 font-semibold">Version</th>
                  <th className="text-left px-6 py-4 font-semibold">Integrity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-vault-800">
                {documents.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-vault-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <Link to={`/documents/${d.id}`} className="text-slate-800 font-medium hover:text-blue-600 dark:text-vault-200 dark:hover:text-white dark:font-normal hover:underline">
                        {d.name}
                      </Link>
                      {!d.canAccess && (
                        <span className="inline-flex items-center gap-1 ml-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <Lock size={12} /> Restricted
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-vault-400">{d.case.caseNumber}</td>
                    <td className="px-6 py-4 text-slate-600 dark:text-vault-400">{d.type}</td>
                    <td className="px-6 py-4 text-slate-600 dark:text-vault-400 font-mono">v{d.latestVersionNo}</td>
                    <td className="px-6 py-4">
                      <Badge
                        text={d.integrityStatus}
                        tone={d.integrityStatus === "VERIFIED" ? "good" : d.integrityStatus === "MISMATCH" ? "danger" : "neutral"}
                      />
                    </td>
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
