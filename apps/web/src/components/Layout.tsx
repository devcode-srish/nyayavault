import React from "react";
import { NavLink, Outlet } from "react-router-dom";
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
} from "lucide-react";
import { useAuth, Role } from "../context/AuthContext";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  roles: Role[];
}

// This list is the ONLY thing that differs per role on the frontend — a
// convenience so unauthorized modules don't even appear in navigation.
// It is NOT the security boundary: every one of these routes calls an API
// that separately enforces RBAC server-side (see apps/api/src/middleware/auth.ts).
const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "FORENSIC_OFFICER", "LEGAL_OFFICER"] },
  { to: "/cases", label: "Cases", icon: FolderKanban, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "LEGAL_OFFICER"] },
  { to: "/documents", label: "Documents", icon: FileText, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "LEGAL_OFFICER"] },
  { to: "/evidence", label: "Evidence", icon: Fingerprint, roles: ["ADMIN", "FORENSIC_OFFICER"] },
  { to: "/ai", label: "AI Assistant", icon: BrainCircuit, roles: ["INVESTIGATING_OFFICER", "SENIOR_OFFICER"] },
  { to: "/audit", label: "Audit Log", icon: ScrollText, roles: ["ADMIN", "SENIOR_OFFICER"] },
  { to: "/access-requests", label: "Access Requests", icon: KeyRound, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER"] },
  { to: "/signatures", label: "Signatures", icon: PenTool, roles: ["SENIOR_OFFICER", "LEGAL_OFFICER"] },
  { to: "/notifications", label: "Notifications", icon: Bell, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "FORENSIC_OFFICER", "LEGAL_OFFICER"] },
  { to: "/users", label: "Users", icon: Users, roles: ["ADMIN"] },
  { to: "/security", label: "Security", icon: ShieldAlert, roles: ["ADMIN"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "FORENSIC_OFFICER", "LEGAL_OFFICER"] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <div className="min-h-screen flex bg-vault-950 text-vault-100">
      <aside className="w-64 shrink-0 bg-vault-900 border-r border-vault-800 flex flex-col">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-vault-800">
          <ShieldCheck className="text-vault-300" size={22} />
          <span className="font-semibold tracking-tight text-white">NyayaVault</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                  isActive
                    ? "bg-vault-700 text-white"
                    : "text-vault-300 hover:bg-vault-800 hover:text-white"
                }`
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-vault-800 p-3">
          <div className="px-2 mb-2">
            <p className="text-sm text-white truncate">{user.name}</p>
            <p className="text-xs text-vault-400">{user.role.replace(/_/g, " ")}</p>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-vault-300 hover:bg-vault-800 hover:text-white transition"
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
