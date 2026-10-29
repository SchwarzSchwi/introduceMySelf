import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentSession, method } from "../../src/server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "GET")) return;
  const session = await currentSession(req, res);
  if (!session) return;
  const credentials = await session.sql`
    SELECT credential_id AS id, credential_name AS name, created_at
    FROM passkey_credentials
    WHERE account_id = ${session.accountId}
    ORDER BY created_at
  `;
  res.status(200).json({ credentials });
}
