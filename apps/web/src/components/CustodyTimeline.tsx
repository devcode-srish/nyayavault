import { EmptyState } from "./ui";

export interface TimelineEvent {
  id: string;
  title: string;
  actor?: string;
  detail?: string;
  notes?: string | null;
  at: string;
  tone?: "neutral" | "good" | "danger" | "warn";
}

const AUDIT_LABELS: Record<string, string> = {
  DOCUMENT_UPLOADED: "Uploaded",
  VERSION_CREATED: "New version created",
  DOCUMENT_VIEWED: "Accessed",
  DOCUMENT_DOWNLOADED: "Downloaded",
  ACCESS_REQUESTED: "Access requested",
  ACCESS_APPROVED: "Access approved",
  ACCESS_REJECTED: "Access rejected",
  DOCUMENT_SHARED: "Shared via secure link",
  DOCUMENT_SIGNED: "Signed",
  SIGNATURE_VERIFIED: "Signature verified",
  INTEGRITY_CHECK: "Integrity verified",
  INTEGRITY_MISMATCH: "INTEGRITY MISMATCH",
  TAMPER_SIMULATED: "Tampering simulated (DEMO)",
};

export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action.replace(/_/g, " ").toLowerCase();
}

export function auditTone(action: string): TimelineEvent["tone"] {
  if (action === "INTEGRITY_MISMATCH" || action === "TAMPER_SIMULATED") return "danger";
  if (action === "INTEGRITY_CHECK" || action === "ACCESS_APPROVED" || action === "DOCUMENT_SIGNED") return "good";
  if (action === "ACCESS_REJECTED" || action === "ACCESS_REQUESTED") return "warn";
  return "neutral";
}

const DOT: Record<string, string> = {
  neutral: "bg-vault-500 border-vault-400",
  good: "bg-emerald-500 border-emerald-300",
  danger: "bg-red-500 border-red-300",
  warn: "bg-amber-500 border-amber-300",
};

export default function CustodyTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <EmptyState text="No custody events recorded." />;

  return (
    <ol className="relative border-l border-vault-700 ml-2 space-y-5">
      {events.map((e) => (
        <li key={e.id} className="ml-5 relative">
          <span
            className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border ${DOT[e.tone ?? "neutral"]}`}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-white">
              {e.title}
              {e.detail && <span className="text-vault-300"> {e.detail}</span>}
            </p>
            <span className="text-xs text-vault-500">{new Date(e.at).toLocaleString()}</span>
          </div>
          {e.actor && <p className="text-xs text-vault-400">by {e.actor}</p>}
          {e.notes && <p className="text-xs text-vault-500 mt-0.5">{e.notes}</p>}
        </li>
      ))}
    </ol>
  );
}
