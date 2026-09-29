import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-vault-950 px-4 transition-colors duration-200">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-2 mb-6 justify-center">
          <img src="/logo.png" alt="NyayaVault" className="h-16 object-contain drop-shadow-md dark:bg-white dark:rounded-2xl dark:px-4 dark:py-2 dark:shadow-none" />
        </div>
        <p className="text-center text-slate-500 dark:text-vault-400 font-medium text-sm mb-8">
          Secure Digital Document Management &mdash; DEMO / SYNTHETIC DATA (SIH26190)
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-2xl p-8 space-y-5 shadow-lg transition-colors"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-vault-300 mb-1.5 uppercase tracking-wide">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-slate-50 dark:bg-vault-950 border border-slate-200 dark:border-vault-700 px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-vault-500 transition-colors"
              placeholder="officer@nyayavault.demo"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-vault-300 mb-1.5 uppercase tracking-wide">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-slate-50 dark:bg-vault-950 border border-slate-200 dark:border-vault-700 px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-vault-500 transition-colors"
            />
          </div>
          {error && <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-vault-500 dark:hover:bg-vault-400 transition-colors text-white text-sm font-medium py-2.5 shadow-md disabled:opacity-50 mt-2"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="mt-8 bg-slate-100 dark:bg-vault-900/60 border border-slate-200 dark:border-vault-800 rounded-2xl p-5 shadow-inner">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-vault-400 mb-3">Demo accounts (password: Demo@1234)</p>
          <div className="grid grid-cols-1 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                onClick={() => setEmail(acc.email)}
                className="text-left text-xs font-medium text-slate-700 dark:text-vault-200 hover:bg-white dark:hover:bg-slate-100 dark:bg-vault-800 border border-transparent hover:border-slate-300 dark:hover:border-slate-300 dark:border-vault-700 shadow-sm hover:shadow-md rounded-lg px-3 py-2 transition-all"
              >
                {acc.label} &mdash; <span className="text-slate-400 dark:text-vault-400 font-normal">{acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
