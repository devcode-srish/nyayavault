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
  { to: "/security", label: "Security", icon: ShieldAlert, roles: ["ADMIN", "SENIOR_OFFICER", "INVESTIGATING_OFFICER"] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  
  // Theme Toggle Logic
  const [isDark, setIsDark] = useState(() => {
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
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0a0f16] text-slate-900 dark:text-vault-100 transition-colors duration-200 relative overflow-hidden">
      
      {/* Absolute Dot Pattern Background */}
      <div className="absolute inset-0 bg-dot-pattern pointer-events-none z-0"></div>

      <aside className="w-64 shrink-0 glass border-r border-slate-200/50 dark:border-[#28374b]/50 flex flex-col transition-colors duration-200 relative z-10 shadow-2xl">
        <div className="flex justify-center px-5 py-6 border-b border-slate-200/50 dark:border-[#28374b]/50 bg-white/40 dark:bg-vault-900/40 backdrop-blur-md transition-colors">
          <img src="/logo.png" alt="NyayaVault" className="h-16 object-contain drop-shadow-md dark:bg-white/90 dark:rounded-xl dark:px-3 dark:py-1 dark:shadow-none hover:scale-105 transition-transform duration-300" />
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1 custom-scrollbar">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 dark:shadow-indigo-900/40 translate-x-1"
                    : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-vault-300 dark:hover:bg-vault-800/50 dark:hover:text-white"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={18} className={isActive ? "animate-pulse" : ""} />
                  <span className="flex-1">{item.label}</span>
                  {item.to === "/notifications" && unread > 0 && (
                    <span className="text-[10px] bg-red-500 text-white font-bold rounded-full px-2 py-0.5 shadow-sm shadow-red-500/40">{unread}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200/50 dark:border-[#28374b]/50 p-4 flex flex-col gap-2 bg-white/30 dark:bg-vault-900/30 backdrop-blur-md">
          <div className="px-2 mb-2">
            <p className="text-sm text-slate-900 dark:text-white truncate font-bold">{user.name}</p>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-blue-600 dark:text-blue-400 mt-0.5">{user.role.replace(/_/g, " ")}</p>
          </div>
          
          <button
            onClick={() => setIsDark(!isDark)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-vault-300 dark:hover:bg-vault-800/50 dark:hover:text-white transition-all"
          >
            <div className="flex items-center gap-2">
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
              <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
            </div>
          </button>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300 transition-all"
          >
            <LogOut size={16} /> Secure Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto relative z-10 transition-all duration-300 ease-in-out">
        {/* Simple fade-in wrapper based on key */}
        <div key={location.pathname} className="animate-fade-in-up">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
