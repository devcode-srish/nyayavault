import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Badge, EmptyState } from "../components/ui";

const DURATIONS = [
  { label: "1 hour", value: 1 },
  { label: "24 hours", value: 24 },
  { label: "3 days", value: 72 },
  { label: "7 days", value: 168 },
];

const TONE: Record<string, "neutral" | "warn" | "danger" | "good"> = {
  PENDING: "warn",
  APPROVED: "good",
  REJECTED: "danger",
  EXPIRED: "neutral",
};

export default function AccessRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [hours, setHours] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const { data } = await api.get("/access-requests");
      setRequests(data.requests);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load access requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, kind: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      await api.post(
        `/access-requests/${id}/${kind}`,
        kind === "approve" ? { expiresInHours: hours[id] ?? 24 } : {}
      );
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not save decision");
    } finally {
      setBusyId(null);
    }
  }

  const isApprover = user?.role === "SENIOR_OFFICER" || user?.role === "ADMIN";
  const sorted = [...requests].sort(
    (a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1)
  );

  return (
    <div>
      <PageHeader
        title="Access Requests"
        subtitle={
          isApprover
            ? "Requests for documents in cases you supervise, plus your own"
            : "Your requests for restricted documents"
        }
      />
      <div className="p-8">
        {loading && <p className="text-vault-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {!loading && requests.length === 0 && (
          <EmptyState text="No access requests yet. Open a locked document to request access." />
        )}
        {requests.length > 0 && (
          <div className="bg-vault-900 border border-vault-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-vault-800/50 text-vault-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Document</th>
                  <th className="text-left px-4 py-2">Requested by</th>
                  <th className="text-left px-4 py-2">Reason</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Decision</th>
                  <th className="text-left px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vault-800">
                {sorted.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3">
                      <Link to={`/documents/${r.document.id}`} className="text-vault-200 hover:text-white hover:underline">
                        {r.document.name}
                      </Link>
                      <p className="text-xs text-vault-500">
                        {r.document.case.caseNumber} &middot; {r.document.classification}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-vault-300">
                      {r.requestedBy.name}
                      <p className="text-xs text-vault-500">{new Date(r.createdAt).toLocaleString()}</p>
                    </td>
                    <td className="px-4 py-3 text-vault-400 max-w-xs">{r.reason || "\u2014"}</td>
                    <td className="px-4 py-3">
                      <Badge text={r.status} tone={TONE[r.status] ?? "neutral"} />
                    </td>
                    <td className="px-4 py-3 text-xs text-vault-500">
                      {r.decidedBy ? (
                        <>
                          {r.decidedBy.name}
                          {r.status !== "REJECTED" && r.expiresAt && (
                            <p>until {new Date(r.expiresAt).toLocaleString()}</p>
                          )}
                        </>
                      ) : (
                        "\u2014"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.canDecide && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={hours[r.id] ?? 24}
                            onChange={(e) => setHours({ ...hours, [r.id]: Number(e.target.value) })}
                            className="rounded-lg bg-vault-950 border border-vault-700 px-2 py-1 text-xs text-white"
                          >
                            {DURATIONS.map((d) => (
                              <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => decide(r.id, "approve")}
                            disabled={busyId === r.id}
                            className="rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-3 py-1 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => decide(r.id, "reject")}
                            disabled={busyId === r.id}
                            className="rounded-lg bg-vault-700 hover:bg-red-800 text-white text-xs px-3 py-1 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
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
