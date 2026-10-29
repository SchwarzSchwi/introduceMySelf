import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentSession, method } from "../../src/server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "GET")) return;
  const session = await currentSession(req, res);
  if (!session) return;
  const accounts = await session.sql`
    SELECT display_name FROM accounts WHERE id = ${session.accountId} LIMIT 1
  `;
  if (accounts.length === 0) {
    res.status(401).json({ error: "계정을 확인할 수 없습니다." });
    return;
  }
  res.status(200).json({ authenticated: true, accountName: String(accounts[0].display_name) });
}
