'use strict';

const crypto = require('crypto');

function timingSafeEqualString(a, b) {
  try {
    const ba = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function getStateSecret() {
  const s = String(process.env.JWT_SECRET || '').trim();
  if (!s) {
    throw new Error('JWT_SECRET requerido para firmar state OAuth Meta');
  }
  return s;
}

/**
 * @param {{ o: number, u: number }} payload organizationId y userId
 */
function signMetaOAuthState(payload) {
  const secret = getStateSecret();
  const exp = Date.now() + 15 * 60 * 1000;
  const o = Number(payload.o);
  const u = Number(payload.u);
  if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(u) || u <= 0) {
    throw new Error('payload OAuth inválido');
  }
  const body = Buffer.from(JSON.stringify({ o, u, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** @returns {{ organizationId: number, userId: number } | null} */
function verifyMetaOAuthState(state) {
  if (!state || typeof state !== 'string') return null;
  const i = state.lastIndexOf('.');
  if (i <= 0) return null;
  const body = state.slice(0, i);
  const sig = state.slice(i + 1);
  let secret;
  try {
    secret = getStateSecret();
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!timingSafeEqualString(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp < Date.now()) return null;
  const organizationId = Number(payload.o);
  const userId = Number(payload.u);
  if (!Number.isFinite(organizationId) || organizationId <= 0 || !Number.isFinite(userId) || userId <= 0) {
    return null;
  }
  return { organizationId, userId };
}

/**
 * Intercambia el authorization code OAuth por access token de corta duración.
 * @param {string} graphVersion ej. v21.0
 */
async function exchangeMetaOAuthCode(graphVersion, clientId, clientSecret, redirectUri, code) {
  const u = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('client_secret', clientSecret);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('code', code);
  let res;
  try {
    res = await fetch(u);
  } catch (e) {
    return { ok: false, error: e.message || 'network' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const msg =
      data.error && typeof data.error === 'object'
        ? data.error.message || JSON.stringify(data.error)
        : (data.error && data.error.message) || JSON.stringify(data);
    return { ok: false, error: typeof msg === 'string' ? msg : 'code_exchange_failed', raw: data };
  }
  return { ok: true, access_token: data.access_token };
}

module.exports = {
  signMetaOAuthState,
  verifyMetaOAuthState,
  exchangeMetaOAuthCode,
};
