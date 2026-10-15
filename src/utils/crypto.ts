// src/utils/crypto.ts

/**
 * 将 Uint8Array 转换为标准 Base64 字符串
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 将 Base64 字符串解析为 Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 基于用户口令 (Passphrase) 和盐 (Salt) 派生 256 位 AES-GCM 密钥
 * 使用 PBKDF2-HMAC-SHA256 算法，迭代 100,000 次
 */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedPayload {
  ciphertext: string; // Base64
  iv: string; // Base64
  salt: string; // Base64
}

/**
 * 使用 AES-256-GCM 加密明文字符串
 */
export async function encryptData(plaintext: string, passphrase: string): Promise<EncryptedPayload> {
  if (!passphrase) {
    throw new Error('加密密码不能为空');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
    },
    key,
    enc.encode(plaintext)
  );

  return {
    ciphertext: uint8ArrayToBase64(new Uint8Array(encrypted)),
    iv: uint8ArrayToBase64(iv),
    salt: uint8ArrayToBase64(salt),
  };
}

/**
 * 使用 AES-256-GCM 解密密文
 */
export async function decryptData(
  ciphertextBase64: string,
  ivBase64: string,
  saltBase64: string,
  passphrase: string
): Promise<string> {
  if (!passphrase) {
    throw new Error('解密密码不能为空');
  }

  try {
    const salt = base64ToUint8Array(saltBase64);
    const iv = base64ToUint8Array(ivBase64);
    const ciphertext = base64ToUint8Array(ciphertextBase64);

    const key = await deriveKey(passphrase, salt);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
      },
      key,
      ciphertext as BufferSource
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (err: any) {
    throw new Error('解密失败：同步密码不正确或配置数据已损坏');
  }
}
