import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentSession, establishSession, jsonBody, method, webauthnConfig } from "../../../src/server/http.js";
import { getSql } from "../../../src/server/db.js";

type PrivateItemInput = { title: string; content: string };

function validItems(value: unknown): PrivateItemInput[] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const items: PrivateItemInput[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") return null;
    const { title, content } = item as Record<string, unknown>;
    if (
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.trim().length > 80 ||
      typeof content !== "string" ||
      content.trim().length === 0 ||
      content.trim().length > 500
    ) return null;
    items.push({ title: title.trim() || `비공개 항목 ${index + 1}`, content: content.trim() });
  }
  return items;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, "POST")) return;
  const body = jsonBody(req);
  if (
    typeof body?.challenge !== "string" ||
    !body.credential ||
    typeof body.credential !== "object"
  ) {
    res.status(400).json({ error: "등록 응답 형식이 올바르지 않습니다." });
    return;
  }

  const sql = getSql();
  const challenges = await sql`
    DELETE FROM auth_challenges
    WHERE challenge = ${body.challenge} AND expires_at > now()
      AND flow IN ('register-new', 'register-add')
    RETURNING challenge, flow, account_id, account_name, credential_name, session_hash
  `;
  if (challenges.length === 0) {
    res.status(401).json({ error: "질문이 만료되었거나 이미 사용되었습니다. 다시 시작하세요." });
    return;
  }
  const challenge = challenges[0];
  const flow = String(challenge.flow);

  if (flow === "register-add") {
    const session = await currentSession(req, res);
    if (!session) return;
    if (session.accountId !== String(challenge.account_id) || session.tokenHash !== challenge.session_hash) {
      res.status(403).json({ error: "등록을 시작한 계정 세션이 아닙니다." });
      return;
    }
  }

  let items: PrivateItemInput[] | null = null;
  if (flow === "register-new") {
    items = validItems(body.privateItems);
    if (!items) {
      res.status(400).json({ error: "첫 등록에는 비공개 항목 세 개를 모두 입력해야 합니다." });
      return;
    }
  }

  const { origin, rpID } = webauthnConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: String(challenge.challenge),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    res.status(401).json({ error: "패스키 등록 서명을 확인할 수 없습니다." });
    return;
  }
  if (!verification.verified || !verification.registrationInfo) {
    res.status(401).json({ error: "패스키 등록 서명이 유효하지 않습니다." });
    return;
  }

  const info = verification.registrationInfo;
  const credentialId = info.credential.id;
  const publicKey = Buffer.from(info.credential.publicKey).toString("base64url");
  const counter = info.credential.counter;
  const transports = JSON.stringify(info.credential.transports ?? []);
  const accountId = String(challenge.account_id);
  let inserted;

  if (flow === "register-new" && items) {
    inserted = await sql`
      WITH new_account AS (
        INSERT INTO accounts (id, display_name)
        VALUES (${accountId}, ${String(challenge.account_name)})
        ON CONFLICT DO NOTHING
        RETURNING id
      ),
      new_credential AS (
        INSERT INTO passkey_credentials
          (credential_id, account_id, credential_name, public_key, counter, transports)
        SELECT ${credentialId}, id, ${String(challenge.credential_name)}, ${publicKey}, ${counter}, ${transports}::jsonb
        FROM new_account
        ON CONFLICT (credential_id) DO NOTHING
        RETURNING account_id
      ),
      new_items AS (
        INSERT INTO private_items (account_id, title, content)
        SELECT new_credential.account_id, item.title, item.content
        FROM new_credential
        CROSS JOIN jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS item(title text, content text)
        RETURNING id
      )
      SELECT account_id FROM new_credential
    `;
  } else {
    inserted = await sql`
      INSERT INTO passkey_credentials
        (credential_id, account_id, credential_name, public_key, counter, transports)
      SELECT ${credentialId}, id, ${String(challenge.credential_name)}, ${publicKey}, ${counter}, ${transports}::jsonb
      FROM accounts WHERE id = ${accountId}
      ON CONFLICT (credential_id) DO NOTHING
      RETURNING account_id
    `;
  }

  if (inserted.length === 0) {
    res.status(409).json({ error: "계정 또는 패스키를 저장하지 못했습니다. 계정 이름을 확인하고 다시 시도하세요." });
    return;
  }
  await establishSession(accountId, res);
  res.status(201).json({ verified: true });
}
