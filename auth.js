"use strict";

const SESSION_TOKEN_KEY = "musicPlayerAccessToken";

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function decryptEnvelope(envelope, token) {
  if (
    envelope.format !== 1 ||
    envelope.kdf !== "PBKDF2-SHA-256" ||
    !Number.isInteger(envelope.iterations)
  ) {
    throw new Error("Неподдерживаемый формат зашифрованного плейлиста.");
  }

  const salt = decodeBase64(envelope.salt);
  const iv = decodeBase64(envelope.iv);
  const ciphertext = decodeBase64(envelope.ciphertext);

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: envelope.iterations,
      hash: "SHA-256"
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function loadEncryptedPlaylist() {
  // Код может прийти из QR-ссылки после #access=...
  const hashParams = new URLSearchParams(location.hash.slice(1));
  let token = hashParams.get("access");

  // Убираем секрет из адресной строки сразу после чтения.
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }

  // Сохраняем код только до закрытия вкладки, чтобы пережить обновление.
  if (token) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    token = sessionStorage.getItem(SESSION_TOKEN_KEY);
  }

  const response = await fetch(
    new URL("./playlist.enc", document.baseURI),
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(`Не удалось загрузить playlist.enc: HTTP ${response.status}`);
  }

  const envelope = await response.json();

  while (true) {
    if (!token) {
      token = window.prompt("Введите код доступа:");

      if (!token) {
        throw new Error("Вход отменён.");
      }
    }

    try {
      const playlist = await decryptEnvelope(envelope, token.trim());

      if (!Array.isArray(playlist.tracks)) {
        throw new Error("В зашифрованном файле нет массива tracks.");
      }

      sessionStorage.setItem(SESSION_TOKEN_KEY, token.trim());
      return playlist;
    } catch {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      token = window.prompt("Код неверный. Попробуйте ещё раз:");

      if (!token) {
        throw new Error("Вход отменён.");
      }
    }
  }
}