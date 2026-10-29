import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { establishSession, jsonBody, method, webauthnConfig } from "../../../src/server/http.js";
import { getSql } from "../../../src/server/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "POST")) return;
  const body = jsonBody(req);
  if (
    typeof body?.challenge !== "string" ||
    !body.credential ||
    typeof body.credential !== "object"
  ) {
    res.status(400).json({ error: "로그인 응답 형식이 올바르지 않습니다." });
    return;
  }
  const sql = getSql();
  const challenges = await sql`
    DELETE FROM auth_challenges
    WHERE challenge = ${body.challenge} AND flow = 'login' AND expires_at > now()
    RETURNING challenge, account_id
  `;
  if (challenges.length === 0) {
    res.status(401).json({ error: "질문이 만료되었거나 이미 사용되었습니다. 다시 시작하세요." });
    return;
  }
  const accountId = String(challenges[0].account_id);
  const credentialResponse = body.credential as { id?: unknown };
  if (typeof credentialResponse.id !== "string") {
    res.status(400).json({ error: "패스키 식별자가 없습니다." });
    return;
  }
  const credentials = await sql`
    SELECT credential_id, public_key, counter, transports
    FROM passkey_credentials
    WHERE credential_id = ${credentialResponse.id} AND account_id = ${accountId}
    LIMIT 1
  `;
  if (credentials.length === 0) {
    res.status(401).json({ error: "해당 계정에 등록된 패스키가 아닙니다." });
    return;
  }

  const stored = credentials[0];
  const { origin, rpID } = webauthnConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: String(challenges[0].challenge),
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: String(stored.credential_id),
        publicKey: new Uint8Array(Buffer.from(String(stored.public_key), "base64url")),
        counter: Number(stored.counter),
        transports: stored.transports as AuthenticatorTransport[],
      },
      requireUserVerification: true,
    });
  } catch {
    res.status(401).json({ error: "패스키 서명을 확인할 수 없습니다." });
    return;
  }
  if (!verification.verified) {
    res.status(401).json({ error: "패스키 서명이 유효하지 않습니다." });
    return;
  }
  await sql`
    UPDATE passkey_credentials
    SET counter = ${verification.authenticationInfo.newCounter}
    WHERE credential_id = ${String(stored.credential_id)} AND account_id = ${accountId}
  `;
  await establishSession(accountId, res);
  res.status(200).json({ verified: true });
}
