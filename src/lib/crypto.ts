/**
 * Web Crypto API utilities for DESYRA BYOK Key Management.
 * Uses AES-GCM (256-bit, random 12-byte IV) and PBKDF2 (SHA-256, 600,000 iterations).
 * No external cryptography libraries.
 */

export interface EncryptedPayload {
  iv: string; // base64
  ciphertext: string; // base64
}

const CHECK_PLAINTEXT = 'DESYRA_VERIFY_PASSPHRASE_TOKEN_v1';
const PBKDF2_ITERATIONS = 600000;

export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Checks if the Web Crypto API is available in the current runtime.
 */
export function isWebCryptoAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.crypto && !!window.crypto.subtle;
}

/**
 * Generates a non-extractable 256-bit AES-GCM CryptoKey for default mode.
 */
export async function generateDefaultKey(): Promise<CryptoKey> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }
  return window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Derives a non-extractable 256-bit AES-GCM key from a passphrase and salt using PBKDF2.
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  saltBytes: Uint8Array
): Promise<CryptoKey> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }
  const encoder = new TextEncoder();
  const rawKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    rawKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Generates a random 16-byte salt for PBKDF2.
 */
export function generateSalt(): Uint8Array {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }
  const salt = new Uint8Array(16);
  window.crypto.getRandomValues(salt);
  return salt;
}

/**
 * Encrypts a plaintext string using AES-GCM with a random 12-byte IV.
 */
export async function encryptData(
  plaintext: string,
  key: CryptoKey
): Promise<EncryptedPayload> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(iv);

  const encoder = new TextEncoder();
  const encodedPlaintext = encoder.encode(plaintext);

  const cipherBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    encodedPlaintext as unknown as BufferSource
  );

  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(cipherBuffer),
  };
}

/**
 * Decrypts an EncryptedPayload using AES-GCM with the supplied CryptoKey.
 */
export async function decryptData(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<string> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }
  const ivBytes = base64ToUint8Array(payload.iv);
  const cipherBytes = base64ToUint8Array(payload.ciphertext);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes as unknown as BufferSource,
    },
    key,
    cipherBytes as unknown as BufferSource
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Creates an encrypted verification check token for passphrase mode.
 */
export async function createPassphraseCheck(key: CryptoKey): Promise<EncryptedPayload> {
  return encryptData(CHECK_PLAINTEXT, key);
}

/**
 * Validates whether a derived key correctly decrypts the passphrase verification check token.
 */
export async function verifyPassphraseCheck(
  checkPayload: EncryptedPayload,
  key: CryptoKey
): Promise<boolean> {
  try {
    const decrypted = await decryptData(checkPayload, key);
    return decrypted === CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}
