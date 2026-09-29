import React, { useState } from "react";
import { api } from "../lib/api";
import {
  Briefcase,
  Shield,
  FileCheck2,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
  Clock,
  HardDrive,
  Copy,
  Check,
  FileText,
  KeyRound,
  Terminal,
} from "lucide-react";

interface CourtBundleExportModalProps {
  caseId: string;
  caseNumber: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function CourtBundleExportModal({
  caseId,
  caseNumber,
  isOpen,
  onClose,
  onSuccess,
}: CourtBundleExportModalProps) {
  const [courtRefNumber, setCourtRefNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [copiedRoot, setCopiedRoot] = useState(false);
  const [copiedFp, setCopiedFp] = useState(false);

  if (!isOpen) return null;

  async function handleGenerateBundle(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data } = await api.post(`/cases/${caseId}/court-bundle`, {
        courtRefNumber: courtRefNumber.trim() || undefined,
      });

      setResult(data);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      if (status === 409) {
        setError(
          data?.error ||
            "A court evidence bundle is already being generated for this case. Please wait a few moments or refresh."
        );
      } else if (status === 403) {
        setError(
          data?.error ||
            "You do not have permission to generate court bundles for this case."
        );
      } else if (status === 404) {
        setError("Case record or associated exhibits could not be found.");
      } else {
        setError(data?.error || "Failed to generate courtroom evidence bundle.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadBundle(bundleId: string, bundleNumber: string) {
    try {
      const response = await api.get(`/cases/court-bundles/${bundleId}/download`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/zip" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bundleNumber}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to download court bundle archive.");
    }
  }

  function handleCopy(text: string, type: "root" | "fp") {
    navigator.clipboard.writeText(text);
    if (type === "root") {
      setCopiedRoot(true);
      setTimeout(() => setCopiedRoot(false), 2000);
    } else {
      setCopiedFp(true);
      setTimeout(() => setCopiedFp(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-6 text-slate-900 dark:text-white max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-vault-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-100 dark:bg-vault-800 rounded-xl text-slate-500 dark:text-vault-400 border border-slate-300 dark:border-vault-700">
              <Briefcase size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Export Courtroom Evidence Bundle
              </h2>
              <p className="text-xs text-slate-500 dark:text-vault-400">
                Case {caseNumber} — Forensic Archive & Offline Verifier
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 text-slate-500 dark:text-vault-400 hover:text-white rounded-lg hover:bg-slate-100 dark:bg-vault-800 transition disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-4 bg-red-950/50 border border-red-800/80 rounded-xl flex items-start gap-3 text-red-200 text-sm">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-red-300">Bundle Generation Notice</p>
              <p className="text-xs mt-0.5 opacity-90">{error}</p>
            </div>
          </div>
        )}

        {!result ? (
          /* Input Form & Pre-generation Info */
          <form onSubmit={handleGenerateBundle} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-vault-300 uppercase tracking-wider mb-2">
                  Court Docket / FIR Reference Number (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. FIR-442/2026 or DOCKET-CR-8891"
                  value={courtRefNumber}
                  onChange={(e) => setCourtRefNumber(e.target.value)}
                  disabled={loading}
                  className="w-full bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-vault-600 focus:outline-none focus:border-vault-500 transition"
                />
                <p className="text-[11px] text-slate-500 dark:text-vault-500 mt-1">
                  Reference recorded in the tamper-evident manifest and cryptographic checkpoint.
                </p>
              </div>

              {/* Package Content Breakdown */}
              <div className="bg-white dark:bg-vault-950/60 border border-slate-200 dark:border-vault-800/80 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-600 dark:text-vault-300 uppercase tracking-wider">
                  Included Archive Components
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-vault-300">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-slate-500 dark:text-vault-400" /> Multi-Version Exhibits
                  </div>
                  <div className="flex items-center gap-2">
                    <KeyRound size={14} className="text-slate-500 dark:text-vault-400" /> Section 65B/BSA Signatures
                  </div>
                  <div className="flex items-center gap-2">
                    <FileCheck2 size={14} className="text-slate-500 dark:text-vault-400" /> Custody Handover Receipts
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-slate-500 dark:text-vault-400" /> Investigation Timeline
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-slate-500 dark:text-vault-400" /> NYAYAVAULT-MERKLE-V1 Root
                  </div>
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-slate-500 dark:text-vault-400" /> Standalone verify.js
                  </div>
                </div>
              </div>

              {/* Security & Statutory Disclaimer */}
              <div className="p-3.5 bg-vault-800/30 border border-slate-200 dark:border-vault-800 rounded-xl text-[11px] text-slate-500 dark:text-vault-400 space-y-1">
                <p className="font-medium text-slate-600 dark:text-vault-300">Forensic Admissibility Notice</p>
                <p>
                  This self-contained archive is cryptographically sealed in accordance with Section 65B of the Indian Evidence Act / Section 63 of Bharatiya Sakshya Adhiniyam. Cryptographic validity establishes mathematical provenance and does not substitute for judicial appraisal.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-600 dark:text-vault-300 hover:text-white text-sm font-medium rounded-xl transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 bg-vault-600 hover:bg-blue-600 dark:bg-vault-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-vault-950/50 transition disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Computing Merkle Root & Sealing...
                  </>
                ) : (
                  <>
                    <Shield size={16} />
                    Generate & Seal Bundle
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* Success Result View */
          <div className="space-y-5">
            <div className="p-4 bg-emerald-950/40 border border-emerald-800/80 rounded-xl flex items-start gap-3 text-emerald-200">
              <CheckCircle2 size={20} className="text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-300">Courtroom Evidence Bundle Sealed</p>
                <p className="text-xs text-emerald-200/90 mt-0.5">
                  The evidence docket archive has been generated and anchored to the audit log.
                </p>
              </div>
            </div>

            {/* Bundle Metadata Card */}
            <div className="bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-xl p-4 space-y-3.5 text-xs">
              <div className="flex justify-between items-center border-b border-slate-200 dark:border-vault-800/80 pb-2.5">
                <span className="text-slate-500 dark:text-vault-400">Bundle Identifier:</span>
                <span className="font-mono font-bold text-white text-sm">
                  {result.bundle?.bundleNumber}
                </span>
              </div>

              {result.bundle?.courtRefNumber && (
                <div className="flex justify-between items-center border-b border-slate-200 dark:border-vault-800/80 pb-2.5">
                  <span className="text-slate-500 dark:text-vault-400">Court Docket Ref:</span>
                  <span className="text-slate-700 dark:text-vault-200">{result.bundle.courtRefNumber}</span>
                </div>
              )}

              <div className="flex justify-between items-center border-b border-slate-200 dark:border-vault-800/80 pb-2.5">
                <span className="text-slate-500 dark:text-vault-400">Total Artifacts:</span>
                <span className="text-slate-700 dark:text-vault-200 font-medium">
                  {result.artifactCount} exhibits / metadata files
                </span>
              </div>

              <div className="flex justify-between items-center border-b border-slate-200 dark:border-vault-800/80 pb-2.5">
                <span className="text-slate-500 dark:text-vault-400">Archive Size:</span>
                <span className="text-slate-700 dark:text-vault-200 font-medium">
                  {(result.zipSizeBytes / 1024).toFixed(1)} KB
                </span>
              </div>

              <div className="space-y-1.5 border-b border-slate-200 dark:border-vault-800/80 pb-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-vault-400">Canonical Merkle Root (V1):</span>
                  <button
                    onClick={() => handleCopy(result.merkleRoot, "root")}
                    className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-vault-400 hover:text-white transition"
                  >
                    {copiedRoot ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    {copiedRoot ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="font-mono text-[11px] text-slate-600 dark:text-vault-300 break-all bg-white dark:bg-vault-900/90 p-2 rounded-lg border border-slate-200 dark:border-vault-800">
                  {result.merkleRoot}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-vault-400">Authority Key Fingerprint:</span>
                  <button
                    onClick={() => handleCopy(result.bundle?.authorityKeyFp, "fp")}
                    className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-vault-400 hover:text-white transition"
                  >
                    {copiedFp ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    {copiedFp ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="font-mono text-[11px] text-slate-500 dark:text-vault-400 break-all bg-white dark:bg-vault-900/90 p-2 rounded-lg border border-slate-200 dark:border-vault-800">
                  {result.bundle?.authorityKeyFp}
                </p>
              </div>
            </div>

            {/* Offline Verification Instructions */}
            <div className="p-3.5 bg-white dark:bg-vault-950/80 border border-slate-200 dark:border-vault-800 rounded-xl space-y-1.5">
              <p className="text-xs font-semibold text-slate-600 dark:text-vault-300 flex items-center gap-1.5">
                <Terminal size={14} className="text-slate-500 dark:text-vault-400" /> Air-Gapped Offline Verification
              </p>
              <p className="text-[11px] text-slate-500 dark:text-vault-400">
                To verify independently on an air-gapped machine without internet access:
              </p>
              <div className="bg-white dark:bg-vault-900 px-3 py-2 rounded-lg font-mono text-[11px] text-slate-700 dark:text-vault-200 border border-slate-200 dark:border-vault-800 select-all">
                node verify.js --trusted-authority-fp {result.bundle?.authorityKeyFp?.slice(0, 16)}...
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-600 dark:text-vault-300 hover:text-white text-sm font-medium rounded-xl transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() =>
                  handleDownloadBundle(result.bundle.id, result.bundle.bundleNumber)
                }
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-emerald-950/50 transition"
              >
                <Download size={16} />
                Download Sealed ZIP Archive
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
