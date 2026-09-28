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
import adminRoutes from "./routes/admin.routes";
import signaturesRoutes from "./routes/signatures.routes";
import { startExpiryScheduler } from "./jobs/scheduler";

const app = express();

app.use(helmet());
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
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later." },
});

// Public share links get their own, tighter limit (they need no login).
const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
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
app.use("/api/evidence", evidenceRoutes);
app.use("/api/share", shareLimiter, shareRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/signatures", signaturesRoutes);

// Central error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`NyayaVault API listening on http://localhost:${PORT}`);
  // Start background scheduler if enabled
  startExpiryScheduler();
});
