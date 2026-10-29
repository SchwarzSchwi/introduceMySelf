import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSessionCookie, hashToken, method } from "../../src/server/http.js";
import { getSql } from "../../src/server/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "POST")) return;
  const token = req.cookies.passkey_session;
  if (token) {
    const sql = getSql();
    await sql`DELETE FROM auth_sessions WHERE token_hash = ${hashToken(token)}`;
  }
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(204).end();
}
