'use strict';

const crypto = require('crypto');

function resolveEncryptionKeyBuffer() {
  const raw = String(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length === 32) return Buffer.from(raw, 'utf8');
  return crypto.createHash('sha256').update(raw).digest();
}

function isLegacyPlainValue(stored) {
  const s = String(stored || '').trim();
  if (!s) return false;
  if (s.startsWith('shpat_')) return true;
  return !s.includes(':');
}

/**
 * @param {string} plainValue
 * @returns {string}
 */
function encryptShopifyToken(plainValue) {
  const plain = String(plainValue || '').trim();
  if (!plain) return '';
  const key = resolveEncryptionKeyBuffer();
  if (!key) {
    throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY no configurada');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/**
 * @param {string} storedValue
 * @returns {string}
 */
function decryptShopifyToken(storedValue) {
  const stored = String(storedValue || '').trim();
  if (!stored) return '';
  if (isLegacyPlainValue(stored)) return stored;
  const key = resolveEncryptionKeyBuffer();
  if (!key) return stored;
  const parts = stored.split(':');
  if (parts.length !== 3) return stored;
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const enc = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return stored;
  }
}

module.exports = {
  encryptShopifyToken,
  decryptShopifyToken,
};
