import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { Lock } from "lucide-react";
import { PageHeader, Card, Badge, EmptyState } from "../components/ui";

const CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"];

export default function CaseDetail() {
  const { id } = useParams();
  const [caseData, setCaseData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [type, setType] = useState("Report");
  const [classification, setClassification] = useState("INTERNAL");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .get(`/cases/${id}`)
      .then(({ data }) => setCaseData(data.case))
      .catch((e) => setError(e?.response?.data?.error || "Failed to load case"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      (document.getElementById("file-input") as HTMLInputElement).value = "";
      load();
    } catch (err: any) {
      setUploadError(err?.response?.data?.error || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="p-8 text-vault-400 text-sm">Loading...</div>;
  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>;
  if (!caseData) return null;

  return (
    <div>
      <PageHeader
        title={`${caseData.caseNumber} — ${caseData.title}`}
        subtitle="DEMO / SYNTHETIC DATA"
      />
      <div className="p-8 space-y-6">
        <Card title="Overview">
          <p className="text-sm text-vault-300 mb-2">{caseData.description}</p>
          <div className="flex gap-2 items-center">
            <Badge text={caseData.status} />
          </div>
        </Card>

        <Card title="Upload Document">
          <form onSubmit={handleUpload} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-vault-400 mb-1">Document name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Defaults to file name"
                  className="w-full rounded-lg bg-vault-950 border border-vault-700 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-vault-400 mb-1">Type</label>
                <input
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-lg bg-vault-950 border border-vault-700 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-vault-400 mb-1">Classification</label>
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                className="w-full rounded-lg bg-vault-950 border border-vault-700 px-3 py-2 text-sm text-white"
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-vault-400 mb-1">
                File (PDF, JPG, PNG, DOC, DOCX — max 25MB)
              </label>
              <input
                id="file-input"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-vault-300"
              />
            </div>
            {uploadError && <p className="text-red-400 text-sm">{uploadError}</p>}
            <button
              type="submit"
              disabled={!file || uploading}
              className="rounded-lg bg-vault-500 hover:bg-vault-400 transition text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </form>
        </Card>

        <Card title="Documents">
          {caseData.documents.length === 0 ? (
            <EmptyState text="No documents uploaded yet." />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-vault-400 text-xs uppercase">
                <tr>
                  <th className="text-left py-1">Name</th>
                  <th className="text-left py-1">Type</th>
                  <th className="text-left py-1">Classification</th>
                  <th className="text-left py-1">Integrity</th>
                  <th className="text-left py-1">Uploaded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vault-800">
                {caseData.documents.map((d: any) => (
                  <tr key={d.id}>
                    <td className="py-2">
                      <Link to={`/documents/${d.id}`} className="text-vault-200 hover:text-white hover:underline">
                        {d.name}
                      </Link>
                      {!d.canAccess && (
                        <span className="inline-flex items-center gap-1 ml-2 text-xs text-amber-400">
                          <Lock size={12} /> Restricted
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-vault-400">{d.type}</td>
                    <td className="py-2"><Badge text={d.classification} /></td>
                    <td className="py-2">
                      <Badge
                        text={d.integrityStatus}
                        tone={d.integrityStatus === "VERIFIED" ? "good" : d.integrityStatus === "MISMATCH" ? "danger" : "neutral"}
                      />
                    </td>
                    <td className="py-2 text-vault-400">{d.uploadedBy?.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Case Members">
          <ul className="space-y-1">
            {caseData.members.map((m: any) => (
              <li key={m.id} className="text-sm text-vault-300 flex justify-between">
                <span>{m.user.name} <span className="text-vault-500">({m.user.role.replace(/_/g, " ")})</span></span>
                <span className="text-vault-500">{m.roleInCase.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
