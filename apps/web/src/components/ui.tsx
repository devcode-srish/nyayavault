import React from "react";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="px-8 pt-10 pb-6 border-b border-slate-200/50 dark:border-vault-800/50 bg-gradient-to-b from-white to-slate-50/50 dark:from-vault-900/50 dark:to-transparent">
      <h1 className="text-3xl font-bold gradient-text tracking-tight animate-float" style={{ animation: "none", transform: "none" }}>{title}</h1>
      {subtitle && <p className="text-sm text-slate-500 dark:text-vault-400 mt-2 font-medium">{subtitle}</p>}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
      <p className="text-xs text-slate-500 dark:text-vault-400 uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2 font-mono">{value}</p>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl p-6">
      <p className="text-sm font-semibold text-slate-800 dark:text-white mb-4 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

export function Badge({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "warn" | "danger" | "good" }) {
  const tones: Record<string, string> = {
    neutral: "bg-slate-100/80 text-slate-700 dark:bg-vault-800/80 dark:text-vault-200 border border-slate-200/50 dark:border-vault-700/50",
    warn: "bg-amber-50/80 text-amber-700 border border-amber-200/50 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-amber-400",
    danger: "bg-red-50/80 text-red-700 border border-red-200/50 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400",
    good: "bg-emerald-50/80 text-emerald-700 border border-emerald-200/50 dark:border-emerald-900/30 dark:bg-emerald-900/20 dark:text-emerald-400",
  };
  return <span className={`text-[11px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider ${tones[tone]} shadow-sm backdrop-blur-sm`}>{text}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="p-8 text-center bg-slate-50/50 dark:bg-vault-900/20 rounded-xl border border-dashed border-slate-200 dark:border-vault-800">
      <p className="text-sm text-slate-500 dark:text-vault-500 font-medium">{text}</p>
    </div>
  );
}
