import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, EmptyState } from "../components/ui";

export default function Evidence() {
  const [items, setItems] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [caseId, setCaseId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    try {
      const [ev, cs] = await Promise.all([api.get("/evidence"), api.get("/cases")]);
      setItems(ev.data.evidence);
      setCases(cs.data.cases);
      if (!caseId && cs.data.cases.length > 0) setCaseId(cs.data.cases[0].id);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load evidence");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post("/evidence", { caseId, name, description: description || undefined });
      setName("");
      setDescription("");
      await load();
    } catch (err: any) {
      setFormError(err?.response?.data?.error || "Could not log evidence");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Evidence" subtitle="Every item has a chain of custody. DEMO / SYNTHETIC DATA" />
      <div className="p-8 space-y-6">
        {loading && <p className="text-slate-500 dark:text-vault-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!loading && items.length === 0 && <EmptyState text="No evidence items visible to you." />}
        {items.length > 0 && (
          <div className="bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-vault-800/50 text-slate-500 dark:text-vault-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Item</th>
                  <th className="text-left px-4 py-2">Case</th>
                  <th className="text-left px-4 py-2">Current custodian</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Custody events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-vault-800">
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50/50 dark:hover:bg-vault-800/30 transition-colors">
                    <td className="px-4 py-2">
                      <Link to={`/evidence/${i.id}`} className="text-slate-800 font-medium hover:text-blue-600 dark:text-vault-200 dark:hover:text-white dark:font-normal hover:underline">
                        {i.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-vault-400">{i.case.caseNumber}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-vault-300">{i.currentCustodian?.name ?? "\u2014"}</td>
                    <td className="px-4 py-2"><Badge text={i.status.replace(/_/g, " ")} /></td>
                    <td className="px-4 py-2 text-slate-600 dark:text-vault-400">{i._count.transfers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cases.length > 0 && (
          <Card title="Log New Evidence">
            <form onSubmit={create} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 dark:text-vault-400 mb-1">Case</label>
                  <select
                    value={caseId}
                    onChange={(e) => setCaseId(e.target.value)}
                    className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {cases.map((c) => (
                      <option key={c.id} value={c.id}>{c.caseNumber} &mdash; {c.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-600 dark:text-vault-400 mb-1">Item name</label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-vault-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Mobile phone - Exhibit C"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-600 dark:text-vault-400 mb-1">Description (optional)</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {formError && <p className="text-red-400 text-sm">{formError}</p>}
              <button
                type="submit"
                disabled={busy || !name}
                className="rounded-lg bg-blue-600 dark:bg-vault-500 hover:bg-blue-700 dark:hover:bg-vault-400 transition text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
              >
                {busy ? "Saving..." : "Log evidence (starts chain of custody)"}
              </button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
