import React, { useEffect, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Search,
  CheckCircle2,
  Clock,
  User,
  Package,
  FileText,
  Fingerprint,
  ExternalLink,
  ArrowRight,
  Shield,
  RotateCw,
} from "lucide-react";
import { PageHeader, Card, Badge } from "../components/ui";

export default function VerifyEvidence() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryToken = searchParams.get("token") || "";

  const [tokenInput, setTokenInput] = useState(queryToken);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (queryToken) {
      setTokenInput(queryToken);
      verifyToken(queryToken);
    }
  }, [queryToken]);

  async function verifyToken(tokenToVerify: string) {
    const cleanToken = tokenToVerify.trim();
    if (!cleanToken) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data } = await api.get(`/evidence/verify/${cleanToken}`);
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.response?.data?.message || "Failed to verify evidence tag");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tokenInput.trim()) {
      navigate(`/verify/evidence?token=${encodeURIComponent(tokenInput.trim())}`);
    }
  }

  return (
    <div>
      <PageHeader
        title="Physical Evidence Tag Verification"
        subtitle="Cryptographic verification and chain-of-custody inspection for physical evidence exhibits"
      />

      <div className="p-8 space-y-6 max-w-4xl mx-auto">
        {/* Token Search Bar */}
        <Card title="Verify Physical Evidence QR Token">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vault-500" />
                <input
                  type="text"
                  required
                  placeholder="Scan or paste 64-character verification token..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="w-full bg-vault-950 border border-vault-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-vault-500 font-mono focus:outline-none focus:border-vault-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !tokenInput.trim()}
                className="px-5 py-2 bg-vault-600 hover:bg-vault-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
              >
                {loading ? "Verifying..." : "Verify"}
              </button>
            </div>
          </form>
        </Card>

        {/* Loading Indicator */}
        {loading && (
          <div className="p-12 text-center text-vault-400 text-sm">
            Validating cryptographic token against authoritative database ledger...
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-5 rounded-xl bg-red-950/60 border border-red-800 text-red-200 flex items-start gap-3">
            <ShieldAlert size={20} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Verification Failed</h4>
              <p className="text-xs text-red-300/80 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Result 1: Unauthenticated Public View (Anti-Oracle Protection) */}
        {result && !result.authenticated && (
          <div className="p-8 rounded-2xl bg-vault-900 border border-vault-800 space-y-6 text-center shadow-xl">
            <div className="w-16 h-16 rounded-full bg-vault-800 border-2 border-vault-600 flex items-center justify-center mx-auto text-vault-300">
              <Lock size={28} />
            </div>

            <div className="space-y-2 max-w-md mx-auto">
              <h3 className="text-lg font-bold text-white">Physical Evidence Tag Detected</h3>
              <p className="text-xs text-vault-400 leading-relaxed">
                This tag belongs to the NyayaVault Evidence Repository. To prevent unauthorized intelligence
                gathering, complete case records, exhibit descriptions, and custodial history are restricted to
                authorized officers.
              </p>
            </div>

            <div className="pt-2">
              <Link
                to={`/login?redirect=${encodeURIComponent(`/verify/evidence?token=${tokenInput.trim()}`)}`}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-vault-600 hover:bg-vault-500 text-white font-semibold text-sm rounded-lg shadow-lg shadow-vault-950/50 transition"
              >
                Sign In with Authorized Credentials <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        )}

        {/* Result 2: Authenticated & Authorized Case Member View */}
        {result && result.authenticated && result.authorized && result.evidence && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-vault-900 border border-emerald-900/60 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-vault-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-400">
                    <ShieldCheck size={24} />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400">
                      CRYPTOGRAPHICALLY VERIFIED PHYSICAL TAG
                    </span>
                    <h3 className="text-xl font-bold text-white mt-0.5">{result.evidence.name}</h3>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge text={result.evidence.status.replace(/_/g, " ")} />
                </div>
              </div>

              {/* Grid Overview */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="p-3 bg-vault-950 rounded-xl border border-vault-800">
                  <span className="text-vault-500 uppercase font-semibold text-[10px] block">Assigned Case</span>
                  <Link
                    to={`/cases/${result.evidence.case.id}`}
                    className="font-semibold text-sm text-vault-200 hover:text-white hover:underline flex items-center gap-1 mt-0.5"
                  >
                    <span>{result.evidence.case.caseNumber}</span>
                    <ExternalLink size={12} className="text-vault-400" />
                  </Link>
                  <p className="text-vault-400 truncate mt-0.5">{result.evidence.case.title}</p>
                </div>

                <div className="p-3 bg-vault-950 rounded-xl border border-vault-800">
                  <span className="text-vault-500 uppercase font-semibold text-[10px] block">Current Custodian</span>
                  <span className="font-semibold text-sm text-vault-200 block mt-0.5">
                    {result.evidence.currentCustodian?.name || "System Vault"}
                  </span>
                  {result.evidence.currentCustodian?.role && (
                    <span className="text-vault-500 font-mono text-[11px]">
                      {result.evidence.currentCustodian.role.replace(/_/g, " ")}
                    </span>
                  )}
                </div>

                <div className="p-3 bg-vault-950 rounded-xl border border-vault-800">
                  <span className="text-vault-500 uppercase font-semibold text-[10px] block">Tag Token Status</span>
                  <span className="font-semibold text-emerald-400 text-sm flex items-center gap-1 mt-0.5">
                    <CheckCircle2 size={13} /> Active & Valid
                  </span>
                  <span className="text-vault-500 font-mono text-[11px]">
                    Logged: {new Date(result.evidence.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {result.evidence.description && (
                <div className="p-4 bg-vault-950 rounded-xl border border-vault-800 text-xs">
                  <span className="text-vault-500 uppercase font-semibold text-[10px] block mb-1">
                    Exhibit Description
                  </span>
                  <p className="text-vault-300 leading-relaxed">{result.evidence.description}</p>
                </div>
              )}

              {/* Custody Chain Timeline */}
              <div className="space-y-3 pt-2">
                <h4 className="font-bold text-sm text-white flex items-center gap-2">
                  <Fingerprint size={16} className="text-vault-400" /> Complete Chain of Custody (
                  {result.evidence.transfers?.length || 0} Events)
                </h4>

                <div className="space-y-2">
                  {result.evidence.transfers?.map((t: any, idx: number) => (
                    <div
                      key={t.id}
                      className="p-3 bg-vault-950 border border-vault-800 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-vault-200">
                          {t.fromUser ? `${t.fromUser.name} → ${t.toUser.name}` : `Initial Intake to ${t.toUser.name}`}
                        </div>
                        <div className="text-vault-400 flex items-center gap-3 text-[11px]">
                          <span>Condition: {t.packageCondition}</span>
                          {t.sealNumber && <span>Seal: {t.sealNumber}</span>}
                          {t.notes && <span className="italic truncate max-w-xs">{t.notes}</span>}
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-vault-400 font-mono text-[11px] block">
                          {new Date(t.transferredAt).toLocaleString()}
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-vault-900 border border-vault-700 text-vault-300">
                          {t.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
