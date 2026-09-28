import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, StatCard, Card, EmptyState, Badge } from "../components/ui";

const REQUEST_TONE: Record<string, "neutral" | "warn" | "danger" | "good"> = {
  PENDING: "warn",
  APPROVED: "good",
  REJECTED: "danger",
  EXPIRED: "neutral",
};

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/dashboard")
      .then(({ data }) => setData(data))
      .catch((e) => setError(e?.response?.data?.error || "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name}`}
        subtitle={`${user?.role.replace(/_/g, " ")} dashboard \u2014 DEMO / SYNTHETIC DATA`}
      />
      <div className="p-8">
        {loading && (
          <div className="space-y-4 animate-pulse">
            <div className="h-4 w-48 bg-slate-200 dark:bg-vault-800 rounded"></div>
            <div className="h-32 w-full bg-slate-100 dark:bg-vault-800/50 rounded-xl"></div>
          </div>
        )}
        {error && <p className="text-red-600 dark:text-red-400 text-sm font-medium p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">{error}</p>}
        {data && renderByRole(data)}
      </div>
    </div>
  );
}

function CaseList({ cases }: { cases: any[] }) {
  if (cases.length === 0) return <EmptyState text="No cases assigned yet." />;
  return (
    <ul className="space-y-2">
      {cases.map((c) => (
        <li key={c.id}>
          <Link to={`/cases/${c.id}`} className="flex justify-between items-center text-sm p-3 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50 dark:border-vault-800/50 dark:hover:border-slate-300 dark:border-vault-700 dark:hover:bg-vault-800/30 transition-all shadow-sm">
            <span className="text-slate-800 font-medium dark:text-vault-200">{c.caseNumber} <span className="text-slate-400 dark:text-vault-500 font-normal">&mdash; {c.title}</span></span>
            <Badge text={c.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MyRequests({ requests }: { requests: any[] }) {
  return (
    <Card title="My Access Requests">
      {requests.length === 0 ? (
        <EmptyState text="No access requests. Open a locked document to request access." />
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => (
            <li key={r.id}>
              <Link to={`/documents/${r.document.id}`} className="flex justify-between items-center text-sm p-3 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50 dark:border-vault-800/50 dark:hover:border-slate-300 dark:border-vault-700 dark:hover:bg-vault-800/30 transition-all shadow-sm">
                <span className="text-slate-800 font-medium dark:text-vault-200">{r.document.name}</span>
                <Badge text={r.status} tone={REQUEST_TONE[r.status] ?? "neutral"} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/access-requests" className="text-xs text-blue-600 font-medium hover:text-blue-700 dark:text-vault-400 dark:hover:text-white hover:underline mt-4 inline-block">
        View all &rarr;
      </Link>
    </Card>
  );
}

function renderByRole(data: any) {
  switch (data.role) {
    case "ADMIN":
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Users" value={data.widgets.userCount} />
            <StatCard label="Active Cases" value={data.widgets.activeCases} />
            <StatCard label="Pending Approvals" value={data.widgets.pendingApprovals} />
            <StatCard label="Integrity Alerts" value={data.widgets.integrityAlerts} />
          </div>
          <Card title="Recent Audit Activity">
            {data.recentAudit.length === 0 ? (
              <EmptyState text="No audit events yet." />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-vault-800">
                {data.recentAudit.map((a: any) => (
                  <li key={a.id} className="py-3 text-sm text-slate-800 dark:text-vault-200 flex justify-between items-center">
                    <span>
                      {a.action.replace(/_/g, " ")}
                      {a.actor?.name && <span className="text-slate-500 dark:text-vault-500"> &middot; {a.actor.name}</span>}
                    </span>
                    <span className="text-slate-400 dark:text-vault-500 text-xs font-mono">{new Date(a.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      );

    case "INVESTIGATING_OFFICER":
      return (
        <div className="space-y-6">
          <Card title="Assigned Cases">
            <CaseList cases={data.widgets.assignedCases} />
          </Card>
          <Card title="Recent Documents">
            {data.widgets.recentDocuments.length === 0 ? (
              <EmptyState text="No documents yet." />
            ) : (
              <ul className="space-y-2">
                {data.widgets.recentDocuments.map((d: any) => (
                  <li key={d.id}>
                    <Link to={`/documents/${d.id}`} className="flex justify-between items-center text-sm p-3 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50 dark:border-vault-800/50 dark:hover:border-slate-300 dark:border-vault-700 dark:hover:bg-vault-800/30 transition-all shadow-sm">
                      <span className="text-slate-800 font-medium dark:text-vault-200">{d.name}</span>
                      <Badge text={d.classification} tone={d.classification === "RESTRICTED" ? "danger" : d.classification === "CONFIDENTIAL" ? "warn" : "neutral"} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <MyRequests requests={data.widgets.myAccessRequests} />
        </div>
      );

    case "SENIOR_OFFICER":
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Supervised Cases" value={data.widgets.supervisedCases.length} />
            <StatCard label="Pending Approvals" value={data.widgets.pendingApprovals.length} />
            <StatCard label="Integrity Alerts" value={data.widgets.integrityAlerts} />
          </div>
          <Card title="Pending Approvals">
            {data.widgets.pendingApprovals.length === 0 ? (
              <EmptyState text="No pending access requests." />
            ) : (
              <ul className="space-y-2">
                {data.widgets.pendingApprovals.map((r: any) => (
                  <li key={r.id} className="text-sm text-slate-800 dark:text-vault-200 p-3 rounded-lg border border-slate-100 dark:border-vault-800/50 shadow-sm bg-white dark:bg-transparent">
                    <span className="font-medium text-slate-900 dark:text-white">{r.requestedBy?.name}</span> requested <span className="font-medium text-slate-900 dark:text-white">{r.document?.name}</span>
                    {r.reason && <span className="text-slate-500 dark:text-vault-500"> &mdash; &ldquo;{r.reason}&rdquo;</span>}
                  </li>
                ))}
              </ul>
            )}
            <Link to="/access-requests" className="text-xs text-blue-600 font-medium hover:text-blue-700 dark:text-vault-400 dark:hover:text-white hover:underline mt-4 inline-block">
              Review requests &rarr;
            </Link>
          </Card>
          <Card title="Supervised Cases">
            <CaseList cases={data.widgets.supervisedCases} />
          </Card>
        </div>
      );

    case "FORENSIC_OFFICER":
      return (
        <Card title="Assigned Evidence">
          {data.widgets.assignedEvidence.length === 0 ? (
            <EmptyState text="No evidence assigned yet." />
          ) : (
            <ul className="space-y-2">
              {data.widgets.assignedEvidence.map((e: any) => (
                <li key={e.id}>
                  <Link to={`/evidence/${e.id}`} className="flex justify-between items-center text-sm p-3 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50 dark:border-vault-800/50 dark:hover:border-slate-300 dark:border-vault-700 dark:hover:bg-vault-800/30 transition-all shadow-sm">
                    <span className="text-slate-800 font-medium dark:text-vault-200">
                      {e.name} <span className="text-slate-400 dark:text-vault-500 font-normal">({e.case.caseNumber})</span>
                    </span>
                    <Badge text={e.status.replace(/_/g, " ")} tone={e.status === "COLLECTED" ? "good" : "neutral"} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );

    case "LEGAL_OFFICER":
      return (
        <div className="space-y-6">
          <Card title="Assigned Cases">
            <CaseList cases={data.widgets.assignedCases} />
          </Card>
          <MyRequests requests={data.widgets.myAccessRequests} />
        </div>
      );

    default:
      return <EmptyState text="Unknown role." />;
  }
}
