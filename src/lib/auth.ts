import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import { env } from "../config/env";

export const SESSION_COOKIE = "bad_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

type SessionPayload = { vendorId: string };

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "30d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as SessionPayload;
  } catch {
    return null;
  }
}

// httpOnly so a script on the page can't read it; sameSite "lax" is enough
// since the browser only ever talks to its own origin (the web app proxies
// /api/* to the API — see before-you-dispatch-web's next.config.ts) or, for
// a raw API-to-API call, isn't a cross-site form/link submission anyway.
export function setSessionCookie(res: Response, vendorId: string) {
  res.cookie(SESSION_COOKIE, signSession({ vendorId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
  });
}

export function vendorIdFromRequest(req: Request): string | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string") return null;
  return verifySession(token)?.vendorId ?? null;
}
