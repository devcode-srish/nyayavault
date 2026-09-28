import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ShieldCheck, Lock } from "lucide-react";
import { api } from "../lib/api";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Public page: no login. Reached through a secure share link.
export default function SharePublic() {
  const { token } = useParams();
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  function fetchMetadata(pin?: string) {
    setLoading(true);
    setPinError(null);
    const headers: Record<string, string> = {};
    if (pin) headers["x-share-pin"] = pin;

    api
      .get(`/share/${token}`, { headers })
      .then(({ data }) => {
        setInfo(data.share);
        setPinRequired(false);
      })
      .catch((e) => {
        const resData = e?.response?.data;
        if (e?.response?.status === 401 && resData?.requiresPin) {
          setPinRequired(true);
          if (pin) setPinError("Incorrect PIN. Please try again.");
        } else {
          setError(resData?.error || "This link is not valid.");
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchMetadata();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!enteredPin) return;
    fetchMetadata(enteredPin);
  }

  async function download() {
    setBusy(true);
    setDlError(null);
    try {
      const headers: Record<string, string> = {};
      if (enteredPin) headers["x-share-pin"] = enteredPin;

      const res = await api.get(`/share/${token}/download`, {
        headers,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = info.fileName;
      a.click();
      window.URL.revokeObjectURL(url);
      setDownloaded(true);
      setInfo({ ...info, usesRemaining: info.usesRemaining - 1 });
    } catch (err: any) {
      let msg = "Download failed";
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try {
          msg = JSON.parse(await data.text()).error || msg;
        } catch {
          /* keep default */
        }
      }
      setDlError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-vault-950 px-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <ShieldCheck className="text-vault-300" size={26} />
          <h1 className="text-xl font-semibold text-white">NyayaVault &mdash; Secure Share</h1>
        </div>

        <div className="bg-vault-900 border border-vault-800 rounded-xl p-6">
          {loading && <p className="text-vault-400 text-sm">Checking link...</p>}
          {error && <p className="text-red-400 text-sm">{error}</p>}

          {pinRequired && !loading && !error && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-vault-300">
                <Lock size={20} />
                <h2 className="text-sm font-semibold text-white">PIN Protection Required</h2>
              </div>
              <p className="text-xs text-vault-400">
                This secure share link requires a security PIN set by the sender to unlock document details and download access.
              </p>
              <form onSubmit={handlePinSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs text-vault-400 mb-1">Enter Security PIN</label>
                  <input
                    type="password"
                    maxLength={8}
                    value={enteredPin}
                    onChange={(e) => setEnteredPin(e.target.value)}
                    placeholder="Enter PIN"
                    className="w-full rounded-lg bg-vault-950 border border-vault-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-vault-500"
                    autoFocus
                  />
                </div>
                {pinError && <p className="text-xs text-red-400">{pinError}</p>}
                <button
                  type="submit"
                  disabled={!enteredPin || loading}
                  className="w-full rounded-lg bg-vault-500 hover:bg-vault-400 transition text-white text-sm font-medium py-2 disabled:opacity-50"
                >
                  Unlock Document
                </button>
              </form>
            </div>
          )}

          {info && !pinRequired && (
            <>
              <p className="text-white font-medium">{info.name}</p>
              <p className="text-xs text-vault-400 mt-1">
                {info.fileName} &middot; {formatSize(info.sizeBytes)} &middot; version {info.versionNo}
              </p>
              <dl className="mt-4 space-y-2 text-xs">
                <div>
                  <dt className="text-vault-500">Shared by</dt>
                  <dd className="text-vault-300">{info.sharedBy}</dd>
                </div>
                <div>
                  <dt className="text-vault-500">Link expires</dt>
                  <dd className="text-vault-300">{new Date(info.expiresAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-vault-500">Downloads remaining</dt>
                  <dd className="text-vault-300">{info.usesRemaining}</dd>
                </div>
                <div>
                  <dt className="text-vault-500">SHA-256 (compare after download)</dt>
                  <dd className="text-vault-300 break-all">{info.sha256}</dd>
                </div>
              </dl>

              {info.usesRemaining > 0 ? (
                <button
                  onClick={download}
                  disabled={busy}
                  className="mt-5 w-full rounded-lg bg-vault-500 hover:bg-vault-400 transition text-white text-sm font-medium py-2 disabled:opacity-50"
                >
                  {busy ? "Preparing..." : "Download"}
                </button>
              ) : (
                <p className="mt-5 text-sm text-vault-400">This link has no downloads remaining.</p>
              )}
              {downloaded && <p className="mt-3 text-xs text-emerald-300">Download started.</p>}
              {dlError && <p className="mt-3 text-sm text-red-400">{dlError}</p>}
            </>
          )}
        </div>
        <p className="text-center text-xs text-vault-600 mt-4">DEMO / SYNTHETIC DATA &mdash; SIH26190 prototype</p>
      </div>
    </div>
  );
}
