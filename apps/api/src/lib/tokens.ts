import jwt from "jsonwebtoken";
import crypto from "crypto";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET as string;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in .env"
  );
}

export interface AccessTokenPayload {
  sub: string; // user id
  role: string;
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

// Refresh tokens are random opaque strings stored (hashed not required for
// demo scope, but we store them server-side so they can be revoked) in the
// RefreshToken table — NOT JWTs — so they can be invalidated individually.
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function refreshTokenExpiryDate(): Date {
  const days = parseInt(REFRESH_EXPIRES_IN.replace("d", ""), 10) || 7;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
