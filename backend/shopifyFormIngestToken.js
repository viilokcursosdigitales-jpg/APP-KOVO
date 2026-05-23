const crypto = require('crypto');

function ingestTokenPepper() {
  return String(process.env.JWT_SECRET || process.env.INGEST_TOKEN_PEPPER || 'kovo-ingest-default').trim();
}

function hashIngestToken(token) {
  return crypto.createHmac('sha256', ingestTokenPepper()).update(String(token || '').trim()).digest('hex');
}

function generatePlainIngestToken() {
  return `kovo_ingest_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} token
 * @returns {Promise<number|null>}
 */
async function resolveOrganizationIdByIngestToken(pool, token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const hash = hashIngestToken(t);
  const { rows } = await pool.query(
    'SELECT id FROM organizations WHERE shopify_form_ingest_token_hash = $1 LIMIT 2',
    [hash],
  );
  if (rows.length !== 1) return null;
  return Number(rows[0].id);
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} organizationId
 */
async function rotateOrganizationIngestToken(pool, organizationId) {
  const plain = generatePlainIngestToken();
  const hash = hashIngestToken(plain);
  const upd = await pool.query(
    `UPDATE organizations
     SET shopify_form_ingest_token_hash = $2,
         shopify_form_ingest_token_rotated_at = now()
     WHERE id = $1`,
    [organizationId, hash],
  );
  if (!upd.rowCount) return null;
  const { rows } = await pool.query(
    'SELECT shopify_form_ingest_token_rotated_at FROM organizations WHERE id = $1',
    [organizationId],
  );
  const rotatedAt = rows[0]?.shopify_form_ingest_token_rotated_at;
  return {
    ingest_token: plain,
    rotated_at: rotatedAt != null ? new Date(rotatedAt).toISOString() : new Date().toISOString(),
  };
}

module.exports = {
  hashIngestToken,
  generatePlainIngestToken,
  resolveOrganizationIdByIngestToken,
  rotateOrganizationIngestToken,
};
