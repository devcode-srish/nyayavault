import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, LockKeyhole } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const DEMO_ACCOUNTS = [
  { label: "Admin", email: "admin@nyayavault.demo" },
  { label: "Investigating Officer", email: "officer@nyayavault.demo" },
  { label: "Senior Officer", email: "senior@nyayavault.demo" },
  { label: "Forensic Officer", email: "forensic@nyayavault.demo" },
  { label: "Legal Officer", email: "legal@nyayavault.demo" },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Demo@1234");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err?.response?.data?.error || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0a0f16] px-4 transition-colors duration-200 relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/20 dark:bg-blue-600/10 blur-[120px] rounded-full mix-blend-multiply dark:mix-blend-lighten pointer-events-none animate-float"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/20 dark:bg-indigo-600/10 blur-[120px] rounded-full mix-blend-multiply dark:mix-blend-lighten pointer-events-none animate-float" style={{ animationDelay: '2s' }}></div>
      <div className="absolute top-[20%] right-[20%] w-[20%] h-[20%] bg-emerald-500/10 dark:bg-emerald-600/5 blur-[100px] rounded-full mix-blend-multiply dark:mix-blend-lighten pointer-events-none animate-float" style={{ animationDelay: '4s' }}></div>

      <div className="w-full max-w-md relative z-10">
        <div className="flex flex-col items-center gap-2 mb-4 justify-center">
          <img src="/logo.png" alt="NyayaVault" className="h-20 object-contain drop-shadow-md dark:bg-white/90 dark:backdrop-blur-sm dark:rounded-2xl dark:px-4 dark:py-2 dark:shadow-xl transition-all duration-300 hover:scale-105" />
        </div>
        <p className="text-center text-slate-500 dark:text-vault-400 font-medium text-xs mb-8 uppercase tracking-widest">
          Secure Digital Document Management &mdash; SIH26190
        </p>

        <form
          onSubmit={handleSubmit}
          className="glass rounded-3xl p-8 space-y-5 transition-colors relative overflow-hidden"
        >
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 dark:text-vault-300 mb-1.5 uppercase tracking-wider">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-slate-100/50 dark:bg-[#0f1720]/80 border border-slate-200/50 dark:border-[#28374b]/50 px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-500/50 transition-all shadow-inner"
              placeholder="officer@nyayavault.demo"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 dark:text-vault-300 mb-1.5 uppercase tracking-wider">Master Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-slate-100/50 dark:bg-[#0f1720]/80 border border-slate-200/50 dark:border-[#28374b]/50 px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-500/50 transition-all shadow-inner"
            />
          </div>
          {error && <p className="text-red-600 dark:text-red-400 text-sm font-medium bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800/50">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-bold py-3 shadow-lg shadow-blue-500/30 disabled:opacity-50 mt-4 transition-all duration-300 hover:shadow-indigo-500/40 hover:-translate-y-0.5 flex items-center justify-center gap-2"
          >
            <LockKeyhole size={18} className={submitting ? "animate-pulse" : ""} />
            {submitting ? "Authenticating..." : "Secure Sign In"}
          </button>
        </form>

        <div className="mt-8 glass-card rounded-2xl p-6 relative">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-vault-400 mb-4 text-center">Demo Accounts (Auto-fills)</p>
          <div className="grid grid-cols-1 gap-2.5">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                type="button"
                key={acc.email}
                onClick={() => setEmail(acc.email)}
                className="group flex flex-col sm:flex-row sm:items-center sm:justify-between text-left text-xs font-medium text-slate-700 dark:text-vault-200 hover:bg-white dark:hover:bg-[#1a2332] bg-slate-100/50 dark:bg-[#0f1720]/50 border border-slate-200/50 dark:border-[#28374b]/30 shadow-sm hover:shadow-md rounded-xl px-4 py-2.5 transition-all duration-200 hover:border-blue-300 dark:hover:border-blue-500/50"
              >
                <span className="font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{acc.label}</span>
                <span className="text-slate-400 dark:text-vault-500 font-mono text-[10px] sm:text-[11px] mt-1 sm:mt-0">{acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
