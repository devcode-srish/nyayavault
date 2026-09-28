import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import UsersPage from "./pages/Users";
import ComingSoon from "./pages/ComingSoon";
import Cases from "./pages/Cases";
import CaseDetail from "./pages/CaseDetail";
import Documents from "./pages/Documents";
import DocumentDetail from "./pages/DocumentDetail";
import Audit from "./pages/Audit";
import AccessRequests from "./pages/AccessRequests";
import Notifications from "./pages/Notifications";
import Evidence from "./pages/Evidence";
import EvidenceDetail from "./pages/EvidenceDetail";
import SharePublic from "./pages/SharePublic";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/share/:token" element={<SharePublic />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/documents/:id" element={<DocumentDetail />} />
            <Route path="/evidence" element={<Evidence />} />
            <Route path="/evidence/:id" element={<EvidenceDetail />} />
            <Route path="/ai" element={<ComingSoon title="AI Case Assistant" phase="Phase 5" />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/access-requests" element={<AccessRequests />} />
            <Route path="/signatures" element={<ComingSoon title="Signatures" phase="Phase 4" />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/security" element={<ComingSoon title="Security Center" phase="Phase 4" />} />
            <Route path="/settings" element={<ComingSoon title="Settings" phase="Phase 6" />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
