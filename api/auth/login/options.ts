import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { boundedText, jsonBody, method, webauthnConfig } from "../../../src/server/http.js";
import { getSql } from "../../../src/server/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "POST")) return;
  const body = jsonBody(req);
  const accountName = boundedText(body?.accountName, 60);
  if (!accountName) {
    res.status(400).json({ error: "계정 이름을 1~60자로 입력하세요." });
    return;
  }
  const sql = getSql();
  await sql`DELETE FROM auth_sessions WHERE expires_at <= now()`;
  const accounts = await sql`
    SELECT id FROM accounts WHERE lower(display_name) = lower(${accountName}) LIMIT 1
  `;
  if (accounts.length === 0) {
    res.status(401).json({ error: "계정 이름 또는 패스키를 확인할 수 없습니다." });
    return;
  }
  const accountId = String(accounts[0].id);
  const credentials = await sql`
    SELECT credential_id, transports FROM passkey_credentials WHERE account_id = ${accountId}
  `;
  if (credentials.length === 0) {
    res.status(401).json({ error: "이 계정에는 사용할 수 있는 패스키가 없습니다." });
    return;
  }

  const { rpID } = webauthnConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((credential) => ({
      id: String(credential.credential_id),
      transports: credential.transports as AuthenticatorTransport[],
    })),
    userVerification: "required",
  });
  await sql`DELETE FROM auth_challenges WHERE expires_at <= now()`;
  await sql`
    INSERT INTO auth_challenges (challenge, flow, account_id, expires_at)
    VALUES (${options.challenge}, 'login', ${accountId}, now() + interval '5 minutes')
  `;
  res.status(200).json(options);
}
