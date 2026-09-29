import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader, Card, Badge } from "../components/ui";
import CustodyTimeline, { TimelineEvent } from "../components/CustodyTimeline";
import EvidenceQRLabelModal from "../components/EvidenceQRLabelModal";
import CustodyReceiptModal from "../components/CustodyReceiptModal";
import { QrCode, FileCheck2, Printer } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function EvidenceDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [ev, setEv] = useState<any>(null);
  const [canTransfer, setCanTransfer] = useState(false);
  const [people, setPeople] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showQRModal, setShowQRModal] = useState(false);
  const [selectedReceiptTransferId, setSelectedReceiptTransferId] = useState<string | null>(null);

  const [toUserId, setToUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    try {
      const { data } = await api.get(`/evidence/${id}`);
      setEv(data.evidence);
      setCanTransfer(data.canTransfer);
      if (data.canTransfer) {
        const dir = await api.get("/users/directory");
        setPeople(dir.data.users.filter((u: any) => u.id !== data.evidence.currentCustodianId));
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load evidence");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function transfer(e: React.FormEvent) {
    e.preventDefault();
    if (!toUserId) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.post(`/evidence/${id}/transfer`, { toUserId, notes: notes || undefined });
      setToUserId("");
      setNotes("");
      await load();
    } catch (err: any) {
      setFormError(err?.response?.data?.error || "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-8 text-slate-500 dark:text-vault-400 text-sm">Loading...</div>;
  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>;
  if (!ev) return null;

  const events: TimelineEvent[] = ev.transfers.map((t: any) => ({
    id: t.id,
    transferId: t.id,
    title: t.fromUser ? "Transferred" : "Logged — initial custody",
    detail: t.fromUser ? `${t.fromUser.name} → ${t.toUser.name}` : `to ${t.toUser.name}`,
    actor: t.fromUser ? t.fromUser.name : t.toUser.name,
    notes: t.notes,
    at: t.transferredAt,
    status: t.status,
    tone: t.status === "REJECTED" || t.status === "CANCELLED" ? "danger" : t.status === "PENDING" ? "warn" : "neutral",
  }));

  const canRotateQR = user?.role === "ADMIN" || ev.currentCustodianId === user?.id;

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-vault-800 bg-white dark:bg-vault-950/50 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{ev.name}</h1>
          <p className="text-sm text-slate-500 dark:text-vault-400 mt-1">
            Case:{" "}
            <Link to={`/cases/${ev.case.id}`} className="text-slate-700 dark:text-vault-200 hover:text-white hover:underline font-mono">
              {ev.case.caseNumber}
            </Link>{" "}
            — {ev.case.title}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowQRModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-800 dark:text-vault-100 text-sm font-semibold rounded-lg border border-slate-300 dark:border-vault-700 shadow-sm transition"
          >
            <QrCode size={16} /> Physical QR Label
          </button>
        </div>
      </div>
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <Card title="Status"><Badge text={ev.status.replace(/_/g, " ")} /></Card>
          <Card title="Current custodian">
            <span className="text-sm text-slate-700 dark:text-vault-200">{ev.currentCustodian?.name ?? "\u2014"}</span>
          </Card>
          <Card title="Custody events">
            <span className="text-sm text-slate-700 dark:text-vault-200">{ev.transfers.length}</span>
          </Card>
        </div>

        {ev.description && (
          <Card title="Description">
            <p className="text-sm text-slate-600 dark:text-vault-300">{ev.description}</p>
          </Card>
        )}

        <Card title="Chain of Custody">
          <CustodyTimeline
            events={events}
            onViewReceipt={(transferId) => setSelectedReceiptTransferId(transferId)}
          />
        </Card>

        {canTransfer && (
          <Card title="Transfer Custody">
            <form onSubmit={transfer} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Transfer to</label>
                <select
                  value={toUserId}
                  onChange={(e) => setToUserId(e.target.value)}
                  className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="">Select a person...</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.role.replace(/_/g, " ")})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Notes (optional)</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={300}
                  className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white"
                  placeholder="e.g. Handed over for forensic imaging"
                />
              </div>
              {formError && <p className="text-red-400 text-sm">{formError}</p>}
              <button
                type="submit"
                disabled={!toUserId || busy}
                className="rounded-lg bg-blue-600 dark:bg-vault-500 hover:bg-blue-700 dark:hover:bg-vault-400 transition text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
              >
                {busy ? "Transferring..." : "Transfer custody"}
              </button>
            </form>
          </Card>
        )}
      </div>

      {/* QR Label Modal */}
      <EvidenceQRLabelModal
        evidenceId={id!}
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        canRotate={canRotateQR}
      />

      {/* Custody Receipt Modal */}
      {selectedReceiptTransferId && (
        <CustodyReceiptModal
          transferId={selectedReceiptTransferId}
          isOpen={!!selectedReceiptTransferId}
          onClose={() => setSelectedReceiptTransferId(null)}
        />
      )}
    </div>
  );
}
