const { sanitizeShopDomain } = require('./shopifyService');

const PROXY_TIMESTAMP_MAX_SKEW_SEC = Number(process.env.SHOPIFY_PROXY_TIMESTAMP_MAX_SKEW_SEC || 86400);

/**
 * @param {import('pg').Pool} pool
 * @param {string} shopDomain
 */
async function syncOrganizationShopifyDomain(pool, organizationId, shopDomain) {
  const shop = sanitizeShopDomain(shopDomain);
  const orgId = Number(organizationId);
  if (!shop || !Number.isFinite(orgId) || orgId <= 0) return;
  await pool.query(`UPDATE organizations SET shopify_shop_domain = $2 WHERE id = $1`, [orgId, shop]);
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} shopDomain
 * @returns {Promise<{ organizationId: number, hasIngestToken: boolean }|null>}
 */
async function resolveOrganizationByShopDomain(pool, shopDomain) {
  const shop = sanitizeShopDomain(shopDomain);
  if (!shop) return null;

  const fromOrg = await pool.query(
    `SELECT id, (shopify_form_ingest_token_hash IS NOT NULL) AS has_ingest
     FROM organizations
     WHERE lower(shopify_shop_domain) = lower($1)
     LIMIT 2`,
    [shop],
  );
  if (fromOrg.rows.length === 1) {
    return {
      organizationId: Number(fromOrg.rows[0].id),
      hasIngestToken: Boolean(fromOrg.rows[0].has_ingest),
    };
  }

  const fromConn = await pool.query(
    `SELECT o.id, (o.shopify_form_ingest_token_hash IS NOT NULL) AS has_ingest
     FROM shopify_connections sc
     INNER JOIN organizations o ON o.id = sc.organization_id
     WHERE lower(sc.shop_domain) = lower($1) AND sc.status = 'connected'
     LIMIT 2`,
    [shop],
  );
  if (fromConn.rows.length === 1) {
    return {
      organizationId: Number(fromConn.rows[0].id),
      hasIngestToken: Boolean(fromConn.rows[0].has_ingest),
    };
  }

  return null;
}

function isShopifyProxyTimestampValid(timestampRaw) {
  const ts = parseInt(String(timestampRaw ?? ''), 10);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const now = Math.floor(Date.now() / 1000);
  const maxSkew = Number.isFinite(PROXY_TIMESTAMP_MAX_SKEW_SEC) && PROXY_TIMESTAMP_MAX_SKEW_SEC > 0
    ? PROXY_TIMESTAMP_MAX_SKEW_SEC
    : 86400;
  return Math.abs(now - ts) <= maxSkew;
}

function shopDomainFromProxyRequest(req) {
  const fromQuery = sanitizeShopDomain(req.query?.shop);
  if (fromQuery) return fromQuery;
  const host = String(req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (host.endsWith('.myshopify.com')) return sanitizeShopDomain(host);
  return null;
}

module.exports = {
  syncOrganizationShopifyDomain,
  resolveOrganizationByShopDomain,
  isShopifyProxyTimestampValid,
  shopDomainFromProxyRequest,
};
