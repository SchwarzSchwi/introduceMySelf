import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentSession, method } from "../../src/server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "DELETE")) return;
  const session = await currentSession(req, res);
  if (!session) return;
  const credentialId = req.query.credentialId;
  if (typeof credentialId !== "string" || credentialId.length > 200) {
    res.status(400).json({ error: "패스키 식별자가 올바르지 않습니다." });
    return;
  }
  const deleted = await session.sql`
    DELETE FROM passkey_credentials
    WHERE credential_id = ${credentialId} AND account_id = ${session.accountId}
    RETURNING credential_id
  `;
  if (deleted.length === 0) {
    res.status(404).json({ error: "이 계정에서 해당 패스키를 찾을 수 없습니다." });
    return;
  }
  const remaining = await session.sql`
    SELECT count(*)::int AS count FROM passkey_credentials WHERE account_id = ${session.accountId}
  `;
  res.status(200).json({
    remaining: Number(remaining[0].count),
    message: Number(remaining[0].count) === 0
      ? "패스키가 없습니다. 지금 로그인 세션을 닫으면 이 계정에 다시 로그인할 수 없습니다."
      : "패스키를 삭제했습니다.",
  });
}
