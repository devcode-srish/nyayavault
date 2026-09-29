import React, { useState } from "react";
import { api } from "../lib/api";
import { Card } from "./ui";

export default function AIAnalysisPanel({ documentId }: { documentId: string }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post(`/documents/${documentId}/ai-analyze`);
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || "AI Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <Card title="Intelligent Analysis">
      {!result && !analyzing && !error && (
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <p className="text-sm text-slate-500 dark:text-vault-300 mb-4">
            Run an AI analysis to automatically extract entities and generate a summary of this document.
          </p>
          <button
            onClick={handleAnalyze}
            className="rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 transition-all shadow-lg text-white text-sm font-medium px-5 py-2.5"
          >
            Run Intelligent Analysis
          </button>
        </div>
      )}

      {analyzing && (
        <div className="space-y-6 mt-2 animate-pulse">
          <div>
            <div className="h-4 w-32 bg-slate-200 dark:bg-vault-800 rounded mb-4"></div>
            <div className="space-y-2">
              <div className="h-3 w-full bg-slate-100 dark:bg-vault-800/50 rounded"></div>
              <div className="h-3 w-5/6 bg-slate-100 dark:bg-vault-800/50 rounded"></div>
              <div className="h-3 w-4/6 bg-slate-100 dark:bg-vault-800/50 rounded"></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="p-4 rounded-xl bg-slate-50 dark:bg-vault-950/50 border border-slate-100 dark:border-vault-800">
                <div className="h-3 w-20 bg-slate-200 dark:bg-vault-800 rounded mb-4"></div>
                <div className="flex gap-2">
                  <div className="h-6 w-16 bg-indigo-100 dark:bg-indigo-900/40 rounded-md"></div>
                  <div className="h-6 w-24 bg-indigo-100 dark:bg-indigo-900/40 rounded-md"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button onClick={handleAnalyze} className="mt-3 text-xs text-red-600 dark:text-red-200 hover:underline">Try Again</button>
        </div>
      )}

      {result && (
        <div className="space-y-6 mt-2">
          {result.piiDetected && (
            <div className="px-4 py-3 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/50 flex items-start shadow-inner">
              <span className="text-orange-500 dark:text-orange-400 mr-3 text-lg">⚠️</span>
              <div>
                <h4 className="text-sm font-medium text-orange-800 dark:text-orange-300">Sensitive Information Detected</h4>
                <p className="text-xs text-orange-600 dark:text-orange-200/80 mt-1">This document contains PII (e.g. Aadhaar, phone numbers, or minors). Handle with strict confidentiality.</p>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-slate-800 dark:text-vault-200 mb-2 uppercase tracking-wider">Executive Summary</h4>
            <ul className="list-disc pl-5 space-y-2">
              {result.summary.map((point: string, i: number) => (
                <li key={i} className="text-sm text-slate-600 dark:text-vault-300">{point}</li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {Object.entries(result.entities).map(([key, items]: [string, any]) => {
              if (!items || items.length === 0) return null;
              return (
                <div key={key} className="p-4 rounded-xl bg-slate-50 border border-slate-200 dark:bg-vault-950/50 dark:border-vault-800 shadow-sm transition-all hover:shadow-md">
                  <h4 className="text-xs font-semibold text-slate-500 dark:text-vault-400 mb-3 uppercase tracking-wider">{key}</h4>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item: string, i: number) => (
                      <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-800/50 shadow-sm transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/60">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
