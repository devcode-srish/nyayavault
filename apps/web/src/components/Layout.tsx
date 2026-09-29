import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ShieldCheck,
  LayoutDashboard,
  FolderKanban,
  FileText,
  Fingerprint,
  BrainCircuit,
  ScrollText,
  KeyRound,
  PenTool,
  Bell,
  Users,
  ShieldAlert,
  Settings,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { useAuth, Role } from "../context/AuthContext";
import { api } from "../lib/api";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  roles: Role[];
}

const ALL: Role[] = ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "FORENSIC_OFFICER", "LEGAL_OFFICER"];

// This list only decides which links are SHOWN. It is a convenience, not the
// security boundary: every page calls an API that enforces RBAC on the server.
const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
  { to: "/cases", label: "Cases", icon: FolderKanban, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "LEGAL_OFFICER"] },
  { to: "/documents", label: "Documents", icon: FileText, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "LEGAL_OFFICER"] },
  { to: "/evidence", label: "Evidence", icon: Fingerprint, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "FORENSIC_OFFICER"] },
  { to: "/ai", label: "AI Assistant", icon: BrainCircuit, roles: ["INVESTIGATING_OFFICER", "SENIOR_OFFICER"] },
  { to: "/audit", label: "Audit Log", icon: ScrollText, roles: ["ADMIN", "SENIOR_OFFICER"] },
  { to: "/access-requests", label: "Access Requests", icon: KeyRound, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "LEGAL_OFFICER"] },
  { to: "/signatures", label: "Signatures", icon: PenTool, roles: ["SENIOR_OFFICER", "LEGAL_OFFICER"] },
  { to: "/notifications", label: "Notifications", icon: Bell, roles: ALL },
  { to: "/users", label: "Users", icon: Users, roles: ["ADMIN"] },
  { to: "/security", label: "Security", icon: ShieldAlert, roles: ["ADMIN"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ALL },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  
  // Theme Toggle Logic
  const [isDark, setIsDark] = useState(() => {
    // Default to light mode for government feel, unless user previously selected dark
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  // Refresh the unread badge on every navigation and every 30 seconds.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchCount = () =>
      api
        .get("/notifications/unread-count")
        .then(({ data }) => {
          if (!cancelled) setUnread(data.count);
        })
        .catch(() => {});
    fetchCount();
    const timer = setInterval(fetchCount, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user?.id, location.pathname]);

  if (!user) return null;

  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-vault-950 text-slate-900 dark:text-vault-100 transition-colors duration-200">
      <aside className="w-64 shrink-0 bg-white dark:bg-vault-900 border-r border-slate-200 dark:border-vault-800 flex flex-col transition-colors duration-200">
        <div className="flex justify-center px-5 py-6 border-b border-slate-200 dark:border-vault-800 bg-slate-50 dark:bg-vault-950 transition-colors">
          <img src="/logo.png" alt="NyayaVault" className="h-20 object-contain drop-shadow-sm dark:bg-white dark:rounded-xl dark:px-3 dark:py-1 dark:shadow-none" />
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-medium dark:bg-vault-700 dark:text-white dark:font-normal"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-vault-300 dark:hover:bg-vault-800 dark:hover:text-white"
                }`
              }
            >
              <item.icon size={16} />
              <span className="flex-1">{item.label}</span>
              {item.to === "/notifications" && unread > 0 && (
                <span className="text-[10px] bg-blue-600 dark:bg-vault-500 text-white rounded-full px-1.5 py-0.5">{unread}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 dark:border-vault-800 p-3 flex flex-col gap-1">
          <div className="px-2 mb-2">
            <p className="text-sm text-slate-900 dark:text-white truncate font-medium">{user.name}</p>
            <p className="text-xs text-slate-500 dark:text-vault-400">{user.role.replace(/_/g, " ")}</p>
          </div>
          
          <button
            onClick={() => setIsDark(!isDark)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-vault-300 dark:hover:bg-vault-800 dark:hover:text-white transition"
          >
            <div className="flex items-center gap-2">
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
              <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
            </div>
          </button>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-vault-300 dark:hover:bg-vault-800 dark:hover:text-white transition"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
