import React, { useState, useEffect } from "react";
import { api } from "../lib/api";
import {
  QrCode,
  Printer,
  RotateCw,
  X,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Shield,
} from "lucide-react";

interface EvidenceQRLabelModalProps {
  evidenceId: string;
  isOpen: boolean;
  onClose: () => void;
  canRotate: boolean;
}

export default function EvidenceQRLabelModal({
  evidenceId,
  isOpen,
  onClose,
  canRotate,
}: EvidenceQRLabelModalProps) {
  const [labelData, setLabelData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    if (isOpen && evidenceId) {
      loadLabel();
    }
  }, [isOpen, evidenceId]);

  async function loadLabel() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/evidence/${evidenceId}/qr-label`);
      setLabelData(data.label);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load evidence QR label");
    } finally {
      setLoading(false);
    }
  }

  async function handleRotate() {
    setRotating(true);
    setError(null);
    try {
      const { data } = await api.post(`/evidence/${evidenceId}/rotate-qr`);
      setLabelData((prev: any) => ({
        ...prev,
        ...data.label,
      }));
      setConfirmRotate(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to rotate QR token");
    } finally {
      setRotating(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  function copyLink() {
    if (labelData?.verificationUrl) {
      navigator.clipboard.writeText(labelData.verificationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm print:p-0 print:bg-white">
      <div className="bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-6 text-slate-900 dark:text-white max-h-[90vh] overflow-y-auto print:border-none print:shadow-none print:p-0 print:text-black">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-vault-800 pb-4 print:hidden">
          <div className="flex items-center gap-2">
            <QrCode className="text-slate-500 dark:text-vault-400" size={20} />
            <h3 className="font-semibold text-lg">Physical Evidence QR Tag</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-500 dark:text-vault-400 hover:text-white hover:bg-slate-100 dark:bg-vault-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 dark:text-vault-400 text-sm">Loading label metadata...</div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-sm">
            {error}
          </div>
        ) : labelData ? (
          <div className="space-y-6">
            {/* Printable Evidence Tag Physical Layout */}
            <div
              id="printable-evidence-label"
              className="bg-white text-black p-5 rounded-xl border-2 border-black shadow-md space-y-3 print:m-0 print:border-2 print:border-black print:shadow-none"
            >
              <div className="flex items-center justify-between border-b-2 border-black pb-2">
                <div className="flex items-center gap-1.5">
                  <Shield size={18} className="text-black fill-black" />
                  <span className="font-black text-xs uppercase tracking-widest">
                    NYAYAVAULT PHYSICAL EXHIBIT
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold uppercase bg-black text-white px-1.5 py-0.5 rounded">
                  {labelData.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 items-center">
                <div className="col-span-2 space-y-1 text-xs">
                  <div>
                    <span className="font-bold text-[10px] uppercase text-neutral-600 block">Case Number:</span>
                    <span className="font-mono font-bold text-sm">{labelData.caseNumber}</span>
                  </div>
                  <div>
                    <span className="font-bold text-[10px] uppercase text-neutral-600 block">Item Description:</span>
                    <span className="font-semibold text-sm line-clamp-2">{labelData.name}</span>
                  </div>
                  <div>
                    <span className="font-bold text-[10px] uppercase text-neutral-600 block">Current Custodian:</span>
                    <span className="font-medium text-xs">
                      {labelData.currentCustodian?.name || "System Vault"}
                    </span>
                  </div>
                  <div className="pt-1 text-[9px] text-neutral-500 font-mono">
                    ID: {labelData.evidenceId}
                  </div>
                </div>

                {/* QR Code Graphic */}
                <div className="flex flex-col items-center justify-center p-1 bg-white border border-neutral-300 rounded">
                  <img
                    src={labelData.qrDataUri}
                    alt="Evidence Verification QR Code"
                    className="w-28 h-28 object-contain"
                  />
                  <span className="text-[8px] font-mono text-neutral-500 mt-0.5 text-center">
                    SCAN TO VERIFY
                  </span>
                </div>
              </div>

              <div className="border-t border-neutral-300 pt-1.5 flex justify-between items-center text-[9px] text-neutral-600 font-mono">
                <span>Tamper-evident verification reference</span>
                <span>{new Date().toLocaleDateString()}</span>
              </div>
            </div>

            {/* Rotation Alert Box */}
            {confirmRotate ? (
              <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-200 space-y-3 text-xs print:hidden">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Are you sure you want to rotate this QR code?</p>
                    <p className="text-amber-300/80 mt-1">
                      Rotating generates a brand new 256-bit cryptographic token and immediately invalidates
                      all existing physical tags printed for this item.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setConfirmRotate(false)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-700 dark:text-vault-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRotate}
                    disabled={rotating}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold transition"
                  >
                    {rotating ? "Rotating..." : "Confirm & Invalidate Old Tag"}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Modal Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-vault-800 print:hidden">
              <div className="flex items-center gap-2">
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 text-xs text-slate-600 dark:text-vault-300 hover:text-slate-900 dark:text-white transition"
                >
                  {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? "Link Copied" : "Copy Verification URL"}
                </button>

                {canRotate && !confirmRotate && (
                  <button
                    onClick={() => setConfirmRotate(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-vault-950 border border-amber-900/60 text-xs text-amber-300 hover:bg-amber-950/40 transition"
                    title="Invalidate old tag and issue new token"
                  >
                    <RotateCw size={13} /> Rotate QR Tag
                  </button>
                )}
              </div>

              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-vault-600 hover:bg-blue-600 dark:bg-vault-500 text-white text-sm font-semibold rounded-lg shadow-lg shadow-vault-950/50 transition"
              >
                <Printer size={16} /> Print Physical Label
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
