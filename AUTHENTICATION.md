# 패스키 인증 및 검증 안내

## 제출 URL

- 결과물 URL: 배포 전 — Vercel 배포 후 HTTPS 주소를 입력해야 합니다.
- 소스 URL: https://github.com/SchwarzSchwi/introduceMySelf

이 저장소에는 실제 개인정보, 비밀번호, 개인키, 세션 토큰이 없습니다. 계정 이름과 비공개 문구는 시연자가 직접 만든 예시 값을 입력합니다. 아래 검증 기록은 실제 배포에서 실행한 뒤 응답과 함께 채워야 하며, 아직 실행하지 않은 결과를 성공 증거로 표시하지 않습니다.

## ① 무엇으로 붙였나

서버 검증에는 `@simplewebauthn/server` 라이브러리를 사용하고, 브라우저에서는 WebAuthn 표준 API (`navigator.credentials.create/get`)를 사용합니다. 인증 서비스 사업자에는 위임하지 않습니다. 브라우저가 서버로 보내는 것은 공개키 등록 자료 또는 서명 응답이며, 패스키 개인키는 인증기(구글 비밀번호 관리자, 기기 자체 또는 보안 키)에 남습니다.

## ② 왜 그걸 골랐나

등록 시 `preferredAuthenticatorType: "localDevice"`로 기기 자체 인증기(Windows Hello 등)를 우선 요청합니다. 서버에는 공개키만 저장되고 개인키는 기기 안에 남습니다. Windows Hello PIN이 설정되지 않은 PC에서는 등록이 실패할 수 있습니다.

Vercel 정적 페이지와 서버리스 함수에서 동작하고, 서버가 challenge·origin·RP ID·서명을 검증하게 하기 위해서입니다. challenge는 5분 만료이며 인증 요청마다 새로 생성됩니다. 등록과 로그인 검증에서 사용자 확인(User Verification)을 요구합니다. 데이터와 공개키, challenge, 세션은 Neon Postgres에 둡니다.

## ③ 어디를 어떻게 고쳤나

| 흐름 | 소스 위치 | 동작 |
|---|---|---|
| 등록 | `app.js`, `api/auth/register/options.ts`, `api/auth/register/verify.ts`, `api/auth/register/cancel.ts` | 서버 challenge 발급·저장, 서명 검증 후 공개키만 저장. 새 계정의 비공개 항목은 검증 성공과 함께 저장. 브라우저 취소 시 challenge 삭제. |
| 로그인 | `app.js`, `api/auth/login/options.ts`, `api/auth/login/verify.ts` | 계정에 등록된 공개키로 새 challenge의 서명을 검증하고, 성공한 뒤에만 세션 쿠키 발급. |
| 로그아웃 | `api/auth/logout.ts`, `src/server/http.ts` | DB의 세션 해시 폐기 및 HttpOnly 쿠키 삭제. |
| 비공개 자료 조회 | `api/private/items.ts`, `api/private/[accountId]/items.ts` | 세션의 계정 ID만 조회에 사용. 미인증 요청은 401, 다른 계정 ID 경로는 403. 쿼리 문자열의 계정 ID는 소유권을 바꾸지 않음. |

Neon에 `db/schema.sql`을 적용하고 Vercel 환경 변수 `DATABASE_URL`, `WEBAUTHN_ORIGIN` (예: `https://your-project.vercel.app`), `WEBAUTHN_RP_ID` (예: `your-project.vercel.app`)를 설정해야 합니다. `WEBAUTHN_ORIGIN`은 프로토콜·호스트가 포함된 origin만 입력하고, RP ID는 해당 호스트와 정확히 일치해야 합니다.

배포 순서: GitHub 저장소를 Vercel에 연결하고 Neon 데이터베이스를 만든 뒤 `db/schema.sql`을 실행합니다. 위 세 환경 변수를 Vercel 프로젝트의 Production 환경에 등록하고 배포합니다. Vercel 도메인이 정해지면 해당 HTTPS origin과 호스트를 환경 변수에 반영한 뒤 다시 배포하고, 결과물 URL과 패스키 저장 위치를 이 문서에 기록합니다.

## ④ 안 열리는 것을 확인한 기록

**아직 미실행.** 이 저장소를 연결한 Vercel 배포와 Neon 데이터베이스가 제공되지 않아 아래 결과를 실제 응답으로 채우지 않았습니다. 각 항목은 시크릿 창에서 시연 계정을 만들고 실행한 뒤 요청 경로, 응답 상태, 자료 건수를 기록하세요. 요청·응답을 공개 제출물에 복사할 때 쿠키, 세션 토큰, `Set-Cookie`, DB 연결 문자열은 반드시 가립니다.

| 확인 | 허용 요청과 응답 | 거절 요청과 응답 | 결과 |
|---|---|---|---|
| 로그인 없이 열기 | 로그인 후 `GET /api/private/items` → `200`, 세 항목 | 쿠키 없이 같은 요청 → `401`, 본문에 항목 없음 | 배포 후 기록 |
| 다른 계정 패스키 | 계정 A의 본인 자료 → `200` | 계정 A 세션으로 `GET /api/private/{계정B_ID}/items` → `403`; 반대 방향도 동일. 두 계정의 항목 수는 요청 전후 동일 | 배포 후 기록 |
| 질문 재사용 | 새 로그인 challenge와 유효 서명 → `200` | 같은 challenge·서명을 다시 제출 → `401` (이미 소비됨) | 배포 후 기록 |
| 삭제된 패스키 | 남은 패스키로 로그인 → `200` | 삭제한 패스키로 새 challenge에 응답 → `401` (계정 공개키를 찾을 수 없음) | 배포 후 기록 |

로그인 성공/실패는 각각 `POST /api/auth/login/verify` 응답으로 나란히 기록합니다. challenge는 `/api/auth/login/options`를 두 번 호출해 서로 다른 `challenge` 값이 반환되는지 기록합니다. 재사용 확인은 첫 검증에서 사용한 같은 challenge를 다시 보내는 경우입니다. 등록 요청 본문은 아래 모양이며, 실제 기록에는 등록 응답값을 넣되 개인키를 포함하거나 기록하지 않습니다.

```json
{
  "challenge": "<서버가 발급한 challenge>",
  "credential": {
    "id": "<credential ID>",
    "rawId": "<credential의 공개 식별자>",
    "type": "public-key",
    "response": {
      "attestationObject": "<인증기가 만든 공개 등록 응답>",
      "clientDataJSON": "<challenge와 origin을 담은 클라이언트 자료>",
      "transports": ["internal"]
    }
  },
  "privateItems": [
    { "title": "비공개 취향 1", "content": "<직접 만든 예시 문장>" },
    { "title": "비공개 취향 2", "content": "<직접 만든 예시 문장>" },
    { "title": "비공개 취향 3", "content": "<직접 만든 예시 문장>" }
  ]
}
```

개인키는 이 본문에 포함되지 않습니다. Neon의 `passkey_credentials.public_key` 값은 Base64URL로 인코딩한 공개키이며 비밀번호가 아닙니다. 실제 공개키 기록은 배포 DB에서 아래처럼 확인한 뒤 제출용 사본에 기록할 수 있습니다.

```sql
SELECT credential_name, public_key, created_at
FROM passkey_credentials
ORDER BY created_at;
```

세션 식별은 8시간 만료의 서버 측 세션과 `HttpOnly; SameSite=Strict` 쿠키로 합니다. 브라우저 쿠키 원문은 DB에 저장하지 않고 SHA-256 해시만 저장합니다. 로그아웃 뒤 같은 쿠키로 `GET /api/private/items`를 요청하면 `401`이어야 합니다. 로그의 쿠키·세션 값은 항상 `[가림]`으로 바꾸세요.

패스키를 두 개 등록한 뒤 목록에서 이름·등록일을 확인하고 하나를 삭제합니다. 남은 것으로 로그인 성공, 삭제된 것으로 로그인 실패를 위 표에 함께 기록합니다. 패스키가 0개인 계정은 현재 로그인 세션을 유지하는 동안만 새 패스키를 추가할 수 있습니다. 마지막 패스키를 지운 뒤 로그아웃하면 재로그인 수단이 없어 계정의 자료에 접근할 수 없으며, 화면에서 이를 경고합니다. 서버에는 계정과 자료가 남고 자동 복구는 제공하지 않습니다.

## ⑤ AI와 나

- AI에게 맡긴 일: Vercel 서버리스 API, 패스키 검증 흐름, 세션·자료 접근 제어, 화면 및 검증 안내 구현.
- 내가 직접 판단한 일: 요구사항과 공개 소개 유지 범위 제시, Vercel 배포 선택, Neon Postgres 사용 승인.
- AI 제안을 따르지 않은 일: 현재 별도로 거절한 제안은 없습니다.

## ⑥ 아직 못 막은 것

비공개 문구는 Neon 데이터베이스에 평문으로 저장됩니다. Neon 프로젝트 관리자 권한이나 `DATABASE_URL`이 탈취되면 서버 API 인증을 거치지 않고 자료를 읽을 수 있습니다. 이 시연에는 애플리케이션 레벨 암호화나 요청 속도 제한이 없습니다. 실제 민감한 내용은 입력하지 마세요. 마지막 패스키 삭제 후 계정 복구 기능도 없습니다.

## 짧은 확인 방법

1. **어디로 가나요?** Vercel 배포 후 위 결과물 HTTPS 주소를 엽니다.
2. **세 단계 안에 무엇을 하나요?** 만든 계정 이름과 가짜 예시 문구 세 개로 첫 패스키를 등록하고, 로그아웃한 다음 같은 계정으로 다시 로그인합니다.
3. **무엇이 보이면 통과인가요?** 공개 소개는 처음부터 보이고, 비공개 문구와 패스키 목록은 인증 후에만 보입니다. 다른 계정 경로는 `403`, 로그아웃 뒤 자료 요청은 `401`이어야 합니다.
4. **안 될 때는 무엇이 보이나요?** 화면에 패스키 취소·실패 또는 서버 오류 안내가 표시됩니다. 환경 변수·스키마가 설정되지 않은 경우 Vercel 로그와 Neon 연결 설정을 확인합니다.

## 배포 전 확인 목록

- [ ] 결과물 URL에 배포된 HTTPS 주소 한 개 기록
- [ ] 소스 URL에 위 HTTPS GitHub 주소 기록
- [ ] 서로 다른 두 계정에 각각 서로 다른 가짜 비공개 항목 세 개 등록
- [ ] 이 문서 ④의 네 검증 결과를 실제 요청/응답으로 채움
- [ ] 패스키 저장 위치(기기 자체·구글 비밀번호 관리자·보안 키)를 실제 등록 시 확인하여 결과에 기록
