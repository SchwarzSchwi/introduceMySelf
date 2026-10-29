import { createHash, randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "./db.js";

export function method(req: VercelRequest, res: VercelResponse, expected: string) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== expected) {
    res.setHeader("Allow", expected);
    res.status(405).json({ error: "지원하지 않는 요청 방식입니다." });
    return false;
  }
  return true;
}

export function jsonBody(req: VercelRequest): Record<string, unknown> | null {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return null;
  return req.body as Record<string, unknown>;
}

export function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

export function webauthnConfig() {
  const origin = process.env.WEBAUTHN_ORIGIN;
  const rpID = process.env.WEBAUTHN_RP_ID;
  if (!origin || !rpID) throw new Error("WebAuthn origin configuration is missing");
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.hostname !== rpID) {
    throw new Error("WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID do not match");
  }
  return { origin, rpID, rpName: "자기소개 - 비공개 취향" };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function currentSession(req: VercelRequest, res: VercelResponse) {
  const session = await optionalSession(req, res);
  if (!session) {
    res.status(401).json({ error: "패스키 로그인이 필요합니다." });
    return null;
  }
  return session;
}

export async function optionalSession(req: VercelRequest, res: VercelResponse) {
  const token = req.cookies.passkey_session;
  if (!token || token.length > 200) {
    return null;
  }
  const tokenHash = hashToken(token);
  const sql = getSql();
  const rows = await sql`
    SELECT account_id
    FROM auth_sessions
    WHERE token_hash = ${tokenHash} AND expires_at > now()
    LIMIT 1
  `;
  if (rows.length === 0) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return null;
  }
  return { accountId: String(rows[0].account_id), tokenHash, sql };
}

export function sessionCookie(token: string) {
  const secure = process.env.WEBAUTHN_ORIGIN?.startsWith("https://");
  return `passkey_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie() {
  const secure = process.env.WEBAUTHN_ORIGIN?.startsWith("https://");
  return `passkey_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function establishSession(accountId: string, res: VercelResponse) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const sql = getSql();
  await sql`
    INSERT INTO auth_sessions (token_hash, account_id, expires_at)
    VALUES (${tokenHash}, ${accountId}, now() + interval '8 hours')
  `;
  res.setHeader("Set-Cookie", sessionCookie(token));
}

export function randomAccountId() {
  return randomBytes(32).toString("base64url");
}
