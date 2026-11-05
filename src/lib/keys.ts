import { getDb, getMetaValue, setMetaValue, deleteMetaValue, type StoredProvider } from './db';
import {
  generateDefaultKey,
  deriveKeyFromPassphrase,
  generateSalt,
  encryptData,
  decryptData,
  createPassphraseCheck,
  verifyPassphraseCheck,
  bufferToBase64,
  base64ToUint8Array,
  isWebCryptoAvailable,
  type EncryptedPayload,
} from './crypto';
import type { ProviderType } from './providers';

export type SecurityMode = 'default' | 'passphrase';

export interface SafeProviderInfo {
  id: string;
  providerType: ProviderType;
  label: string;
  baseUrl?: string;
  last4: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  isCustom?: boolean;
}

// In-memory session key for passphrase mode (never persisted to storage)
let inMemoryPassphraseKey: CryptoKey | null = null;

/**
 * Returns current security mode: 'default' | 'passphrase'.
 */
export async function getSecurityMode(): Promise<SecurityMode> {
  const mode = await getMetaValue<SecurityMode>('security_mode');
  return mode === 'passphrase' ? 'passphrase' : 'default';
}

/**
 * Checks whether the app is currently locked under passphrase mode.
 */
export async function isSessionLocked(): Promise<boolean> {
  const mode = await getSecurityMode();
  if (mode !== 'passphrase') return false;
  return inMemoryPassphraseKey === null;
}

/**
 * Retrieves the active CryptoKey based on current security mode.
 * Throws a clean error if session is locked or crypto is unavailable.
 */
async function getActiveCryptoKey(): Promise<CryptoKey> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Cryptography API is unavailable or blocked in this browser.');
  }

  const mode = await getSecurityMode();

  if (mode === 'passphrase') {
    if (!inMemoryPassphraseKey) {
      throw new Error('DESYRA is locked. Please unlock with your passphrase.');
    }
    return inMemoryPassphraseKey;
  }

  // Default mode: retrieve stored non-extractable key from meta table or generate one
  let defaultKey = await getMetaValue<CryptoKey>('default_crypto_key');
  if (!defaultKey) {
    defaultKey = await generateDefaultKey();
    await setMetaValue('default_crypto_key', defaultKey);
  }
  return defaultKey;
}

/**
 * Unlocks the session with user passphrase.
 * Returns true on success, false if incorrect passphrase.
 */
export async function unlockSession(passphrase: string): Promise<boolean> {
  const saltBase64 = await getMetaValue<string>('passphrase_salt');
  const checkPayload = await getMetaValue<EncryptedPayload>('passphrase_check');

  if (!saltBase64 || !checkPayload) {
    throw new Error('Passphrase security configuration is corrupted.');
  }

  const saltBytes = base64ToUint8Array(saltBase64);
  const derivedKey = await deriveKeyFromPassphrase(passphrase, saltBytes);
  const isValid = await verifyPassphraseCheck(checkPayload, derivedKey);

  if (isValid) {
    inMemoryPassphraseKey = derivedKey;
    return true;
  }

  return false;
}

/**
 * Checks if at least one AI provider key is currently stored.
 */
export async function hasAnyKey(): Promise<boolean> {
  const database = getDb();
  if (!database) return false;
  try {
    const count = await database.providers.count();
    return count > 0;
  } catch {
    return false;
  }
}

/**
 * Lists all configured providers with safe metadata (never returns plaintext).
 */
export async function listProviders(): Promise<SafeProviderInfo[]> {
  const database = getDb();
  if (!database) return [];

  try {
    const items = await database.providers.toArray();
    return items.map((item) => ({
      id: item.id,
      providerType: item.providerType,
      label: item.label,
      baseUrl: item.baseUrl,
      last4: item.last4,
      isDefault: Boolean(item.isDefault),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      isCustom: Boolean(item.isCustom),
    }));
  } catch (error) {
    console.error('[DESYRA Keys] Failed to list providers:', error);
    return [];
  }
}

export interface SaveKeyParams {
  providerId: string;
  providerType: ProviderType;
  label: string;
  baseUrl?: string;
  apiKey: string;
  isCustom?: boolean;
}

/**
 * Saves or updates a provider key with AES-GCM encryption.
 * The raw apiKey is never saved, never logged, and cleared from memory.
 */
export async function saveKey({
  providerId,
  providerType,
  label,
  baseUrl,
  apiKey,
  isCustom = false,
}: SaveKeyParams): Promise<SafeProviderInfo> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error('API Key cannot be empty');
  }

  const database = getDb();
  if (!database) {
    throw new Error('IndexedDB storage is not available');
  }

  const activeKey = await getActiveCryptoKey();
  const encryptedPayload = await encryptData(trimmedKey, activeKey);
  const last4 = trimmedKey.slice(-4);

  const existingCount = await database.providers.count();
  const existingRecord = await database.providers.get(providerId);

  // First key saved automatically becomes the default
  const isDefault = existingRecord ? existingRecord.isDefault : existingCount === 0;

  const storedProvider: StoredProvider = {
    id: providerId,
    providerType,
    label: label.trim(),
    baseUrl: baseUrl ? baseUrl.trim() : undefined,
    encryptedKey: encryptedPayload,
    last4,
    isDefault,
    createdAt: existingRecord ? existingRecord.createdAt : Date.now(),
    updatedAt: Date.now(),
    isCustom,
  };

  await database.providers.put(storedProvider);

  return {
    id: storedProvider.id,
    providerType: storedProvider.providerType,
    label: storedProvider.label,
    baseUrl: storedProvider.baseUrl,
    last4: storedProvider.last4,
    isDefault: storedProvider.isDefault,
    createdAt: storedProvider.createdAt,
    updatedAt: storedProvider.updatedAt,
    isCustom: storedProvider.isCustom,
  };
}

/**
 * Deletes a provider key from storage.
 * If the deleted key was the default, automatically assigns default to another key if available.
 */
export async function deleteKey(providerId: string): Promise<boolean> {
  const database = getDb();
  if (!database) return false;

  try {
    const target = await database.providers.get(providerId);
    if (!target) return false;

    await database.providers.delete(providerId);

    if (target.isDefault) {
      const remaining = await database.providers.toCollection().first();
      if (remaining) {
        await database.providers.update(remaining.id, { isDefault: true });
      }
    }
    return true;
  } catch (error) {
    console.error('[DESYRA Keys] Failed to delete key:', error);
    return false;
  }
}

/**
 * Sets a specific provider key as the default.
 */
export async function setDefault(providerId: string): Promise<boolean> {
  const database = getDb();
  if (!database) return false;

  try {
    const all = await database.providers.toArray();
    await database.transaction('rw', database.providers, async () => {
      for (const item of all) {
        await database.providers.update(item.id, { isDefault: item.id === providerId });
      }
    });
    return true;
  } catch (error) {
    console.error('[DESYRA Keys] Failed to set default provider:', error);
    return false;
  }
}

/**
 * Decrypts and returns the plaintext key for the given provider.
 * Strictly used in later pushes during execution.
 * Throws a clear error if locked or unavailable.
 */
export async function getDecryptedKey(providerId: string): Promise<string> {
  const database = getDb();
  if (!database) {
    throw new Error('IndexedDB storage unavailable');
  }

  const record = await database.providers.get(providerId);
  if (!record) {
    throw new Error(`Provider "${providerId}" not found`);
  }

  const activeKey = await getActiveCryptoKey();
  return decryptData(record.encryptedKey, activeKey);
}

/**
 * Enables Passphrase Mode:
 * Re-encrypts all existing stored keys with the new derived passphrase key.
 */
export async function enablePassphrase(newPassphrase: string): Promise<void> {
  const trimmedPass = newPassphrase.trim();
  if (!trimmedPass) {
    throw new Error('Passphrase cannot be empty');
  }

  const database = getDb();
  if (!database) throw new Error('IndexedDB storage unavailable');

  // 1. Decrypt existing keys with current key (if any)
  const currentProviders = await database.providers.toArray();
  const decryptedMap = new Map<string, string>();

  if (currentProviders.length > 0) {
    const currentKey = await getActiveCryptoKey();
    for (const p of currentProviders) {
      const plain = await decryptData(p.encryptedKey, currentKey);
      decryptedMap.set(p.id, plain);
    }
  }

  // 2. Generate new salt and derive new passphrase key
  const salt = generateSalt();
  const newDerivedKey = await deriveKeyFromPassphrase(trimmedPass, salt);
  const checkToken = await createPassphraseCheck(newDerivedKey);

  // 3. Re-encrypt all existing providers with new key
  for (const p of currentProviders) {
    const plain = decryptedMap.get(p.id);
    if (plain) {
      const reEncrypted = await encryptData(plain, newDerivedKey);
      await database.providers.update(p.id, {
        encryptedKey: reEncrypted,
        updatedAt: Date.now(),
      });
    }
  }

  // 4. Save passphrase meta configuration and clean default key
  await setMetaValue('passphrase_salt', bufferToBase64(salt));
  await setMetaValue('passphrase_check', checkToken);
  await setMetaValue('security_mode', 'passphrase');
  await deleteMetaValue('default_crypto_key');

  // 5. Retain derived key in memory for this session
  inMemoryPassphraseKey = newDerivedKey;
}

/**
 * Changes the passphrase:
 * Verifies the old passphrase, decrypts all keys, and re-encrypts with the new passphrase.
 */
export async function changePassphrase(oldPass: string, newPass: string): Promise<boolean> {
  const trimmedNew = newPass.trim();
  if (!trimmedNew) throw new Error('New passphrase cannot be empty');

  const saltBase64 = await getMetaValue<string>('passphrase_salt');
  const checkPayload = await getMetaValue<EncryptedPayload>('passphrase_check');
  if (!saltBase64 || !checkPayload) throw new Error('Passphrase security configuration missing');

  const oldSalt = base64ToUint8Array(saltBase64);
  const oldDerivedKey = await deriveKeyFromPassphrase(oldPass, oldSalt);
  const isValid = await verifyPassphraseCheck(checkPayload, oldDerivedKey);
  if (!isValid) return false;

  const database = getDb();
  if (!database) throw new Error('Database unavailable');

  // Decrypt all existing keys using verified old key
  const currentProviders = await database.providers.toArray();
  const decryptedMap = new Map<string, string>();
  for (const p of currentProviders) {
    const plain = await decryptData(p.encryptedKey, oldDerivedKey);
    decryptedMap.set(p.id, plain);
  }

  // Derive new key with new salt
  const newSalt = generateSalt();
  const newDerivedKey = await deriveKeyFromPassphrase(trimmedNew, newSalt);
  const newCheck = await createPassphraseCheck(newDerivedKey);

  for (const p of currentProviders) {
    const plain = decryptedMap.get(p.id);
    if (plain) {
      const reEncrypted = await encryptData(plain, newDerivedKey);
      await database.providers.update(p.id, {
        encryptedKey: reEncrypted,
        updatedAt: Date.now(),
      });
    }
  }

  await setMetaValue('passphrase_salt', bufferToBase64(newSalt));
  await setMetaValue('passphrase_check', newCheck);
  inMemoryPassphraseKey = newDerivedKey;

  return true;
}

/**
 * Returns from Passphrase Mode to Default Mode:
 * Verifies current passphrase, re-encrypts all keys with a new non-extractable default key.
 */
export async function disablePassphrase(passphrase: string): Promise<boolean> {
  const saltBase64 = await getMetaValue<string>('passphrase_salt');
  const checkPayload = await getMetaValue<EncryptedPayload>('passphrase_check');
  if (!saltBase64 || !checkPayload) throw new Error('Passphrase configuration missing');

  const salt = base64ToUint8Array(saltBase64);
  const derivedKey = await deriveKeyFromPassphrase(passphrase, salt);
  const isValid = await verifyPassphraseCheck(checkPayload, derivedKey);
  if (!isValid) return false;

  const database = getDb();
  if (!database) throw new Error('Database unavailable');

  const currentProviders = await database.providers.toArray();
  const decryptedMap = new Map<string, string>();
  for (const p of currentProviders) {
    const plain = await decryptData(p.encryptedKey, derivedKey);
    decryptedMap.set(p.id, plain);
  }

  // Generate new default key
  const defaultKey = await generateDefaultKey();
  for (const p of currentProviders) {
    const plain = decryptedMap.get(p.id);
    if (plain) {
      const reEncrypted = await encryptData(plain, defaultKey);
      await database.providers.update(p.id, {
        encryptedKey: reEncrypted,
        updatedAt: Date.now(),
      });
    }
  }

  await setMetaValue('default_crypto_key', defaultKey);
  await setMetaValue('security_mode', 'default');
  await deleteMetaValue('passphrase_salt');
  await deleteMetaValue('passphrase_check');
  inMemoryPassphraseKey = null;

  return true;
}

/**
 * Draft Idea management in meta table (preserves idea across navigation without losing it).
 */
export async function saveDraftIdea(text: string): Promise<void> {
  await setMetaValue('draft_idea', text);
}

export async function getDraftIdea(): Promise<string> {
  const draft = await getMetaValue<string>('draft_idea');
  return draft ?? '';
}

export async function clearDraftIdea(): Promise<void> {
  await deleteMetaValue('draft_idea');
}
