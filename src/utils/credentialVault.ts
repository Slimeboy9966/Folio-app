/**
 * Encrypted on-device credential vault & WebAuthn biometric (fingerprint) helper.
 *
 * Security design:
 * - Credentials are encrypted with AES-GCM-256 via Web Crypto API (`crypto.subtle`).
 * - The encryption key is generated with `extractable: false` and stored as an opaque
 *   CryptoKey handle inside IndexedDB, so plaintext passwords are never written to
 *   localStorage, sessionStorage, or readable storage.
 * - Fingerprint / platform biometric sign-in uses the WebAuthn API (`PublicKeyCredential`)
 *   with `authenticatorAttachment: 'platform'` and `userVerification: 'required'`, backed
 *   by single-use server-issued cryptographic challenges.
 */

export interface SavedLoginCredentials {
  username: string;
  password: string;
  districtUrl: string;
  isParent: boolean;
}

export interface SavedLoginSummary {
  username: string;
  districtUrl: string;
  isParent: boolean;
  savedAt: string;
  biometricEnabled: boolean;
  credentialId?: string;
}

interface EncryptedVaultRecord extends SavedLoginSummary {
  version: 1;
  iv: string;
  ciphertext: string;
}

export interface BiometricSupportInfo {
  supported: boolean;
  platformAvailable: boolean;
}

export type BiometricActionResult =
  | { ok: true; credentialId?: string }
  | { ok: false; error: string; iframeBlocked?: boolean; cancelled?: boolean };

const DB_NAME = 'folio_secure_vault_v1';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const KEY_ENTRY = 'aesKey';
const RECORD_ENTRY = 'record';

function isVaultSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.indexedDB !== 'undefined' &&
    typeof window.crypto !== 'undefined' &&
    typeof window.crypto.subtle !== 'undefined'
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  return bytesToBase64Url(new Uint8Array(buffer));
}

function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (base64Url.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open secure vault.'));
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error || new Error('Failed to read secure vault.'));
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to write secure vault.'));
    };
  });
}

async function idbClearAll(): Promise<void> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to clear secure vault.'));
    };
  });
}

async function getOrCreateAesKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(KEY_ENTRY);
  if (existing && existing.type === 'secret') {
    return existing;
  }
  const key = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable key handle
    ['encrypt', 'decrypt']
  );
  await idbSet(KEY_ENTRY, key);
  return key;
}

function toSummary(record: EncryptedVaultRecord): SavedLoginSummary {
  return {
    username: record.username,
    districtUrl: record.districtUrl,
    isParent: Boolean(record.isParent),
    savedAt: record.savedAt,
    biometricEnabled: Boolean(record.biometricEnabled && record.credentialId),
    credentialId: record.credentialId,
  };
}

export async function getSavedLoginSummary(): Promise<SavedLoginSummary | null> {
  if (!isVaultSupported()) return null;
  try {
    const record = await idbGet<EncryptedVaultRecord>(RECORD_ENTRY);
    const key = await idbGet<CryptoKey>(KEY_ENTRY);
    if (!record || !key || !record.ciphertext || !record.iv || !record.username) {
      return null;
    }
    return toSummary(record);
  } catch {
    return null;
  }
}

export async function saveEncryptedLogin(
  creds: SavedLoginCredentials,
  biometric?: { enabled: boolean; credentialId?: string }
): Promise<SavedLoginSummary> {
  if (!isVaultSupported()) {
    throw new Error('This browser does not support encrypted local storage.');
  }

  const existing = await idbGet<EncryptedVaultRecord>(RECORD_ENTRY).catch(() => undefined);
  const key = await getOrCreateAesKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify({
      username: creds.username.trim(),
      password: creds.password,
      districtUrl: creds.districtUrl.trim(),
      isParent: Boolean(creds.isParent),
    })
  );

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    payloadBytes
  );

  const sameAccount =
    existing &&
    existing.username.toLowerCase() === creds.username.trim().toLowerCase() &&
    existing.districtUrl.toLowerCase() === creds.districtUrl.trim().toLowerCase();

  const biometricEnabled =
    biometric !== undefined
      ? Boolean(biometric.enabled && biometric.credentialId)
      : Boolean(sameAccount && existing?.biometricEnabled && existing?.credentialId);

  const credentialId =
    biometric !== undefined
      ? biometric.enabled
        ? biometric.credentialId
        : undefined
      : sameAccount
        ? existing?.credentialId
        : undefined;

  const record: EncryptedVaultRecord = {
    version: 1,
    iv: bytesToBase64Url(iv),
    ciphertext: bufferToBase64Url(encryptedBuffer),
    username: creds.username.trim(),
    districtUrl: creds.districtUrl.trim(),
    isParent: Boolean(creds.isParent),
    savedAt: new Date().toISOString(),
    biometricEnabled,
    credentialId,
  };

  await idbSet(RECORD_ENTRY, record);
  return toSummary(record);
}

export async function loadDecryptedLogin(): Promise<SavedLoginCredentials | null> {
  if (!isVaultSupported()) return null;
  try {
    const [key, record] = await Promise.all([
      idbGet<CryptoKey>(KEY_ENTRY),
      idbGet<EncryptedVaultRecord>(RECORD_ENTRY),
    ]);
    if (!key || !record || !record.ciphertext || !record.iv) {
      return null;
    }

    const iv = base64UrlToBytes(record.iv);
    const ciphertext = base64UrlToBytes(record.ciphertext);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const parsed = JSON.parse(new TextDecoder().decode(decryptedBuffer)) as Partial<SavedLoginCredentials>;
    if (
      typeof parsed.username !== 'string' ||
      typeof parsed.password !== 'string' ||
      !parsed.username ||
      !parsed.password
    ) {
      return null;
    }

    return {
      username: parsed.username,
      password: parsed.password,
      districtUrl: typeof parsed.districtUrl === 'string' && parsed.districtUrl
        ? parsed.districtUrl
        : record.districtUrl,
      isParent: Boolean(parsed.isParent),
    };
  } catch {
    return null;
  }
}

export async function updateSavedLoginBiometric(
  biometricEnabled: boolean,
  credentialId?: string
): Promise<SavedLoginSummary | null> {
  if (!isVaultSupported()) return null;
  const record = await idbGet<EncryptedVaultRecord>(RECORD_ENTRY);
  if (!record) return null;

  const updated: EncryptedVaultRecord = {
    ...record,
    biometricEnabled: Boolean(biometricEnabled && credentialId),
    credentialId: biometricEnabled ? credentialId : undefined,
  };
  await idbSet(RECORD_ENTRY, updated);
  return toSummary(updated);
}

export async function clearSavedLogin(): Promise<void> {
  if (!isVaultSupported()) return;
  try {
    await idbClearAll();
  } catch {
    // Ignore cleanup errors
  }
}

/* ---------------- WebAuthn Fingerprint / Biometric Auth ---------------- */

export async function checkBiometricSupport(): Promise<BiometricSupportInfo> {
  if (
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    typeof window.PublicKeyCredential === 'undefined'
  ) {
    return { supported: false, platformAvailable: false };
  }

  let platformAvailable = false;
  try {
    if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      platformAvailable =
        await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    platformAvailable = false;
  }

  return { supported: true, platformAvailable };
}

function classifyWebAuthnError(err: unknown): {
  error: string;
  iframeBlocked?: boolean;
  cancelled?: boolean;
} {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err || '');
  const lower = msg.toLowerCase();

  if (
    lower.includes('permissions policy') ||
    lower.includes('publickey-credentials') ||
    lower.includes('cross-origin') ||
    name === 'SecurityError'
  ) {
    return {
      iframeBlocked: true,
      error:
        'Fingerprint sign-in is restricted inside an embedded preview frame. Open Folio in its own browser tab to use Touch ID, Windows Hello, or your device fingerprint sensor.',
    };
  }

  if (name === 'NotAllowedError' || name === 'AbortError') {
    return {
      cancelled: true,
      error: 'Fingerprint verification was cancelled or timed out. You can try again or use Quick Sign In.',
    };
  }

  if (name === 'NotSupportedError') {
    return {
      error: 'This device or browser does not have a built-in fingerprint or biometric authenticator set up.',
    };
  }

  return {
    error: msg || 'Fingerprint verification could not be completed on this device.',
  };
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  const txt = await res.text();
  if (!txt) return null;
  try {
    return JSON.parse(txt) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function registerFingerprintCredential(
  username: string
): Promise<BiometricActionResult> {
  const support = await checkBiometricSupport();
  if (!support.supported) {
    return {
      ok: false,
      error: 'Fingerprint sign-in requires a secure HTTPS browser with WebAuthn support.',
    };
  }

  try {
    const optRes = await fetch('/api/auth/webauthn/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const optData = await safeJson(optRes);
    if (!optRes.ok || !optData) {
      return {
        ok: false,
        error:
          typeof optData?.error === 'string'
            ? optData.error
            : 'Could not start fingerprint registration.',
      };
    }

    const challengeId = String(optData.challengeId || '');
    const challenge = String(optData.challenge || '');
    const rp = optData.rp as { id: string; name: string };
    const user = optData.user as { id: string; name: string; displayName: string };

    const creationOptions: PublicKeyCredentialCreationOptions = {
      challenge: base64UrlToBytes(challenge),
      rp: {
        id: rp.id,
        name: rp.name,
      },
      user: {
        id: base64UrlToBytes(user.id),
        name: user.name,
        displayName: user.displayName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    };

    const credential = (await navigator.credentials.create({
      publicKey: creationOptions,
    })) as PublicKeyCredential | null;

    if (!credential) {
      return {
        ok: false,
        cancelled: true,
        error: 'Fingerprint setup was cancelled.',
      };
    }

    const attestation = credential.response as AuthenticatorAttestationResponse & {
      getAuthenticatorData?: () => ArrayBuffer;
      getPublicKey?: () => ArrayBuffer | null;
      getPublicKeyAlgorithm?: () => number;
    };

    const credentialId = bufferToBase64Url(credential.rawId);
    const authDataBuf =
      typeof attestation.getAuthenticatorData === 'function'
        ? attestation.getAuthenticatorData()
        : null;
    const pubKeyBuf =
      typeof attestation.getPublicKey === 'function' ? attestation.getPublicKey() : null;
    const alg =
      typeof attestation.getPublicKeyAlgorithm === 'function'
        ? attestation.getPublicKeyAlgorithm()
        : undefined;

    const verifyRes = await fetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        credentialId,
        clientDataJSON: bufferToBase64Url(attestation.clientDataJSON),
        authenticatorData: authDataBuf ? bufferToBase64Url(authDataBuf) : undefined,
        publicKeySpki: pubKeyBuf ? bufferToBase64Url(pubKeyBuf) : undefined,
        alg,
      }),
    });

    const verifyData = await safeJson(verifyRes);
    if (!verifyRes.ok || !verifyData?.ok) {
      return {
        ok: false,
        error:
          typeof verifyData?.error === 'string'
            ? verifyData.error
            : 'Fingerprint registration could not be verified.',
      };
    }

    await updateSavedLoginBiometric(true, credentialId);
    return { ok: true, credentialId };
  } catch (err) {
    const classified = classifyWebAuthnError(err);
    return { ok: false, ...classified };
  }
}

export async function authenticateWithFingerprint(
  credentialId?: string
): Promise<BiometricActionResult> {
  const support = await checkBiometricSupport();
  if (!support.supported) {
    return {
      ok: false,
      error: 'Fingerprint sign-in is not supported in this browser.',
    };
  }

  try {
    const optRes = await fetch('/api/auth/webauthn/auth-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId }),
    });
    const optData = await safeJson(optRes);
    if (!optRes.ok || !optData) {
      return {
        ok: false,
        error:
          typeof optData?.error === 'string'
            ? optData.error
            : 'Could not start fingerprint verification.',
      };
    }

    const challengeId = String(optData.challengeId || '');
    const challenge = String(optData.challenge || '');
    const rpId = String(optData.rpId || window.location.hostname);

    const requestOptions: PublicKeyCredentialRequestOptions = {
      challenge: base64UrlToBytes(challenge),
      rpId,
      userVerification: 'required',
      timeout: 60_000,
      ...(credentialId
        ? {
            allowCredentials: [
              {
                id: base64UrlToBytes(credentialId),
                type: 'public-key',
                transports: ['internal'],
              },
            ],
          }
        : {}),
    };

    const assertion = (await navigator.credentials.get({
      publicKey: requestOptions,
    })) as PublicKeyCredential | null;

    if (!assertion) {
      return {
        ok: false,
        cancelled: true,
        error: 'Fingerprint verification was cancelled.',
      };
    }

    const response = assertion.response as AuthenticatorAssertionResponse;
    const assertedId = bufferToBase64Url(assertion.rawId);

    const verifyRes = await fetch('/api/auth/webauthn/auth-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        credentialId: assertedId,
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        authenticatorData: bufferToBase64Url(response.authenticatorData),
        signature: bufferToBase64Url(response.signature),
      }),
    });

    const verifyData = await safeJson(verifyRes);
    if (!verifyRes.ok || !verifyData?.ok) {
      return {
        ok: false,
        error:
          typeof verifyData?.error === 'string'
            ? verifyData.error
            : 'Fingerprint verification failed. Please try again.',
      };
    }

    return { ok: true, credentialId: assertedId };
  } catch (err) {
    const classified = classifyWebAuthnError(err);
    return { ok: false, ...classified };
  }
}
