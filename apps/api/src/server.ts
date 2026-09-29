import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import usersRoutes from "./routes/users.routes";
import casesRoutes from "./routes/cases.routes";
import documentsRoutes from "./routes/documents.routes";
import auditRoutes from "./routes/audit.routes";
import accessRequestsRoutes from "./routes/accessRequests.routes";
import notificationsRoutes from "./routes/notifications.routes";
import evidenceRoutes from "./routes/evidence.routes";
import shareRoutes from "./routes/share.routes";
// import adminRoutes from "./routes/admin.routes"; // TODO: file missing from repo, ask Aryan 
import signaturesRoutes from "./routes/signatures.routes";
import integrityRoutes from "./routes/integrity.routes";
// import { startExpiryScheduler } from "./jobs/scheduler"; // TODO: file missing from repo, ask Aryan
import { validateEncryptionConfig } from "./lib/encryption";

const app = express();

app.use(
  helmet({
    referrerPolicy: { policy: "no-referrer" },
  })
);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));

// Basic global rate limit. Auth gets a tighter one to slow brute force.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: process.env.NODE_ENV === "production" ? 300 : 5000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "production" ? 20 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later." },
});

// Public share links get their own, tighter limit (they need no login).
const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "production" ? 60 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Public evidence verification rate limiter (anti-enumeration & anti-oracle protection)
const evidenceVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "production" ? 60 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification requests, please try again later." },
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nyayavault-api", time: new Date().toISOString() });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/cases", casesRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/access-requests", accessRequestsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/evidence", evidenceVerifyLimiter, evidenceRoutes);
app.use("/api/share", shareLimiter, shareRoutes);
// app.use("/api/admin", adminRoutes); // TODO: file missing from repo, ask Aryan 
app.use("/api/signatures", signaturesRoutes);
app.use("/api/integrity", integrityRoutes);

// Central error handler with bearer token redaction
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const safeUrl = req.originalUrl
    ?.replace(/token=[a-f0-9]{64}/gi, "token=[REDACTED]")
    ?.replace(/\/verify\/[a-f0-9]{64}/gi, "/verify/[REDACTED]");
  const errMsg = err instanceof Error ? err.stack || err.message : String(err);
  const sanitizedErr = errMsg.replace(/[a-f0-9]{64}/gi, "[REDACTED_TOKEN]");

  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${req.method} ${safeUrl}:`, sanitizedErr);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
app.listen(PORT, () => {
  // Validate cryptographic encryption setup
  const encConfig = validateEncryptionConfig();
  // eslint-disable-next-line no-console
  console.log(
    `NyayaVault API listening on http://localhost:${PORT} [AES-256-GCM Config: ${
      encConfig.hasCustomSecret ? "Custom Secret" : "Derived Secret"
    }, Rotation Keys: ${encConfig.rotationKeysConfigured}]`
  );
  // Start background scheduler if enabled
   // startExpiryScheduler(); // TODO: file missing from repo, ask Aryan
});
