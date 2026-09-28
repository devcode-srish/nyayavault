import React, { useState } from "react";
import { Lock } from "lucide-react";
import { api } from "../lib/api";

export default function AccessDeniedPanel({
  documentId,
  pendingRequest,
}: {
  documentId: string;
  pendingRequest: boolean;
}) {
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(pendingRequest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/access-requests", { documentId, reason });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not submit request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white dark:bg-vault-900 border border-amber-900/60 rounded-xl p-6 max-w-2xl">
      <div className="flex items-center gap-2 text-amber-300">
        <Lock size={18} />
        <p className="font-medium">403 &mdash; Access restricted</p>
      </div>
      <p className="text-sm text-slate-600 dark:text-vault-300 mt-3">
        The server refused to return this document because you have not been granted access to it.
        This check is enforced by the API itself, not just by this page.
      </p>

      {submitted ? (
        <div className="mt-4 rounded-lg bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 p-3">
          <p className="text-sm text-slate-700 dark:text-vault-200">Access request pending</p>
          <p className="text-xs text-slate-500 dark:text-vault-500 mt-1">
            A Senior Officer has been notified. You&apos;ll get a notification when it is decided. Track it
            under Access Requests.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Why do you need access?</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              minLength={5}
              maxLength={500}
              className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white"
              placeholder="e.g. Need the informant statement to prepare the case summary"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 dark:bg-vault-500 hover:bg-blue-700 dark:hover:bg-vault-400 transition text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
          >
            {busy ? "Submitting..." : "Request access"}
          </button>
        </form>
      )}
    </div>
  );
}
