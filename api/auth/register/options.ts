import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { optionalSession, jsonBody, method, boundedText, randomAccountId, webauthnConfig } from "../../../src/server/http.js";
import { getSql } from "../../../src/server/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "POST")) return;
  const body = jsonBody(req);
  const credentialName = boundedText(body?.credentialName, 60);
  if (!credentialName) {
    res.status(400).json({ error: "패스키 이름을 1~60자로 입력하세요." });
    return;
  }

  const session = await optionalSession(req, res);
  let accountId: string;
  let accountName: string;
  let flow: "register-new" | "register-add";
  let sessionHash: string | null = null;
  const sql = getSql();

  if (session) {
    const accounts = await sql`SELECT display_name FROM accounts WHERE id = ${session.accountId} LIMIT 1`;
    if (accounts.length === 0) {
      res.status(401).json({ error: "계정을 확인할 수 없습니다." });
      return;
    }
    accountId = session.accountId;
    accountName = String(accounts[0].display_name);
    flow = "register-add";
    sessionHash = session.tokenHash;
  } else {
    const requestedName = boundedText(body?.accountName, 60);
    if (!requestedName) {
      res.status(400).json({ error: "새 계정 이름을 1~60자로 입력하세요." });
      return;
    }
    const existing = await sql`
      SELECT id FROM accounts WHERE lower(display_name) = lower(${requestedName}) LIMIT 1
    `;
    if (existing.length > 0) {
      res.status(409).json({ error: "이미 사용 중인 계정 이름입니다. 해당 계정으로 로그인하세요." });
      return;
    }
    accountId = randomAccountId();
    accountName = requestedName;
    flow = "register-new";
  }

  const { rpID, rpName } = webauthnConfig();
  const existingCredentials = await sql`
    SELECT credential_id, transports FROM passkey_credentials WHERE account_id = ${accountId}
  `;
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(accountId, "base64url"),
    userName: accountName,
    userDisplayName: accountName,
    attestationType: "none",
    preferredAuthenticatorType: "localDevice",
    excludeCredentials: existingCredentials.map((credential) => ({
      id: String(credential.credential_id),
      transports: credential.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  await sql`
    DELETE FROM auth_challenges WHERE expires_at <= now()
  `;
  await sql`
    INSERT INTO auth_challenges
      (challenge, flow, account_id, account_name, credential_name, session_hash, expires_at)
    VALUES
      (${options.challenge}, ${flow}, ${accountId}, ${accountName}, ${credentialName}, ${sessionHash},
       now() + interval '5 minutes')
  `;
  res.status(200).json(options);
}
