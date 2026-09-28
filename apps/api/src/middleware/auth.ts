import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, AccessTokenPayload } from "../lib/tokens";
import { Role } from "@prisma/client";

// Augment Express Request with the authenticated user payload.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

/**
 * requireAuth verifies the Bearer access token on every protected route.
 * This is the FIRST line of backend authorization — it never relies on the
 * frontend having hidden a button. Any request without a valid token is
 * rejected with 401 before it reaches a controller.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
}

/**
 * requireRole enforces RBAC on the backend. Even if a role's UI never
 * renders a button for a restricted action, calling the API directly with
 * a token for a disallowed role returns 403 here — RBAC is never
 * UI-only in this system.
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    if (!allowedRoles.includes(req.user.role as Role)) {
      return res.status(403).json({
        error: "Forbidden: your role does not have access to this resource",
      });
    }
    return next();
  };
}

/**
 * optionalAuth extracts and attaches req.user if a valid Bearer token is provided,
 * but allows unauthenticated requests to proceed.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length);
    try {
      const payload = verifyAccessToken(token);
      req.user = payload;
    } catch {
      // ignore invalid token for optional auth
    }
  }
  return next();
}
