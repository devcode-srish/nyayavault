import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, Badge, EmptyState } from "./ui";

const EXPIRY = [
  { label: "1 hour", value: 1 },
  { label: "24 hours", value: 24 },
  { label: "3 days", value: 72 },
  { label: "7 days", value: 168 },
];
const USES = [1, 3, 5, 10];

export default function SharePanel({ documentId }: { documentId: string }) {
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [maxUses, setMaxUses] = useState(1);
  const [shares, setShares] = useState<any[]>([]);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadShares() {
    api
      .get(`/documents/${documentId}/shares`)
      .then(({ data }) => setShares(data.shares))
      .catch(() => setShares([]));
  }

  useEffect(() => {
    loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { data } = await api.post(`/documents/${documentId}/share`, { expiresInHours, maxUses });
      setNewUrl(`${window.location.origin}${data.share.path}`);
      loadShares();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not create link");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string, done: () => void) {
    try {
      await navigator.clipboard.writeText(text);
      done();
    } catch {
      // clipboard can be blocked; the link is still visible on screen
    }
  }

  const [copiedId, setCopiedId] = useState<string | null>(null);

  return (
    <Card title="Secure Share Link">
      <p className="text-xs text-vault-500 mb-3">
        Creates a link that expires and has a download limit. It contains only a random token &mdash; no
        file path or document ID. The file is re-hashed before every download and blocked if it no longer
        matches.
      </p>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-vault-400 mb-1">Expires after</label>
          <select
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
            className="rounded-lg bg-vault-950 border border-vault-700 px-3 py-2 text-sm text-white"
          >
            {EXPIRY.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-vault-400 mb-1">Max downloads</label>
          <select
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
            className="rounded-lg bg-vault-950 border border-vault-700 px-3 py-2 text-sm text-white"
          >
            {USES.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-vault-700 hover:bg-vault-600 transition text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create link"}
        </button>
      </form>
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

      {newUrl && (
        <div className="mt-3 rounded-lg bg-vault-950 border border-vault-800 p-3">
          <p className="text-xs text-vault-400 mb-1">New link (you can copy it again from the list below)</p>
          <code className="text-xs text-vault-200 break-all">{newUrl}</code>
          <div className="mt-2">
            <button onClick={() => newUrl && copyText(newUrl, () => setCopied(true))} className="text-xs text-vault-300 hover:text-white hover:underline">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="text-xs text-vault-400 mb-2">Existing links</p>
        {shares.length === 0 ? (
          <EmptyState text="No share links yet." />
        ) : (
          <ul className="divide-y divide-vault-800">
            {shares.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between text-xs gap-3">
                <button
                  onClick={() => copyText(`${window.location.origin}${s.path}`, () => setCopiedId(s.id))}
                  className="text-vault-300 hover:text-white hover:underline whitespace-nowrap"
                >
                  {copiedId === s.id ? "Copied" : "Copy link"}
                </button>
                <span className="text-vault-500 whitespace-nowrap">
                  {s.useCount}/{s.maxUses} used &middot; expires {new Date(s.expiresAt).toLocaleString()}
                </span>
                <Badge text={s.status} tone={s.status === "ACTIVE" ? "good" : "neutral"} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
