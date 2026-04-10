/**
 * Cliente para la API local de AdsPower (mismo equipo donde corre el backend).
 * Base URL: ajustes de AdsPower → Local API (p. ej. http://127.0.0.1:50325).
 * Documentación: GET /api/v2/browser-profile/cookies (1 solicitud/seg aprox.).
 */

const DEFAULT_BASE = 'http://127.0.0.1:50325';
const MIN_GAP_MS = 1100;

function getBaseUrl() {
  return String(process.env.ADSPOWER_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
}

/** Cola simple: respeta el intervalo mínimo entre llamadas a AdsPower (proceso). */
let chain = Promise.resolve();

function enqueueAdsPower(task) {
  const run = chain.then(async () => {
    try {
      return await task();
    } finally {
      await new Promise((r) => setTimeout(r, MIN_GAP_MS));
    }
  });
  chain = run.catch(() => {});
  return run;
}

/**
 * @param {string} profileId
 * @returns {Promise<{ ok: true, count: number } | { ok: false, error: string, status?: number }>}
 */
async function fetchProfileCookieCount(profileId) {
  const base = getBaseUrl();
  const url = `${base}/api/v2/browser-profile/cookies?profile_id=${encodeURIComponent(profileId)}`;

  const headers = {};
  const apiKey = process.env.ADSPOWER_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let res;
  try {
    res = await fetch(url, { method: 'GET', headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error de red';
    return {
      ok: false,
      error:
        'No se pudo contactar AdsPower. Comprueba que la app esté abierta, la Local API activa y ADSPOWER_API_BASE.',
      detail: msg,
    };
  }

  if (!res.ok) {
    return { ok: false, error: `AdsPower respondió HTTP ${res.status}`, status: res.status };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: 'Respuesta de AdsPower no es JSON válido' };
  }

  if (body.code !== 0) {
    const msg =
      typeof body.msg === 'string' && body.msg.trim()
        ? body.msg.trim()
        : 'AdsPower rechazó la solicitud';
    return { ok: false, error: msg };
  }

  const raw = body.data?.cookies;
  if (raw == null || raw === '') {
    return { ok: true, count: 0 };
  }

  let arr;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'El campo cookies no es JSON válido' };
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  } else {
    return { ok: false, error: 'Formato de cookies no reconocido' };
  }

  return { ok: true, count: Array.isArray(arr) ? arr.length : 0 };
}

function getProfileCookieCount(profileId) {
  return enqueueAdsPower(() => fetchProfileCookieCount(profileId));
}

module.exports = {
  getBaseUrl,
  getProfileCookieCount,
};
