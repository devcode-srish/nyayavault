import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader, EmptyState } from "../components/ui";

export default function Notifications() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { data } = await api.get("/notifications");
      setItems(data.notifications);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      load();
    }
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api.post("/notifications/read-all");
    } catch {
      load();
    }
  }

  const unread = items.filter((n) => !n.isRead).length;

  return (
    <div>
      <PageHeader title="Notifications" subtitle={unread > 0 ? `${unread} unread` : "All caught up"} />
      <div className="p-8 max-w-3xl">
        {loading && <p className="text-vault-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!loading && items.length === 0 && <EmptyState text="No notifications yet." />}
        {unread > 0 && (
          <button onClick={markAllRead} className="text-xs text-vault-300 hover:text-white hover:underline mb-3">
            Mark all as read
          </button>
        )}
        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              onClick={() => !n.isRead && markRead(n.id)}
              className={`rounded-xl border p-4 cursor-pointer ${
                n.isRead ? "bg-vault-900/50 border-vault-800" : "bg-vault-900 border-vault-600"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`text-sm ${n.isRead ? "text-vault-300" : "text-white font-medium"}`}>{n.title}</p>
                  <p className="text-sm text-vault-400 mt-0.5">{n.message}</p>
                  {n.type === "ACCESS_REQUEST" && (
                    <Link to="/access-requests" className="text-xs text-vault-300 hover:text-white hover:underline mt-1 inline-block">
                      Review requests
                    </Link>
                  )}
                  {(n.type === "ACCESS_APPROVED" || n.type === "ACCESS_REJECTED") && (
                    <Link to="/access-requests" className="text-xs text-vault-300 hover:text-white hover:underline mt-1 inline-block">
                      View my requests
                    </Link>
                  )}
                </div>
                <span className="text-xs text-vault-500 whitespace-nowrap">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
