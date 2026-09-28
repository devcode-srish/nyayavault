import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, EmptyState } from "../components/ui";

export default function Signatures() {
  const [signatures, setSignatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCert, setSelectedCert] = useState<any>(null);
  const [certLoading, setCertLoading] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{ [id: string]: any }>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/signatures");
      setSignatures(data.signatures || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load signatures");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleVerify(sigId: string) {
    setVerifyingId(sigId);
    try {
      const { data } = await api.get(`/signatures/verify/${sigId}`);
      setVerifyStatus((prev) => ({ ...prev, [sigId]: data.report }));
    } catch (err: any) {
      setVerifyStatus((prev) => ({
        ...prev,
        [sigId]: { isCryptographicallyValid: false, error: err?.response?.data?.error || "Verification failed" },
      }));
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleViewCertificate(documentVersionId: string) {
    setCertLoading(true);
    setSelectedCert(null);
    try {
      const { data } = await api.get(`/signatures/certificate/${documentVersionId}`);
      setSelectedCert(data.certificate);
    } catch (err: any) {
      alert(err?.response?.data?.error || "Failed to generate certificate draft");
    } finally {
      setCertLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Signatures & Legal Certificates"
        subtitle="Asymmetric digital signatures & Section 65B Electronic Evidence Certificate Drafts"
      />

      <div className="p-8 max-w-7xl mx-auto space-y-6">
        {/* Top Info Banner */}
        <div className="bg-vault-900/60 border border-vault-800 rounded-xl p-5 flex items-start gap-4">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400 font-mono text-xl">
            ✍️
          </div>
          <div>
            <h3 className="text-white font-semibold text-base">Cryptographic Non-Repudiation & Section 65B Drafts</h3>
            <p className="text-vault-400 text-sm mt-1 leading-relaxed">
              Signatures are bound to the immutable <code className="text-vault-200">DocumentVersion.sha256</code> using asymmetric ECDSA/RSA cryptography and server-issued challenge nonces. Certificates generated here serve as official technical drafts for Section 65B compliance under the Indian Evidence Act / BSA 2023.
            </p>
          </div>
        </div>

        {/* Signatures List Table */}
        <Card title={`Digital Signatures Ledger (${signatures.length})`}>
          {loading && <p className="text-vault-400 text-sm p-4">Loading cryptographic signatures...</p>}
          {error && <p className="text-red-400 text-sm p-4">{error}</p>}

          {!loading && signatures.length === 0 && (
            <EmptyState text="No digital signatures recorded yet. Sign document versions from the Document Detail page." />
          )}

          {!loading && signatures.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-vault-800/40 text-vault-400 text-xs uppercase border-b border-vault-800">
                  <tr>
                    <th className="text-left px-4 py-3">Certificate / Ref</th>
                    <th className="text-left px-4 py-3">Document</th>
                    <th className="text-left px-4 py-3">Case</th>
                    <th className="text-left px-4 py-3">Signer</th>
                    <th className="text-left px-4 py-3">Algorithm</th>
                    <th className="text-left px-4 py-3">Signed At</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vault-800/60">
                  {signatures.map((sig) => {
                    const verification = verifyStatus[sig.id];
                    return (
                      <tr key={sig.id} className="hover:bg-vault-800/20 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-indigo-400">
                          {sig.certificateNumber || `SIG-${sig.id.slice(-8)}`}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/documents/${sig.documentId}`}
                            className="text-white hover:text-indigo-400 font-medium transition-colors"
                          >
                            {sig.document?.name || "Document"}
                          </Link>
                          <span className="text-vault-500 text-xs ml-2">v{sig.documentVersion?.versionNo}</span>
                        </td>
                        <td className="px-4 py-3 text-vault-400 text-xs">
                          {sig.document?.case?.caseNumber || "—"}
                        </td>
                        <td className="px-4 py-3 text-vault-300">
                          <div>{sig.signer?.name || "Signer"}</div>
                          <div className="text-vault-500 text-xs">{sig.signer?.role}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-vault-400">
                          {sig.algorithm}
                        </td>
                        <td className="px-4 py-3 text-vault-400 text-xs">
                          {new Date(sig.signedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {verification ? (
                            verification.isCryptographicallyValid ? (
                              <Badge text="VERIFIED VALID" tone="good" />
                            ) : (
                              <Badge text="VERIFICATION FAILED" tone="danger" />
                            )
                          ) : (
                            <Badge text={sig.status} tone="good" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <button
                            onClick={() => handleVerify(sig.id)}
                            disabled={verifyingId === sig.id}
                            className="px-2.5 py-1 text-xs rounded bg-vault-800 hover:bg-vault-700 text-vault-200 transition-colors"
                          >
                            {verifyingId === sig.id ? "Verifying..." : "Verify"}
                          </button>
                          <button
                            onClick={() => handleViewCertificate(sig.documentVersionId)}
                            className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                          >
                            Certificate Draft
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Section 65B Certificate Modal */}
        {selectedCert && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-vault-900 border border-vault-700 rounded-2xl max-w-3xl w-full p-8 shadow-2xl space-y-6 my-8">
              {/* Certificate Header */}
              <div className="text-center border-b border-vault-800 pb-6">
                <div className="inline-block px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase rounded-full mb-3">
                  {selectedCert.certificateHeader.disclaimer}
                </div>
                <h2 className="text-2xl font-bold text-white tracking-wide uppercase">
                  {selectedCert.certificateHeader.title}
                </h2>
                <p className="text-vault-400 text-xs mt-1 italic">
                  {selectedCert.certificateHeader.statutoryReference}
                </p>
                <div className="mt-3 font-mono text-sm text-indigo-400 font-semibold">
                  Certificate Ref: {selectedCert.certificateHeader.certificateNumber}
                </div>
              </div>

              {/* Case & Electronic Record Details */}
              <div className="grid grid-cols-2 gap-4 text-sm bg-vault-950/60 p-4 rounded-xl border border-vault-800">
                <div>
                  <div className="text-vault-500 text-xs">Case Reference</div>
                  <div className="text-white font-medium">{selectedCert.caseDetails.caseNumber} - {selectedCert.caseDetails.caseTitle}</div>
                </div>
                <div>
                  <div className="text-vault-500 text-xs">Document Name & Version</div>
                  <div className="text-white font-medium">{selectedCert.electronicRecord.documentName} (v{selectedCert.electronicRecord.versionNo})</div>
                </div>
                <div>
                  <div className="text-vault-500 text-xs">Original Filename & Size</div>
                  <div className="text-vault-300">{selectedCert.electronicRecord.originalFilename} ({selectedCert.electronicRecord.sizeBytes} bytes)</div>
                </div>
                <div>
                  <div className="text-vault-500 text-xs">Generated At</div>
                  <div className="text-vault-300">{new Date(selectedCert.certificateHeader.generatedAt).toLocaleString()}</div>
                </div>
              </div>

              {/* Cryptographic Proof Section */}
              <div className="bg-vault-950/80 p-4 rounded-xl border border-vault-800 space-y-3 font-mono text-xs">
                <div>
                  <div className="text-vault-500 text-[11px] uppercase font-sans">Authoritative SHA-256 Checksum</div>
                  <div className="text-emerald-400 break-all select-all font-bold">
                    {selectedCert.electronicRecord.sha256Checksum}
                  </div>
                </div>

                {selectedCert.cryptographicSignature ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-vault-800/80">
                      <div>
                        <div className="text-vault-500 text-[11px] uppercase font-sans">Digital Signer</div>
                        <div className="text-white">{selectedCert.cryptographicSignature.signerName} ({selectedCert.cryptographicSignature.signerRole})</div>
                      </div>
                      <div>
                        <div className="text-vault-500 text-[11px] uppercase font-sans">Algorithm</div>
                        <div className="text-indigo-400">{selectedCert.cryptographicSignature.algorithm}</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-vault-500 text-[11px] uppercase font-sans">Public Key Fingerprint (SHA-256)</div>
                      <div className="text-vault-300 break-all">{selectedCert.cryptographicSignature.keyFingerprint || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-vault-500 text-[11px] uppercase font-sans">Cryptographic Signature Value</div>
                      <div className="text-vault-400 break-all max-h-16 overflow-y-auto bg-vault-900 p-2 rounded border border-vault-800 select-all">
                        {selectedCert.cryptographicSignature.signatureValue}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-amber-400 font-sans text-sm">
                    ⚠️ No formal digital signature recorded for this version. Certificate reflects repository integrity checksum only.
                  </div>
                )}
              </div>

              {/* Legal Notice */}
              <p className="text-vault-500 text-[11px] leading-relaxed text-center">
                This document is generated by the NyayaVault Digital Evidence System for verification purposes. For production court submissions, this certificate must be signed by the competent officer in charge of the computer system pursuant to Section 65B(4) of the Indian Evidence Act / Section 63 of the BSA.
              </p>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-lg bg-vault-800 hover:bg-vault-700 text-white text-sm font-medium transition-colors"
                >
                  Print Certificate Draft
                </button>
                <button
                  onClick={() => setSelectedCert(null)}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
