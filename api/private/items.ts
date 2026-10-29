import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentSession, method } from "../../src/server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "GET")) return;
  const session = await currentSession(req, res);
  if (!session) return;
  const items = await session.sql`
    SELECT id, title, content, created_at
    FROM private_items
    WHERE account_id = ${session.accountId}
    ORDER BY id
  `;
  res.status(200).json(items);
}
