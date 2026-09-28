import React from "react";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="px-8 pt-8 pb-4 border-b border-vault-800">
      <h1 className="text-xl font-semibold text-white">{title}</h1>
      {subtitle && <p className="text-sm text-vault-400 mt-1">{subtitle}</p>}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-vault-900 border border-vault-800 rounded-xl p-4">
      <p className="text-xs text-vault-400">{label}</p>
      <p className="text-2xl font-semibold text-white mt-1">{value}</p>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-vault-900 border border-vault-800 rounded-xl p-4">
      <p className="text-sm font-medium text-white mb-3">{title}</p>
      {children}
    </div>
  );
}

export function Badge({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "warn" | "danger" | "good" }) {
  const tones: Record<string, string> = {
    neutral: "bg-vault-800 text-vault-200",
    warn: "bg-amber-900/40 text-amber-300",
    danger: "bg-red-900/40 text-red-300",
    good: "bg-emerald-900/40 text-emerald-300",
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${tones[tone]}`}>{text}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-vault-500 italic">{text}</p>;
}
