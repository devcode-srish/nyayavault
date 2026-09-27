import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import UsersPage from "./pages/Users";
import ComingSoon from "./pages/ComingSoon";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/cases" element={<ComingSoon title="Cases" phase="Phase 2" />} />
            <Route path="/cases/:id" element={<ComingSoon title="Case Detail" phase="Phase 2" />} />
            <Route path="/documents" element={<ComingSoon title="Documents" phase="Phase 2" />} />
            <Route path="/documents/:id" element={<ComingSoon title="Document Detail" phase="Phase 2" />} />
            <Route path="/evidence" element={<ComingSoon title="Evidence" phase="Phase 3" />} />
            <Route path="/ai" element={<ComingSoon title="AI Case Assistant" phase="Phase 5" />} />
            <Route path="/audit" element={<ComingSoon title="Audit Log" phase="Phase 2" />} />
            <Route path="/access-requests" element={<ComingSoon title="Access Requests" phase="Phase 3" />} />
            <Route path="/signatures" element={<ComingSoon title="Signatures" phase="Phase 4" />} />
            <Route path="/notifications" element={<ComingSoon title="Notifications" phase="Phase 3" />} />
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
