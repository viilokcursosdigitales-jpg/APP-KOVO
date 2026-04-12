/**
 * Renovación automática de tokens de usuario Meta (tipo evaluator).
 * Credenciales de app: se usan las guardadas por organización (app_id / app_secret);
 * si META_APP_ID y META_APP_SECRET existen en env y META_APP_ID coincide con el app_id
 * de la fila, se usa el secret del env (útil si no quieres duplicar el secret en BD).
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRES_IN_SEC = 60 * 24 * 60 * 60; // ~60 días si Meta no envía expires_in

/**
 * @param {import('pg').Pool} pool
 * @param {string} graphVersion ej. v21.0
 */
async function getMetaConnectionConnectedForOrg(pool, organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM meta_connections
     WHERE organization_id = $1 AND status = 'connected'
     ORDER BY id DESC
     LIMIT 1`,
    [organizationId],
  );
  return rows[0] || null;
}

function getAppCredentialsForExchange(row) {
  const rowAppId = String(row.app_id || '').replace(/\s/g, '');
  const envId = process.env.META_APP_ID ? String(process.env.META_APP_ID).replace(/\s/g, '') : '';
  const envSecret = process.env.META_APP_SECRET ? String(process.env.META_APP_SECRET).trim() : '';
  if (envId && envSecret && envId === rowAppId) {
    return { appId: envId, appSecret: envSecret };
  }
  return { appId: rowAppId, appSecret: String(row.app_secret || '').trim() };
}

/**
 * Intercambia el token actual por uno long-lived y devuelve { ok, access_token?, expires_at?, error? }
 * @param {string} graphVersion
 */
async function exchangeFbUserToken(graphVersion, clientId, clientSecret, fbExchangeToken) {
  const u = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('client_secret', clientSecret);
  u.searchParams.set('fb_exchange_token', fbExchangeToken);

  let res;
  try {
    res = await fetch(u);
  } catch (e) {
    return { ok: false, error: e.message || 'network' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const msg = (data.error && (data.error.message || data.error)) || JSON.stringify(data);
    return { ok: false, error: typeof msg === 'string' ? msg : 'exchange_failed', raw: data };
  }
  const expiresIn = Number(data.expires_in);
  const sec = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN_SEC;
  const expiresAt = new Date(Date.now() + sec * 1000);
  return { ok: true, access_token: data.access_token, expires_at: expiresAt };
}

/**
 * Marca la conexión como desconectada tras fallo de renovación.
 * @param {import('pg').Pool} pool
 */
async function markConnectionDisconnectedTokenFailed(pool, connectionId, organizationId) {
  await pool.query(
    `UPDATE meta_connections
     SET status = 'disconnected',
         access_token = NULL,
         disconnect_reason = 'token_refresh_failed',
         token_expires_at = NULL
     WHERE id = $1 AND organization_id = $2`,
    [connectionId, organizationId],
  );
}

/**
 * Renueva el token long-lived para la organización (conexión connected más reciente).
 * @param {import('pg').Pool} pool
 * @param {string} graphVersion
 * @param {number} organizationId
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function refreshMetaTokenForOrganization(pool, graphVersion, organizationId) {
  const row = await getMetaConnectionConnectedForOrg(pool, organizationId);
  if (!row) return { ok: false, reason: 'no_connection' };
  const tokenType = row.token_type || 'evaluator';
  if (tokenType === 'system_user') return { ok: true, reason: 'system_user_skip' };
  const token = String(row.access_token || '').trim();
  if (!token) return { ok: false, reason: 'no_token' };

  const { appId, appSecret } = getAppCredentialsForExchange(row);
  if (!appId || !appSecret) {
    await markConnectionDisconnectedTokenFailed(pool, row.id, organizationId);
    return { ok: false, reason: 'missing_app_credentials' };
  }

  const ex = await exchangeFbUserToken(graphVersion, appId, appSecret, token);
  if (!ex.ok) {
    console.error('[meta-token] refresh failed org', organizationId, ex.error);
    await markConnectionDisconnectedTokenFailed(pool, row.id, organizationId);
    return { ok: false, reason: 'exchange_error' };
  }

  await pool.query(
    `UPDATE meta_connections
     SET access_token = $1,
         token_expires_at = $2,
         disconnect_reason = NULL,
         status = 'connected'
     WHERE id = $3 AND organization_id = $4`,
    [ex.access_token, ex.expires_at.toISOString(), row.id, organizationId],
  );
  return { ok: true };
}

/**
 * Tras crear o actualizar token: intercambiar a long-lived y guardar expiración (solo evaluator).
 * @param {import('pg').Pool} pool
 * @param {string} graphVersion
 * @param {number} connectionId
 * @param {number} organizationId
 */
async function exchangeAndPersistLongLivedForConnection(pool, graphVersion, connectionId, organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM meta_connections WHERE id = $1 AND organization_id = $2`,
    [connectionId, organizationId],
  );
  const row = rows[0];
  if (!row) return;
  const tokenType = row.token_type || 'evaluator';
  if (tokenType === 'system_user') {
    await pool.query(
      `UPDATE meta_connections SET token_expires_at = NULL, disconnect_reason = NULL WHERE id = $1`,
      [connectionId],
    );
    return;
  }
  const token = String(row.access_token || '').trim();
  if (!token) return;

  const { appId, appSecret } = getAppCredentialsForExchange(row);
  if (!appId || !appSecret) return;

  const ex = await exchangeFbUserToken(graphVersion, appId, appSecret, token);
  if (!ex.ok) {
    console.error('[meta-token] initial exchange failed', connectionId, ex.error);
    return;
  }
  await pool.query(
    `UPDATE meta_connections
     SET access_token = $1, token_expires_at = $2, disconnect_reason = NULL
     WHERE id = $3 AND organization_id = $4`,
    [ex.access_token, ex.expires_at.toISOString(), connectionId, organizationId],
  );
}

/**
 * Si hace falta, renueva antes de usar Graph API (evaluator: &lt; 7 días para expirar o sin fecha).
 * @param {import('pg').Pool} pool
 * @param {string} graphVersion
 * @param {number} organizationId
 * @returns {Promise<object | null>} fila meta_connections connected o null
 */
async function ensureValidMetaTokenForOrg(pool, graphVersion, organizationId) {
  let row = await getMetaConnectionConnectedForOrg(pool, organizationId);
  if (!row) return null;
  const tokenType = row.token_type || 'evaluator';
  if (tokenType === 'system_user') return row;

  const token = String(row.access_token || '').trim();
  if (!token) return row;

  const now = Date.now();
  let expiresMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (!row.token_expires_at || Number.isNaN(expiresMs)) {
    await refreshMetaTokenForOrganization(pool, graphVersion, organizationId);
    row = await getMetaConnectionConnectedForOrg(pool, organizationId);
    return row;
  }

  if (expiresMs - now < SEVEN_DAYS_MS) {
    await refreshMetaTokenForOrganization(pool, graphVersion, organizationId);
    row = await getMetaConnectionConnectedForOrg(pool, organizationId);
  }
  return row;
}

/**
 * Cron: todas las conexiones evaluator conectadas con token; renovar si &lt; 15 días.
 * @param {import('pg').Pool} pool
 * @param {string} graphVersion
 */
async function runEvaluatorTokenRefreshCron(pool, graphVersion) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, token_expires_at, access_token, token_type
     FROM meta_connections
     WHERE status = 'connected'
       AND access_token IS NOT NULL
       AND length(trim(access_token)) > 0
       AND (token_type = 'evaluator' OR token_type IS NULL)`,
  );

  const now = Date.now();
  for (const r of rows) {
    const exp = r.token_expires_at ? new Date(r.token_expires_at).getTime() : 0;
    const needs =
      !r.token_expires_at || Number.isNaN(exp) || exp - now < FIFTEEN_DAYS_MS;
    if (!needs) continue;
    const result = await refreshMetaTokenForOrganization(pool, graphVersion, r.organization_id);
    if (result.ok && result.reason !== 'system_user_skip') {
      console.log(`[meta-token-cron] refreshed organization_id=${r.organization_id} connection_id=${r.id}`);
    }
  }
}

module.exports = {
  getMetaConnectionConnectedForOrg,
  refreshMetaTokenForOrganization,
  ensureValidMetaTokenForOrg,
  exchangeAndPersistLongLivedForConnection,
  runEvaluatorTokenRefreshCron,
  exchangeFbUserToken,
  getAppCredentialsForExchange,
  SEVEN_DAYS_MS,
  FIFTEEN_DAYS_MS,
};
