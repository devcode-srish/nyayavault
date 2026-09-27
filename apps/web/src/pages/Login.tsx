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
    <div className="min-h-screen flex items-center justify-center bg-vault-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <ShieldCheck className="text-vault-300" size={28} />
          <h1 className="text-2xl font-semibold tracking-tight text-white">NyayaVault</h1>
        </div>
        <p className="text-center text-vault-400 text-sm mb-6">
          Secure Digital Document Management &mdash; DEMO / SYNTHETIC DATA (SIH26190)
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-vault-900 border border-vault-800 rounded-xl p-6 space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-vault-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-vault-950 border border-vault-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-vault-500"
              placeholder="officer@nyayavault.demo"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-vault-300 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-vault-950 border border-vault-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-vault-500"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-vault-500 hover:bg-vault-400 transition text-white text-sm font-medium py-2 disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="mt-6 bg-vault-900/60 border border-vault-800 rounded-xl p-4">
          <p className="text-xs text-vault-400 mb-2">Demo accounts (password: Demo@1234)</p>
          <div className="grid grid-cols-1 gap-1">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                onClick={() => setEmail(acc.email)}
                className="text-left text-xs text-vault-200 hover:text-white hover:bg-vault-800 rounded px-2 py-1 transition"
              >
                {acc.label} &mdash; <span className="text-vault-400">{acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
