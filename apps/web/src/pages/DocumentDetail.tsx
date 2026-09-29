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

  // Digital Signature & Certificate States
  const [signModalVersion, setSignModalVersion] = useState<any>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signSuccess, setSignSuccess] = useState<string | null>(null);
  const [certModalData, setCertModalData] = useState<any>(null);

  function handleOpenSignModal(v: any) {
    setSignModalVersion(v);
    setSignError(null);
    setSignSuccess(null);
  }

  async function handleViewCertificate(versionId: string) {
    try {
      const { data } = await api.get(`/signatures/certificate/${versionId}`);
      setCertModalData(data.certificate);
    } catch (err: any) {
      alert(err?.response?.data?.error || "Failed to generate certificate draft");
    }
  }

  async function executeSigning() {
    if (!signModalVersion) return;
    setSigning(true);
    setSignError(null);
    setSignSuccess(null);

    try {
      // 1. Request authoritative challenge from server
      const challengeRes = await api.post("/signatures/challenge", {
        documentVersionId: signModalVersion.id,
      });
      const { challengeNonce, canonicalPayload } = challengeRes.data.challenge;

      // 2. Generate client-side ECDSA key pair in memory
      const keyPair = await window.crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );

      // 3. Sign canonical payload using Web Crypto API
      const encoder = new TextEncoder();
      const payloadBytes = encoder.encode(canonicalPayload);
      const signatureBuffer = await window.crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        keyPair.privateKey,
        payloadBytes
      );

      // Convert signature to base64
      const signatureBase64 = btoa(
        String.fromCharCode(...new Uint8Array(signatureBuffer))
      );

      // Export public key to SPKI PEM format
      const spkiBuffer = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
      const spkiBase64 = btoa(
        String.fromCharCode(...new Uint8Array(spkiBuffer))
      );
      const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${spkiBase64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;

      // 4. Submit verified signature to server
      const submitRes = await api.post("/signatures/sign", {
        documentVersionId: signModalVersion.id,
        signatureValue: signatureBase64,
        challengeNonce,
        publicKeyPem,
        algorithm: "ECDSA-P256-SHA256",
      });

      setSignSuccess(`Successfully signed! Certificate Ref: ${submitRes.data.certificateNumber}`);
      setTimeout(() => {
        setSignModalVersion(null);
        load(false);
      }, 1200);
    } catch (err: any) {
      setSignError(err?.response?.data?.error || "Signing operation failed");
    } finally {
      setSigning(false);
    }
  }

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

        <Card title="Version History & Digital Signatures">
          {downloadError && <p className="text-red-400 text-sm mb-2">{downloadError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 dark:text-vault-400 text-xs uppercase border-b border-slate-200 dark:border-vault-800">
                <tr>
                  <th className="text-left py-2">Version</th>
                  <th className="text-left py-2">File</th>
                  <th className="text-left py-2">Uploaded by</th>
                  <th className="text-left py-2">Signatures</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-right py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-vault-800">
                {doc.versions.map((v: any) => {
                  const sigs = v.signatures || [];
                  const isSigned = sigs.length > 0;
                  return (
                    <tr key={v.id} className="hover:bg-vault-850/30">
                      <td className="py-2.5 text-slate-700 dark:text-vault-200 font-mono">v{v.versionNo}</td>
                      <td className="py-2.5 text-slate-600 dark:text-vault-300">{v.originalName}</td>
                      <td className="py-2.5 text-slate-500 dark:text-vault-400">{v.createdBy?.name || "—"}</td>
                      <td className="py-2.5">
                        {isSigned ? (
                          <div className="space-y-1">
                            {sigs.map((s: any) => (
                              <div key={s.id} className="flex items-center gap-1.5">
                                <Badge text="SIGNED" tone="good" />
                                <span className="text-xs text-slate-500 dark:text-vault-400">{s.signer?.name}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Badge text="UNSIGNED" tone="neutral" />
                        )}
                      </td>
                      <td className="py-2.5 text-slate-500 dark:text-vault-500 text-xs">{new Date(v.createdAt).toLocaleString()}</td>
                      <td className="py-2.5 text-right space-x-2">
                        <button
                          onClick={() => handleDownload(v.versionNo)}
                          className="text-xs text-slate-600 dark:text-vault-300 hover:text-white px-2 py-1 rounded bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 transition"
                        >
                          Download
                        </button>
                        <button
                          onClick={() => handleOpenSignModal(v)}
                          className="text-xs text-indigo-300 hover:text-white px-2.5 py-1 rounded bg-indigo-950/80 border border-indigo-700/50 hover:bg-indigo-900 transition"
                        >
                          Sign
                        </button>
                        <button
                          onClick={() => handleViewCertificate(v.id)}
                          className="text-xs text-emerald-300 hover:text-white px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-700/50 hover:bg-emerald-900 transition"
                        >
                          65B Draft
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Sign Version Modal */}
        {signModalVersion && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-vault-900 border border-slate-300 dark:border-vault-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
              <h3 className="text-lg font-bold text-white">
                Cryptographically Sign Document (v{signModalVersion.versionNo})
              </h3>
              <p className="text-xs text-slate-500 dark:text-vault-400 leading-relaxed">
                This operation requests an authoritative, server-issued challenge nonce and signs the exact immutable SHA-256 checksum (<code className="text-slate-700 dark:text-vault-200">{signModalVersion.sha256.slice(0, 16)}...</code>) using client-side ECDSA-P256 cryptography.
              </p>

              {signError && <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 text-xs rounded-lg">{signError}</div>}
              {signSuccess && <div className="p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs rounded-lg">{signSuccess}</div>}

              <div className="space-y-3 text-xs bg-white dark:bg-vault-950 p-4 rounded-xl border border-slate-200 dark:border-vault-800 font-mono">
                <div>
                  <span className="text-slate-500 dark:text-vault-500 font-sans">Document:</span> <span className="text-white">{doc.name}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-vault-500 font-sans">Signer:</span> <span className="text-indigo-400">{user?.name} ({user?.role})</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-vault-500 font-sans">Algorithm:</span> <span className="text-emerald-400">ECDSA-P256-SHA256</span>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setSignModalVersion(null)}
                  disabled={signing}
                  className="px-4 py-2 text-xs rounded-lg bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-600 dark:text-vault-300 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={executeSigning}
                  disabled={signing}
                  className="px-5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
                >
                  {signing ? "Signing & Verifying..." : "Confirm & Sign"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Section 65B Certificate Modal */}
        {certModalData && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white dark:bg-vault-900 border border-slate-300 dark:border-vault-700 rounded-2xl max-w-3xl w-full p-8 shadow-2xl space-y-6 my-8">
              <div className="text-center border-b border-slate-200 dark:border-vault-800 pb-6">
                <div className="inline-block px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase rounded-full mb-3">
                  {certModalData.certificateHeader.disclaimer}
                </div>
                <h2 className="text-2xl font-bold text-white tracking-wide uppercase">
                  {certModalData.certificateHeader.title}
                </h2>
                <p className="text-slate-500 dark:text-vault-400 text-xs mt-1 italic">
                  {certModalData.certificateHeader.statutoryReference}
                </p>
                <div className="mt-3 font-mono text-sm text-indigo-400 font-semibold">
                  Certificate Ref: {certModalData.certificateHeader.certificateNumber}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm bg-white dark:bg-vault-950/60 p-4 rounded-xl border border-slate-200 dark:border-vault-800">
                <div>
                  <div className="text-slate-500 dark:text-vault-500 text-xs">Case Reference</div>
                  <div className="text-white font-medium">{certModalData.caseDetails.caseNumber} - {certModalData.caseDetails.caseTitle}</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-vault-500 text-xs">Document Name & Version</div>
                  <div className="text-white font-medium">{certModalData.electronicRecord.documentName} (v{certModalData.electronicRecord.versionNo})</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-vault-500 text-xs">Original Filename & Size</div>
                  <div className="text-slate-600 dark:text-vault-300">{certModalData.electronicRecord.originalFilename} ({certModalData.electronicRecord.sizeBytes} bytes)</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-vault-500 text-xs">Generated At</div>
                  <div className="text-slate-600 dark:text-vault-300">{new Date(certModalData.certificateHeader.generatedAt).toLocaleString()}</div>
                </div>
              </div>

              <div className="bg-white dark:bg-vault-950/80 p-4 rounded-xl border border-slate-200 dark:border-vault-800 space-y-3 font-mono text-xs">
                <div>
                  <div className="text-slate-500 dark:text-vault-500 text-[11px] uppercase font-sans">Authoritative SHA-256 Checksum</div>
                  <div className="text-emerald-400 break-all select-all font-bold">
                    {certModalData.electronicRecord.sha256Checksum}
                  </div>
                </div>

                {certModalData.cryptographicSignature ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-vault-800/80">
                      <div>
                        <div className="text-slate-500 dark:text-vault-500 text-[11px] uppercase font-sans">Digital Signer</div>
                        <div className="text-white">{certModalData.cryptographicSignature.signerName} ({certModalData.cryptographicSignature.signerRole})</div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-vault-500 text-[11px] uppercase font-sans">Algorithm</div>
                        <div className="text-indigo-400">{certModalData.cryptographicSignature.algorithm}</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-vault-500 text-[11px] uppercase font-sans">Public Key Fingerprint</div>
                      <div className="text-slate-600 dark:text-vault-300 break-all">{certModalData.cryptographicSignature.keyFingerprint || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-vault-500 text-[11px] uppercase font-sans">Cryptographic Signature Value</div>
                      <div className="text-slate-500 dark:text-vault-400 break-all max-h-16 overflow-y-auto bg-white dark:bg-vault-900 p-2 rounded border border-slate-200 dark:border-vault-800 select-all">
                        {certModalData.cryptographicSignature.signatureValue}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-amber-400 font-sans text-sm">
                    ⚠️ No formal digital signature recorded for this version. Certificate reflects repository integrity checksum only.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-white text-sm font-medium transition-colors"
                >
                  Print Certificate Draft
                </button>
                <button
                  onClick={() => setCertModalData(null)}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

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
