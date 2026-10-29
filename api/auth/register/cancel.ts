import type { VercelRequest, VercelResponse } from "@vercel/node";
import { jsonBody, method } from "../../../src/server/http.js";
import { getSql } from "../../../src/server/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "POST")) return;
  const body = jsonBody(req);
  if (typeof body?.challenge !== "string") {
    res.status(400).json({ error: "취소할 질문 값이 없습니다." });
    return;
  }
  const sql = getSql();
  await sql`DELETE FROM auth_challenges WHERE challenge = ${body.challenge}`;
  res.status(204).end();
}
