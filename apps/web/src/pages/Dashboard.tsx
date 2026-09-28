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
        {loading && <p className="text-vault-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
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
        <li key={c.id} className="flex justify-between text-sm">
          <Link to={`/cases/${c.id}`} className="text-vault-200 hover:text-white hover:underline">
            {c.caseNumber} &mdash; {c.title}
          </Link>
          <Badge text={c.status} />
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
            <li key={r.id} className="flex justify-between items-center text-sm">
              <Link to={`/documents/${r.document.id}`} className="text-vault-200 hover:text-white hover:underline">
                {r.document.name}
              </Link>
              <Badge text={r.status} tone={REQUEST_TONE[r.status] ?? "neutral"} />
            </li>
          ))}
        </ul>
      )}
      <Link to="/access-requests" className="text-xs text-vault-400 hover:text-white hover:underline mt-3 inline-block">
        View all
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
              <ul className="divide-y divide-vault-800">
                {data.recentAudit.map((a: any) => (
                  <li key={a.id} className="py-2 text-sm text-vault-200 flex justify-between">
                    <span>
                      {a.action.replace(/_/g, " ")}
                      {a.actor?.name && <span className="text-vault-500"> &middot; {a.actor.name}</span>}
                    </span>
                    <span className="text-vault-500 text-xs">{new Date(a.createdAt).toLocaleString()}</span>
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
                  <li key={d.id} className="flex justify-between text-sm">
                    <Link to={`/documents/${d.id}`} className="text-vault-200 hover:text-white hover:underline">
                      {d.name}
                    </Link>
                    <Badge text={d.classification} />
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
                  <li key={r.id} className="text-sm text-vault-200">
                    {r.requestedBy?.name} requested <span className="text-white">{r.document?.name}</span>
                    {r.reason && <span className="text-vault-500"> &mdash; &ldquo;{r.reason}&rdquo;</span>}
                  </li>
                ))}
              </ul>
            )}
            <Link to="/access-requests" className="text-xs text-vault-400 hover:text-white hover:underline mt-3 inline-block">
              Review requests
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
                <li key={e.id} className="flex justify-between text-sm">
                  <Link to={`/evidence/${e.id}`} className="text-vault-200 hover:text-white hover:underline">
                    {e.name} <span className="text-vault-500">({e.case.caseNumber})</span>
                  </Link>
                  <Badge text={e.status.replace(/_/g, " ")} />
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
