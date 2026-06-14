'use strict';

const { verifyShopifyOAuthHmac } = require('./shopifyService');

function readEnv(key) {
  return String(process.env[key] || '').trim();
}

/** @returns {{ clientId: string, clientSecret: string, appSlot: 1 | 2 }} */
function shopifyOAuthApp1Credentials() {
  return {
    clientId: readEnv('SHOPIFY_API_KEY'),
    clientSecret: readEnv('SHOPIFY_API_SECRET'),
    appSlot: 1,
  };
}

/** @returns {{ clientId: string, clientSecret: string, appSlot: 2 }} */
function shopifyOAuthApp2Credentials() {
  return {
    clientId: readEnv('SHOPIFY_API_KEY_2'),
    clientSecret: readEnv('SHOPIFY_API_SECRET_2'),
    appSlot: 2,
  };
}

function shopifyApp2Configured() {
  const app2 = shopifyOAuthApp2Credentials();
  return Boolean(app2.clientId && app2.clientSecret);
}

function maskClientId(clientId) {
  const id = String(clientId || '').replace(/\s/g, '');
  if (!id) return '(vacío)';
  if (id.length <= 8) return '····';
  return `····${id.slice(-6)}`;
}

/**
 * App OAuth según query ?app=2 (clientes nuevos). Sin parámetro → App 1 (sin cambios).
 * @param {string | string[] | undefined} appQuery
 */
function resolveShopifyOAuthAppFromAuthQuery(appQuery) {
  const raw = Array.isArray(appQuery) ? appQuery[0] : appQuery;
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (normalized === '2' || normalized === 'app2' || normalized === 'kovo-2-publica') {
    if (!shopifyApp2Configured()) return null;
    return shopifyOAuthApp2Credentials();
  }
  return shopifyOAuthApp1Credentials();
}

/**
 * Resuelve credenciales por Client ID (API key) guardado en el state OAuth o devuelto por Shopify.
 * @param {string | null | undefined} clientId
 */
function resolveShopifyOAuthAppByClientId(clientId) {
  const id = String(clientId || '').replace(/\s/g, '');
  if (!id) return null;
  const app2 = shopifyOAuthApp2Credentials();
  if (app2.clientId && id === app2.clientId.replace(/\s/g, '')) {
    return app2;
  }
  const app1 = shopifyOAuthApp1Credentials();
  if (app1.clientId && id === app1.clientId.replace(/\s/g, '')) {
    return app1;
  }
  return null;
}

/**
 * Valida HMAC del callback OAuth probando el secret de cada app configurada.
 * @param {object} query
 * @returns {{ clientId: string, clientSecret: string, appSlot: 1 | 2 } | null}
 */
function verifyShopifyOAuthCallbackAndResolveApp(query) {
  const app1 = shopifyOAuthApp1Credentials();
  if (app1.clientId && app1.clientSecret && verifyShopifyOAuthHmac(query, app1.clientSecret)) {
    return app1;
  }
  const app2 = shopifyOAuthApp2Credentials();
  if (app2.clientId && app2.clientSecret && verifyShopifyOAuthHmac(query, app2.clientSecret)) {
    return app2;
  }
  return null;
}

function logShopifyOAuthAppsStatus() {
  const app1 = shopifyOAuthApp1Credentials();
  const app2 = shopifyOAuthApp2Credentials();
  console.log('[shopify] OAuth App 1 (María / sin ?app):', {
    configured: Boolean(app1.clientId && app1.clientSecret),
    clientId: maskClientId(app1.clientId),
  });
  console.log('[shopify] OAuth App 2 (?app=2 / clientes nuevos):', {
    configured: shopifyApp2Configured(),
    clientId: maskClientId(app2.clientId),
  });
}

module.exports = {
  shopifyOAuthApp1Credentials,
  shopifyOAuthApp2Credentials,
  shopifyApp2Configured,
  resolveShopifyOAuthAppFromAuthQuery,
  resolveShopifyOAuthAppByClientId,
  verifyShopifyOAuthCallbackAndResolveApp,
  logShopifyOAuthAppsStatus,
};
