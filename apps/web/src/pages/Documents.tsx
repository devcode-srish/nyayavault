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
        {loading && <p className="text-vault-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!loading && documents.length === 0 && <EmptyState text="No documents yet." />}
        {documents.length > 0 && (
          <div className="bg-vault-900 border border-vault-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-vault-800/50 text-vault-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Case</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Version</th>
                  <th className="text-left px-4 py-2">Integrity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vault-800">
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2">
                      <Link to={`/documents/${d.id}`} className="text-vault-200 hover:text-white hover:underline">
                        {d.name}
                      </Link>
                      {!d.canAccess && (
                        <span className="inline-flex items-center gap-1 ml-2 text-xs text-amber-400">
                          <Lock size={12} /> Restricted
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-vault-400">{d.case.caseNumber}</td>
                    <td className="px-4 py-2 text-vault-400">{d.type}</td>
                    <td className="px-4 py-2 text-vault-400">v{d.latestVersionNo}</td>
                    <td className="px-4 py-2">
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
