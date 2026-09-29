import React, { useState, useEffect } from "react";
import { api } from "../lib/api";
import {
  FileCheck2,
  Printer,
  X,
  Shield,
  Clock,
  User,
  Package,
  FileText,
  AlertTriangle,
  Lock,
  Hash,
} from "lucide-react";

interface CustodyReceiptModalProps {
  transferId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function CustodyReceiptModal({
  transferId,
  isOpen,
  onClose,
}: CustodyReceiptModalProps) {
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (isOpen && transferId) {
      loadReceipt();
    }
  }, [isOpen, transferId]);

  async function loadReceipt() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/evidence/transfers/${transferId}/receipt`);
      setReceipt(data.receipt);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load custody receipt");
    } finally {
      setLoading(false);
    }
  }

  async function handlePrintOfficial() {
    setExporting(true);
    try {
      // Send explicit POST request for official export to record CUSTODY_RECEIPT_GENERATED audit log
      await api.post(`/evidence/transfers/${transferId}/receipt/export`);
      window.print();
    } catch (err) {
      console.error("Failed to record export audit log:", err);
      window.print();
    } finally {
      setExporting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm print:p-0 print:bg-white">
      <div className="bg-vault-900 border border-vault-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-6 text-white max-h-[90vh] overflow-y-auto print:border-none print:shadow-none print:p-0 print:text-black">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-vault-800 pb-4 print:hidden">
          <div className="flex items-center gap-2">
            <FileCheck2 className="text-emerald-400" size={20} />
            <h3 className="font-semibold text-lg">Evidence Custody Handover Receipt</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-vault-400 hover:text-white hover:bg-vault-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-vault-400 text-sm">Loading receipt details...</div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-sm">
            {error}
          </div>
        ) : receipt ? (
          <div className="space-y-6">
            {/* Formal Printable Document Layout */}
            <div
              id="printable-custody-receipt"
              className="relative bg-white text-black p-8 rounded-xl border-2 border-black shadow-lg space-y-6 print:m-0 print:border-2 print:border-black print:shadow-none"
            >
              {/* Watermark for Pending Transfers */}
              {receipt.isPending && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-15 overflow-hidden">
                  <span className="text-red-700 font-black text-4xl transform -rotate-45 uppercase border-8 border-red-700 p-6 text-center leading-tight">
                    {receipt.watermarkText}
                  </span>
                </div>
              )}

              {/* Document Header */}
              <div className="border-b-2 border-black pb-4 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <Shield size={24} className="text-black fill-black" />
                    <h2 className="font-black text-xl tracking-tight uppercase">
                      NyayaVault Evidence Repository
                    </h2>
                  </div>
                  <p className="text-xs text-neutral-600 font-serif uppercase tracking-widest mt-0.5">
                    Official Chain-of-Custody Handover Receipt
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-sm bg-black text-white px-2 py-0.5 rounded inline-block">
                    {receipt.receiptNumber}
                  </div>
                  <p className="text-[10px] text-neutral-500 font-mono mt-1">
                    Generated: {new Date(receipt.generatedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Status Banner */}
              <div
                className={`p-3 rounded-lg border flex items-center justify-between text-xs font-semibold ${
                  receipt.isPending
                    ? "bg-amber-50 border-amber-400 text-amber-900"
                    : receipt.status === "ACCEPTED"
                    ? "bg-emerald-50 border-emerald-400 text-emerald-900"
                    : "bg-red-50 border-red-400 text-red-900"
                }`}
              >
                <span>TRANSFER STATUS: {receipt.status}</span>
                {receipt.isPending && (
                  <span className="text-[11px] font-bold text-amber-800">
                    ⚠ Awaiting Recipient Handshake Acceptance
                  </span>
                )}
                {receipt.status === "ACCEPTED" && (
                  <span className="text-[11px] font-bold text-emerald-800">
                    ✓ Handover Confirmed & Accepted
                  </span>
                )}
              </div>

              {/* Case & Evidence Identification Grid */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-neutral-50 p-4 rounded-lg border border-neutral-200">
                <div className="space-y-1.5">
                  <div>
                    <span className="font-bold text-[10px] uppercase text-neutral-500 block">Case Number</span>
                    <span className="font-mono font-bold text-sm">{receipt.case.caseNumber}</span>
                  </div>
                  <div>
                    <span className="font-bold text-[10px] uppercase text-neutral-500 block">Case Title</span>
                    <span className="font-semibold">{receipt.case.title}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div>
                    <span className="font-bold text-[10px] uppercase text-neutral-500 block">Evidence Exhibit</span>
                    <span className="font-semibold text-sm">{receipt.evidence.name}</span>
                  </div>
                  <div>
                    <span className="font-bold text-[10px] uppercase text-neutral-500 block">Evidence ID</span>
                    <span className="font-mono text-neutral-600">{receipt.evidence.id}</span>
                  </div>
                </div>
              </div>

              {/* Transferring Parties Section */}
              <div className="border border-neutral-200 rounded-lg p-4 space-y-3 text-xs">
                <h4 className="font-bold text-[11px] uppercase tracking-wider text-neutral-700 border-b border-neutral-200 pb-1">
                  Custodial Handover Details
                </h4>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="font-bold text-[10px] uppercase text-neutral-500 block">Transferring Officer (Sender)</span>
                    <p className="font-semibold text-sm">{receipt.parties.sender.name}</p>
                    {receipt.parties.sender.role && (
                      <p className="text-neutral-500 font-mono text-[11px]">{receipt.parties.sender.role.replace(/_/g, " ")}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <span className="font-bold text-[10px] uppercase text-neutral-500 block">Receiving Officer (Recipient)</span>
                    <p className="font-semibold text-sm">{receipt.parties.recipient.name}</p>
                    <p className="text-neutral-500 font-mono text-[11px]">{receipt.parties.recipient.role.replace(/_/g, " ")}</p>
                  </div>
                </div>
              </div>

              {/* Physical Packaging & Seal Verification */}
              <div className="grid grid-cols-3 gap-3 text-xs bg-neutral-50 p-4 rounded-lg border border-neutral-200">
                <div>
                  <span className="font-bold text-[10px] uppercase text-neutral-500 block">Package Seal Status</span>
                  <span className="font-bold font-mono text-neutral-800">{receipt.handoverDetails.packageCondition}</span>
                </div>
                <div>
                  <span className="font-bold text-[10px] uppercase text-neutral-500 block">Seal Number</span>
                  <span className="font-mono font-semibold">{receipt.handoverDetails.sealNumber || "N/A"}</span>
                </div>
                <div>
                  <span className="font-bold text-[10px] uppercase text-neutral-500 block">Handover Location</span>
                  <span className="font-semibold">{receipt.handoverDetails.location || "Central Evidence Room"}</span>
                </div>
              </div>

              {/* Notes & Purpose */}
              {(receipt.handoverDetails.purpose || receipt.handoverDetails.notes) && (
                <div className="text-xs space-y-1 bg-white p-3 rounded border border-neutral-200">
                  {receipt.handoverDetails.purpose && (
                    <p><span className="font-bold text-neutral-600">Purpose:</span> {receipt.handoverDetails.purpose}</p>
                  )}
                  {receipt.handoverDetails.notes && (
                    <p><span className="font-bold text-neutral-600">Notes:</span> {receipt.handoverDetails.notes}</p>
                  )}
                </div>
              )}

              {/* Timestamps & Audit Hash Reference */}
              <div className="border-t-2 border-neutral-200 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10px] text-neutral-600 font-mono">
                <div>
                  <span>Dispatched: {new Date(receipt.handoverDetails.transferredAt).toLocaleString()}</span>
                  {receipt.handoverDetails.decidedAt && (
                    <span className="ml-3">Accepted: {new Date(receipt.handoverDetails.decidedAt).toLocaleString()}</span>
                  )}
                </div>
                {receipt.auditProof?.hash && (
                  <div className="flex items-center gap-1">
                    <span>Audit Hash:</span>
                    <span className="bg-neutral-100 px-1 py-0.5 rounded border border-neutral-300">
                      {receipt.auditProof.hash.slice(0, 16)}...
                    </span>
                  </div>
                )}
              </div>

              {/* Legal Framing Notice */}
              <div className="border-t border-neutral-200 pt-2 text-[9px] text-neutral-500 leading-tight">
                {receipt.legalNotice}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-vault-800 print:hidden">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-vault-800 hover:bg-vault-700 text-vault-200 text-sm transition"
              >
                Close
              </button>
              <button
                onClick={handlePrintOfficial}
                disabled={exporting}
                className="flex items-center gap-2 px-4 py-2 bg-vault-600 hover:bg-vault-500 text-white text-sm font-semibold rounded-lg shadow-lg shadow-vault-950/50 transition"
              >
                <Printer size={16} /> {exporting ? "Recording Export..." : "Print Official Receipt"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
