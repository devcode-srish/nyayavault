import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, StatCard, Card, EmptyState, Badge } from "../components/ui";

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

function renderByRole(data: any) {
  switch (data.role) {
    case "ADMIN":
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total Users" value={data.widgets.userCount} />
            <StatCard label="Active Cases" value={data.widgets.activeCases} />
            <StatCard label="Pending Approvals" value={data.widgets.pendingApprovals} />
          </div>
          <Card title="Recent Audit Activity">
            {data.recentAudit.length === 0 ? (
              <EmptyState text="No audit events yet." />
            ) : (
              <ul className="divide-y divide-vault-800">
                {data.recentAudit.map((a: any) => (
                  <li key={a.id} className="py-2 text-sm text-vault-200 flex justify-between">
                    <span>{a.action.replace(/_/g, " ")}</span>
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
            {data.widgets.assignedCases.length === 0 ? (
              <EmptyState text="No cases assigned yet." />
            ) : (
              <ul className="space-y-2">
                {data.widgets.assignedCases.map((c: any) => (
                  <li key={c.id} className="flex justify-between text-sm">
                    <span className="text-vault-200">{c.caseNumber} &mdash; {c.title}</span>
                    <Badge text={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent Documents">
            {data.widgets.recentDocuments.length === 0 ? (
              <EmptyState text="No documents yet. (Coming in Phase 2: uploads + hashing.)" />
            ) : (
              <ul className="space-y-2">
                {data.widgets.recentDocuments.map((d: any) => (
                  <li key={d.id} className="text-sm text-vault-200">{d.name}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      );

    case "SENIOR_OFFICER":
      return (
        <div className="space-y-6">
          <Card title="Supervised Cases">
            {data.widgets.supervisedCases.length === 0 ? (
              <EmptyState text="No supervised cases yet." />
            ) : (
              <ul className="space-y-2">
                {data.widgets.supervisedCases.map((c: any) => (
                  <li key={c.id} className="flex justify-between text-sm">
                    <span className="text-vault-200">{c.caseNumber} &mdash; {c.title}</span>
                    <Badge text={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Pending Approvals">
            {data.widgets.pendingApprovals.length === 0 ? (
              <EmptyState text="No pending access requests. (Full flow arrives in Phase 3.)" />
            ) : (
              <ul className="space-y-2">
                {data.widgets.pendingApprovals.map((r: any) => (
                  <li key={r.id} className="text-sm text-vault-200">
                    {r.requestedBy?.name} requested {r.document?.name}
                  </li>
                ))}
              </ul>
            )}
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
                  <span className="text-vault-200">{e.name}</span>
                  <Badge text={e.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      );

    case "LEGAL_OFFICER":
      return (
        <Card title="Assigned Cases">
          {data.widgets.assignedCases.length === 0 ? (
            <EmptyState text="No cases assigned yet." />
          ) : (
            <ul className="space-y-2">
              {data.widgets.assignedCases.map((c: any) => (
                <li key={c.id} className="flex justify-between text-sm">
                  <span className="text-vault-200">{c.caseNumber} &mdash; {c.title}</span>
                  <Badge text={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      );

    default:
      return <EmptyState text="Unknown role." />;
  }
}
