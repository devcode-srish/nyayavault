import React from "react";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="px-8 pt-8 pb-4 border-b border-slate-200 dark:border-vault-800">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-slate-500 dark:text-vault-400 mt-1">{subtitle}</p>}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-xl p-4 shadow-sm">
      <p className="text-xs text-slate-500 dark:text-vault-400 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 dark:text-white mt-1">{value}</p>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-vault-900 border border-slate-200 dark:border-vault-800 rounded-xl p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">{title}</p>
      {children}
    </div>
  );
}

export function Badge({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "warn" | "danger" | "good" }) {
  const tones: Record<string, string> = {
    neutral: "bg-slate-100 text-slate-700 dark:bg-vault-800 dark:text-vault-200",
    warn: "bg-amber-50 text-amber-700 border border-amber-200 dark:border-transparent dark:bg-amber-900/40 dark:text-amber-300",
    danger: "bg-red-50 text-red-700 border border-red-200 dark:border-transparent dark:bg-red-900/40 dark:text-red-300",
    good: "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:border-transparent dark:bg-emerald-900/40 dark:text-emerald-300",
  };
  return <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${tones[tone]}`}>{text}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-slate-500 dark:text-vault-500 italic">{text}</p>;
}
