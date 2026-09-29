import React, { useEffect, useState, useCallback } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  FileQuestion,
  RefreshCw,
  Play,
  XCircle,
  FileText,
  Search,
  Clock,
  HardDrive,
  Copy,
  ExternalLink,
  ChevronRight,
  Info,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";

interface IntegritySummary {
  totalDocuments: number;
  verifiedDocuments: number;
  mismatchDocuments: number;
  unverifiedDocuments: number;
  totalVersions: number;
  integrityScore: number;
  lastScan: {
    id: string;
    completedAt: string | null;
    verifiedCount: number;
    mismatchCount: number;
    missingCount: number;
    unreadableCount: number;
    errorCount: number;
    elapsedMs: number | null;
    initiatedBy: string;
  } | null;
}

interface ScanRun {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  caseId: string | null;
  caseName?: string | null;
  totalVersions: number;
  processedVersions: number;
  percentage: number;
  verifiedCount: number;
  mismatchCount: number;
  missingCount: number;
  unreadableCount: number;
  errorCount: number;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number | null;
  errorMessage: string | null;
  initiatedBy: {
    id: string;
    name: string;
    role: string;
  };
}

interface Finding {
  id: string;
  scanRunId: string;
  documentId: string | null;
  documentVersionId: string | null;
  caseId: string | null;
  documentName: string;
  versionNo: number;
  originalName: string;
  sizeBytes: number;
  status: "VERIFIED" | "MISMATCH" | "MISSING" | "UNREADABLE" | "ERROR";
  expectedSha256: string;
  actualSha256: string | null;
  reason: string | null;
  scannedAt: string;
}

interface CaseOption {
  id: string;
  caseNumber: string;
  title: string;
}

export default function Security() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<IntegritySummary | null>(null);
  const [activeScan, setActiveScan] = useState<ScanRun | null>(null);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingScan, setStartingScan] = useState(false);
  const [cancellingScan, setCancellingScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"findings" | "runs">("findings");

  // Detail Modal
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await api.get("/integrity/summary");
      setSummary(data);
    } catch (err: any) {
      console.error("Failed to fetch integrity summary:", err);
    }
  }, []);

  const fetchActiveScan = useCallback(async () => {
    try {
      const { data } = await api.get("/integrity/scans/active");
      setActiveScan(data.activeScan);
      return data.activeScan;
    } catch (err: any) {
      console.error("Failed to fetch active scan:", err);
      return null;
    }
  }, []);

  const fetchScans = useCallback(async () => {
    try {
      const { data } = await api.get("/integrity/scans");
      setScans(data.scans || []);
    } catch (err: any) {
      console.error("Failed to fetch scan runs:", err);
    }
  }, []);

  const fetchFindings = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: "100" };
      if (statusFilter !== "ALL") params.status = statusFilter;
      if (selectedCaseId) params.caseId = selectedCaseId;
      const { data } = await api.get("/integrity/findings", { params });
      setFindings(data.findings || []);
    } catch (err: any) {
      console.error("Failed to fetch findings:", err);
    }
  }, [statusFilter, selectedCaseId]);

  const fetchCases = useCallback(async () => {
    try {
      const { data } = await api.get("/cases");
      setCases(data.cases || []);
    } catch (err) {
      console.error("Failed to fetch cases:", err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchSummary(), fetchActiveScan(), fetchScans(), fetchFindings(), fetchCases()]);
    setLoading(false);
  }, [fetchSummary, fetchActiveScan, fetchScans, fetchFindings, fetchCases]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Polling loop when scan is active
  useEffect(() => {
    let timer: any = null;
    if (activeScan) {
      timer = setInterval(async () => {
        const current = await fetchActiveScan();
        if (!current) {
          fetchSummary();
          fetchScans();
          fetchFindings();
        }
      }, 1500);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [activeScan, fetchActiveScan, fetchSummary, fetchScans, fetchFindings]);

  const handleStartScan = async () => {
    setError(null);
    setSuccessMsg(null);
    setStartingScan(true);
    try {
      const payload: { caseId?: string } = {};
      if (selectedCaseId) payload.caseId = selectedCaseId;
      const { data } = await api.post("/integrity/scan", payload);
      setActiveScan(data.scanRun);
      setSuccessMsg("Storage integrity scan initiated successfully.");
      setTimeout(() => setSuccessMsg(null), 5000);
      fetchScans();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to initiate storage scan");
    } finally {
      setStartingScan(false);
    }
  };

  const handleCancelScan = async (scanId: string) => {
    setError(null);
    setCancellingScan(true);
    try {
      await api.post(`/integrity/scans/${scanId}/cancel`);
      setActiveScan(null);
      setSuccessMsg("Storage scan cancelled.");
      setTimeout(() => setSuccessMsg(null), 4000);
      fetchSummary();
      fetchScans();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to cancel scan");
    } finally {
      setCancellingScan(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(label);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const filteredFindings = findings.filter((f) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      f.documentName.toLowerCase().includes(q) ||
      f.originalName.toLowerCase().includes(q) ||
      f.expectedSha256.toLowerCase().includes(q) ||
      (f.actualSha256 && f.actualSha256.toLowerCase().includes(q)) ||
      (f.reason && f.reason.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-vault-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <ShieldAlert className="text-vault-400" size={32} />
            <h1 className="text-2xl font-bold text-white tracking-tight">Security & Storage Integrity Center</h1>
          </div>
          <p className="text-vault-400 text-sm mt-1">
            Automated streaming verification of evidence file digests against authoritative cryptographic records.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refreshAll}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-vault-800 hover:bg-vault-700 text-vault-200 text-sm font-medium rounded-lg border border-vault-700 transition"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={handleStartScan}
            disabled={startingScan || !!activeScan}
            className="flex items-center gap-2 px-4 py-2 bg-vault-600 hover:bg-vault-500 text-white text-sm font-medium rounded-lg shadow-lg shadow-vault-950/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {startingScan ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
            {activeScan ? "Scan In Progress..." : "Run Storage Scan"}
          </button>
        </div>
      </div>

      {/* Alert Messages */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
            <XCircle size={18} />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-800 text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Active Scan Progress Banner */}
      {activeScan && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-vault-900 to-vault-850 border border-vault-700 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-vault-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-vault-500"></span>
              </span>
              <div>
                <h3 className="font-semibold text-white">
                  Storage Integrity Scan Running — {activeScan.caseName || "System-wide"}
                </h3>
                <p className="text-xs text-vault-400">
                  Initiated by {activeScan.initiatedBy.name} • {activeScan.processedVersions} of {activeScan.totalVersions} document versions processed
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-lg font-bold text-vault-300 font-mono">{activeScan.percentage}%</span>
              <button
                onClick={() => handleCancelScan(activeScan.id)}
                disabled={cancellingScan}
                className="px-3 py-1.5 bg-red-900/40 hover:bg-red-900/80 border border-red-700 text-red-200 text-xs font-medium rounded-lg transition"
              >
                {cancellingScan ? "Aborting..." : "Cancel Scan"}
              </button>
            </div>
          </div>

          <div className="w-full bg-vault-950 rounded-full h-3 overflow-hidden border border-vault-800">
            <div
              className="bg-gradient-to-r from-vault-500 to-emerald-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.max(5, activeScan.percentage)}%` }}
            ></div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
            <div className="bg-vault-950/60 p-2.5 rounded-lg border border-vault-800">
              <span className="text-vault-400">Verified Match:</span>
              <span className="ml-2 font-semibold text-emerald-400">{activeScan.verifiedCount}</span>
            </div>
            <div className="bg-vault-950/60 p-2.5 rounded-lg border border-vault-800">
              <span className="text-vault-400">Mismatches:</span>
              <span className="ml-2 font-semibold text-red-400">{activeScan.mismatchCount}</span>
            </div>
            <div className="bg-vault-950/60 p-2.5 rounded-lg border border-vault-800">
              <span className="text-vault-400">Missing Files:</span>
              <span className="ml-2 font-semibold text-amber-400">{activeScan.missingCount}</span>
            </div>
            <div className="bg-vault-950/60 p-2.5 rounded-lg border border-vault-800">
              <span className="text-vault-400">Unreadable/Errors:</span>
              <span className="ml-2 font-semibold text-yellow-400">{activeScan.unreadableCount + activeScan.errorCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="p-5 rounded-2xl bg-vault-900/70 border border-vault-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-vault-400 text-sm">
            <span>Integrity Health Score</span>
            <ShieldCheck size={18} className="text-vault-400" />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white font-mono">
              {summary ? `${summary.integrityScore}%` : "—"}
            </span>
            <span className="text-xs text-vault-400">
              ({summary ? summary.verifiedDocuments : 0}/{summary ? summary.totalDocuments : 0} documents)
            </span>
          </div>
          <div className="mt-3 text-xs text-vault-400">
            Total Versions: <span className="text-vault-200 font-semibold">{summary?.totalVersions ?? 0}</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-vault-900/70 border border-vault-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-vault-400 text-sm">
            <span>Verified Evidence</span>
            <CheckCircle2 size={18} className="text-emerald-400" />
          </div>
          <div className="mt-4">
            <span className="text-3xl font-bold text-emerald-400 font-mono">
              {summary ? summary.verifiedDocuments : "—"}
            </span>
          </div>
          <div className="mt-3 text-xs text-vault-400">
            Cryptographically intact on storage
          </div>
        </div>

        <div className={`p-5 rounded-2xl border flex flex-col justify-between ${
          (summary?.mismatchDocuments ?? 0) > 0
            ? "bg-red-950/30 border-red-800 text-red-300"
            : "bg-vault-900/70 border-vault-800 text-vault-400"
        }`}>
          <div className="flex items-center justify-between text-sm">
            <span>Tamper & Mismatches</span>
            <AlertTriangle size={18} className={(summary?.mismatchDocuments ?? 0) > 0 ? "text-red-400" : "text-vault-500"} />
          </div>
          <div className="mt-4">
            <span className={`text-3xl font-bold font-mono ${(summary?.mismatchDocuments ?? 0) > 0 ? "text-red-400" : "text-white"}`}>
              {summary ? summary.mismatchDocuments : "—"}
            </span>
          </div>
          <div className="mt-3 text-xs">
            {(summary?.mismatchDocuments ?? 0) > 0 ? "Requires forensic investigation" : "Zero integrity violations detected"}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-vault-900/70 border border-vault-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-vault-400 text-sm">
            <span>Last Scan Execution</span>
            <Clock size={18} className="text-vault-400" />
          </div>
          <div className="mt-4">
            <span className="text-sm font-semibold text-white">
              {summary?.lastScan?.completedAt
                ? new Date(summary.lastScan.completedAt).toLocaleString()
                : "No completed scans"}
            </span>
          </div>
          <div className="mt-3 text-xs text-vault-400">
            {summary?.lastScan
              ? `Duration: ${Math.round((summary.lastScan.elapsedMs || 0) / 1000)}s by ${summary.lastScan.initiatedBy}`
              : "Ready to scan"}
          </div>
        </div>
      </div>

      {/* Scope Selector & Filter Bar */}
      <div className="p-4 rounded-xl bg-vault-900/50 border border-vault-800 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vault-500" />
            <input
              type="text"
              placeholder="Search document, hash, reason..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-vault-950 border border-vault-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-vault-500 focus:outline-none focus:border-vault-500"
            />
          </div>

          <select
            value={selectedCaseId}
            onChange={(e) => setSelectedCaseId(e.target.value)}
            className="bg-vault-950 border border-vault-800 rounded-lg px-3 py-1.5 text-sm text-vault-200 focus:outline-none focus:border-vault-500"
          >
            <option value="">All Accessible Cases</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.caseNumber} - {c.title}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-vault-950 border border-vault-800 rounded-lg px-3 py-1.5 text-sm text-vault-200 focus:outline-none focus:border-vault-500"
          >
            <option value="ALL">All Finding Statuses</option>
            <option value="VERIFIED">Verified Only</option>
            <option value="MISMATCH">Mismatches Only</option>
            <option value="MISSING">Missing Files Only</option>
            <option value="UNREADABLE">Unreadable Only</option>
            <option value="ERROR">Errors Only</option>
          </select>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-vault-950 rounded-lg p-1 border border-vault-800 shrink-0">
          <button
            onClick={() => setActiveTab("findings")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              activeTab === "findings" ? "bg-vault-800 text-white shadow" : "text-vault-400 hover:text-vault-200"
            }`}
          >
            Findings Ledger ({filteredFindings.length})
          </button>
          <button
            onClick={() => setActiveTab("runs")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              activeTab === "runs" ? "bg-vault-800 text-white shadow" : "text-vault-400 hover:text-vault-200"
            }`}
          >
            Scan Runs ({scans.length})
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === "findings" ? (
        <div className="rounded-2xl bg-vault-900/70 border border-vault-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-vault-950/80 text-vault-400 text-xs uppercase tracking-wider border-b border-vault-800">
                <tr>
                  <th className="px-5 py-3.5">Document & Version</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Authoritative Expected SHA-256</th>
                  <th className="px-5 py-3.5">Recalculated Actual SHA-256</th>
                  <th className="px-5 py-3.5">Verification Time</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vault-800 text-vault-200">
                {filteredFindings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-vault-400">
                      <FileQuestion size={36} className="mx-auto text-vault-600 mb-2" />
                      No scan findings match the selected criteria.
                      <p className="text-xs text-vault-500 mt-1">Run a new storage scan to populate evidence records.</p>
                    </td>
                  </tr>
                ) : (
                  filteredFindings.map((finding) => (
                    <tr key={finding.id} className="hover:bg-vault-850/50 transition">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <FileText size={16} className="text-vault-400 shrink-0" />
                          <div>
                            <span className="font-medium text-white">{finding.documentName}</span>
                            <div className="flex items-center gap-1.5 text-xs text-vault-400">
                              <span className="px-1.5 py-0.2 bg-vault-800 rounded font-mono text-[10px]">
                                v{finding.versionNo}
                              </span>
                              <span>• {finding.originalName}</span>
                              <span>• {(finding.sizeBytes / 1024).toFixed(1)} KB</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {finding.status === "VERIFIED" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/70 border border-emerald-800 text-emerald-300">
                            <CheckCircle2 size={12} /> Verified
                          </span>
                        )}
                        {finding.status === "MISMATCH" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-950/70 border border-red-800 text-red-300">
                            <AlertTriangle size={12} /> Mismatch
                          </span>
                        )}
                        {finding.status === "MISSING" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/70 border border-amber-800 text-amber-300">
                            <FileQuestion size={12} /> Missing File
                          </span>
                        )}
                        {finding.status === "UNREADABLE" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-950/70 border border-yellow-800 text-yellow-300">
                            <AlertTriangle size={12} /> Unreadable
                          </span>
                        )}
                        {finding.status === "ERROR" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-950/70 border border-red-800 text-red-300">
                            <XCircle size={12} /> Error
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-vault-300">
                        <span title={finding.expectedSha256}>
                          {finding.expectedSha256.substring(0, 16)}...
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs">
                        {finding.actualSha256 ? (
                          <span
                            className={finding.status === "MISMATCH" ? "text-red-400 font-semibold" : "text-vault-300"}
                            title={finding.actualSha256}
                          >
                            {finding.actualSha256.substring(0, 16)}...
                          </span>
                        ) : (
                          <span className="text-vault-500 italic">N/A</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-vault-400">
                        {new Date(finding.scannedAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setSelectedFinding(finding)}
                          className="px-2.5 py-1 bg-vault-800 hover:bg-vault-700 text-vault-200 text-xs rounded border border-vault-700 transition"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Scan Runs Table */
        <div className="rounded-2xl bg-vault-900/70 border border-vault-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-vault-950/80 text-vault-400 text-xs uppercase tracking-wider border-b border-vault-800">
                <tr>
                  <th className="px-5 py-3.5">Scan Run</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Scope</th>
                  <th className="px-5 py-3.5">Findings Breakdown</th>
                  <th className="px-5 py-3.5">Duration</th>
                  <th className="px-5 py-3.5">Initiator</th>
                  <th className="px-5 py-3.5">Executed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vault-800 text-vault-200">
                {scans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-vault-400">
                      No scan runs recorded yet.
                    </td>
                  </tr>
                ) : (
                  scans.map((run) => (
                    <tr key={run.id} className="hover:bg-vault-850/50 transition">
                      <td className="px-5 py-3.5 font-mono text-xs text-vault-300">
                        {run.id}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          run.status === "COMPLETED"
                            ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800"
                            : run.status === "IN_PROGRESS"
                            ? "bg-vault-800 text-vault-300 border border-vault-600 animate-pulse"
                            : run.status === "CANCELLED"
                            ? "bg-amber-950/80 text-amber-300 border border-amber-800"
                            : "bg-red-950/80 text-red-300 border border-red-800"
                        }`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-white">
                        {run.caseName || "System-wide"}
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-emerald-400">{run.verifiedCount} ok</span>
                          {run.mismatchCount > 0 && <span className="text-red-400 font-bold">{run.mismatchCount} mismatch</span>}
                          {run.missingCount > 0 && <span className="text-amber-400">{run.missingCount} missing</span>}
                          {(run.unreadableCount + run.errorCount) > 0 && (
                            <span className="text-yellow-400">{run.unreadableCount + run.errorCount} err</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-vault-400">
                        {run.elapsedMs ? `${Math.round(run.elapsedMs / 1000)}s` : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-vault-300">
                        {run.initiatedBy.name} ({run.initiatedBy.role.replace(/_/g, " ")})
                      </td>
                      <td className="px-5 py-3.5 text-xs text-vault-400">
                        {new Date(run.startedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Forensic Finding Inspector Modal */}
      {selectedFinding && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-vault-900 border border-vault-700 rounded-2xl max-w-2xl w-full p-6 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-vault-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <HardDrive size={20} className="text-vault-400" />
                  <h3 className="text-lg font-bold text-white">Forensic Evidence Finding</h3>
                </div>
                <p className="text-xs text-vault-400 mt-0.5">
                  Finding ID: <span className="font-mono text-vault-300">{selectedFinding.id}</span>
                </p>
              </div>
              <button
                onClick={() => setSelectedFinding(null)}
                className="text-vault-400 hover:text-white transition"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {/* Status Header Banner */}
              <div className={`p-4 rounded-xl border flex items-center justify-between ${
                selectedFinding.status === "VERIFIED"
                  ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                  : selectedFinding.status === "MISMATCH"
                  ? "bg-red-950/40 border-red-800 text-red-300"
                  : "bg-amber-950/40 border-amber-800 text-amber-300"
              }`}>
                <div className="flex items-center gap-3">
                  {selectedFinding.status === "VERIFIED" ? (
                    <CheckCircle2 size={24} className="text-emerald-400" />
                  ) : (
                    <AlertTriangle size={24} className="text-red-400" />
                  )}
                  <div>
                    <h4 className="font-bold">Status: {selectedFinding.status}</h4>
                    <p className="text-xs opacity-90">{selectedFinding.reason || "Integrity verification executed"}</p>
                  </div>
                </div>
                <span className="text-xs font-mono opacity-80">
                  {new Date(selectedFinding.scannedAt).toLocaleTimeString()}
                </span>
              </div>

              {/* Document Info */}
              <div className="bg-vault-950 p-4 rounded-xl border border-vault-800 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-vault-400">Document Name:</span>
                  <span className="font-semibold text-white">{selectedFinding.documentName}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-vault-400">Version Number:</span>
                  <span className="font-mono text-vault-200">v{selectedFinding.versionNo}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-vault-400">Original File:</span>
                  <span className="text-vault-200">{selectedFinding.originalName}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-vault-400">Size:</span>
                  <span className="font-mono text-vault-200">{(selectedFinding.sizeBytes / 1024).toFixed(2)} KB</span>
                </div>
              </div>

              {/* Hashes Inspection */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-vault-400 font-medium">Authoritative Expected SHA-256 (from Database):</span>
                    <button
                      onClick={() => copyToClipboard(selectedFinding.expectedSha256, "expected")}
                      className="text-vault-400 hover:text-vault-200 flex items-center gap-1 text-[11px]"
                    >
                      <Copy size={12} />
                      {copiedHash === "expected" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="p-2.5 bg-vault-950 border border-vault-800 rounded-lg font-mono text-xs text-vault-200 break-all select-all">
                    {selectedFinding.expectedSha256}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-vault-400 font-medium">Actual Disk Recalculated SHA-256:</span>
                    {selectedFinding.actualSha256 && (
                      <button
                        onClick={() => copyToClipboard(selectedFinding.actualSha256!, "actual")}
                        className="text-vault-400 hover:text-vault-200 flex items-center gap-1 text-[11px]"
                      >
                        <Copy size={12} />
                        {copiedHash === "actual" ? "Copied" : "Copy"}
                      </button>
                    )}
                  </div>
                  <div className={`p-2.5 bg-vault-950 border rounded-lg font-mono text-xs break-all select-all ${
                    selectedFinding.status === "MISMATCH"
                      ? "border-red-800 text-red-300 font-bold bg-red-950/20"
                      : "border-vault-800 text-vault-200"
                  }`}>
                    {selectedFinding.actualSha256 || "File could not be hashed from disk"}
                  </div>
                </div>
              </div>

              {/* Scan Run Reference */}
              <div className="p-3 bg-vault-950/60 rounded-lg border border-vault-800 flex items-center justify-between text-xs text-vault-400">
                <span>Scan Run Reference:</span>
                <span className="font-mono text-vault-300">{selectedFinding.scanRunId}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-vault-800 pt-4">
              {selectedFinding.documentId ? (
                <Link
                  to={`/documents/${selectedFinding.documentId}`}
                  className="inline-flex items-center gap-1.5 text-xs text-vault-400 hover:text-vault-200"
                >
                  <ExternalLink size={14} /> Open Document Details
                </Link>
              ) : (
                <span></span>
              )}
              <button
                onClick={() => setSelectedFinding(null)}
                className="px-4 py-2 bg-vault-800 hover:bg-vault-700 text-white text-xs font-medium rounded-lg transition"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
