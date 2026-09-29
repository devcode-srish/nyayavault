import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader, Badge, EmptyState } from "../components/ui";

export default function Cases() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/cases")
      .then(({ data }) => setCases(data.cases))
      .catch((e) => setError(e?.response?.data?.error || "Failed to load cases"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Cases" subtitle="DEMO / SYNTHETIC DATA" />
      <div className="p-8">
        {loading && <p className="text-slate-500 dark:text-vault-400 text-sm">Loading...</p>}
        {error && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}
        {!loading && cases.length === 0 && <EmptyState text="No cases assigned to you yet." />}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cases.map((c) => (
            <Link
              key={c.id}
              to={`/cases/${c.id}`}
              className="block bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-xl p-4 hover:border-blue-500 dark:hover:border-slate-400 dark:border-vault-600 transition shadow-sm dark:shadow-none"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-slate-500 dark:text-vault-400">{c.caseNumber}</p>
                  <p className="text-slate-900 dark:text-white font-medium mt-0.5">{c.title}</p>
                </div>
                <Badge text={c.status} />
              </div>
              {c.description && (
                <p className="text-sm text-slate-600 dark:text-vault-400 mt-2 line-clamp-2">{c.description}</p>
              )}
              <div className="flex gap-4 mt-3 text-xs text-slate-500 dark:text-vault-500">
                <span>{c._count.documents} documents</span>
                <span>{c._count.members} members</span>
                <span>{c._count.evidenceItems} evidence items</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
