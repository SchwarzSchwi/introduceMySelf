const statusMessage = document.querySelector("#status");
const authState = document.querySelector("#auth-state");
const authControls = document.querySelector("#auth-controls");
const privateView = document.querySelector("#private-view");

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.className = `status mt-3 mb-2 ${isError ? "text-danger" : "text-success"}`;
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64Url(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `요청이 거절되었습니다 (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function registrationOptionsForBrowser(options) {
  return {
    ...options,
    challenge: decodeBase64Url(options.challenge),
    user: { ...options.user, id: decodeBase64Url(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({
      ...item,
      id: decodeBase64Url(item.id),
    })),
  };
}

function authenticationOptionsForBrowser(options) {
  return {
    ...options,
    challenge: decodeBase64Url(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item) => ({
      ...item,
      id: decodeBase64Url(item.id),
    })),
  };
}

function serializeRegistration(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: encodeBase64Url(response.attestationObject),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      transports: response.getTransports ? response.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment,
  };
}

function serializeAuthentication(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: encodeBase64Url(response.authenticatorData),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment,
  };
}

async function registerPasskey(accountName, credentialName, privateItems) {
  if (!window.isSecureContext || !navigator.credentials) {
    throw new Error("패스키에는 HTTPS 또는 localhost 연결이 필요합니다.");
  }
  const options = await request("/api/auth/register/options", {
    method: "POST",
    body: JSON.stringify({ accountName, credentialName }),
  });
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: registrationOptionsForBrowser(options),
    });
  } catch (error) {
    try {
      await request("/api/auth/register/cancel", {
        method: "POST",
        body: JSON.stringify({ challenge: options.challenge }),
      });
    } catch (cancelError) {
      throw new Error(`${error.message} 등록 취소 정리도 실패했습니다: ${cancelError.message}`);
    }
    if (error.name === "NotAllowedError" || error.name === "AbortError") {
      throw new Error("패스키 등록을 취소했습니다. 서버에는 계정이나 패스키가 저장되지 않았습니다.");
    }
    throw error;
  }
  if (!credential) {
    await request("/api/auth/register/cancel", {
      method: "POST",
      body: JSON.stringify({ challenge: options.challenge }),
    });
    throw new Error("패스키 등록을 취소했습니다. 서버에는 계정이나 패스키가 저장되지 않았습니다.");
  }
  await request("/api/auth/register/verify", {
    method: "POST",
    body: JSON.stringify({
      challenge: options.challenge,
      credential: serializeRegistration(credential),
      ...(privateItems ? { privateItems } : {}),
    }),
  });
  await loadAuthenticatedView();
  showStatus("패스키 등록을 완료했습니다.");
}

async function login(accountName) {
  if (!window.isSecureContext || !navigator.credentials) {
    throw new Error("패스키에는 HTTPS 또는 localhost 연결이 필요합니다.");
  }
  const options = await request("/api/auth/login/options", {
    method: "POST",
    body: JSON.stringify({ accountName }),
  });
  const credential = await navigator.credentials.get({
    publicKey: authenticationOptionsForBrowser(options),
  });
  if (!credential) throw new Error("패스키 로그인이 취소되었습니다.");
  await request("/api/auth/login/verify", {
    method: "POST",
    body: JSON.stringify({
      challenge: options.challenge,
      credential: serializeAuthentication(credential),
    }),
  });
  await loadAuthenticatedView();
  showStatus("패스키로 로그인했습니다.");
}

function renderPrivateItems(items) {
  const container = document.querySelector("#private-items");
  container.replaceChildren();
  for (const item of items) {
    const article = document.createElement("article");
    article.className = "private-item rounded";
    const title = document.createElement("h4");
    title.className = "h6 fw-bold";
    title.textContent = item.title;
    const content = document.createElement("p");
    content.className = "mb-0";
    content.textContent = item.content;
    article.append(title, content);
    container.append(article);
  }
  if (items.length === 0) {
    container.textContent = "비공개 항목이 없습니다.";
  }
}

function renderCredentials(credentials) {
  const list = document.querySelector("#credential-list");
  list.replaceChildren();
  for (const credential of credentials) {
    const row = document.createElement("li");
    row.className = "list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2";
    const details = document.createElement("span");
    const created = new Date(credential.created_at).toLocaleDateString("ko-KR");
    details.textContent = `${credential.name} · 등록일 ${created}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-sm btn-outline-danger";
    remove.textContent = "삭제";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`${credential.name} 패스키를 삭제할까요?`)) return;
      try {
        const result = await request(`/api/credentials/${encodeURIComponent(credential.id)}`, {
          method: "DELETE",
        });
        showStatus(result.message, result.remaining === 0);
        await loadAuthenticatedView();
      } catch (error) {
        showStatus(error.message, true);
      }
    });
    row.append(details, remove);
    list.append(row);
  }
  if (credentials.length === 0) {
    const empty = document.createElement("li");
    empty.className = "list-group-item text-danger";
    empty.textContent = "등록된 패스키가 없습니다. 지금 세션을 로그아웃하면 다시 로그인할 수 없습니다.";
    list.append(empty);
  }
}

async function loadAuthenticatedView() {
  const session = await request("/api/auth/session");
  const [items, credentialData] = await Promise.all([
    request("/api/private/items"),
    request("/api/credentials"),
  ]);
  authState.textContent = `${session.accountName} 로그인`;
  authState.className = "badge text-bg-success";
  authControls.hidden = true;
  privateView.hidden = false;
  renderPrivateItems(items);
  renderCredentials(credentialData.credentials);
}

document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = ["one", "two", "three"];
  const privateItems = fields.map((suffix, index) => ({
    title: `비공개 취향 ${index + 1}`,
    content: document.querySelector(`#item-${suffix}`).value.trim(),
  }));
  try {
    await registerPasskey(
      document.querySelector("#register-name").value.trim(),
      document.querySelector("#credential-name").value.trim(),
      privateItems,
    );
    form.reset();
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await login(document.querySelector("#login-name").value.trim());
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector("#add-passkey").addEventListener("click", async () => {
  const name = window.prompt("새 패스키를 구분할 이름을 입력하세요.");
  if (!name?.trim()) {
    showStatus("패스키 추가를 취소했습니다. 서버에는 패스키가 저장되지 않았습니다.");
    return;
  }
  try {
    await registerPasskey("", name.trim(), null);
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector("#logout").addEventListener("click", async () => {
  try {
    await request("/api/auth/logout", { method: "POST", body: "{}" });
    privateView.hidden = true;
    authControls.hidden = false;
    authState.textContent = "로그아웃 상태";
    authState.className = "badge text-bg-secondary";
    document.querySelector("#private-items").replaceChildren();
    document.querySelector("#credential-list").replaceChildren();
    showStatus("로그아웃했습니다. 폐기된 세션으로는 비공개 자료를 요청할 수 없습니다.");
  } catch (error) {
    showStatus(error.message, true);
  }
});

if (!window.isSecureContext) {
  showStatus("패스키는 HTTPS 연결에서만 사용할 수 있습니다.", true);
}

async function loadInitialState() {
  try {
    await loadAuthenticatedView();
  } catch (error) {
    authState.textContent = "로그아웃 상태";
    authState.className = "badge text-bg-secondary";
    if (error.status !== 401) showStatus(error.message, true);
  }
}

loadInitialState();
