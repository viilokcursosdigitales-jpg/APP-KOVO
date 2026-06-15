'use strict';

const express = require('express');
const { sanitizeShopDomain } = require('../shopifyService');
const { encryptShopifyToken, decryptShopifyToken } = require('../shopifyTokenCrypto');

const PROTECTED_OWNER_EMAILS = ['digitalocampo19@hotmail.com', 'cavimo25@gmail.com'];

const SHOPIFY_V2_SCOPES =
  'read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_customers,read_analytics,read_reports,read_fulfillments,write_fulfillments,read_shipping,read_locations';

const SHOPIFY_V2_REDIRECT_URI = 'https://kovo.services/api/shopify-v2/callback';

function frontendBaseUrl() {
  return String(process.env.SHOPIFY_APP_URL || 'https://kovo.services').replace(/\/$/, '');
}

function pickCredential(row, encryptedKey, plainKey) {
  const encrypted = row[encryptedKey];
  if (encrypted != null && String(encrypted).trim()) {
    return decryptShopifyToken(String(encrypted));
  }
  const plain = row[plainKey];
  if (plain != null && String(plain).trim()) {
    return String(plain).trim();
  }
  return '';
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} organizationId
 */
async function isProtectedOrganization(pool, organizationId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM users
     WHERE organization_id = $1
       AND lower(trim(email)) = ANY($2::text[])
     LIMIT 1`,
    [organizationId, PROTECTED_OWNER_EMAILS.map((email) => email.toLowerCase())],
  );
  return rows.length > 0;
}

/**
 * @param {{ pool: import('pg').Pool, verifyToken: Function, scopeToOrganization: Function, requireRole: Function }} deps
 */
function createShopifyV2Router({ pool, verifyToken, scopeToOrganization, requireRole }) {
  const router = express.Router();
  const manageAuth = [verifyToken, scopeToOrganization, requireRole('owner', 'admin')];

  router.post('/iniciar-conexion', ...manageAuth, async (req, res) => {
    try {
      const organizationId = Number(req.organizationId);
      if (!Number.isFinite(organizationId) || organizationId <= 0) {
        return res.status(400).json({ error: 'Organización inválida' });
      }
      if (await isProtectedOrganization(pool, organizationId)) {
        return res.status(403).json({ error: 'Esta organización no puede usar la conexión Shopify v2' });
      }

      const shopDomain = sanitizeShopDomain(req.body?.shopDomain);
      const apiKey = String(req.body?.apiKey || '').trim();
      const apiSecret = String(req.body?.apiSecret || '').trim();

      if (!shopDomain) {
        return res.status(400).json({ error: 'shopDomain debe terminar en .myshopify.com' });
      }
      if (!apiKey) {
        return res.status(400).json({ error: 'apiKey es obligatorio' });
      }
      if (!apiSecret) {
        return res.status(400).json({ error: 'apiSecret es obligatorio' });
      }

      let apiKeyEncrypted;
      let apiSecretEncrypted;
      try {
        apiKeyEncrypted = encryptShopifyToken(apiKey);
        apiSecretEncrypted = encryptShopifyToken(apiSecret);
      } catch (e) {
        console.error('[shopify-v2 iniciar-conexion] encryption', e);
        return res.status(500).json({ error: 'No se pudo encriptar las credenciales. Configura SHOPIFY_TOKEN_ENCRYPTION_KEY.' });
      }

      await pool.query(
        `INSERT INTO shopify_connections_v2 (
           organization_id, shop_domain, api_key_encrypted, api_secret_encrypted, status, updated_at
         )
         VALUES ($1, $2, $3, $4, 'pending', now())
         ON CONFLICT (organization_id)
         DO UPDATE SET
           shop_domain = EXCLUDED.shop_domain,
           api_key_encrypted = EXCLUDED.api_key_encrypted,
           api_secret_encrypted = EXCLUDED.api_secret_encrypted,
           status = 'pending',
           updated_at = now()`,
        [organizationId, shopDomain, apiKeyEncrypted, apiSecretEncrypted],
      );

      const params = new URLSearchParams({
        client_id: apiKey,
        scope: SHOPIFY_V2_SCOPES,
        redirect_uri: SHOPIFY_V2_REDIRECT_URI,
        state: String(organizationId),
      });
      const authUrl = `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
      return res.json({ authUrl });
    } catch (e) {
      console.error('[shopify-v2 iniciar-conexion]', e);
      return res.status(500).json({ error: 'No se pudo iniciar la conexión con Shopify' });
    }
  });

  router.get('/callback', async (req, res) => {
    const redirectOk = () => res.redirect(302, `${frontendBaseUrl()}/canales?shopify=conectado`);
    const redirectErr = () => res.redirect(302, `${frontendBaseUrl()}/canales?shopify=error`);

    try {
      const code = String(req.query.code || '').trim();
      const shop = sanitizeShopDomain(req.query.shop);
      const organizationId = Number.parseInt(String(req.query.state || '').trim(), 10);

      if (!code || !shop || !Number.isFinite(organizationId) || organizationId <= 0) {
        console.warn('[shopify-v2 callback] parámetros inválidos', {
          hasCode: Boolean(code),
          shop,
          state: req.query.state,
        });
        return redirectErr();
      }

      if (await isProtectedOrganization(pool, organizationId)) {
        console.warn('[shopify-v2 callback] organización protegida', { organizationId });
        return redirectErr();
      }

      const { rows } = await pool.query(`SELECT * FROM shopify_connections_v2 WHERE organization_id = $1 LIMIT 1`, [
        organizationId,
      ]);
      const row = rows[0];
      if (!row) {
        console.warn('[shopify-v2 callback] sin fila para organization_id', organizationId);
        return redirectErr();
      }

      const clientId = pickCredential(row, 'api_key_encrypted', 'api_key');
      const clientSecret = pickCredential(row, 'api_secret_encrypted', 'api_secret');
      if (!clientId || !clientSecret) {
        console.warn('[shopify-v2 callback] credenciales ausentes', { organizationId });
        return redirectErr();
      }

      const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });
      const tokenBody = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokenBody.access_token) {
        console.error('[shopify-v2 callback] access_token falló', {
          organizationId,
          httpStatus: tokenRes.status,
          body: tokenBody,
        });
        return redirectErr();
      }

      let accessTokenEncrypted;
      try {
        accessTokenEncrypted = encryptShopifyToken(String(tokenBody.access_token));
      } catch (e) {
        console.error('[shopify-v2 callback] encryption', e);
        return redirectErr();
      }

      await pool.query(
        `UPDATE shopify_connections_v2
         SET shop_domain = $2,
             access_token_encrypted = $3,
             status = 'connected',
             connected_at = COALESCE(connected_at, now()),
             updated_at = now()
         WHERE organization_id = $1`,
        [organizationId, shop, accessTokenEncrypted],
      );

      return redirectOk();
    } catch (e) {
      console.error('[shopify-v2 callback]', e);
      return redirectErr();
    }
  });

  router.get('/estado', ...manageAuth, async (req, res) => {
    try {
      const organizationId = Number(req.organizationId);
      const { rows } = await pool.query(
        `SELECT shop_domain, status, connected_at, access_token_encrypted, access_token
         FROM shopify_connections_v2
         WHERE organization_id = $1
         LIMIT 1`,
        [organizationId],
      );
      const row = rows[0];
      if (!row) {
        return res.json({
          conectado: false,
          shopDomain: null,
          status: null,
          connectedAt: null,
        });
      }

      const hasToken = Boolean(
        (row.access_token_encrypted && String(row.access_token_encrypted).trim()) ||
          (row.access_token && String(row.access_token).trim()),
      );
      const conectado = String(row.status || '').toLowerCase() === 'connected' && hasToken;

      return res.json({
        conectado,
        shopDomain: row.shop_domain || null,
        status: row.status || null,
        connectedAt: row.connected_at ? new Date(row.connected_at).toISOString() : null,
      });
    } catch (e) {
      console.error('[shopify-v2 estado]', e);
      return res.status(500).json({ error: 'No se pudo leer el estado de Shopify' });
    }
  });

  return router;
}

module.exports = createShopifyV2Router;
