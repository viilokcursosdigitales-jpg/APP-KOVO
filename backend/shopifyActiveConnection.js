'use strict';

const { decryptShopifyToken } = require('./shopifyTokenCrypto');

function pickAccessTokenField(row) {
  if (!row || typeof row !== 'object') return null;
  const candidates = [
    row.access_token_encrypted,
    row.access_token,
    row.accessTokenEncrypted,
    row.accessToken,
  ];
  for (const value of candidates) {
    if (value != null && String(value).trim()) return String(value);
  }
  return null;
}

function resolveDecryptedAccessToken(stored) {
  const raw = String(stored ?? '').trim();
  if (!raw) return '';
  const decrypted = decryptShopifyToken(raw);
  if (!decrypted.trim()) return '';
  if (raw.includes(':') && decrypted === raw) return '';
  return decrypted.trim();
}

/**
 * Conexión Shopify v2 (shopify_connections_v2) en forma compatible con v1.
 * @param {import('pg').Pool} pool
 * @param {number} organizationId
 */
async function getActiveShopifyConnectionFromV2(pool, organizationId) {
  const { rows } = await pool.query(
    `SELECT *
     FROM shopify_connections_v2
     WHERE organization_id = $1 AND lower(trim(status)) = 'connected'
     LIMIT 1`,
    [organizationId],
  );
  const row = rows[0];
  if (!row) return null;

  const tokenRaw = pickAccessTokenField(row);
  const accessToken = resolveDecryptedAccessToken(tokenRaw);
  if (!accessToken) return null;

  return {
    id: row.id,
    shop_domain: row.shop_domain,
    access_token: accessToken,
    scope: row.scope || null,
    status: 'connected',
    installed_at: row.connected_at || row.created_at || row.updated_at || null,
    updated_at: row.updated_at || null,
    connection_source: 'v2',
  };
}

/**
 * v1 (shopify_connections) tiene prioridad — preserva flujo de María / App 1.
 * Si no hay v1 activa, usa v2 (Kindiu y clientes con app propia).
 * @param {import('pg').Pool} pool
 * @param {number} organizationId
 */
async function getActiveShopifyConnection(pool, organizationId) {
  const { rows } = await pool.query(
    `SELECT id, shop_domain, access_token, scope, status, installed_at, updated_at
     FROM shopify_connections
     WHERE organization_id = $1 AND status = 'connected'
     ORDER BY id DESC
     LIMIT 1`,
    [organizationId],
  );
  if (rows[0]) {
    return { ...rows[0], connection_source: 'v1' };
  }
  return getActiveShopifyConnectionFromV2(pool, organizationId);
}

module.exports = {
  getActiveShopifyConnection,
  getActiveShopifyConnectionFromV2,
  pickAccessTokenField,
  resolveDecryptedAccessToken,
};
