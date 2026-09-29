import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import {
  Lock,
  Plus,
  Search,
  Filter,
  ArrowUpDown,
  Shield,
  FileText,
  Fingerprint,
  PenTool,
  ShieldAlert,
  KeyRound,
  MessageSquare,
  Star,
  CheckCircle2,
  Calendar,
  Clock,
  User,
  Hash,
  ExternalLink,
  XCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Briefcase,
  Download,
  Copy,
  Check,
} from "lucide-react";
import { PageHeader, Card, Badge, EmptyState } from "../components/ui";
import CourtBundleExportModal from "../components/CourtBundleExportModal";
import { useAuth } from "../context/AuthContext";

const CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"];

const CATEGORY_OPTIONS = [
  { value: "ALL", label: "All Categories", icon: Filter },
  { value: "INVESTIGATOR_NOTE", label: "Notes & Milestones", icon: MessageSquare },
  { value: "DOCUMENT_VERSIONING", label: "Documents", icon: FileText },
  { value: "DIGITAL_SIGNATURE", label: "Signatures & 65B", icon: PenTool },
  { value: "EVIDENCE_CUSTODY", label: "Custody Transfers", icon: Fingerprint },
  { value: "STORAGE_INTEGRITY", label: "Integrity & Scans", icon: ShieldAlert },
  { value: "ACCESS_SHARING", label: "Access & Sharing", icon: KeyRound },
  { value: "CASE_LIFECYCLE", label: "Case Lifecycle", icon: Shield },
];

interface TimelineEvent {
  id: string;
  source: "AUDIT_LOG" | "MANUAL_NOTE";
  sourceId: string;
  caseId: string;
  category: string;
  title: string;
  description: string | null;
  occurredAt: string;
  createdAt: string;
  isMilestone: boolean;
  actor: {
    id: string | null;
    name: string;
    role: string | null;
  };
  document: {
    id: string;
    name: string;
  } | null;
  evidence: {
    id: string;
    name: string;
  } | null;
  auditProof: {
    hash: string | null;
    previousHash: string | null;
    verifiedProvenance: boolean;
  } | null;
  metadata: any;
}

export default function CaseDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [caseData, setCaseData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Tab State
  const [activeTab, setActiveTab] = useState<"timeline" | "documents" | "court-bundles" | "overview">("timeline");

  // Timeline State
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineTotalPages, setTimelineTotalPages] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // Courtroom Evidence Bundles State
  const [courtBundles, setCourtBundles] = useState<any[]>([]);
  const [courtBundlesLoading, setCourtBundlesLoading] = useState(false);
  const [showCourtBundleModal, setShowCourtBundleModal] = useState(false);
  const [downloadingBundleId, setDownloadingBundleId] = useState<string | null>(null);
  const [bundleActionError, setBundleActionError] = useState<string | null>(null);
  const [copiedBundleRoot, setCopiedBundleRoot] = useState<string | null>(null);

  // Note Creation Modal State
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteDescription, setNoteDescription] = useState("");
  const [noteCategory, setNoteCategory] = useState("INVESTIGATOR_NOTE");
  const [noteOccurredAt, setNoteOccurredAt] = useState("");
  const [noteIsMilestone, setNoteIsMilestone] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Document Upload State
  const [name, setName] = useState("");
  const [type, setType] = useState("Report");
  const [classification, setClassification] = useState("INTERNAL");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const canExportCourtBundle =
    user &&
    ["ADMIN", "SENIOR_OFFICER", "INVESTIGATING_OFFICER", "LEGAL_OFFICER"].includes(user.role);

  const loadCase = useCallback(() => {
    setLoading(true);
    api
      .get(`/cases/${id}`)
      .then(({ data }) => setCaseData(data.case))
      .catch((e) => setError(e?.response?.data?.error || "Failed to load case"))
      .finally(() => setLoading(false));
  }, [id]);

  const loadCourtBundles = useCallback(async () => {
    if (!id) return;
    setCourtBundlesLoading(true);
    setBundleActionError(null);
    try {
      const { data } = await api.get(`/cases/${id}/court-bundles`);
      setCourtBundles(data.bundles || []);
    } catch (err: any) {
      console.error("Failed to load court bundles:", err);
      setBundleActionError(err?.response?.data?.error || "Failed to load courtroom bundles");
    } finally {
      setCourtBundlesLoading(false);
    }
  }, [id]);

  const loadTimeline = useCallback(async () => {
    if (!id) return;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setDateError("End date cannot be earlier than start date");
      return;
    }
    setDateError(null);
    setTimelineLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(timelinePage),
        limit: "20",
        order: sortOrder,
      };
      if (categoryFilter !== "ALL") params.category = categoryFilter;
      if (sourceFilter !== "ALL") params.source = sourceFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      if (dateFrom) {
        const fromDate = new Date(`${dateFrom}T00:00:00`);
        params.dateFrom = fromDate.toISOString();
      }
      if (dateTo) {
        const toDate = new Date(`${dateTo}T23:59:59.999`);
        params.dateTo = toDate.toISOString();
      }

      const { data } = await api.get(`/cases/${id}/timeline`, { params });
      setTimelineEvents(data.events || []);
      setTimelineTotal(data.pagination.totalEvents || 0);
      setTimelineTotalPages(data.pagination.totalPages || 1);
    } catch (err: any) {
      console.error("Failed to load case timeline:", err);
    } finally {
      setTimelineLoading(false);
    }
  }, [id, timelinePage, sortOrder, categoryFilter, sourceFilter, searchQuery, dateFrom, dateTo]);

  useEffect(() => {
    loadCase();
    loadCourtBundles();
  }, [loadCase, loadCourtBundles]);

  useEffect(() => {
    if (activeTab === "timeline") {
      loadTimeline();
    } else if (activeTab === "court-bundles") {
      loadCourtBundles();
    }
  }, [activeTab, loadTimeline, loadCourtBundles]);

  async function handleDownloadBundle(bundleId: string, bundleNumber: string) {
    setDownloadingBundleId(bundleId);
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
      alert(err?.response?.data?.error || "Failed to download court bundle archive.");
    } finally {
      setDownloadingBundleId(null);
    }
  }

  function handleCopyMerkleRoot(root: string) {
    navigator.clipboard.writeText(root);
    setCopiedBundleRoot(root);
    setTimeout(() => setCopiedBundleRoot(null), 2000);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caseId", id!);
      form.append("name", name || file.name);
      form.append("type", type);
      form.append("classification", classification);
      await api.post("/documents", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setName("");
      setFile(null);
      const fileInput = document.getElementById("file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      loadCase();
      loadTimeline();
    } catch (err: any) {
      setUploadError(err?.response?.data?.error || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteTitle.trim()) return;
    setCreatingNote(true);
    setNoteError(null);
    try {
      await api.post(`/cases/${id}/timeline`, {
        title: noteTitle.trim(),
        description: noteDescription.trim() || undefined,
        category: noteCategory,
        occurredAt: noteOccurredAt || undefined,
        isMilestone: noteIsMilestone,
      });
      setShowNoteModal(false);
      setNoteTitle("");
      setNoteDescription("");
      setNoteOccurredAt("");
      setNoteIsMilestone(false);
      loadTimeline();
    } catch (err: any) {
      setNoteError(err?.response?.data?.error || "Failed to record timeline note");
    } finally {
      setCreatingNote(false);
    }
  }

  function getCategoryIcon(category: string) {
    switch (category) {
      case "INVESTIGATOR_NOTE":
        return <MessageSquare size={16} className="text-sky-400" />;
      case "DOCUMENT_VERSIONING":
        return <FileText size={16} className="text-indigo-400" />;
      case "DIGITAL_SIGNATURE":
        return <PenTool size={16} className="text-purple-400" />;
      case "EVIDENCE_CUSTODY":
        return <Fingerprint size={16} className="text-emerald-400" />;
      case "STORAGE_INTEGRITY":
        return <ShieldAlert size={16} className="text-amber-400" />;
      case "ACCESS_SHARING":
        return <KeyRound size={16} className="text-orange-400" />;
      case "CASE_LIFECYCLE":
      default:
        return <Shield size={16} className="text-slate-500 dark:text-vault-400" />;
    }
  }

  if (loading) return <div className="p-8 text-slate-500 dark:text-vault-400 text-sm">Loading case details...</div>;
  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>;
  if (!caseData) return null;

  return (
    <div>
      <PageHeader
        title={`${caseData.caseNumber} — ${caseData.title}`}
        subtitle="Digital Investigation Record & Evidence Ledger"
      />

      <div className="p-8 space-y-6 max-w-7xl mx-auto">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-vault-800 pb-3">
          <div className="flex gap-2 bg-white dark:bg-vault-950 p-1 rounded-xl border border-slate-200 dark:border-vault-800">
            <button
              onClick={() => setActiveTab("timeline")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === "timeline"
                  ? "bg-slate-100 dark:bg-vault-800 text-white shadow"
                  : "text-slate-500 dark:text-vault-400 hover:text-slate-700 dark:text-vault-200"
              }`}
            >
              Investigation Timeline
            </button>
            <button
              onClick={() => setActiveTab("documents")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === "documents"
                  ? "bg-slate-100 dark:bg-vault-800 text-white shadow"
                  : "text-slate-500 dark:text-vault-400 hover:text-slate-700 dark:text-vault-200"
              }`}
            >
              Documents & Upload ({caseData.documents.length})
            </button>
            <button
              onClick={() => setActiveTab("overview")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === "overview"
                  ? "bg-slate-100 dark:bg-vault-800 text-white shadow"
                  : "text-slate-500 dark:text-vault-400 hover:text-slate-700 dark:text-vault-200"
              }`}
            >
              Overview & Members ({caseData.members.length})
            </button>
          </div>

          {activeTab === "timeline" && (
            <button
              onClick={() => setShowNoteModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-vault-600 hover:bg-blue-600 dark:bg-vault-500 text-white text-sm font-medium rounded-lg shadow-lg shadow-vault-950/50 transition"
            >
              <Plus size={16} /> Record Milestone / Note
            </button>
          )}
        </div>

        {/* TAB 1: TIMELINE */}
        {activeTab === "timeline" && (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="p-4 rounded-xl bg-white dark:bg-vault-900/50 border border-slate-200 dark:border-vault-800 space-y-3">
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-vault-500" />
                    <input
                      type="text"
                      placeholder="Search events, actors, files..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setTimelinePage(1);
                      }}
                      className="w-full bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-900 dark:text-white placeholder-vault-500 focus:outline-none focus:border-vault-500"
                    />
                  </div>

                  <select
                    value={categoryFilter}
                    onChange={(e) => {
                      setCategoryFilter(e.target.value);
                      setTimelinePage(1);
                    }}
                    className="bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-vault-200 focus:outline-none focus:border-vault-500"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={sourceFilter}
                    onChange={(e) => {
                      setSourceFilter(e.target.value);
                      setTimelinePage(1);
                    }}
                    className="bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-vault-200 focus:outline-none focus:border-vault-500"
                  >
                    <option value="ALL">All Event Sources</option>
                    <option value="AUDIT_LOG">Audit-Verified System Events</option>
                    <option value="MANUAL_NOTE">Investigator Field Notes</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg text-xs text-slate-600 dark:text-vault-300 hover:text-slate-900 dark:text-white transition"
                  >
                    <ArrowUpDown size={14} />
                    {sortOrder === "desc" ? "Newest First" : "Oldest First"}
                  </button>
                  <span className="text-xs text-slate-500 dark:text-vault-400">
                    Total: <span className="text-slate-700 dark:text-vault-200 font-semibold">{timelineTotal}</span>
                  </span>
                </div>
              </div>

              {/* Date Range Sub-Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-vault-800/60 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-slate-500 dark:text-vault-400 font-medium flex items-center gap-1.5">
                    <Calendar size={13} className="text-slate-500 dark:text-vault-500" /> Date Range:
                  </span>

                  <div className="flex items-center gap-2 bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg px-2.5 py-1">
                    <label className="text-slate-500 dark:text-vault-500 text-[11px] uppercase font-semibold">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (dateTo && val && val > dateTo) {
                          setDateError("Start date cannot be after end date");
                        } else {
                          setDateError(null);
                          setDateFrom(val);
                          setTimelinePage(1);
                        }
                      }}
                      className="bg-transparent text-white text-xs focus:outline-none [color-scheme:dark]"
                    />
                  </div>

                  <div className="flex items-center gap-2 bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg px-2.5 py-1">
                    <label className="text-slate-500 dark:text-vault-500 text-[11px] uppercase font-semibold">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (dateFrom && val && val < dateFrom) {
                          setDateError("End date cannot be earlier than start date");
                        } else {
                          setDateError(null);
                          setDateTo(val);
                          setTimelinePage(1);
                        }
                      }}
                      className="bg-transparent text-white text-xs focus:outline-none [color-scheme:dark]"
                    />
                  </div>

                  {(dateFrom || dateTo) && (
                    <button
                      onClick={() => {
                        setDateFrom("");
                        setDateTo("");
                        setDateError(null);
                        setTimelinePage(1);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-600 dark:text-vault-300 hover:text-white rounded-lg text-xs transition"
                      title="Clear date filter"
                    >
                      <X size={12} /> Clear Dates
                    </button>
                  )}
                </div>

                {dateError && (
                  <span className="text-red-400 font-medium text-xs flex items-center gap-1">
                    <XCircle size={13} /> {dateError}
                  </span>
                )}
              </div>
            </div>

            {/* Timeline Stream */}
            {timelineLoading ? (
              <div className="p-12 text-center text-slate-500 dark:text-vault-400 text-sm">Loading investigation timeline...</div>
            ) : timelineEvents.length === 0 ? (
              <div className="p-12 text-center text-slate-500 dark:text-vault-400 rounded-2xl bg-white dark:bg-vault-900/50 border border-slate-200 dark:border-vault-800">
                <Calendar size={36} className="mx-auto text-vault-600 mb-2" />
                No events match the selected filters for this case.
                <p className="text-xs text-slate-500 dark:text-vault-500 mt-1">Record a milestone or upload evidence to populate the timeline.</p>
              </div>
            ) : (
              <div className="relative border-l-2 border-slate-200 dark:border-vault-800 ml-4 md:ml-6 space-y-6 pb-6">
                {timelineEvents.map((event) => (
                  <div key={event.id} className="relative pl-6 md:pl-8 group">
                    {/* Circle Node on Timeline line */}
                    <div className="absolute -left-[17px] top-1.5 bg-white dark:bg-vault-950 border-2 border-slate-300 dark:border-vault-700 rounded-full p-1.5 group-hover:border-vault-400 transition shadow">
                      {getCategoryIcon(event.category)}
                    </div>

                    {/* Event Card */}
                    <div className={`p-5 rounded-2xl border transition shadow-sm ${
                      event.isMilestone
                        ? "bg-white dark:bg-vault-900/90 border-slate-400 dark:border-vault-600 shadow-md ring-1 ring-vault-500/20"
                        : "bg-white dark:bg-vault-900/50 border-slate-200 dark:border-vault-800 hover:border-slate-300 dark:border-vault-700"
                    }`}>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 dark:border-vault-800/80 pb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold tracking-wide uppercase px-2 py-0.5 rounded bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 text-slate-600 dark:text-vault-300">
                            {event.category.replace(/_/g, " ")}
                          </span>

                          {event.isMilestone && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-950/80 border border-amber-700 text-amber-300">
                              <Star size={11} className="fill-amber-400 text-amber-400" /> Key Milestone
                            </span>
                          )}

                          {event.source === "AUDIT_LOG" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 font-mono">
                              <Shield size={10} /> Audit-Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-sky-950/60 border border-sky-800 text-sky-300 font-mono">
                              <MessageSquare size={10} /> Field Note
                            </span>
                          )}
                        </div>

                        {/* Timestamps */}
                        <div className="text-xs text-slate-500 dark:text-vault-400 flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <Clock size={12} /> {new Date(event.occurredAt).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {/* Title & Description */}
                      <div className="mt-3 space-y-1.5">
                        <h4 className="font-semibold text-white text-base">{event.title}</h4>
                        {event.description && (
                          <p className="text-sm text-slate-600 dark:text-vault-300 leading-relaxed whitespace-pre-wrap">
                            {event.description}
                          </p>
                        )}
                      </div>

                      {/* Associated References & Metadata */}
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-vault-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-4 flex-wrap text-slate-500 dark:text-vault-400">
                          <span className="flex items-center gap-1.5">
                            <User size={13} className="text-slate-500 dark:text-vault-500" />
                            <span className="text-slate-700 dark:text-vault-200 font-medium">{event.actor.name}</span>
                            {event.actor.role && (
                              <span className="text-slate-500 dark:text-vault-500">({event.actor.role.replace(/_/g, " ")})</span>
                            )}
                          </span>

                          {event.document && (
                            <Link
                              to={`/documents/${event.document.id}`}
                              className="flex items-center gap-1 text-slate-600 dark:text-vault-300 hover:text-white hover:underline"
                            >
                              <FileText size={13} className="text-indigo-400" />
                              <span>{event.document.name}</span>
                              <ExternalLink size={10} />
                            </Link>
                          )}

                          {event.evidence && (
                            <Link
                              to={`/evidence/${event.evidence.id}`}
                              className="flex items-center gap-1 text-slate-600 dark:text-vault-300 hover:text-white hover:underline"
                            >
                              <Fingerprint size={13} className="text-emerald-400" />
                              <span>{event.evidence.name}</span>
                              <ExternalLink size={10} />
                            </Link>
                          )}
                        </div>

                        {/* Cryptographic Proof Chip for Audit-Backed Events */}
                        {event.auditProof?.hash && (
                          <div
                            title={`Audit Hash: ${event.auditProof.hash}\nPrevious Hash: ${event.auditProof.previousHash}`}
                            className="flex items-center gap-1 font-mono text-[11px] text-slate-500 dark:text-vault-400 bg-white dark:bg-vault-950 px-2 py-0.5 rounded border border-slate-200 dark:border-vault-800"
                          >
                            <Hash size={11} className="text-slate-500 dark:text-vault-500" />
                            <span>{event.auditProof.hash.substring(0, 12)}...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination Controls */}
            {timelineTotalPages > 1 && (
              <div className="flex items-center justify-between p-4 bg-white dark:bg-vault-900/50 rounded-xl border border-slate-200 dark:border-vault-800">
                <span className="text-xs text-slate-500 dark:text-vault-400">
                  Showing page <span className="font-semibold text-white">{timelinePage}</span> of{" "}
                  <span className="font-semibold text-white">{timelineTotalPages}</span>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTimelinePage(Math.max(1, timelinePage - 1))}
                    disabled={timelinePage <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-700 dark:text-vault-200 text-xs rounded-lg disabled:opacity-50 transition"
                  >
                    <ChevronLeft size={14} /> Previous
                  </button>
                  <button
                    onClick={() => setTimelinePage(Math.min(timelineTotalPages, timelinePage + 1))}
                    disabled={timelinePage >= timelineTotalPages}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-700 dark:text-vault-200 text-xs rounded-lg disabled:opacity-50 transition"
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DOCUMENTS */}
        {activeTab === "documents" && (
          <div className="space-y-6">
            <Card title="Upload Evidence Document">
              <form onSubmit={handleUpload} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Document name</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Defaults to file name"
                      className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-vault-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Type</label>
                    <input
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-vault-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Classification</label>
                  <select
                    value={classification}
                    onChange={(e) => setClassification(e.target.value)}
                    className="w-full rounded-lg bg-white dark:bg-vault-950 border border-slate-300 dark:border-vault-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-vault-500"
                  >
                    {CLASSIFICATIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">
                    File (PDF, JPG, PNG, DOC, DOCX — max 25MB)
                  </label>
                  <input
                    id="file-input"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-slate-600 dark:text-vault-300"
                  />
                </div>
                {uploadError && <p className="text-red-400 text-sm">{uploadError}</p>}
                <button
                  type="submit"
                  disabled={!file || uploading}
                  className="rounded-lg bg-blue-600 dark:bg-vault-500 hover:bg-blue-700 dark:hover:bg-vault-400 transition text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Upload Document"}
                </button>
              </form>
            </Card>

            <Card title="Uploaded Documents">
              {caseData.documents.length === 0 ? (
                <EmptyState text="No documents uploaded yet." />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-slate-500 dark:text-vault-400 text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">Name</th>
                      <th className="text-left py-2">Type</th>
                      <th className="text-left py-2">Classification</th>
                      <th className="text-left py-2">Integrity</th>
                      <th className="text-left py-2">Uploaded by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-vault-800">
                    {caseData.documents.map((d: any) => (
                      <tr key={d.id}>
                        <td className="py-2.5">
                          <Link to={`/documents/${d.id}`} className="text-slate-700 dark:text-vault-200 hover:text-white hover:underline">
                            {d.name}
                          </Link>
                          {!d.canAccess && (
                            <span className="inline-flex items-center gap-1 ml-2 text-xs text-amber-400">
                              <Lock size={12} /> Restricted
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-slate-500 dark:text-vault-400">{d.type}</td>
                        <td className="py-2.5"><Badge text={d.classification} /></td>
                        <td className="py-2.5">
                          <Badge
                            text={d.integrityStatus}
                            tone={d.integrityStatus === "VERIFIED" ? "good" : d.integrityStatus === "MISMATCH" ? "danger" : "neutral"}
                          />
                        </td>
                        <td className="py-2.5 text-slate-500 dark:text-vault-400">{d.uploadedBy?.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        )}

        {/* TAB 3: OVERVIEW & MEMBERS */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <Card title="Case Overview">
              <p className="text-sm text-slate-600 dark:text-vault-300 mb-4">{caseData.description || "No description provided."}</p>
              <div className="flex gap-2 items-center">
                <Badge text={caseData.status} />
              </div>
            </Card>

            <Card title="Assigned Case Members">
              <ul className="space-y-2">
                {caseData.members.map((m: any) => (
                  <li key={m.id} className="text-sm text-slate-600 dark:text-vault-300 flex justify-between p-2 rounded-lg bg-white dark:bg-vault-950/60 border border-slate-200 dark:border-vault-800">
                    <span>
                      <strong className="text-white">{m.user.name}</strong>{" "}
                      <span className="text-slate-500 dark:text-vault-500">({m.user.role.replace(/_/g, " ")})</span>
                    </span>
                    <span className="text-slate-500 dark:text-vault-400 font-mono text-xs">{m.roleInCase.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </div>

      {/* Record Milestone / Note Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-vault-900 border border-slate-300 dark:border-vault-700 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-vault-800 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={20} className="text-slate-500 dark:text-vault-400" />
                <h3 className="text-lg font-bold text-white">Record Investigation Note / Milestone</h3>
              </div>
              <button
                onClick={() => setShowNoteModal(false)}
                className="text-slate-500 dark:text-vault-400 hover:text-white transition"
              >
                <XCircle size={20} />
              </button>
            </div>

            {noteError && (
              <div className="p-3 bg-red-950/60 border border-red-800 rounded-lg text-red-300 text-xs">
                {noteError}
              </div>
            )}

            <form onSubmit={handleCreateNote} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Event Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Witness Statement Recorded, Crime Scene Inspected"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="w-full bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-vault-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Category</label>
                  <select
                    value={noteCategory}
                    onChange={(e) => setNoteCategory(e.target.value)}
                    className="w-full bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-vault-200 focus:outline-none focus:border-vault-500"
                  >
                    <option value="INVESTIGATOR_NOTE">Investigator Note</option>
                    <option value="CASE_LIFECYCLE">Case Lifecycle</option>
                    <option value="EVIDENCE_CUSTODY">Evidence Custody</option>
                    <option value="DOCUMENT_VERSIONING">Document Versioning</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Occurred At (Historical/Current)</label>
                  <input
                    type="datetime-local"
                    value={noteOccurredAt}
                    onChange={(e) => setNoteOccurredAt(e.target.value)}
                    className="w-full bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-vault-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-vault-400 mb-1">Description / Investigative Findings</label>
                <textarea
                  rows={3}
                  placeholder="Provide detailed notes, observations, or legal context..."
                  value={noteDescription}
                  onChange={(e) => setNoteDescription(e.target.value)}
                  className="w-full bg-white dark:bg-vault-950 border border-slate-200 dark:border-vault-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-vault-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="milestone-check"
                  checked={noteIsMilestone}
                  onChange={(e) => setNoteIsMilestone(e.target.checked)}
                  className="rounded bg-white dark:bg-vault-950 border-slate-200 dark:border-vault-800 text-slate-500 dark:text-vault-500 focus:ring-0 h-4 w-4"
                />
                <label htmlFor="milestone-check" className="text-xs text-slate-700 dark:text-vault-200 cursor-pointer">
                  Highlight as a Key Case Milestone
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-vault-800">
                <button
                  type="button"
                  onClick={() => setShowNoteModal(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-vault-800 hover:bg-slate-700 dark:bg-vault-700 text-slate-700 dark:text-vault-200 text-xs font-medium rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingNote || !noteTitle.trim()}
                  className="px-4 py-2 bg-blue-600 dark:bg-vault-500 hover:bg-blue-700 dark:hover:bg-vault-400 text-white text-xs font-medium rounded-lg shadow transition disabled:opacity-50"
                >
                  {creatingNote ? "Recording..." : "Record Event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
