import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Card, Badge } from "../components/ui";
import CustodyTimeline, { auditLabel, auditTone, TimelineEvent } from "../components/CustodyTimeline";
import AccessDeniedPanel from "../components/AccessDeniedPanel";
import SharePanel from "../components/SharePanel";
import AIAnalysisPanel from "../components/AIAnalysisPanel";

const UPLOAD_ROLES = ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "LEGAL_OFFICER"];

async function blobErrorMessage(err: any, fallback: string): Promise<string> {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).error || fallback;
    } catch {
      return fallback;
    }
  }
  return data?.error || fallback;
}

export default function DocumentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [doc, setDoc] = useState<any>(null);
  const [custody, setCustody] = useState<TimelineEvent[]>([]);
  const [denied, setDenied] = useState<{ pendingRequest: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [newVersionFile, setNewVersionFile] = useState<File | null>(null);
  const [versionNotes, setVersionNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const canWrite = !!user && UPLOAD_ROLES.includes(user.role);

  async function load(initial: boolean) {
    if (initial) setLoading(true);
    setError(null);
    setDenied(null);
    try {
      const { data } = await api.get(`/documents/${id}`);
      setDoc(data.document);
      const c = await api.get(`/documents/${id}/custody`);
      setCustody(
        c.data.events.map((e: any) => ({
          id: e.id,
          title: auditLabel(e.action),
          actor: e.actor,
          detail: e.targetUser ? `\u2192 ${e.targetUser}` : undefined,
          notes: e.notes,
          at: e.at,
          tone: auditTone(e.action),
        }))
      );
    } catch (e: any) {
      if (e?.response?.status === 403 && e.response.data?.code === "DOCUMENT_ACCESS_DENIED") {
        setDoc(null);
        setDenied({ pendingRequest: !!e.response.data.pendingRequest });
      } else {
        setError(e?.response?.data?.error || "Failed to load document");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setVerifyResult(null);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data } = await api.post(`/documents/${id}/verify-integrity`);
      setVerifyResult(data);
      await load(false);
    } catch (err: any) {
      setVerifyResult({ error: err?.response?.data?.error || "Verification failed" });
    } finally {
      setVerifying(false);
    }
  }

  async function handleDownload(versionNo: number) {
    setDownloadError(null);
    try {
      const res = await api.get(`/documents/${id}/download`, {
        params: { versionNo },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      const version = doc.versions.find((v: any) => v.versionNo === versionNo);
      link.download = version?.originalName || `document-v${versionNo}`;
      link.click();
      window.URL.revokeObjectURL(url);
      load(false);
    } catch (err: any) {
      setDownloadError(await blobErrorMessage(err, "Download failed"));
    }
  }

  async function handleNewVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!newVersionFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", newVersionFile);
      if (versionNotes) form.append("notes", versionNotes);
      await api.post(`/documents/${id}/versions`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setNewVersionFile(null);
      setVersionNotes("");
      const input = document.getElementById("new-version-file") as HTMLInputElement | null;
      if (input) input.value = "";
      await load(false);
    } catch (err: any) {
      setUploadError(err?.response?.data?.error || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="p-8 text-slate-500 dark:text-vault-400 text-sm">Loading...</div>;

  if (denied) {
    return (
      <div>
        <PageHeader title="Restricted document" subtitle="You cannot open this document yet" />
        <div className="p-8">
          <AccessDeniedPanel documentId={id!} pendingRequest={denied.pendingRequest} />
        </div>
      </div>
    );
  }

  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>;
  if (!doc) return null;

  const latestVersion = doc.versions[0];
  const mismatch = doc.integrityStatus === "MISMATCH";

  return (
    <div>
      <PageHeader
        title={doc.name}
        subtitle={
          <>
            Case:{" "}
            <Link to={`/cases/${doc.case.id}`} className="hover:underline">
              {doc.case.caseNumber}
            </Link>
          </>
        }
      />
      <div className="p-8 space-y-6">
        {mismatch && (
          <div className="rounded-xl border border-red-900 bg-red-950/40 p-4">
            <p className="text-sm font-medium text-red-300">INTEGRITY MISMATCH</p>
            <p className="text-xs text-red-200/80 mt-1">
              The stored file no longer matches the SHA-256 recorded when it was uploaded. Treat this file
              as untrusted.
            </p>
          </div>
        )}

        <div className="grid grid-cols-4 gap-4">
          <Card title="Classification"><Badge text={doc.classification} /></Card>
          <Card title="Latest Version"><span className="text-sm text-slate-700 dark:text-vault-200">v{doc.latestVersionNo}</span></Card>
          <Card title="Integrity Status">
            <Badge
              text={doc.integrityStatus}
              tone={doc.integrityStatus === "VERIFIED" ? "good" : mismatch ? "danger" : "neutral"}
            />
          </Card>
          <Card title="Signature Status"><Badge text={doc.signatureStatus} /></Card>
        </div>

        <Card title="SHA-256 (latest version)">
          <code className="text-xs text-slate-600 dark:text-vault-300 break-all">{latestVersion?.sha256}</code>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={handleVerify}
              disabled={verifying}
              className="rounded-lg bg-slate-700 dark:bg-vault-700 hover:bg-vault-600 transition text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50"
            >
              {verifying ? "Verifying..." : "Verify Integrity"}
            </button>
            {verifyResult && !verifyResult.error && (
              <span className={`text-xs ${verifyResult.integrityStatus === "MISMATCH" ? "text-red-300" : "text-emerald-300"}`}>
                {verifyResult.integrityStatus === "MISMATCH" ? "Mismatch" : "Match"} &mdash; recalculated:{" "}
                <code className="break-all">{verifyResult.recalculatedHash}</code>
              </span>
            )}
            {verifyResult?.error && <span className="text-xs text-red-400">{verifyResult.error}</span>}
          </div>
        </Card>

        <AIAnalysisPanel documentId={doc.id} />

        <Card title="Version History">
          {downloadError && <p className="text-red-400 text-sm mb-2">{downloadError}</p>}
          <table className="w-full text-sm">
            <thead className="text-slate-500 dark:text-vault-400 text-xs uppercase">
              <tr>
                <th className="text-left py-1">Version</th>
                <th className="text-left py-1">File</th>
                <th className="text-left py-1">Uploaded by</th>
                <th className="text-left py-1">Date</th>
                <th className="text-left py-1"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-vault-800">
              {doc.versions.map((v: any) => (
                <tr key={v.id}>
                  <td className="py-2 text-slate-700 dark:text-vault-200">v{v.versionNo}</td>
                  <td className="py-2 text-slate-500 dark:text-vault-400">{v.originalName}</td>
                  <td className="py-2 text-slate-500 dark:text-vault-400">{v.createdBy?.name}</td>
                  <td className="py-2 text-slate-500 dark:text-vault-500 text-xs">{new Date(v.createdAt).toLocaleString()}</td>
                  <td className="py-2">
                    <button
                      onClick={() => handleDownload(v.versionNo)}
                      className="text-xs text-slate-600 dark:text-vault-300 hover:text-white hover:underline"
                    >
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Chain of Custody">
          <CustodyTimeline events={custody} />
        </Card>

        {canWrite && <SharePanel documentId={doc.id} />}

        {canWrite && (
          <Card title="Upload New Version">
            <form onSubmit={handleNewVersion} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">
                  File (PDF, JPG, PNG, DOC, DOCX &mdash; max 25MB)
                </label>
                <input
                  id="new-version-file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={(e) => setNewVersionFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-slate-600 dark:text-vault-300"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Notes (optional)</label>
                <input
                  value={versionNotes}
                  onChange={(e) => setVersionNotes(e.target.value)}
                  className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white"
                  placeholder="What changed in this version?"
                />
              </div>
              {uploadError && <p className="text-red-400 text-sm">{uploadError}</p>}
              <button
                type="submit"
                disabled={!newVersionFile || uploading}
                className="rounded-lg bg-blue-600 dark:bg-vault-500 hover:bg-blue-700 dark:hover:bg-vault-400 transition text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Upload New Version"}
              </button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
