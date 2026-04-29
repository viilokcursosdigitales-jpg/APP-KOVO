require('./loadEnv').loadEnv();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createPool } = require('./db/pool');
const { initDb, uniqueSlug } = require('./db/initDb');
const {
  computeOrganizationCommissionPeriodTotals,
  findMinDespachadoCommissionUpdatedAtMs,
  buildClosedCommissionCutSpecs,
} = require('./comisionVentasPeriod');
const {
  normalizeActId,
  datePresetFromDashboardPeriod,
  listAdAccounts,
  fetchInsightsForAdAccount,
  filterValidAdAccountIds,
  fetchFunnelForAdAccounts,
  fetchMergedDailyInsightsForAdAccounts,
  fetchTotalSpendForAdAccountsTimeRange,
  fetchDailySpendByDayForAdAccountsTimeRange,
  fetchDailyInsightsByDayForAdAccountsTimeRange,
  getCampaignAdAccountId,
  updateCampaignStatusGraph,
} = require('./metaMarketingApi');
const cron = require('node-cron');
const {
  ensureValidMetaTokenForOrg,
  exchangeAndPersistLongLivedForConnection,
  runEvaluatorTokenRefreshCron,
} = require('./metaTokenService');
const {
  sanitizeShopDomain,
  verifyShopifyOAuthHmac,
  verifyShopifyWebhookHmac,
  shopifyRequest,
  registerUninstallWebhook,
  normalizeShopifyOrdersForApp,
  mapFinancialToBadge,
  shopifyOrderCreatedRangeForMetaPeriod,
  shopifyOrderCreatedRangeForCalendarDate,
  shopCalendarYmdFromInstant,
  parseIsoDateYmd,
  shopifyFetchAllOrders,
  shopifyInformativeOrdersRangeYearToDate,
  shopifyClampInformativeCreatedAtRange,
  phoneWithoutColombia57,
} = require('./shopifyService');
const {
  getPublicAppUrl,
  sendInvitationEmail,
  isMailConfigured,
  sendPasswordResetEmail,
  getMailTransportInfo,
} = require('./mailService');
const staticDir = process.env.STATIC_DIR || path.join(__dirname, '..', 'frontend', 'dist');
const hasFrontendDist = fs.existsSync(staticDir);

const COMMISSION_PAYMENT_PROOFS_DIR = path.join(__dirname, 'uploads', 'commission-payment-proofs');
function ensureCommissionPaymentProofsDir() {
  try {
    fs.mkdirSync(COMMISSION_PAYMENT_PROOFS_DIR, { recursive: true });
  } catch (e) {
    console.warn('[commission-payment-proof] mkdir:', e && e.message);
  }
}

function parseCommissionCutsAsOfDate(raw) {
  const s = String(raw ?? '')
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (Number.isNaN(Date.parse(`${s}T12:00:00Z`))) return null;
  return s;
}

function decodeBase64ImagePayload(raw) {
  let s = String(raw || '').trim();
  const dataIdx = s.indexOf('base64,');
  if (s.startsWith('data:') && dataIdx >= 0) s = s.slice(dataIdx + 7);
  s = s.replace(/\s/g, '');
  if (!s) return null;
  try {
    return Buffer.from(s, 'base64');
  } catch {
    return null;
  }
}

function detectImageMimeFromBuffer(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

const JWT_SECRET = process.env.JWT_SECRET || 'kovo-dev-secret-change-in-production';
const JWT_EXPIRES = '7d';
const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_HOURS = 1;
const INVITE_DAYS = 7;

const PLAN_LIMITS = {
  free: { users: 5, metaConnections: 1 },
  pro: { users: 10, metaConnections: 5 },
  enterprise: { users: Infinity, metaConnections: Infinity },
};
const META_SNAPSHOT_TIMEZONE =
  String(process.env.META_SNAPSHOT_TZ || process.env.CRON_TZ || 'Europe/Madrid').trim() || 'Europe/Madrid';

/** Slugs de módulos configurables (sidebar); perfil y configuración no se restringen aquí. */
const CONFIGURABLE_MODULE_IDS = [
  'dashboard',
  'analisis_producto',
  'pedidos',
  'relacion_pagos_motico',
  'inventario',
  'meta_ads',
  'ads_funnel',
  'finanza',
  'indicadores_marketing',
  'canales',
  'ganancia_diaria',
  'calculadora_cod',
  'planeacion_ventas',
  'comision_ventas',
];

const MODULE_CATALOG_FOR_API = [
  { id: 'dashboard', label: 'Inicio', group: 'Principal' },
  { id: 'analisis_producto', label: 'Analisis de productos', group: 'Principal' },
  { id: 'pedidos', label: 'Pedidos', group: 'Principal' },
  { id: 'relacion_pagos_motico', label: 'Relación de Pagos Motico', group: 'Principal' },
  { id: 'inventario', label: 'Inventario', group: 'Principal' },
  { id: 'meta_ads', label: 'Meta Ads', group: 'Marketing' },
  { id: 'ads_funnel', label: 'Ads Funnel', group: 'Marketing' },
  { id: 'finanza', label: 'Finanza', group: 'Marketing' },
  { id: 'indicadores_marketing', label: 'Indicadores', group: 'Marketing' },
  { id: 'canales', label: 'Canales', group: 'Marketing' },
  { id: 'ganancia_diaria', label: 'Ganancia Diaria', group: 'Marketing' },
  { id: 'calculadora_cod', label: 'Calculadora COD', group: 'Marketing' },
  { id: 'planeacion_ventas', label: 'Planeación de Ventas', group: 'Marketing' },
  { id: 'comision_ventas', label: 'Comisión por Ventas', group: 'Marketing' },
];

const pool = createPool();
const RESPONSE_CACHE_TTL_MS_DEFAULT = Number(process.env.RESPONSE_CACHE_TTL_MS || 45_000);
const responseCacheStore = new Map();

function cacheTtlMs(valueMs) {
  const n = Number(valueMs);
  return Number.isFinite(n) && n > 0 ? n : RESPONSE_CACHE_TTL_MS_DEFAULT;
}

function cacheKeyForRequest(req, scope) {
  const org = Number(req.organizationId) || 0;
  const role = String(req.userRole || '');
  const url = String(req.originalUrl || req.url || '');
  return `${String(scope || 'default')}|org:${org}|role:${role}|${url}`;
}

function readCachedJsonResponse(key) {
  const now = Date.now();
  const hit = responseCacheStore.get(String(key));
  if (!hit) return null;
  if (!Number.isFinite(hit.expiresAt) || hit.expiresAt <= now) {
    responseCacheStore.delete(String(key));
    return null;
  }
  return hit.payload;
}

function writeCachedJsonResponse(key, payload, ttlMs) {
  const ttl = cacheTtlMs(ttlMs);
  responseCacheStore.set(String(key), {
    payload,
    expiresAt: Date.now() + ttl,
  });
}

function cleanupExpiredResponseCache() {
  const now = Date.now();
  for (const [key, value] of responseCacheStore) {
    if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) {
      responseCacheStore.delete(key);
    }
  }
}
const responseCacheGcTimer = setInterval(cleanupExpiredResponseCache, 60_000);
if (typeof responseCacheGcTimer.unref === 'function') responseCacheGcTimer.unref();

function parseCorsOrigins() {
  const devDefaults = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const raw = process.env.CORS_ORIGINS;
  const fromEnv =
    raw && String(raw).trim()
      ? String(raw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const fromShopifyEnv = [];
  for (const u of [process.env.SHOPIFY_APP_URL, process.env.SHOPIFY_REDIRECT_URI]) {
    const s = String(u || '').trim();
    if (!s.startsWith('http')) continue;
    try {
      fromShopifyEnv.push(new URL(s).origin);
    } catch {
      /* ignore */
    }
  }
  return [...new Set([...devDefaults, ...fromEnv, ...fromShopifyEnv])];
}

const app = express();
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

const corsAllowed = parseCorsOrigins();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (corsAllowed.includes(origin)) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(
  express.json({
    limit: '6mb',
    verify(req, res, buf) {
      if (req.method === 'POST' && String(req.originalUrl || '').startsWith('/api/shopify/webhooks/')) {
        req.rawBody = Buffer.from(buf);
      }
    },
  }),
);

const SHOPIFY_API_KEY = String(process.env.SHOPIFY_API_KEY || '').trim();
const SHOPIFY_API_SECRET = String(process.env.SHOPIFY_API_SECRET || '').trim();
const SHOPIFY_APP_URL = String(process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
const SHOPIFY_REDIRECT_URI =
  String(process.env.SHOPIFY_REDIRECT_URI || '').trim() ||
  (SHOPIFY_APP_URL ? `${SHOPIFY_APP_URL}/api/shopify/callback` : '');
const SHOPIFY_SCOPES = String(process.env.SHOPIFY_SCOPES || '')
  .split(/[\s,]+/)
  .filter(Boolean)
  .join(',');

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

async function countActiveUsers(organizationId) {
  const r = await pool.query(
    'SELECT COUNT(*)::int AS c FROM users WHERE organization_id = $1 AND is_active = true',
    [organizationId],
  );
  return r.rows[0].c;
}

async function countPendingInvites(organizationId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM invitations
     WHERE organization_id = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [organizationId],
  );
  return r.rows[0].c;
}

async function countConnectedMeta(organizationId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM meta_connections
     WHERE organization_id = $1 AND status = 'connected'`,
    [organizationId],
  );
  return r.rows[0].c;
}

async function getOrgPlan(organizationId) {
  const r = await pool.query('SELECT plan FROM organizations WHERE id = $1', [organizationId]);
  return r.rows[0]?.plan || 'free';
}

/** @returns {Promise<{ users: { used: number, max: number | null }, meta: { used: number, max: number | null } }>} */
async function getUsageSnapshot(organizationId) {
  const plan = await getOrgPlan(organizationId);
  const lim = getPlanLimits(plan);
  const usedUsers = await countActiveUsers(organizationId);
  const pending = await countPendingInvites(organizationId);
  const usedMeta = await countConnectedMeta(organizationId);
  const maxU = lim.users === Infinity ? null : lim.users;
  const maxM = lim.metaConnections === Infinity ? null : lim.metaConnections;
  return {
    users: { used: usedUsers + pending, max: maxU },
    meta: { used: usedMeta, max: maxM },
  };
}

/**
 * @param {number} organizationId
 * @param {'invite_user'|'meta_connection'} feature
 */
function normalizeConfigurableModulesList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    let id = String(x || '').trim();
    if (id === 'motico') id = 'pedidos';
    if (!id || seen.has(id) || !CONFIGURABLE_MODULE_IDS.includes(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Guarda auditoría de cambios sobre pedidos (Shopify y manuales Motico).
 * No rompe el flujo principal si el log falla.
 */
async function appendOrderChangeLog(req, params) {
  const p = params && typeof params === 'object' ? params : {};
  const source = String(p.orderSource || '').trim();
  const orderId = Number(p.orderId);
  const action = String(p.action || '').trim();
  if (!source || !Number.isFinite(orderId) || !action) return;
  const payload =
    p.payload && typeof p.payload === 'object' ? p.payload : {};
  try {
    await pool.query(
      `INSERT INTO order_change_logs
       (organization_id, order_source, order_id, action, user_id, user_name, user_email, user_role, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        req.organizationId,
        source,
        orderId,
        action,
        req.user?.userId || null,
        String(req.user?.name || ''),
        String(req.user?.email || ''),
        String(req.user?.role || ''),
        JSON.stringify(payload),
      ],
    );
  } catch (e) {
    if (e && e.code === '42P01') {
      console.warn('[order-change-log] tabla faltante order_change_logs');
      return;
    }
    console.warn('[order-change-log] no se pudo registrar auditoría:', e && e.message);
  }
}

async function listOrganizationRoleRows(organizationId) {
  let custom = [];
  try {
    const cr = await pool.query(
      `SELECT slug, label, base_role FROM organization_custom_roles WHERE organization_id = $1 ORDER BY label`,
      [organizationId],
    );
    custom = cr.rows;
  } catch (e) {
    if (e && e.code !== '42P01') throw e;
  }
  return [
    { slug: 'owner', label: 'Propietario', editable: true },
    { slug: 'admin', label: 'Administrador', editable: true },
    { slug: 'member', label: 'Miembro', editable: true },
    ...custom.map((c) => ({
      slug: c.slug,
      label: `${c.label} (${c.base_role === 'admin' ? 'como admin' : 'como miembro'})`,
      editable: true,
    })),
  ];
}

async function fetchShopifyTotalsByOrderIds(organizationId, orderIds) {
  const out = new Map();
  const ids = Array.isArray(orderIds)
    ? [...new Set(orderIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))]
    : [];
  if (!ids.length) return out;
  const shop = await getActiveShopifyConnection(organizationId);
  if (!shop) return out;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    try {
      const endpoint = `orders.json?status=any&ids=${encodeURIComponent(slice.join(','))}&fields=id,total_price`;
      const r = await shopifyRequest(shop.shop_domain, shop.access_token, endpoint);
      const rows =
        r && r.ok && r.data && Array.isArray(r.data.orders)
          ? r.data.orders
          : [];
      for (const o of rows) {
        const id = Number(o?.id);
        const total = Number.parseFloat(String(o?.total_price ?? '0').replace(',', '.'));
        if (!Number.isFinite(id) || id <= 0) continue;
        out.set(id, Number.isFinite(total) && total > 0 ? total : 0);
      }
    } catch (e) {
      console.warn('[comision-ventas] fetchShopifyTotalsByOrderIds chunk error:', e && e.message);
    }
  }
  return out;
}

/**
 * null = acceso a todos los módulos configurables (comportamiento por defecto).
 * array = solo esos ids.
 */
async function resolveModuleAccessForSession(organizationId, roleSlug, roleTier) {
  if (roleSlug === 'owner' || roleTier === 'owner') {
    return null;
  }
  let row;
  try {
    const r = await pool.query(
      `SELECT full_access, modules FROM organization_role_modules
       WHERE organization_id = $1 AND role_slug = $2`,
      [organizationId, roleSlug],
    );
    row = r.rows[0];
  } catch (e) {
    if (e && e.code === '42P01') return null;
    throw e;
  }
  if (!row) return null;
  if (row.full_access) return null;
  return normalizeConfigurableModulesList(row.modules);
}

async function checkPlanLimit(organizationId, feature) {
  const plan = await getOrgPlan(organizationId);
  const lim = getPlanLimits(plan);
  if (feature === 'invite_user') {
    const used = (await countActiveUsers(organizationId)) + (await countPendingInvites(organizationId));
    if (used >= lim.users) {
      return {
        ok: false,
        message:
          plan === 'free'
            ? `El plan gratuito permite hasta ${lim.users} usuarios (activos e invitaciones pendientes). Mejora tu plan para ampliar el equipo.`
            : `Has alcanzado el límite de ${lim.users} usuarios de tu plan ${plan}.`,
      };
    }
  }
  if (feature === 'meta_connection') {
    const used = await countConnectedMeta(organizationId);
    if (used >= lim.metaConnections) {
      return {
        ok: false,
        message:
          plan === 'free'
            ? 'El plan gratuito permite 1 conexión Meta. Actualiza tu plan para agregar más conexiones.'
            : `Has alcanzado el límite de ${lim.metaConnections} conexiones Meta en el plan ${plan}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * @param {string} accessToken JWT sin prefijo Bearer
 * @returns {Promise<true|'jwt'|'user'>}
 */
async function loadSessionFromAccessToken(accessToken, req) {
  let decoded;
  try {
    decoded = jwt.verify(accessToken, JWT_SECRET);
  } catch {
    return 'jwt';
  }

  const { rows } = await pool.query(
    `SELECT u.id as "userId", u.email, u.name, u.created_at, u.organization_id, u.role, u.is_active
     FROM users u
     WHERE u.id = $1`,
    [decoded.userId],
  );
  const row = rows[0];

  if (!row || !row.is_active || !row.organization_id) {
    return 'user';
  }

  req.user = {
    userId: row.userId,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    organizationId: row.organization_id,
    role: row.role,
  };
  req.organizationId = row.organization_id;
  return true;
}

/** Permiso efectivo: owner | admin | member (roles personalizados heredan admin o member). */
async function getRoleTier(userId, organizationId) {
  const { rows } = await pool.query(
    `SELECT role FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true`,
    [userId, organizationId],
  );
  const r = rows[0]?.role;
  if (r == null) return null;
  if (r === 'owner') return 'owner';
  if (r === 'admin') return 'admin';
  if (r === 'member') return 'member';
  const cr = await pool.query(
    `SELECT base_role FROM organization_custom_roles WHERE organization_id = $1 AND slug = $2`,
    [organizationId, r],
  );
  if (cr.rows[0]) return cr.rows[0].base_role;
  return 'member';
}

function slugifyRoleLabel(label) {
  return (
    String(label || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'rol'
  );
}

async function uniqueCustomRoleSlug(organizationId, label) {
  const base = slugifyRoleLabel(label);
  let n = 0;
  for (;;) {
    const slug = n === 0 ? base : `${base}_${n}`;
    if (slug === 'owner' || slug === 'admin' || slug === 'member') {
      n += 1;
      continue;
    }
    const clash = await pool.query(
      `SELECT 1 FROM organization_custom_roles WHERE organization_id = $1 AND slug = $2
       UNION ALL SELECT 1 FROM users WHERE organization_id = $1 AND role = $2 LIMIT 1`,
      [organizationId, slug],
    );
    if (clash.rowCount === 0) return String(slug).slice(0, 64);
    n += 1;
  }
}

async function isAssignableOrgRole(organizationId, role) {
  if (role === 'owner' || role === 'admin' || role === 'member') return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM organization_custom_roles WHERE organization_id = $1 AND slug = $2`,
    [organizationId, role],
  );
  return rows.length > 0;
}

async function invitationRoleLabel(organizationId, roleSlug) {
  const r = String(roleSlug || '');
  if (r === 'admin') return 'Administrador';
  if (r === 'member') return 'Miembro';
  const { rows } = await pool.query(
    `SELECT label, base_role FROM organization_custom_roles WHERE organization_id = $1 AND slug = $2`,
    [organizationId, r],
  );
  const row = rows[0];
  if (row) {
    return `${row.label} (${row.base_role === 'admin' ? 'como administrador' : 'como miembro'})`;
  }
  return r || 'miembro';
}

/** Envía el correo de invitación (mismo enlace mientras el token no cambie). */
async function sendInvitationNotification(organizationId, email, role, token, inviterUserId) {
  const orgR = await pool.query(`SELECT name FROM organizations WHERE id = $1`, [organizationId]);
  const organizationName = orgR.rows[0]?.name || 'KOVO';
  const inviterR = await pool.query(`SELECT name FROM users WHERE id = $1`, [inviterUserId]);
  const inviterName = inviterR.rows[0]?.name || 'Un administrador';
  const roleLabel = await invitationRoleLabel(organizationId, role);
  const acceptUrl = `${getPublicAppUrl()}/aceptar-invitacion?token=${encodeURIComponent(token)}`;
  const sendRes = await sendInvitationEmail({
    to: email,
    organizationName,
    inviterName,
    roleLabel,
    acceptUrl,
  });
  return { sendRes, acceptUrl };
}

function logInvitationSmtp(email, acceptUrl, sendRes) {
  if (!isMailConfigured()) {
    console.warn(`[invite] Correo no configurado (Resend/SMTP). Enlace invitación ${email}: ${acceptUrl}`);
  } else if (!sendRes.ok && !sendRes.skipped) {
    console.error(`[invite] Fallo envío correo para ${email}:`, sendRes.error);
  } else if (process.env.NODE_ENV !== 'production' && sendRes.ok) {
    console.log(`[invite] Correo enviado a ${email} · ${acceptUrl}`);
  }
}

/** Mensaje para la UI según resultado de Resend/SMTP (incluye pistas de Resend “solo tu email” / dominio). */
function inviteEmailUserMessage(sendRes, invitedEmail, opts = {}) {
  const resent = Boolean(opts.resent);
  const fromResend = sendRes && sendRes.resend_status != null;
  if (sendRes.ok) {
    return {
      email_sent: true,
      message: resent
        ? `Se reenvió el correo a ${invitedEmail} con el mismo enlace de invitación.`
        : `Se envió un correo a ${invitedEmail} con el enlace para aceptar la invitación.`,
    };
  }
  if (sendRes.skipped) {
    return {
      email_sent: false,
      message: resent
        ? 'No hay Resend ni SMTP configurado. Copia el enlace y envíalo tú (es el mismo de siempre).'
        : 'Invitación creada. No hay Resend ni SMTP configurado en el servidor; copia el enlace que muestra la app y envíalo tú.',
    };
  }
  const err = String(sendRes.error || '');
  let message = resent
    ? `No se pudo reenviar el correo (${err || 'error de envío'}). Copia el enlace y envíalo tú.`
    : `Invitación creada, pero no se pudo enviar el correo (${err || 'error de envío'}). Copia el enlace y envíalo tú.`;
  if (/only send testing emails|your own email address/i.test(err)) {
    message +=
      ' En Resend, con remitente de prueba (p. ej. onboarding@resend.dev) solo se entrega a tu propio correo. Verifica un dominio en https://resend.com/domains y usa RESEND_FROM del tipo «Nombre <noreply@tudominio.com>» para invitar a cualquier dirección.';
  } else if (/domain is not verified|not verified/i.test(err)) {
    message +=
      ' El dominio del remitente no está verificado en Resend: completa SPF/DKIM en el panel de Resend.';
  } else if (/invalid_api_key|API key is invalid|Missing API key|restricted_api_key/i.test(err)) {
    message +=
      ' Revisa RESEND_API_KEY en Render (clave de envío, sin comillas ni espacios al inicio/final).';
  } else if (!fromResend && err) {
    message += ' Si usas SMTP, comprueba usuario, contraseña y puerto.';
  }
  return { email_sent: false, message };
}

async function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const r = await loadSessionFromAccessToken(auth.slice(7), req);
  if (r === 'jwt') {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  if (r === 'user') {
    return res.status(401).json({ error: 'Usuario no válido' });
  }
  next();
}

function requireRole(...allowed) {
  return (req, res, next) => {
    (async () => {
      try {
        const tier = await getRoleTier(req.user.userId, req.user.organizationId);
        if (!tier || !allowed.includes(tier)) {
          return res.status(403).json({ error: 'No tienes permisos para esta acción' });
        }
        next();
      } catch (e) {
        console.error('[requireRole]', e);
        return res.status(500).json({ error: 'Error de autorización' });
      }
    })();
  };
}

function scopeToOrganization(req, res, next) {
  req.organizationId = req.user.organizationId;
  next();
}

/** Nombre de producto estable para guardar y buscar (minúsculas, sin acentos, espacios colapsados). */
function normalizeCalculadoraProductName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function calculadoraCalculoRowToJson(r) {
  return {
    id: r.id,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    updated_at: r.updated_at != null ? new Date(r.updated_at).toISOString() : null,
    inputs_json: r.inputs_json,
    kpis_json: r.kpis_json,
    currency: r.currency,
    notes: r.notes,
  };
}

/** KPIs de mezcla al guardar (CPA / ROAS “objetivo” ponderados, nivel embudo generado). */
function mixObjetivoPonderadoFromKpisJson(kpisJson) {
  try {
    const o = kpisJson && typeof kpisJson === 'object' && !Array.isArray(kpisJson) ? kpisJson : {};
    const mix = o.mix && typeof o.mix === 'object' && !Array.isArray(o.mix) ? o.mix : {};
    const cpa = Number(mix.cpaPonderado);
    const roasRaw = mix.roasPonderado;
    const roas = roasRaw == null || roasRaw === '' ? NaN : Number(roasRaw);
    return {
      cpa_objetivo_ponderado: Number.isFinite(cpa) && cpa > 0 ? cpa : null,
      roas_objetivo_ponderado: Number.isFinite(roas) && roas > 0 ? roas : null,
    };
  } catch {
    return { cpa_objetivo_ponderado: null, roas_objetivo_ponderado: null };
  }
}

/** Acceso por módulo (misma lógica que module_access en sesión). null = acceso total. */
function requireModuleAccess(moduleId) {
  const mid = String(moduleId || '').trim();
  return (req, res, next) => {
    (async () => {
      try {
        if (!mid) {
          return res.status(500).json({ error: 'Módulo no configurado' });
        }
        const roleTier = await getRoleTier(req.user.userId, req.user.organizationId);
        const access = await resolveModuleAccessForSession(
          req.user.organizationId,
          req.user.role,
          roleTier,
        );
        if (access === null) return next();
        if (Array.isArray(access) && access.includes(mid)) return next();
        return res.status(403).json({ error: 'No tienes acceso a este módulo' });
      } catch (e) {
        console.error('[requireModuleAccess]', e);
        return res.status(500).json({ error: 'Error de autorización' });
      }
    })();
  };
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function issueToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function buildSessionPayload(userId) {
  const uq = await pool.query(
    `SELECT u.id, u.name, u.email, u.created_at, u.organization_id, u.role
     FROM users u WHERE u.id = $1 AND u.is_active = true`,
    [userId],
  );
  const u = uq.rows[0];
  if (!u) return null;
  const oq = await pool.query('SELECT id, name, slug, plan FROM organizations WHERE id = $1', [
    u.organization_id,
  ]);
  const org = oq.rows[0];
  if (!org) return null;
  const limits = await getUsageSnapshot(org.id);
  const role_tier = (await getRoleTier(u.id, u.organization_id)) || 'member';
  const module_access = await resolveModuleAccessForSession(org.id, u.role, role_tier);
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      created_at: u.created_at,
    },
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
    },
    role: u.role,
    role_tier,
    limits,
    module_access,
  };
}

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

/**
 * Valida App ID + App Secret contra la Graph API (client_credentials).
 * Si se envía accessToken de usuario, comprueba con debug_token y opcionalmente obtiene el nombre.
 */
async function verifyMetaWithGraphApi(appId, appSecret, accessToken) {
  const id = String(appId || '').replace(/\s/g, '');
  const secret = String(appSecret || '').trim();
  const userToken = accessToken ? String(accessToken).trim() : '';

  if (!/^\d+$/.test(id) || id.length < 8 || id.length > 22) {
    const e = new Error('invalid');
    e.code = 'invalid_credentials';
    throw e;
  }
  if (secret.length < 8) {
    const e = new Error('invalid');
    e.code = 'invalid_credentials';
    throw e;
  }

  const tokenUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', id);
  tokenUrl.searchParams.set('client_secret', secret);
  tokenUrl.searchParams.set('grant_type', 'client_credentials');

  let tokenRes;
  try {
    tokenRes = await fetch(tokenUrl);
  } catch {
    const e = new Error('network');
    e.code = 'network';
    throw e;
  }

  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenBody.access_token) {
    const e = new Error('invalid');
    e.code = 'invalid_credentials';
    throw e;
  }

  const appAccessToken = tokenBody.access_token;
  let accountName = `Cuenta publicitaria · App ${id.slice(-4)}`;

  if (userToken.length > 0) {
    if (userToken.length < 30) {
      const e = new Error('token');
      e.code = 'token_expired';
      throw e;
    }
    const debugUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/debug_token`);
    debugUrl.searchParams.set('input_token', userToken);
    debugUrl.searchParams.set('access_token', appAccessToken);

    let debugRes;
    try {
      debugRes = await fetch(debugUrl);
    } catch {
      const e = new Error('network');
      e.code = 'network';
      throw e;
    }

    const debugBody = await debugRes.json().catch(() => ({}));
    const d = debugBody.data;
    if (!debugRes.ok || !d || d.is_valid !== true) {
      const errCode = d && d.error && d.error.code;
      const e = new Error('token');
      e.code = errCode === 190 ? 'token_expired' : 'invalid_credentials';
      throw e;
    }

    try {
      const meUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me`);
      meUrl.searchParams.set('fields', 'name');
      meUrl.searchParams.set('access_token', userToken);
      const meRes = await fetch(meUrl);
      const me = await meRes.json().catch(() => ({}));
      if (meRes.ok && me.name && String(me.name).trim()) {
        accountName = String(me.name).trim();
      }
    } catch {
      /* mantener nombre por defecto */
    }
  }

  return { accountName };
}

function parseAdAccountIdsFromDb(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val.map((x) => String(x)).filter(Boolean);
  if (typeof val === 'string') {
    try {
      const j = JSON.parse(val);
      return Array.isArray(j) ? j.map((x) => String(x)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** @param {string | undefined} queryAdAccountId */
function resolveAdAccountIdsForRequest(queryAdAccountId, storedRawIds) {
  const all = parseAdAccountIdsFromDb(storedRawIds)
    .map((id) => normalizeActId(id))
    .filter(Boolean);
  const allowed = new Set(all);
  const q = queryAdAccountId != null ? String(queryAdAccountId).trim() : '';
  if (!q) {
    return { ok: true, actIds: all };
  }
  const one = normalizeActId(q);
  if (!one || !allowed.has(one)) {
    return { ok: false, actIds: [], code: 'invalid_ad_account' };
  }
  return { ok: true, actIds: [one] };
}

function shiftYmdString(ymdStr, deltaDays) {
  const parsed = parseIsoDateYmd(ymdStr);
  if (!parsed || !Number.isFinite(deltaDays)) return ymdStr;
  const dt = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(deltaDays));
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}

function metaSnapshotTodayYmd(timezone) {
  const ymd = shopCalendarYmdFromInstant(Date.now(), timezone || META_SNAPSHOT_TIMEZONE);
  return gananciaDiariaYmdKey(ymd);
}

function metaSnapshotTargetYmd(timezone) {
  return shiftYmdString(metaSnapshotTodayYmd(timezone), -1);
}

function metaSnapshotRollingDaysForPeriod(periodRaw) {
  const period = String(periodRaw || '').trim().toLowerCase();
  if (period === 'hoy' || period === 'ayer') return 1;
  if (period === '3d') return 3;
  if (period === '7d' || period === 'custom') return 7;
  if (period === '14d') return 14;
  if (period === '30d') return 30;
  return 7;
}

function normalizeMetaSnapshotTotals(raw) {
  const impressions = Number(raw?.impressions) || 0;
  const clicks = Number(raw?.clicks) || 0;
  const spend = Number(raw?.spend) || 0;
  const purchases = Number(raw?.purchases) || 0;
  const revenue = Number(raw?.revenue) || 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const roas = spend > 0 && revenue > 0 ? revenue / spend : 0;
  const cpa = purchases > 0 ? spend / purchases : 0;
  return { impressions, clicks, spend, purchases, revenue, cpm, cpc, ctr, roas, cpa };
}

function aggregateMetaSnapshotRows(rows) {
  const base = { impressions: 0, clicks: 0, spend: 0, purchases: 0, revenue: 0 };
  for (const row of rows || []) {
    base.impressions += Number(row?.impressions) || 0;
    base.clicks += Number(row?.clicks) || 0;
    base.spend += Number(row?.spend) || 0;
    base.purchases += Number(row?.purchases) || 0;
    base.revenue += Number(row?.revenue) || 0;
  }
  return normalizeMetaSnapshotTotals(base);
}

async function upsertMetaDailySnapshotRow(organizationId, snapshotDate, payload) {
  try {
    const totals = normalizeMetaSnapshotTotals(payload);
    await pool.query(
      `INSERT INTO meta_daily_snapshots (
         organization_id, snapshot_date, impressions, clicks, spend, purchases, revenue, cpm, cpc, ctr, roas, cpa,
         currency, ad_account_ids, partial_errors, source, fetched_at, updated_at
       ) VALUES (
         $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, $14::jsonb, $15::jsonb, $16, now(), now()
       )
       ON CONFLICT (organization_id, snapshot_date) DO UPDATE SET
         impressions = EXCLUDED.impressions,
         clicks = EXCLUDED.clicks,
         spend = EXCLUDED.spend,
         purchases = EXCLUDED.purchases,
         revenue = EXCLUDED.revenue,
         cpm = EXCLUDED.cpm,
         cpc = EXCLUDED.cpc,
         ctr = EXCLUDED.ctr,
         roas = EXCLUDED.roas,
         cpa = EXCLUDED.cpa,
         currency = EXCLUDED.currency,
         ad_account_ids = EXCLUDED.ad_account_ids,
         partial_errors = EXCLUDED.partial_errors,
         source = EXCLUDED.source,
         fetched_at = EXCLUDED.fetched_at,
         updated_at = now()`,
      [
        organizationId,
        String(snapshotDate),
        totals.impressions,
        totals.clicks,
        totals.spend,
        totals.purchases,
        totals.revenue,
        totals.cpm,
        totals.cpc,
        totals.ctr,
        totals.roas,
        totals.cpa,
        payload?.currency ? String(payload.currency) : null,
        JSON.stringify(Array.isArray(payload?.ad_account_ids) ? payload.ad_account_ids : []),
        JSON.stringify(Array.isArray(payload?.partial_errors) ? payload.partial_errors : []),
        payload?.source ? String(payload.source) : 'meta_cron',
      ],
    );
    return true;
  } catch (e) {
    if (e && e.code === '42P01') {
      console.warn('[meta-snapshot] Tabla meta_daily_snapshots no existe. Reinicia para ejecutar initDb.');
      return false;
    }
    throw e;
  }
}

async function loadMetaDailySnapshotsForRange(organizationId, sinceYmd, untilYmd) {
  try {
    const { rows } = await pool.query(
      `SELECT snapshot_date, impressions, clicks, spend, purchases, revenue, cpm, cpc, ctr, roas, cpa, currency, fetched_at
       FROM meta_daily_snapshots
       WHERE organization_id = $1
         AND snapshot_date >= $2::date
         AND snapshot_date <= $3::date
       ORDER BY snapshot_date ASC`,
      [organizationId, String(sinceYmd), String(untilYmd)],
    );
    return rows.map((r) => ({
      snapshot_date: String(r.snapshot_date).slice(0, 10),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      spend: Number(r.spend) || 0,
      purchases: Number(r.purchases) || 0,
      revenue: Number(r.revenue) || 0,
      cpm: Number(r.cpm) || 0,
      cpc: Number(r.cpc) || 0,
      ctr: Number(r.ctr) || 0,
      roas: Number(r.roas) || 0,
      cpa: Number(r.cpa) || 0,
      currency: r.currency ? String(r.currency) : '',
      fetched_at: r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
    }));
  } catch (e) {
    if (e && e.code === '42P01') return [];
    throw e;
  }
}

async function loadMetaLatestDailySnapshot(organizationId) {
  try {
    const { rows } = await pool.query(
      `SELECT snapshot_date, impressions, clicks, spend, purchases, revenue, cpm, cpc, ctr, roas, cpa, currency, fetched_at
       FROM meta_daily_snapshots
       WHERE organization_id = $1
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [organizationId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      snapshot_date: String(r.snapshot_date).slice(0, 10),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      spend: Number(r.spend) || 0,
      purchases: Number(r.purchases) || 0,
      revenue: Number(r.revenue) || 0,
      cpm: Number(r.cpm) || 0,
      cpc: Number(r.cpc) || 0,
      ctr: Number(r.ctr) || 0,
      roas: Number(r.roas) || 0,
      cpa: Number(r.cpa) || 0,
      currency: r.currency ? String(r.currency) : '',
      fetched_at: r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
    };
  } catch (e) {
    if (e && e.code === '42P01') return null;
    throw e;
  }
}

async function buildMetaSnapshotFallbackForPeriod(organizationId, period) {
  const days = metaSnapshotRollingDaysForPeriod(period);
  const todayYmd = metaSnapshotTodayYmd(META_SNAPSHOT_TIMEZONE);
  let untilYmd = shiftYmdString(todayYmd, -1);
  let sinceYmd = shiftYmdString(untilYmd, -(days - 1));
  let rows = await loadMetaDailySnapshotsForRange(organizationId, sinceYmd, untilYmd);
  let usedLatestFallback = false;
  if (!rows.length) {
    const latest = await loadMetaLatestDailySnapshot(organizationId);
    if (latest) {
      rows = [latest];
      sinceYmd = latest.snapshot_date;
      untilYmd = latest.snapshot_date;
      usedLatestFallback = true;
    }
  }
  const totals = aggregateMetaSnapshotRows(rows);
  const fetchedAt = rows.length
    ? rows
        .map((r) => Date.parse(String(r.fetched_at || '')))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a)[0]
    : null;
  return {
    ok: rows.length > 0,
    rows,
    totals,
    sinceYmd,
    untilYmd,
    usedLatestFallback,
    fetchedAt: Number.isFinite(fetchedAt) ? new Date(fetchedAt).toISOString() : null,
  };
}

function spendByDayFromMetaSnapshotRows(rows) {
  const byDay = {};
  for (const row of rows || []) {
    const d = String(row?.snapshot_date || '').slice(0, 10);
    if (!d) continue;
    byDay[d] = Number(row?.spend) || 0;
  }
  return byDay;
}

function ctrFromSnapshotRows(rows) {
  let clicks = 0;
  let impressions = 0;
  for (const row of rows || []) {
    clicks += Number(row?.clicks) || 0;
    impressions += Number(row?.impressions) || 0;
  }
  if (!(impressions > 0)) return null;
  return (clicks / impressions) * 100;
}

function metaCtrCompareWindows(periodRaw, timezone) {
  const period = String(periodRaw || '').trim().toLowerCase();
  const today = metaSnapshotTodayYmd(timezone || META_SNAPSHOT_TIMEZONE);
  if (period === 'hoy') {
    return {
      current: { since: today, until: today },
      previous: { since: shiftYmdString(today, -1), until: shiftYmdString(today, -1) },
    };
  }
  if (period === 'ayer') {
    const yesterday = shiftYmdString(today, -1);
    const prev = shiftYmdString(today, -2);
    return {
      current: { since: yesterday, until: yesterday },
      previous: { since: prev, until: prev },
    };
  }
  // default 7d vs 7d anteriores
  const currentUntil = today;
  const currentSince = shiftYmdString(today, -6);
  return {
    current: { since: currentSince, until: currentUntil },
    previous: { since: shiftYmdString(currentSince, -7), until: shiftYmdString(currentUntil, -7) },
  };
}

async function runMetaDailySnapshotCron(poolArg, graphVersion, timezone) {
  const tz = String(timezone || META_SNAPSHOT_TIMEZONE || 'Europe/Madrid');
  const targetYmd = metaSnapshotTargetYmd(tz);
  const { rows: orgRows } = await poolArg.query(
    `SELECT DISTINCT organization_id
     FROM meta_connections
     WHERE status = 'connected'`,
  );
  let saved = 0;
  let attempted = 0;
  for (const orgRow of orgRows) {
    const organizationId = Number(orgRow.organization_id);
    if (!Number.isFinite(organizationId) || organizationId <= 0) continue;
    attempted += 1;
    try {
      const metaRow = await ensureValidMetaTokenForOrg(poolArg, graphVersion, organizationId);
      if (!metaRow || !String(metaRow.access_token || '').trim()) continue;
      const resolved = resolveAdAccountIdsForRequest(undefined, metaRow.selected_ad_account_ids);
      if (!resolved.ok || resolved.actIds.length === 0) continue;

      const [dailyRes, accountList] = await Promise.all([
        fetchMergedDailyInsightsForAdAccounts(resolved.actIds, metaRow.access_token, 'yesterday'),
        listAdAccounts(metaRow.access_token),
      ]);
      const targetSeriesRow = Array.isArray(dailyRes.series)
        ? dailyRes.series.find((r) => String(r.date_start || '') === targetYmd)
        : null;
      const snapshotBase = targetSeriesRow || aggregateMetaSnapshotRows(dailyRes.series || []);
      const totals = normalizeMetaSnapshotTotals(snapshotBase);
      const hasData =
        totals.impressions > 0 ||
        totals.clicks > 0 ||
        totals.spend > 0 ||
        totals.purchases > 0 ||
        totals.revenue > 0 ||
        (Array.isArray(dailyRes.series) && dailyRes.series.length > 0);
      if (!hasData) continue;

      let currency = '';
      if (accountList.ok && Array.isArray(accountList.accounts)) {
        const curSet = new Set();
        for (const aid of resolved.actIds) {
          const n = normalizeActId(aid);
          const hit = accountList.accounts.find((a) => normalizeActId(a.id) === n);
          if (hit && hit.currency) curSet.add(String(hit.currency).trim());
        }
        if (curSet.size === 1) currency = [...curSet][0];
        else if (curSet.size > 1) currency = [...curSet].join(', ');
      }

      const ok = await upsertMetaDailySnapshotRow(organizationId, targetYmd, {
        ...totals,
        currency,
        ad_account_ids: resolved.actIds,
        partial_errors: Array.isArray(dailyRes.partialErrors) ? dailyRes.partialErrors : [],
        source: 'meta_cron_7am',
      });
      if (ok) saved += 1;
    } catch (e) {
      console.error(`[meta-snapshot-cron] org ${organizationId}`, e && e.message ? e.message : e);
    }
  }
  console.log(`[meta-snapshot-cron] ${targetYmd} guardado para ${saved}/${attempted} organizaciones (${tz})`);
}

async function runMetaHistoricalSnapshotBackfill(poolArg, graphVersion, timezone) {
  const tz = String(timezone || META_SNAPSHOT_TIMEZONE || 'Europe/Madrid');
  const todayYmd = metaSnapshotTodayYmd(tz);
  const yesterdayYmd = shiftYmdString(todayYmd, -1);
  const parsedToday = parseIsoDateYmd(todayYmd);
  const defaultStartYmd =
    parsedToday != null ? `${String(parsedToday.y).padStart(4, '0')}-01-01` : shiftYmdString(yesterdayYmd, -30);
  const envStartRaw = String(process.env.META_SNAPSHOT_BACKFILL_FROM || '').trim();
  const envStart = parseIsoDateYmd(envStartRaw) ? envStartRaw : null;
  const globalStartYmd = envStart || defaultStartYmd;
  const { rows: orgRows } = await poolArg.query(
    `SELECT DISTINCT organization_id
     FROM meta_connections
     WHERE status = 'connected'`,
  );
  let updatedDays = 0;
  let orgsTouched = 0;
  for (const orgRow of orgRows) {
    const organizationId = Number(orgRow.organization_id);
    if (!Number.isFinite(organizationId) || organizationId <= 0) continue;
    try {
      const metaRow = await ensureValidMetaTokenForOrg(poolArg, graphVersion, organizationId);
      if (!metaRow || !String(metaRow.access_token || '').trim()) continue;
      const resolved = resolveAdAccountIdsForRequest(undefined, metaRow.selected_ad_account_ids);
      if (!resolved.ok || resolved.actIds.length === 0) continue;

      let startYmd = globalStartYmd;
      try {
        const latestRes = await poolArg.query(
          `SELECT MAX(snapshot_date) AS max_date
           FROM meta_daily_snapshots
           WHERE organization_id = $1`,
          [organizationId],
        );
        const maxDateRaw = latestRes.rows[0]?.max_date;
        const maxDate = maxDateRaw ? String(maxDateRaw).slice(0, 10) : '';
        if (parseIsoDateYmd(maxDate)) {
          const nextDate = shiftYmdString(maxDate, 1);
          if (nextDate > startYmd) startYmd = nextDate;
        }
      } catch (e) {
        if (!(e && e.code === '42P01')) throw e;
      }
      if (startYmd > yesterdayYmd) continue;

      const [dailyRes, accountList] = await Promise.all([
        fetchDailyInsightsByDayForAdAccountsTimeRange(resolved.actIds, metaRow.access_token, startYmd, yesterdayYmd),
        listAdAccounts(metaRow.access_token),
      ]);
      if (!Array.isArray(dailyRes.series) || !dailyRes.series.length) continue;

      let currency = '';
      if (accountList.ok && Array.isArray(accountList.accounts)) {
        const curSet = new Set();
        for (const aid of resolved.actIds) {
          const n = normalizeActId(aid);
          const hit = accountList.accounts.find((a) => normalizeActId(a.id) === n);
          if (hit && hit.currency) curSet.add(String(hit.currency).trim());
        }
        if (curSet.size === 1) currency = [...curSet][0];
        else if (curSet.size > 1) currency = [...curSet].join(', ');
      }

      let orgSaved = 0;
      for (const day of dailyRes.series) {
        const snapshotDate = String(day?.date_start || '').slice(0, 10);
        if (!parseIsoDateYmd(snapshotDate)) continue;
        const ok = await upsertMetaDailySnapshotRow(organizationId, snapshotDate, {
          impressions: Number(day.impressions) || 0,
          clicks: Number(day.clicks) || 0,
          spend: Number(day.spend) || 0,
          purchases: Number(day.purchases) || 0,
          revenue: Number(day.revenue) || 0,
          cpm: Number(day.cpm) || 0,
          cpc: Number(day.cpc) || 0,
          ctr: Number(day.ctr) || 0,
          roas: Number(day.roas) || 0,
          cpa: Number(day.cpa) || 0,
          currency,
          ad_account_ids: resolved.actIds,
          partial_errors: Array.isArray(dailyRes.partialErrors) ? dailyRes.partialErrors : [],
          source: 'meta_backfill',
        });
        if (ok) {
          updatedDays += 1;
          orgSaved += 1;
        }
      }
      if (orgSaved > 0) orgsTouched += 1;
    } catch (e) {
      console.error(`[meta-snapshot-backfill] org ${organizationId}`, e && e.message ? e.message : e);
    }
  }
  console.log(
    `[meta-snapshot-backfill] completado (${tz}) start=${globalStartYmd} end=${yesterdayYmd}, orgs=${orgsTouched}, days=${updatedDays}`,
  );
}

if (!hasFrontendDist) {
  app.get('/', (req, res) => {
    res.send('Backend funcionando 🚀 (PostgreSQL / multi-tenant)');
  });
}

app.get('/api/cookies', (req, res) => {
  res.json({
    ok: true,
    message: 'Backend respondiendo. Estado de base de datos: GET /api/health',
  });
});

/** Comprueba que el proceso responde y que el pool puede ejecutar SQL (Supabase / Postgres). */
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, database: true });
  } catch (err) {
    console.error('[api/health] DB:', err.code || '', err.message);
    res.status(503).json({
      ok: false,
      database: false,
      code: err.code || '',
      message: err.message ? String(err.message).slice(0, 240) : 'unknown',
    });
  }
});

app.get('/orders', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, cliente, total, estado FROM orders WHERE organization_id = $1 ORDER BY id',
      [req.organizationId],
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const organizationName = String(req.body?.organizationName || '').trim();
    const { name, email, password } = req.body;
    const n = String(name || '').trim();
    const em = normalizeEmail(email);
    const pw = String(password || '');

    if (!organizationName || organizationName.length < 2) {
      return res.status(400).json({ error: 'El nombre de la empresa debe tener al menos 2 caracteres' });
    }
    if (!n || n.length < 2) {
      return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres' });
    }
    if (!isValidEmail(em)) {
      return res.status(400).json({ error: 'Email no válido' });
    }
    if (pw.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const ex = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [em]);
    if (ex.rowCount > 0) {
      return res.status(409).json({ error: 'Ya existe una cuenta con este email' });
    }

    const password_hash = bcrypt.hashSync(pw, BCRYPT_ROUNDS);
    const slug = await uniqueSlug(pool, organizationName);

    const orgIns = await pool.query(
      `INSERT INTO organizations (name, slug, plan) VALUES ($1, $2, 'free') RETURNING id`,
      [organizationName, slug],
    );
    const orgId = orgIns.rows[0].id;

    const userIns = await pool.query(
      `INSERT INTO users (name, email, password_hash, organization_id, role, is_active)
       VALUES ($1, $2, $3, $4, 'owner', true) RETURNING id`,
      [n, em, password_hash, orgId],
    );

    const session = await buildSessionPayload(userIns.rows[0].id);
    return res.status(201).json(session);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error al registrar' });
  }
});

app.get('/api/invitations/accept-info', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Falta el token de invitación' });
    }
    const { rows } = await pool.query(
      `SELECT i.email, i.role, i.expires_at, i.organization_id, o.name AS organization_name
       FROM invitations i
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.token = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
      [token],
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Invitación no válida o caducada' });
    }
    const role_label = await invitationRoleLabel(row.organization_id, row.role);
    res.json({
      email: row.email,
      role: row.role,
      role_label,
      organization_name: row.organization_name,
      expires_at: row.expires_at,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al leer la invitación' });
  }
});

app.post('/api/auth/accept-invitation', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const name = String(req.body?.name || '').trim();
  const em = normalizeEmail(req.body?.email);
  const pw = String(req.body?.password || '');

  if (!token) {
    return res.status(400).json({ error: 'Falta el token de invitación' });
  }
  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres' });
  }
  if (!isValidEmail(em)) {
    return res.status(400).json({ error: 'Email no válido' });
  }
  if (pw.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invQ = await client.query(
      `SELECT id, email, role, organization_id
       FROM invitations
       WHERE token = $1 AND accepted_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [token],
    );
    const invRow = invQ.rows[0];
    if (!invRow) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invitación no válida o caducada' });
    }
    if (em !== normalizeEmail(invRow.email)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El email debe ser el de la invitación' });
    }
    const ex = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [em]);
    if (ex.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe una cuenta con este email' });
    }
    const password_hash = bcrypt.hashSync(pw, BCRYPT_ROUNDS);
    const userIns = await client.query(
      `INSERT INTO users (name, email, password_hash, organization_id, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [name, em, password_hash, invRow.organization_id, invRow.role],
    );
    await client.query(`UPDATE invitations SET accepted_at = now() WHERE id = $1`, [invRow.id]);
    await client.query('COMMIT');
    const uid = userIns.rows[0].id;
    const session = await buildSessionPayload(uid);
    if (!session) {
      return res.status(500).json({ error: 'Cuenta creada pero no se pudo iniciar sesión' });
    }
    return res.status(201).json({ token: issueToken(uid), ...session });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      /* ignore */
    }
    console.error(e);
    return res.status(500).json({ error: 'Error al aceptar la invitación' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const em = normalizeEmail(req.body?.email);
    const pw = String(req.body?.password || '');

    if (!em || !pw) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [em]);
    const row = rows[0];
    if (!row || !row.is_active || !bcrypt.compareSync(pw, row.password_hash)) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const token = issueToken(row.id);
    const session = await buildSessionPayload(row.id);
    if (!session) {
      return res.status(401).json({ error: 'Cuenta no disponible' });
    }

    return res.json({ token, ...session });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const em = normalizeEmail(req.body?.email);
    const generic = {
      ok: true,
      message: 'Si el email existe en nuestro sistema, recibirás las instrucciones para restablecer tu contraseña.',
    };

    if (!em || !isValidEmail(em)) {
      return res.json(generic);
    }

    const { rows } = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [em]);
    const row = rows[0];
    if (row) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);
      await pool.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3', [
        token,
        expires,
        row.id,
      ]);

      const resetUrl = `${getPublicAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
      const sendRes = await sendPasswordResetEmail({ to: em, resetUrl });
      if (!sendRes.ok && !sendRes.skipped) {
        console.error('[auth] No se pudo enviar correo de recuperación:', sendRes.error);
      }
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[dev] Recuperación contraseña ${em}: ${resetUrl}`);
      }
    }

    return res.json(generic);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');

    if (!token) {
      return res.status(400).json({ error: 'Token requerido' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const { rows } = await pool.query('SELECT id, reset_token_expires FROM users WHERE reset_token = $1', [
      token,
    ]);
    const row = rows[0];
    if (!row) {
      return res.status(400).json({ error: 'Token inválido o ya utilizado' });
    }
    if (!row.reset_token_expires || new Date(row.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'El enlace ha expirado. Solicita uno nuevo.' });
    }

    const password_hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [password_hash, row.id],
    );

    return res.json({ ok: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const session = await buildSessionPayload(req.user.userId);
    if (!session) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    return res.json(session);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error al obtener el usuario' });
  }
});

app.put('/api/auth/profile', verifyToken, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres' });
    }

    const result = await pool.query(
      'UPDATE users SET name = $1 WHERE id = $2 AND organization_id = $3',
      [name, req.user.userId, req.user.organizationId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const session = await buildSessionPayload(req.user.userId);
    return res.json({
      user: session.user,
      organization: session.organization,
      role: session.role,
      role_tier: session.role_tier,
      limits: session.limits,
      module_access: session.module_access,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error al actualizar el perfil' });
  }
});

app.get('/api/organization', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, slug, plan, created_at FROM organizations WHERE id = $1',
      [req.organizationId],
    );
    const org = rows[0];
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    res.json({ organization: org, limits: await getUsageSnapshot(req.organizationId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener la organización' });
  }
});

app.put(
  '/api/organization',
  verifyToken,
  scopeToOrganization,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name || name.length < 2) {
        return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres' });
      }
      await pool.query('UPDATE organizations SET name = $1 WHERE id = $2', [name, req.organizationId]);
      const { rows } = await pool.query(
        'SELECT id, name, slug, plan, created_at FROM organizations WHERE id = $1',
        [req.organizationId],
      );
      res.json({ organization: rows[0], limits: await getUsageSnapshot(req.organizationId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar la organización' });
    }
  },
);

app.post(
  '/api/organization/custom-roles',
  verifyToken,
  scopeToOrganization,
  requireRole('owner'),
  async (req, res) => {
    try {
      const label = String(req.body?.label || '').trim();
      const base_role = String(req.body?.base_role || '').toLowerCase();
      if (label.length < 2 || label.length > 120) {
        return res.status(400).json({ error: 'El nombre del rol debe tener entre 2 y 120 caracteres' });
      }
      if (base_role !== 'admin' && base_role !== 'member') {
        return res.status(400).json({ error: 'El nivel debe ser administrador (admin) o miembro (member).' });
      }
      const slug = await uniqueCustomRoleSlug(req.organizationId, label);
      const ins = await pool.query(
        `INSERT INTO organization_custom_roles (organization_id, slug, label, base_role)
         VALUES ($1, $2, $3, $4) RETURNING id, slug, label, base_role, created_at`,
        [req.organizationId, slug, label, base_role],
      );
      res.status(201).json({ ok: true, role: ins.rows[0] });
    } catch (e) {
      if (e && e.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un rol con ese identificador' });
      }
      if (e && e.code === '42P01') {
        return res.status(503).json({
          error: 'Falta la tabla organization_custom_roles. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error(e);
      res.status(500).json({ error: 'Error al crear el rol' });
    }
  },
);

app.delete(
  '/api/organization/custom-roles/:id',
  verifyToken,
  scopeToOrganization,
  requireRole('owner'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const row = (
        await pool.query(
          `SELECT id, slug FROM organization_custom_roles WHERE id = $1 AND organization_id = $2`,
          [id, req.organizationId],
        )
      ).rows[0];
      if (!row) return res.status(404).json({ error: 'Rol no encontrado' });
      const uCount = await pool.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE organization_id = $1 AND role = $2 AND is_active = true`,
        [req.organizationId, row.slug],
      );
      if (uCount.rows[0].c > 0) {
        return res.status(400).json({ error: 'Hay miembros con este rol; reasígnalos antes de borrar' });
      }
      const iCount = await pool.query(
        `SELECT COUNT(*)::int AS c FROM invitations WHERE organization_id = $1 AND role = $2 AND accepted_at IS NULL`,
        [req.organizationId, row.slug],
      );
      if (iCount.rows[0].c > 0) {
        return res.status(400).json({ error: 'Hay invitaciones pendientes con este rol' });
      }
      await pool.query(`DELETE FROM organization_custom_roles WHERE id = $1 AND organization_id = $2`, [
        id,
        req.organizationId,
      ]);
      try {
        await pool.query(
          `DELETE FROM organization_role_modules WHERE organization_id = $1 AND role_slug = $2`,
          [req.organizationId, row.slug],
        );
      } catch (e) {
        if (e && e.code !== '42P01') throw e;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al eliminar el rol' });
    }
  },
);

app.get(
  '/api/organization/role-modules',
  verifyToken,
  scopeToOrganization,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      let rows = [];
      try {
        const r = await pool.query(
          `SELECT role_slug, full_access, modules FROM organization_role_modules WHERE organization_id = $1`,
          [req.organizationId],
        );
        rows = r.rows;
      } catch (e) {
        if (e && e.code !== '42P01') throw e;
      }
      const bySlug = new Map(rows.map((x) => [x.role_slug, x]));

      let custom = [];
      try {
        const cr = await pool.query(
          `SELECT slug, label, base_role FROM organization_custom_roles WHERE organization_id = $1 ORDER BY label`,
          [req.organizationId],
        );
        custom = cr.rows;
      } catch (e) {
        if (e && e.code !== '42P01') throw e;
      }

      const roleRows = [
        { slug: 'owner', label: 'Propietario', locked: true },
        { slug: 'admin', label: 'Administrador', locked: false },
        { slug: 'member', label: 'Miembro', locked: false },
        ...custom.map((c) => ({
          slug: c.slug,
          label: `${c.label} (${c.base_role === 'admin' ? 'como admin' : 'como miembro'})`,
          locked: false,
        })),
      ];

      const roles = roleRows.map((meta) => {
        if (meta.slug === 'owner') {
          return { slug: meta.slug, label: meta.label, full_access: true, modules: [], locked: true };
        }
        const db = bySlug.get(meta.slug);
        if (!db) {
          return { slug: meta.slug, label: meta.label, full_access: true, modules: [], locked: false };
        }
        const full = Boolean(db.full_access);
        const mods = full ? [] : normalizeConfigurableModulesList(db.modules);
        return {
          slug: meta.slug,
          label: meta.label,
          full_access: full,
          modules: mods,
          locked: false,
        };
      });

      res.json({ module_catalog: MODULE_CATALOG_FOR_API, roles });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al leer permisos por módulo' });
    }
  },
);

app.put(
  '/api/organization/role-modules',
  verifyToken,
  scopeToOrganization,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const entries = req.body?.entries;
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: 'Se esperaba una lista bajo la clave JSON «entries».' });
      }

      let customSlugs = new Set();
      try {
        const cr = await pool.query(`SELECT slug FROM organization_custom_roles WHERE organization_id = $1`, [
          req.organizationId,
        ]);
        customSlugs = new Set(cr.rows.map((r) => r.slug));
      } catch (e) {
        if (e && e.code !== '42P01') throw e;
      }

      const allowedSlugs = new Set(['admin', 'member', ...customSlugs]);

      for (const ent of entries) {
        const slug = String(ent?.role_slug || '').trim();
        if (!slug || slug === 'owner' || !allowedSlugs.has(slug)) {
          return res.status(400).json({ error: `Rol no válido en la lista enviada: ${slug || '(vacío)'}` });
        }
        const full_access = Boolean(ent?.full_access);
        const modules = normalizeConfigurableModulesList(ent?.modules);
        if (!full_access && modules.length === 0) {
          /* permitido: solo Cuenta / Configuración según tier */
        }
        await pool.query(
          `INSERT INTO organization_role_modules (organization_id, role_slug, full_access, modules, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, now())
           ON CONFLICT (organization_id, role_slug) DO UPDATE SET
             full_access = EXCLUDED.full_access,
             modules = EXCLUDED.modules,
             updated_at = now()`,
          [req.organizationId, slug, full_access, JSON.stringify(modules)],
        );
      }

      res.json({ ok: true });
    } catch (e) {
      if (e && e.code === '42P01') {
        return res.status(503).json({
          error: 'Falta la tabla organization_role_modules. Reinicia el backend o ejecuta initDb.',
        });
      }
      console.error(e);
      res.status(500).json({ error: 'Error al guardar permisos por módulo' });
    }
  },
);

app.get(
  '/api/comision-ventas/roles',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('comision_ventas'),
  async (req, res) => {
    try {
      const periodRaw = String(req.query.period || '30d')
        .trim()
        .toLowerCase();
      const now = new Date();
      let sinceDate = null;
      let periodApplied = '30d';
      if (periodRaw === 'hoy') {
        sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        periodApplied = 'hoy';
      } else if (periodRaw === '7d') {
        sinceDate = new Date(now.getTime() - 7 * 86400000);
        periodApplied = '7d';
      } else if (periodRaw === 'mes') {
        sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);
        periodApplied = 'mes';
      } else {
        sinceDate = new Date(now.getTime() - 30 * 86400000);
        periodApplied = '30d';
      }
      const sinceMs = sinceDate.getTime();

      const roleRows = await listOrganizationRoleRows(req.organizationId);
      const roleLabelBySlug = new Map(roleRows.map((r) => [String(r.slug), String(r.label || r.slug)]));

      const commissionBySlug = new Map();
      try {
        const cRows = await pool.query(
          `SELECT role_slug, commission_percent FROM organization_role_commissions WHERE organization_id = $1`,
          [req.organizationId],
        );
        for (const r of cRows.rows) {
          const slug = String(r.role_slug || '').trim();
          const pct = Number(r.commission_percent);
          if (!slug) continue;
          commissionBySlug.set(slug, Number.isFinite(pct) && pct >= 0 ? pct : 0);
        }
      } catch (e) {
        if (e && e.code !== '42P01') throw e;
      }

      const shopifyDespachados = [];
      try {
        const sRows = await pool.query(
          `SELECT shopify_order_id, internal_status, motico_status, price_override, updated_at, updated_by
           FROM shopify_order_local_fields
           WHERE organization_id = $1`,
          [req.organizationId],
        );
        for (const r of sRows.rows) {
          const updatedMs = Date.parse(String(r.updated_at || ''));
          if (!Number.isFinite(updatedMs) || updatedMs < sinceMs) continue;
          /* Mismo criterio que KPI "Ventas despachado" en Pedidos: internal_status unificado. */
          const stInternal = normalizeLegacyMoticoEstadoToUnified(r.internal_status);
          if (stInternal !== 'despachado') continue;
          const orderId = Number(r.shopify_order_id);
          if (!Number.isFinite(orderId) || orderId <= 0) continue;
          /* NULL en price_override debe significar "usar total Shopify", no 0 (Number(null) === 0). */
          let amount = null;
          if (r.price_override != null && String(r.price_override).trim() !== '') {
            const amountRaw = Number(r.price_override);
            if (Number.isFinite(amountRaw) && amountRaw >= 0) amount = amountRaw;
          }
          const fallbackUserIdRaw = Number(r.updated_by);
          shopifyDespachados.push({
            orderId,
            amount,
            fallback_user_id:
              Number.isFinite(fallbackUserIdRaw) && fallbackUserIdRaw > 0 ? fallbackUserIdRaw : null,
          });
        }
      } catch (e) {
        if (e && e.code !== '42P01') throw e;
      }

      const manualDespachados = [];
      try {
        const mRows = await pool.query(
          `SELECT id, motico_status, price_override, total_price, updated_at, created_by
           FROM motico_manual_orders
           WHERE organization_id = $1`,
          [req.organizationId],
        );
        for (const r of mRows.rows) {
          const updatedMs = Date.parse(String(r.updated_at || ''));
          if (!Number.isFinite(updatedMs) || updatedMs < sinceMs) continue;
          const st = normalizeLegacyMoticoEstadoToUnified(r.motico_status);
          if (st !== 'despachado') continue;
          const orderId = Number(r.id);
          if (!Number.isFinite(orderId) || orderId <= 0) continue;
          const hasOvr = r.price_override != null && String(r.price_override).trim() !== '';
          const ovr = hasOvr ? Number(r.price_override) : NaN;
          const totalPrice = Number(r.total_price);
          const fallbackUserIdRaw = Number(r.created_by);
          const amount = Number.isFinite(ovr) && ovr >= 0 ? ovr : Number.isFinite(totalPrice) && totalPrice >= 0 ? totalPrice : 0;
          manualDespachados.push({
            orderId,
            amount,
            fallback_user_id:
              Number.isFinite(fallbackUserIdRaw) && fallbackUserIdRaw > 0 ? fallbackUserIdRaw : null,
          });
        }
      } catch (e) {
        if (e && e.code !== '42P01') throw e;
      }

      const queryLatestActorMap = async (orderSource, orderIds) => {
        const out = new Map();
        if (!orderIds.length) return out;
        try {
          const q = await pool.query(
            `SELECT DISTINCT ON (order_id) order_id, user_id, user_name, user_email, user_role
             FROM order_change_logs
             WHERE organization_id = $1 AND order_source = $2 AND order_id = ANY($3::bigint[])
             ORDER BY order_id, created_at DESC, id DESC`,
            [req.organizationId, orderSource, orderIds],
          );
          for (const r of q.rows) {
            const id = Number(r.order_id);
            if (!Number.isFinite(id) || id <= 0) continue;
            const roleSlug = String(r.user_role || '').trim() || 'sin_asignar';
            const userId = Number(r.user_id);
            out.set(id, {
              role_slug: roleSlug,
              user_id: Number.isFinite(userId) && userId > 0 ? userId : null,
              user_name: String(r.user_name || '').trim(),
              user_email: String(r.user_email || '').trim(),
            });
          }
        } catch (e) {
          if (e && e.code === '42P01') return out;
          throw e;
        }
        return out;
      };

      const shopActorMap = await queryLatestActorMap(
        'shopify',
        shopifyDespachados.map((x) => x.orderId),
      );
      const manualActorMap = await queryLatestActorMap(
        'motico_manual',
        manualDespachados.map((x) => x.orderId),
      );

      const missingShopifyTotals = shopifyDespachados.filter((x) => x.amount == null).map((x) => x.orderId);
      const shopifyFetchedTotals = await fetchShopifyTotalsByOrderIds(req.organizationId, missingShopifyTotals);

      const ventasByRole = new Map();
      const membersByKey = new Map();
      const unassignedMember = {
        member_id: null,
        member_name: 'Sin usuario asignado',
        member_email: '',
        role_slug: 'sin_asignar',
        role_label: 'Sin rol asignado',
        pedidos_despachados: 0,
        ventas_despachadas_total: 0,
      };

      try {
        const mRows = await pool.query(
          `SELECT id, name, email, role
           FROM users
           WHERE organization_id = $1 AND is_active = true
           ORDER BY name ASC, email ASC`,
          [req.organizationId],
        );
        for (const m of mRows.rows) {
          const id = Number(m.id);
          if (!Number.isFinite(id) || id <= 0) continue;
          const roleSlug = String(m.role || '').trim() || 'member';
          membersByKey.set(`uid:${id}`, {
            member_id: id,
            member_name: String(m.name || '').trim() || String(m.email || '').trim() || `Usuario ${id}`,
            member_email: String(m.email || '').trim(),
            role_slug: roleSlug,
            role_label: String(roleLabelBySlug.get(roleSlug) || roleSlug || 'Sin rol'),
            pedidos_despachados: 0,
            ventas_despachadas_total: 0,
          });
        }
      } catch (e) {
        if (e && e.code !== '42P01') throw e;
      }

      const trackMember = (actor, amountRaw) => {
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) return;
        const userId = Number(actor?.user_id);
        if (Number.isFinite(userId) && userId > 0) {
          const key = `uid:${userId}`;
          let row = membersByKey.get(key);
          if (!row) {
            const roleSlug = String(actor?.role_slug || '').trim() || 'sin_asignar';
            row = {
              member_id: userId,
              member_name: String(actor?.user_name || '').trim() || String(actor?.user_email || '').trim() || `Usuario ${userId}`,
              member_email: String(actor?.user_email || '').trim(),
              role_slug: roleSlug,
              role_label: String(roleLabelBySlug.get(roleSlug) || roleSlug || 'Sin rol'),
              pedidos_despachados: 0,
              ventas_despachadas_total: 0,
            };
            membersByKey.set(key, row);
          }
          row.pedidos_despachados += 1;
          row.ventas_despachadas_total += amount;
          return;
        }
        unassignedMember.pedidos_despachados += 1;
        unassignedMember.ventas_despachadas_total += amount;
      };

      const resolveActor = (actorRaw, fallbackUserIdRaw) => {
        const actor = actorRaw && typeof actorRaw === 'object' ? actorRaw : {};
        const actorUserIdRaw = Number(actor.user_id);
        const fallbackUserId = Number(fallbackUserIdRaw);
        const userId =
          Number.isFinite(actorUserIdRaw) && actorUserIdRaw > 0
            ? actorUserIdRaw
            : Number.isFinite(fallbackUserId) && fallbackUserId > 0
              ? fallbackUserId
              : null;
        let roleSlug = String(actor.role_slug || '').trim();
        let userName = String(actor.user_name || '').trim();
        let userEmail = String(actor.user_email || '').trim();
        if (userId != null) {
          const seeded = membersByKey.get(`uid:${userId}`);
          if (seeded) {
            if (!roleSlug) roleSlug = String(seeded.role_slug || '').trim();
            if (!userName) userName = String(seeded.member_name || '').trim();
            if (!userEmail) userEmail = String(seeded.member_email || '').trim();
          }
        }
        if (!roleSlug) roleSlug = 'sin_asignar';
        return {
          user_id: userId,
          role_slug: roleSlug,
          user_name: userName,
          user_email: userEmail,
        };
      };

      const addToRole = (slugRaw, amountRaw) => {
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) return;
        const slug = String(slugRaw || '').trim() || 'sin_asignar';
        ventasByRole.set(slug, Number(ventasByRole.get(slug) || 0) + amount);
      };

      for (const o of shopifyDespachados) {
        const actor = resolveActor(shopActorMap.get(o.orderId), o.fallback_user_id);
        const roleSlug = String(actor.role_slug || 'sin_asignar');
        const amount = o.amount != null ? o.amount : Number(shopifyFetchedTotals.get(o.orderId) || 0);
        addToRole(roleSlug, amount);
        trackMember(actor, amount);
      }
      for (const o of manualDespachados) {
        const actor = resolveActor(manualActorMap.get(o.orderId), o.fallback_user_id);
        const roleSlug = String(actor.role_slug || 'sin_asignar');
        addToRole(roleSlug, o.amount);
        trackMember(actor, o.amount);
      }

      const baseRows = roleRows.map((r) => {
        const slug = String(r.slug);
        const ventas = Number(ventasByRole.get(slug) || 0);
        const percent = Number(commissionBySlug.get(slug) || 0);
        const gain = ventas * (percent / 100);
        return {
          role_slug: slug,
          role_label: String(r.label || slug),
          ventas_despachadas_total: ventas,
          commission_percent: percent,
          gain,
          editable: Boolean(r.editable),
        };
      });

      if (ventasByRole.has('sin_asignar')) {
        baseRows.push({
          role_slug: 'sin_asignar',
          role_label: 'Sin rol asignado',
          ventas_despachadas_total: Number(ventasByRole.get('sin_asignar') || 0),
          commission_percent: 0,
          gain: 0,
          editable: false,
        });
      }

      const totals = baseRows.reduce(
        (acc, r) => {
          acc.ventas_despachadas_total += Number(r.ventas_despachadas_total || 0);
          acc.commission_percent_total += Number(r.commission_percent || 0);
          acc.gain_total += Number(r.gain || 0);
          return acc;
        },
        { ventas_despachadas_total: 0, commission_percent_total: 0, gain_total: 0 },
      );

      const roleTier = await getRoleTier(req.user.userId, req.organizationId);
      const memberRows = [...membersByKey.values()];
      if (unassignedMember.pedidos_despachados > 0 || unassignedMember.ventas_despachadas_total > 0) {
        memberRows.push(unassignedMember);
      }
      memberRows.sort((a, b) => {
        const va = Number(a.ventas_despachadas_total || 0);
        const vb = Number(b.ventas_despachadas_total || 0);
        if (vb !== va) return vb - va;
        const pa = Number(a.pedidos_despachados || 0);
        const pb = Number(b.pedidos_despachados || 0);
        if (pb !== pa) return pb - pa;
        return String(a.member_name || '').localeCompare(String(b.member_name || ''), 'es');
      });

      const mapMemberRow = (m) => ({
        member_id: m.member_id,
        member_name: m.member_name,
        member_email: m.member_email,
        role_slug: m.role_slug,
        role_label: m.role_label,
        pedidos_despachados: Number(m.pedidos_despachados || 0),
        ventas_despachadas_total: Number(m.ventas_despachadas_total || 0),
      });

      let responseRows = baseRows;
      let responseMemberRows = memberRows.map(mapMemberRow);
      let responseTotals = totals;
      const viewScope = roleTier === 'owner' ? 'full' : 'self';

      if (roleTier !== 'owner') {
        const uid = Number(req.user.userId);
        const selfKey = `uid:${uid}`;
        let selfAgg = membersByKey.get(selfKey);
        if (!selfAgg) {
          const ur = String(req.user.role || 'member').trim() || 'member';
          selfAgg = {
            member_id: uid,
            member_name: String(req.user.name || '').trim() || String(req.user.email || '').trim() || `Usuario ${uid}`,
            member_email: String(req.user.email || '').trim(),
            role_slug: ur,
            role_label: String(roleLabelBySlug.get(ur) || ur),
            pedidos_despachados: 0,
            ventas_despachadas_total: 0,
          };
        }
        const mySlug = String(selfAgg.role_slug || 'member').trim() || 'member';
        const myLabel = String(selfAgg.role_label || roleLabelBySlug.get(mySlug) || mySlug);
        const myVentas = Number(selfAgg.ventas_despachadas_total || 0);
        const myPct = Number(commissionBySlug.get(mySlug) || 0);
        const myGain = myVentas * (myPct / 100);
        responseRows = [
          {
            role_slug: mySlug,
            role_label: myLabel,
            ventas_despachadas_total: myVentas,
            commission_percent: myPct,
            gain: myGain,
            editable: false,
          },
        ];
        responseMemberRows = [
          mapMemberRow({
            ...selfAgg,
            role_slug: mySlug,
            role_label: myLabel,
          }),
        ];
        responseTotals = {
          ventas_despachadas_total: myVentas,
          commission_percent_total: myPct,
          gain_total: myGain,
        };
      }

      return res.json({
        view_scope: viewScope,
        can_edit_percent: roleTier === 'owner',
        period_applied: periodApplied,
        rows: responseRows,
        member_rows: responseMemberRows,
        totals: responseTotals,
      });
    } catch (e) {
      console.error('[comision-ventas GET]', e);
      return res.status(500).json({ error: 'Error al cargar comisión por ventas' });
    }
  },
);

app.put(
  '/api/comision-ventas/roles',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('comision_ventas'),
  requireRole('owner'),
  async (req, res) => {
    try {
      const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
      if (!entries) return res.status(400).json({ error: 'Se esperaba una lista bajo la clave JSON «entries».' });
      const roleRows = await listOrganizationRoleRows(req.organizationId);
      const allowed = new Set(roleRows.map((r) => String(r.slug)));
      for (const ent of entries) {
        const slug = String(ent?.role_slug || '').trim();
        if (!slug || !allowed.has(slug)) {
          return res.status(400).json({ error: `Rol no válido: ${slug || '(vacío)'}` });
        }
        const pct = Number(ent?.commission_percent);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return res.status(400).json({ error: `Porcentaje no válido para ${slug}` });
        }
        await pool.query(
          `INSERT INTO organization_role_commissions (organization_id, role_slug, commission_percent, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (organization_id, role_slug) DO UPDATE SET
             commission_percent = EXCLUDED.commission_percent,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
          [req.organizationId, slug, pct, req.user.userId],
        );
      }
      return res.json({ ok: true });
    } catch (e) {
      if (e && e.code === '42P01') {
        return res.status(503).json({
          error: 'Falta la tabla organization_role_commissions. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[comision-ventas PUT]', e);
      return res.status(500).json({ error: 'Error al guardar porcentajes de comisión' });
    }
  },
);

app.get(
  '/api/comision-ventas/cuts',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('comision_ventas'),
  async (req, res) => {
    try {
      await syncCommissionPaymentCutsForOrg(req.organizationId);
      const asOf =
        parseCommissionCutsAsOfDate(req.query.as_of) || new Date().toISOString().slice(0, 10);
      const cutsR = await pool.query(
        `SELECT id, period_start, period_end, cut_kind, commission_total, ventas_despachadas_total, payment_status, paid_at, updated_at, payment_proof_rel_path
         FROM commission_payment_cuts
         WHERE organization_id = $1 AND period_end <= $2::date
         ORDER BY period_end DESC, id DESC`,
        [req.organizationId, asOf],
      );
      const accR = await pool.query(
        `SELECT
           COALESCE(SUM(commission_total), 0)::float AS commission_total,
           COALESCE(SUM(commission_total) FILTER (WHERE payment_status = 'paid'), 0)::float AS paid_total,
           COALESCE(SUM(commission_total) FILTER (WHERE payment_status = 'pending'), 0)::float AS pending_total
         FROM commission_payment_cuts
         WHERE organization_id = $1 AND period_end <= $2::date`,
        [req.organizationId, asOf],
      );
      const acc = accR.rows[0] || {};
      const roleTier = await getRoleTier(req.user.userId, req.organizationId);
      const can_edit_payment = roleTier === 'owner';
      const asc = [...cutsR.rows].sort((a, b) => {
        const c = String(a.period_start).localeCompare(String(b.period_start));
        if (c !== 0) return c;
        return String(a.period_end).localeCompare(String(b.period_end));
      });
      const cutNumberById = new Map(asc.map((row, i) => [Number(row.id), i + 1]));
      const cuts = cutsR.rows.map((r) => {
        const ps = commissionPaymentCutDateToYmd(r.period_start);
        const pe = commissionPaymentCutDateToYmd(r.period_end);
        const id = Number(r.id);
        const proofPath = r.payment_proof_rel_path != null ? String(r.payment_proof_rel_path).trim() : '';
        return {
          id,
          cut_number: cutNumberById.get(id) || 0,
          period_start: ps,
          period_end: pe,
          cut_kind: String(r.cut_kind),
          period_label: formatComisionCutPeriodLabel(ps, pe, String(r.cut_kind)),
          commission_total: Number(r.commission_total) || 0,
          ventas_despachadas_total: Number(r.ventas_despachadas_total) || 0,
          payment_status: String(r.payment_status),
          paid_at: r.paid_at,
          updated_at: r.updated_at,
          has_payment_proof: Boolean(proofPath),
        };
      });
      return res.json({
        as_of: asOf,
        cuts,
        can_edit_payment,
        accumulated: {
          commission_total: Number(acc.commission_total) || 0,
          paid_total: Number(acc.paid_total) || 0,
          pending_total: Number(acc.pending_total) || 0,
        },
      });
    } catch (e) {
      if (e && (e.code === '42P01' || e.code === '42703')) {
        return res.status(503).json({
          error: 'Falta la tabla o columnas de cortes. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[comision-ventas cuts GET]', e);
      return res.status(500).json({ error: 'Error al cargar cortes de pago' });
    }
  },
);

app.get(
  '/api/comision-ventas/cuts/:id/payment-proof',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('comision_ventas'),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'Identificador de corte no válido' });
      }
      const { rows } = await pool.query(
        `SELECT payment_proof_rel_path FROM commission_payment_cuts WHERE id = $1 AND organization_id = $2`,
        [id, req.organizationId],
      );
      const rel = rows[0]?.payment_proof_rel_path != null ? String(rows[0].payment_proof_rel_path).trim() : '';
      if (!rel || rel.includes('..') || rel.startsWith('/') || path.isAbsolute(rel)) {
        return res.status(404).json({ error: 'No hay comprobante para este corte' });
      }
      const abs = path.join(COMMISSION_PAYMENT_PROOFS_DIR, rel);
      const base = path.resolve(COMMISSION_PAYMENT_PROOFS_DIR) + path.sep;
      if (!abs.startsWith(base) || !fs.existsSync(abs)) {
        return res.status(404).json({ error: 'Archivo de comprobante no encontrado' });
      }
      const ext = path.extname(abs).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, no-store');
      fs.createReadStream(abs).pipe(res);
    } catch (e) {
      if (e && (e.code === '42P01' || e.code === '42703')) {
        return res.status(503).json({
          error: 'Falta columna o tabla de cortes. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[commission proof GET]', e);
      return res.status(500).json({ error: 'Error al leer el comprobante' });
    }
  },
);

app.patch(
  '/api/comision-ventas/cuts/:id',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('comision_ventas'),
  requireRole('owner'),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = String(req.body?.payment_status || '')
        .trim()
        .toLowerCase();
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'Identificador de corte no válido' });
      }
      if (status !== 'paid' && status !== 'pending') {
        return res.status(400).json({
          error:
            'Estado de pago no válido. Los valores admitidos son pending (pendiente) y paid (pagado).',
        });
      }

      const prevRow = await pool.query(
        `SELECT payment_proof_rel_path FROM commission_payment_cuts WHERE id = $1 AND organization_id = $2`,
        [id, req.organizationId],
      );
      if (prevRow.rowCount === 0) {
        return res.status(404).json({ error: 'Corte no encontrado' });
      }
      const prevRel =
        prevRow.rows[0].payment_proof_rel_path != null
          ? String(prevRow.rows[0].payment_proof_rel_path).trim()
          : '';

      if (status === 'pending') {
        if (prevRel && !prevRel.includes('..') && !path.isAbsolute(prevRel)) {
          const absPrev = path.join(COMMISSION_PAYMENT_PROOFS_DIR, prevRel);
          const basePrev = path.resolve(COMMISSION_PAYMENT_PROOFS_DIR) + path.sep;
          if (absPrev.startsWith(basePrev) && fs.existsSync(absPrev)) {
            try {
              fs.unlinkSync(absPrev);
            } catch (e) {
              console.warn('[commission proof unlink]', e && e.message);
            }
          }
        }
        const u = await pool.query(
          `UPDATE commission_payment_cuts
           SET payment_status = 'pending', paid_at = NULL, payment_proof_rel_path = NULL, updated_by = $1, updated_at = now()
           WHERE id = $2 AND organization_id = $3
           RETURNING id`,
          [req.user.userId, id, req.organizationId],
        );
        if (u.rowCount === 0) {
          return res.status(404).json({ error: 'Corte no encontrado' });
        }
        return res.json({ ok: true });
      }

      const proofB64 = req.body?.proof_image_base64;
      const buf = decodeBase64ImagePayload(proofB64);
      if (!buf || buf.length < 32) {
        return res.status(400).json({
          error: 'Debes adjuntar una imagen de soporte de pago (JPEG, PNG o WebP) para marcar el corte como pagado.',
        });
      }
      if (buf.length > 4.5 * 1024 * 1024) {
        return res.status(400).json({ error: 'La imagen no puede superar 4 MB.' });
      }
      const detected = detectImageMimeFromBuffer(buf);
      if (!detected) {
        return res.status(400).json({ error: 'Solo se admiten imágenes JPEG, PNG o WebP como comprobante.' });
      }

      ensureCommissionPaymentProofsDir();
      const orgDir = path.join(COMMISSION_PAYMENT_PROOFS_DIR, String(req.organizationId));
      fs.mkdirSync(orgDir, { recursive: true });
      const relPath = `${req.organizationId}/${id}.${detected.ext}`;
      const absPath = path.join(COMMISSION_PAYMENT_PROOFS_DIR, relPath);
      const baseResolved = path.resolve(COMMISSION_PAYMENT_PROOFS_DIR) + path.sep;
      if (!absPath.startsWith(baseResolved)) {
        return res.status(500).json({ error: 'Ruta de almacenamiento inválida' });
      }

      if (prevRel && !prevRel.includes('..') && !path.isAbsolute(prevRel)) {
        const absPrev = path.join(COMMISSION_PAYMENT_PROOFS_DIR, prevRel);
        if (absPrev.startsWith(baseResolved) && fs.existsSync(absPrev) && absPrev !== absPath) {
          try {
            fs.unlinkSync(absPrev);
          } catch (e) {
            console.warn('[commission proof unlink]', e && e.message);
          }
        }
      }

      fs.writeFileSync(absPath, buf);

      const u = await pool.query(
        `UPDATE commission_payment_cuts
         SET payment_status = 'paid', paid_at = now(), updated_by = $1, updated_at = now(), payment_proof_rel_path = $2
         WHERE id = $3 AND organization_id = $4
         RETURNING id`,
        [req.user.userId, relPath, id, req.organizationId],
      );
      if (u.rowCount === 0) {
        return res.status(404).json({ error: 'Corte no encontrado' });
      }
      return res.json({ ok: true });
    } catch (e) {
      if (e && (e.code === '42P01' || e.code === '42703')) {
        return res.status(503).json({
          error: 'Falta la tabla o columnas de cortes. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[comision-ventas cuts PATCH]', e);
      return res.status(500).json({ error: 'Error al actualizar el estado de pago' });
    }
  },
);

app.get(
  '/api/organization/members',
  verifyToken,
  scopeToOrganization,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const members = (
        await pool.query(
          `SELECT id, name, email, role, is_active, created_at
           FROM users WHERE organization_id = $1 ORDER BY id`,
          [req.organizationId],
        )
      ).rows;

      const invitations = (
        await pool.query(
          `SELECT id, email, role, expires_at, created_at
           FROM invitations
           WHERE organization_id = $1 AND accepted_at IS NULL AND expires_at > now()
           ORDER BY id`,
          [req.organizationId],
        )
      ).rows;

      let custom_roles = [];
      try {
        const cr = await pool.query(
          `SELECT id, slug, label, base_role, created_at
           FROM organization_custom_roles WHERE organization_id = $1 ORDER BY label`,
          [req.organizationId],
        );
        custom_roles = cr.rows;
      } catch (crErr) {
        if (crErr && crErr.code !== '42P01') throw crErr;
      }

      const mail = getMailTransportInfo();
      res.json({
        members,
        invitations,
        custom_roles,
        limits: await getUsageSnapshot(req.organizationId),
        mail: { configured: mail.configured, transport: mail.transport },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al listar miembros' });
    }
  },
);

app.post(
  '/api/organization/invite',
  verifyToken,
  scopeToOrganization,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const role = String(req.body?.role || 'member');
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Email no válido' });
      }
      if (role === 'owner' || !(await isAssignableOrgRole(req.organizationId, role))) {
        return res.status(400).json({ error: 'Rol de invitación no válido' });
      }

      const limit = await checkPlanLimit(req.organizationId, 'invite_user');
      if (!limit.ok) {
        return res.status(403).json({ error: limit.message });
      }

      const existing = (
        await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email])
      ).rows[0];
      if (existing) {
        const same = (
          await pool.query('SELECT organization_id FROM users WHERE id = $1', [existing.id])
        ).rows[0];
        if (same.organization_id === req.organizationId) {
          return res.status(409).json({ error: 'Este usuario ya pertenece a la organización' });
        }
        return res.status(409).json({ error: 'Este email ya está registrado en otra organización' });
      }

      const dup = (
        await pool.query(
          'SELECT id FROM invitations WHERE organization_id = $1 AND lower(email) = lower($2) AND accepted_at IS NULL',
          [req.organizationId, email],
        )
      ).rows[0];
      if (dup) {
        return res.status(409).json({ error: 'Ya hay una invitación pendiente para este email' });
      }

      const token = crypto.randomBytes(24).toString('hex');
      const expires = new Date(Date.now() + INVITE_DAYS * 86400000);

      await pool.query(
        `INSERT INTO invitations (organization_id, email, role, token, expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.organizationId, email, role, token, expires, req.user.userId],
      );

      const { sendRes, acceptUrl } = await sendInvitationNotification(
        req.organizationId,
        email,
        role,
        token,
        req.user.userId,
      );
      logInvitationSmtp(email, acceptUrl, sendRes);

      const { email_sent, message } = inviteEmailUserMessage(sendRes, email);

      res.status(201).json({
        ok: true,
        email_sent,
        invite_link: acceptUrl,
        message,
        invitation: { email, role, expires_at: expires },
        limits: await getUsageSnapshot(req.organizationId),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al crear la invitación' });
    }
  },
);

app.delete(
  '/api/organization/invitations/:id',
  verifyToken,
  scopeToOrganization,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const del = await pool.query(
        `DELETE FROM invitations
         WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL
         RETURNING id`,
        [id, req.organizationId],
      );
      if (del.rowCount === 0) {
        return res.status(404).json({ error: 'Invitación no encontrada o ya aceptada' });
      }
      res.json({ ok: true, limits: await getUsageSnapshot(req.organizationId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al cancelar la invitación' });
    }
  },
);

app.post(
  '/api/organization/invitations/:id/resend',
  verifyToken,
  scopeToOrganization,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const row = (
        await pool.query(
          `SELECT id, email, role, token, invited_by, organization_id
           FROM invitations
           WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND expires_at > now()`,
          [id, req.organizationId],
        )
      ).rows[0];
      if (!row) {
        return res.status(404).json({
          error: 'Invitación no encontrada, ya aceptada o caducada. Cancela y crea una nueva si hace falta.',
        });
      }

      const { sendRes, acceptUrl } = await sendInvitationNotification(
        row.organization_id,
        row.email,
        row.role,
        row.token,
        row.invited_by,
      );
      logInvitationSmtp(row.email, acceptUrl, sendRes);

      const { email_sent, message } = inviteEmailUserMessage(sendRes, row.email, { resent: true });

      res.json({
        ok: true,
        email_sent,
        invite_link: acceptUrl,
        message,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al reenviar la invitación' });
    }
  },
);

app.put(
  '/api/organization/members/:id/role',
  verifyToken,
  scopeToOrganization,
  requireRole('owner'),
  async (req, res) => {
    try {
      const targetId = parseInt(req.params.id, 10);
      const newRole = String(req.body?.role || '');
      if (!(await isAssignableOrgRole(req.organizationId, newRole))) {
        return res.status(400).json({ error: 'Rol no válido' });
      }

      const target = (
        await pool.query(
          'SELECT id, role FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true',
          [targetId, req.organizationId],
        )
      ).rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Miembro no encontrado' });
      }

      if (target.role === 'owner' && newRole !== 'owner') {
        const owners = (
          await pool.query(
            `SELECT COUNT(*)::int AS c FROM users
             WHERE organization_id = $1 AND role = 'owner' AND is_active = true`,
            [req.organizationId],
          )
        ).rows[0].c;
        if (owners <= 1) {
          return res.status(400).json({ error: 'Debe existir al menos un propietario' });
        }
      }

      await pool.query('UPDATE users SET role = $1 WHERE id = $2 AND organization_id = $3', [
        newRole,
        targetId,
        req.organizationId,
      ]);

      res.json({ ok: true, limits: await getUsageSnapshot(req.organizationId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar el rol' });
    }
  },
);

app.delete(
  '/api/organization/members/:id',
  verifyToken,
  scopeToOrganization,
  requireRole('owner'),
  async (req, res) => {
    try {
      const targetId = parseInt(req.params.id, 10);
      if (targetId === req.user.userId) {
        return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
      }

      const target = (
        await pool.query(
          'SELECT id, role FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true',
          [targetId, req.organizationId],
        )
      ).rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Miembro no encontrado' });
      }

      if (target.role === 'owner') {
        const owners = (
          await pool.query(
            `SELECT COUNT(*)::int AS c FROM users
             WHERE organization_id = $1 AND role = 'owner' AND is_active = true`,
            [req.organizationId],
          )
        ).rows[0].c;
        if (owners <= 1) {
          return res.status(400).json({ error: 'No puedes eliminar al único propietario' });
        }
      }

      await pool.query('UPDATE users SET is_active = false WHERE id = $1 AND organization_id = $2', [
        targetId,
        req.organizationId,
      ]);

      res.json({ ok: true, limits: await getUsageSnapshot(req.organizationId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al eliminar el miembro' });
    }
  },
);

app.get('/api/meta/connections', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const rows = (
      await pool.query(
        `SELECT id, app_id, status, connected_at, account_name, selected_ad_account_ids,
                token_type, disconnect_reason,
                (access_token IS NOT NULL AND length(trim(access_token)) > 0) AS has_access_token
         FROM meta_connections WHERE organization_id = $1 ORDER BY id DESC`,
        [req.organizationId],
      )
    ).rows;

    const list = rows.map((r) => {
      const digits = String(r.app_id).replace(/\D/g, '');
      const hint = digits.length >= 4 ? `····${digits.slice(-4)}` : '····';
      const selectedIds = parseAdAccountIdsFromDb(r.selected_ad_account_ids);
      const insightsReady = Boolean(r.has_access_token && selectedIds.length > 0);
      return {
        id: r.id,
        app_id_hint: hint,
        status: r.status,
        connected_at: r.connected_at,
        account_name: r.account_name,
        selected_ad_account_ids: selectedIds,
        insights_ready: insightsReady,
        token_type: r.token_type || 'evaluator',
        disconnect_reason: r.disconnect_reason || null,
      };
    });
    res.json({ connections: list, limits: await getUsageSnapshot(req.organizationId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar conexiones' });
  }
});

app.post('/api/meta/preview-ad-accounts', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const appId = String(req.body?.appId || '').trim();
    const appSecret = String(req.body?.appSecret || '').trim();
    const accessToken = String(req.body?.accessToken || '').trim();
    if (!accessToken) {
      return res.status(400).json({
        error: 'Indica el token de usuario de Meta para listar cuentas publicitarias.',
        code: 'token_required',
      });
    }
    try {
      await verifyMetaWithGraphApi(appId, appSecret, accessToken);
    } catch (err) {
      const code = err.code || 'unknown';
      const map = {
        invalid_credentials: 'El App ID o App Secret son incorrectos',
        token_expired: 'El Access Token ha expirado, genera uno nuevo',
        network: 'No se pudo contactar a Meta',
      };
      const status = code === 'network' ? 503 : 400;
      return res.status(status).json({ error: map[code] || 'No se pudo validar', code });
    }
    const listed = await listAdAccounts(accessToken);
    if (!listed.ok) {
      return res.status(400).json({
        error: listed.message,
        code: listed.code || 'api_error',
      });
    }
    const accounts = listed.accounts.map((a) => ({
      id: a.id,
      name: a.name || a.id,
      account_status: a.account_status,
      currency: a.currency,
    }));
    res.json({ accounts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar cuentas publicitarias' });
  }
});

app.get('/api/meta/ad-accounts', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    if (!row || !String(row.access_token || '').trim()) {
      return res.status(400).json({
        error: 'No hay token de usuario guardado. Vuelve a conectar Meta con un access token.',
        code: 'no_token',
      });
    }
    const listed = await listAdAccounts(row.access_token);
    if (!listed.ok) {
      return res.status(400).json({ error: listed.message, code: listed.code || 'api_error' });
    }
    res.json({
      accounts: listed.accounts.map((a) => ({
        id: a.id,
        name: a.name || a.id,
        account_status: a.account_status,
        currency: a.currency,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar cuentas publicitarias' });
  }
});

app.get('/api/meta/selected-ad-accounts', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    if (!row || !String(row.access_token || '').trim()) {
      return res.status(400).json({ error: 'No hay token de usuario en la conexión Meta.', code: 'no_token' });
    }
    const selected = parseAdAccountIdsFromDb(row.selected_ad_account_ids)
      .map((id) => normalizeActId(id))
      .filter(Boolean);
    if (selected.length === 0) {
      return res.json({ accounts: [] });
    }
    const listed = await listAdAccounts(row.access_token);
    if (!listed.ok) {
      return res.status(400).json({ error: listed.message, code: listed.code || 'api_error' });
    }
    const selSet = new Set(selected);
    const accounts = listed.accounts
      .filter((a) => selSet.has(normalizeActId(a.id)))
      .map((a) => ({
        id: normalizeActId(a.id),
        name: a.name || normalizeActId(a.id),
      }));
    res.json({ accounts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar cuentas seleccionadas' });
  }
});

app.post('/api/meta/connections', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const appId = String(req.body?.appId || '').trim();
    const appSecret = String(req.body?.appSecret || '').trim();
    const accessToken = req.body?.accessToken ? String(req.body.accessToken).trim() : '';
    const tokenType = req.body?.tokenType === 'system_user' ? 'system_user' : 'evaluator';
    const rawSelected = req.body?.selectedAdAccountIds;
    const selectedInput = Array.isArray(rawSelected) ? rawSelected.map((x) => String(x)) : [];

    const limit = await checkPlanLimit(req.organizationId, 'meta_connection');
    if (!limit.ok) {
      return res.status(403).json({ error: limit.message, code: 'plan_limit' });
    }

    let verified;
    try {
      verified = await verifyMetaWithGraphApi(appId, appSecret, accessToken || undefined);
    } catch (err) {
      const code = err.code || 'unknown';
      const map = {
        invalid_credentials: 'El App ID o App Secret son incorrectos',
        token_expired: 'El Access Token ha expirado, genera uno nuevo',
        network: 'No se pudo contactar a Meta. Revisa tu conexión e inténtalo de nuevo',
        permissions: 'Tu app o token no tienen los permisos necesarios en Meta',
      };
      const status = code === 'network' ? 503 : 400;
      return res.status(status).json({ error: map[code] || 'No se pudo validar', code });
    }

    let selectedJson = '[]';
    if (selectedInput.length > 0) {
      if (!accessToken) {
        return res.status(400).json({
          error: 'Para guardar cuentas publicitarias necesitas un access token de usuario.',
          code: 'token_required',
        });
      }
      const listed = await listAdAccounts(accessToken);
      if (!listed.ok) {
        return res.status(400).json({ error: listed.message, code: listed.code || 'api_error' });
      }
      const valid = filterValidAdAccountIds(selectedInput, listed.accounts);
      if (valid.length === 0) {
        return res.status(400).json({
          error: 'Las cuentas seleccionadas no coinciden con las disponibles para este token.',
          code: 'invalid_accounts',
        });
      }
      selectedJson = JSON.stringify(valid);
    }

    const ins = await pool.query(
      `INSERT INTO meta_connections
       (organization_id, created_by, app_id, app_secret, access_token, status, connected_at, account_name, selected_ad_account_ids, token_type, token_expires_at, disconnect_reason)
       VALUES ($1, $2, $3, $4, $5, 'connected', now(), $6, $7::jsonb, $8, $9, $10) RETURNING id, connected_at`,
      [
        req.organizationId,
        req.user.userId,
        appId.replace(/\s/g, ''),
        appSecret,
        accessToken || null,
        verified.accountName,
        selectedJson,
        tokenType,
        null,
        null,
      ],
    );

    if (accessToken && tokenType === 'evaluator') {
      await exchangeAndPersistLongLivedForConnection(
        pool,
        META_GRAPH_VERSION,
        ins.rows[0].id,
        req.organizationId,
      );
    }

    const selectedIds = parseAdAccountIdsFromDb(JSON.parse(selectedJson));
    const insightsReady = Boolean(accessToken && selectedIds.length > 0);

    res.status(201).json({
      connection: {
        id: ins.rows[0].id,
        account_name: verified.accountName,
        connected_at: ins.rows[0].connected_at,
        app_id_hint:
          appId.replace(/\D/g, '').length >= 4
            ? `····${appId.replace(/\D/g, '').slice(-4)}`
            : '····',
        selected_ad_account_ids: selectedIds,
        insights_ready: insightsReady,
      },
      limits: await getUsageSnapshot(req.organizationId),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al guardar la conexión' });
  }
});

app.put('/api/meta/connections/:id/ad-accounts', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const raw = req.body?.adAccountIds;
    const selectedInput = Array.isArray(raw) ? raw.map((x) => String(x)) : [];
    await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    const { rows } = await pool.query(
      'SELECT id, access_token FROM meta_connections WHERE id = $1 AND organization_id = $2',
      [id, req.organizationId],
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Conexión no encontrada' });
    }
    if (!String(row.access_token || '').trim()) {
      return res.status(400).json({
        error: 'No hay token de usuario. Conecta de nuevo incluyendo el access token.',
        code: 'no_token',
      });
    }
    const listed = await listAdAccounts(row.access_token);
    if (!listed.ok) {
      return res.status(400).json({ error: listed.message, code: listed.code || 'api_error' });
    }
    const valid = filterValidAdAccountIds(selectedInput, listed.accounts);
    await pool.query(`UPDATE meta_connections SET selected_ad_account_ids = $1::jsonb WHERE id = $2 AND organization_id = $3`, [
      JSON.stringify(valid),
      id,
      req.organizationId,
    ]);
    const insightsReady = valid.length > 0;
    res.json({
      ok: true,
      selected_ad_account_ids: valid,
      insights_ready: insightsReady,
      limits: await getUsageSnapshot(req.organizationId),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar cuentas publicitarias' });
  }
});

app.get('/api/meta/insights', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const cacheKey = cacheKeyForRequest(req, 'meta_insights');
    const cachedPayload = readCachedJsonResponse(cacheKey);
    if (cachedPayload) {
      return res.json(cachedPayload);
    }
    const sendCached = (payload) => {
      writeCachedJsonResponse(cacheKey, payload, 45_000);
      return res.json(payload);
    };
    const level = ['campaigns', 'adsets', 'ads'].includes(String(req.query.level))
      ? String(req.query.level)
      : 'campaigns';
    const period = String(req.query.period || 'hoy');
    const datePreset = datePresetFromDashboardPeriod(period);

    const row = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    if (!row || !String(row.access_token || '').trim()) {
      const snap = await buildMetaSnapshotFallbackForPeriod(req.organizationId, period);
      if (snap.ok) {
        return sendCached({
          live: false,
          snapshot: true,
          level,
          datePreset,
          period,
          adAccountId: null,
          fetchedAt: snap.fetchedAt || new Date().toISOString(),
          totals: snap.totals,
          rows: [],
          partialErrors: [
            {
              source: 'meta_snapshot',
              error: 'Meta desconectado: mostrando respaldo guardado en KOVO.',
            },
          ],
          snapshot_window: {
            since: snap.sinceYmd,
            until: snap.untilYmd,
            used_latest_fallback: snap.usedLatestFallback,
          },
          snapshot_rows: snap.rows.length,
        });
      }
      return res.status(400).json({
        error: 'Falta token de usuario en la conexión Meta.',
        code: 'no_token',
      });
    }
    const storedIds = row.selected_ad_account_ids;
    const resolved = resolveAdAccountIdsForRequest(req.query.adAccountId, storedIds);
    if (!resolved.ok) {
      return res.status(400).json({
        error: 'Esa cuenta no está entre las vinculadas en la conexión Meta.',
        code: resolved.code || 'invalid_ad_account',
      });
    }
    const actIds = resolved.actIds;
    if (actIds.length === 0) {
      return res.status(400).json({
        error: 'No hay cuentas publicitarias seleccionadas. Configúralas en Conexión Meta ADS.',
        code: 'no_ad_accounts',
      });
    }

    const allRows = [];
    const partialErrors = [];
    for (const actId of actIds) {
      const norm = normalizeActId(actId);
      const r = await fetchInsightsForAdAccount(norm, row.access_token, level, datePreset);
      if (!r.ok) {
        partialErrors.push({ adAccountId: norm, error: r.error || 'Error desconocido' });
        continue;
      }
      allRows.push(...r.rows);
    }

    const totals = allRows.reduce(
      (acc, x) => ({
        impressions: acc.impressions + x.impressions,
        clicks: acc.clicks + x.clicks,
        spend: acc.spend + x.spend,
        purchases: acc.purchases + x.purchases,
        revenue: acc.revenue + x.revenue,
      }),
      { impressions: 0, clicks: 0, spend: 0, purchases: 0, revenue: 0 },
    );
    totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
    totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.roas = totals.spend > 0 && totals.revenue > 0 ? totals.revenue / totals.spend : 0;
    totals.cpa = totals.purchases > 0 ? totals.spend / totals.purchases : 0;

    if (allRows.length === 0) {
      const snap = await buildMetaSnapshotFallbackForPeriod(req.organizationId, period);
      if (snap.ok) {
        return sendCached({
          live: false,
          snapshot: true,
          level,
          datePreset,
          period,
          adAccountId: actIds.length === 1 ? actIds[0] : null,
          fetchedAt: snap.fetchedAt || new Date().toISOString(),
          totals: snap.totals,
          rows: [],
          partialErrors: [
            ...partialErrors,
            {
              source: 'meta_snapshot',
              error: 'No hubo respuesta live de Meta; se muestra respaldo guardado en KOVO.',
            },
          ],
          snapshot_window: {
            since: snap.sinceYmd,
            until: snap.untilYmd,
            used_latest_fallback: snap.usedLatestFallback,
          },
          snapshot_rows: snap.rows.length,
        });
      }
    }

    sendCached({
      live: true,
      level,
      datePreset,
      period,
      adAccountId: actIds.length === 1 ? actIds[0] : null,
      fetchedAt: new Date().toISOString(),
      totals,
      rows: allRows,
      partialErrors,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener métricas de Meta' });
  }
});

app.get('/api/meta/ctr-compare', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const period = String(req.query.period || '7d').trim().toLowerCase();
    const cacheKey = cacheKeyForRequest(req, 'meta_ctr_compare');
    const cachedPayload = readCachedJsonResponse(cacheKey);
    if (cachedPayload) return res.json(cachedPayload);
    const windows = metaCtrCompareWindows(period, META_SNAPSHOT_TIMEZONE);
    const [curRows, prevRows] = await Promise.all([
      loadMetaDailySnapshotsForRange(req.organizationId, windows.current.since, windows.current.until),
      loadMetaDailySnapshotsForRange(req.organizationId, windows.previous.since, windows.previous.until),
    ]);
    const payload = {
      period,
      source: 'meta_daily_snapshots',
      current_ctr: ctrFromSnapshotRows(curRows),
      previous_ctr: ctrFromSnapshotRows(prevRows),
      current_window: windows.current,
      previous_window: windows.previous,
      current_days: curRows.length,
      previous_days: prevRows.length,
    };
    writeCachedJsonResponse(cacheKey, payload, 90_000);
    return res.json(payload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error al calcular comparación CTR' });
  }
});

app.post('/api/meta/campaign-status', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const campaignId = String(req.body?.campaign_id || '').trim();
    const status = String(req.body?.status || '').toUpperCase();
    if (!campaignId) {
      return res.status(400).json({ error: 'campaign_id requerido' });
    }
    if (status !== 'PAUSED' && status !== 'ACTIVE') {
      return res.status(400).json({ error: 'status debe ser PAUSED o ACTIVE' });
    }

    const row = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    if (!row || !String(row.access_token || '').trim()) {
      return res.status(400).json({
        error: 'Falta token de usuario en la conexión Meta.',
        code: 'no_token',
      });
    }
    const resolved = resolveAdAccountIdsForRequest(undefined, row.selected_ad_account_ids);
    if (!resolved.ok || resolved.actIds.length === 0) {
      return res.status(400).json({
        error: 'No hay cuentas publicitarias seleccionadas.',
        code: 'no_ad_accounts',
      });
    }

    const lookup = await getCampaignAdAccountId(campaignId, row.access_token);
    if (!lookup.ok || !lookup.accountId) {
      return res.status(400).json({
        error: lookup.error || 'No se pudo verificar la campaña',
        code: 'campaign_lookup_failed',
      });
    }

    const allowed = new Set(resolved.actIds.map((x) => normalizeActId(x)).filter(Boolean));
    if (!allowed.has(lookup.accountId)) {
      return res.status(403).json({
        error: 'Esta campaña no pertenece a las cuentas publicitarias vinculadas en KOVO.',
        code: 'campaign_not_in_selection',
      });
    }

    const up = await updateCampaignStatusGraph(campaignId, row.access_token, status);
    if (!up.ok) {
      const msg = String(up.error || '').toLowerCase();
      const needsMgmt =
        up.fb &&
        (up.fb.code === 10 ||
          up.fb.code === 200 ||
          msg.includes('ads_management') ||
          msg.includes('permission') ||
          msg.includes('permissions'));
      return res.status(502).json({
        error: up.error || 'Meta no pudo aplicar el cambio',
        code: needsMgmt ? 'ads_management_required' : 'meta_update_failed',
      });
    }

    res.json({ ok: true, campaign_id: campaignId, status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar el estado de la campaña' });
  }
});

app.get('/api/meta/campaign-product-links', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT meta_campaign_id, product_ids FROM meta_campaign_product_links WHERE organization_id = $1`,
      [req.organizationId],
    );
    const links = {};
    for (const row of r.rows) {
      const raw = row.product_ids;
      const ids = Array.isArray(raw) ? raw : [];
      links[String(row.meta_campaign_id)] = ids
        .map((x) => Number.parseInt(String(x), 10))
        .filter((n) => Number.isFinite(n));
    }
    res.json({ links });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error:
          'Falta la tabla meta_campaign_product_links. Reinicia el backend o aplica backend/db/schema.sql.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al leer vínculos campaña–producto' });
  }
});

app.put('/api/meta/campaign-product-links', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const cid = String(req.body?.meta_campaign_id || '').trim();
    if (!cid) {
      return res.status(400).json({ error: 'meta_campaign_id requerido' });
    }
    const raw = req.body?.product_ids;
    const arr = Array.isArray(raw) ? raw : [];
    const product_ids = [];
    const seen = new Set();
    for (const x of arr) {
      const n = Number.parseInt(String(x), 10);
      if (!Number.isFinite(n) || seen.has(n)) continue;
      seen.add(n);
      product_ids.push(n);
      if (product_ids.length >= 80) break;
    }
    await pool.query(
      `INSERT INTO meta_campaign_product_links (organization_id, meta_campaign_id, product_ids, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (organization_id, meta_campaign_id) DO UPDATE SET
         product_ids = EXCLUDED.product_ids,
         updated_at = now()`,
      [req.organizationId, cid, JSON.stringify(product_ids)],
    );
    res.json({ ok: true, meta_campaign_id: cid, product_ids });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error:
          'Falta la tabla meta_campaign_product_links. Reinicia el backend o aplica backend/db/schema.sql.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al guardar vínculos campaña–producto' });
  }
});

/** Gasto de Meta asignado por producto usando links campaña->producto (sin reparto por ventas). */
app.get('/api/product-analytics/meta-spend', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const cacheKey = cacheKeyForRequest(req, 'meta_product_spend');
    const cachedPayload = readCachedJsonResponse(cacheKey);
    if (cachedPayload) {
      return res.json(cachedPayload);
    }
    const sendCached = (payload) => {
      writeCachedJsonResponse(cacheKey, payload, 60_000);
      return res.json(payload);
    };
    const period = String(req.query.period || '30d');
    const datePreset = datePresetFromDashboardPeriod(period);

    const row = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    if (!row || !String(row.access_token || '').trim()) {
      return res.status(400).json({
        error: 'Falta token de usuario en la conexión Meta.',
        code: 'no_token',
      });
    }
    const resolved = resolveAdAccountIdsForRequest(req.query.adAccountId, row.selected_ad_account_ids);
    if (!resolved.ok) {
      return res.status(400).json({
        error: 'Esa cuenta no está entre las vinculadas en la conexión Meta.',
        code: resolved.code || 'invalid_ad_account',
      });
    }
    const actIds = resolved.actIds;
    if (actIds.length === 0) {
      return res.status(400).json({
        error: 'No hay cuentas publicitarias seleccionadas.',
        code: 'no_ad_accounts',
      });
    }

    const linksRows = await pool.query(
      `SELECT meta_campaign_id, product_ids
       FROM meta_campaign_product_links
       WHERE organization_id = $1`,
      [req.organizationId],
    );
    const linksByCampaign = new Map();
    for (const r of linksRows.rows) {
      const cid = String(r.meta_campaign_id || '').trim();
      if (!cid) continue;
      const ids = Array.isArray(r.product_ids)
        ? r.product_ids
            .map((x) => Number.parseInt(String(x), 10))
            .filter((n) => Number.isFinite(n))
        : [];
      linksByCampaign.set(cid, ids);
    }

    const partialErrors = [];
    const campaigns = [];
    for (const actId of actIds) {
      const norm = normalizeActId(actId);
      const r = await fetchInsightsForAdAccount(norm, row.access_token, 'campaigns', datePreset);
      if (!r.ok) {
        partialErrors.push({ adAccountId: norm, error: r.error || 'Error al leer campañas' });
        continue;
      }
      campaigns.push(...r.rows);
    }

    const productSpend = {};
    let unlinkedSpend = 0;
    let linkedCampaignRows = 0;

    for (const c of campaigns) {
      const cid = String(c.id || c.campaignId || '').trim();
      const spend = Number(c.spend || 0);
      if (!Number.isFinite(spend) || spend <= 0) continue;
      const pids = cid ? linksByCampaign.get(cid) || [] : [];
      if (!pids.length) {
        unlinkedSpend += spend;
        continue;
      }
      linkedCampaignRows += 1;
      const share = spend / pids.length;
      for (const pid of pids) {
        const k = String(pid);
        productSpend[k] = (productSpend[k] || 0) + share;
      }
    }

    sendCached({
      live: true,
      period,
      datePreset,
      fetchedAt: new Date().toISOString(),
      product_spend: Object.fromEntries(
        Object.entries(productSpend).map(([k, v]) => [k, Math.round(Number(v) * 100) / 100]),
      ),
      unlinked_spend: Math.round(unlinkedSpend * 100) / 100,
      campaign_rows: campaigns.length,
      linked_campaign_rows: linkedCampaignRows,
      partialErrors,
    });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error:
          'Falta la tabla meta_campaign_product_links. Reinicia el backend o aplica backend/db/schema.sql.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al calcular gasto de Meta por producto' });
  }
});

function parseMarketingTargetNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseManualPricingNum(v) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = Number.parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, value: null };
  }
  return { ok: true, value: n };
}

function parseDeliveryEffectivenessPct(v) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = Number.parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { ok: false, value: null };
  }
  return { ok: true, value: n };
}

app.get('/api/shopify/product-marketing-targets', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT shopify_product_id, cpm_target, ctr_target, cpc_target, roas_target, cpa_target
       FROM shopify_product_marketing_targets WHERE organization_id = $1`,
      [req.organizationId],
    );
    const targets = r.rows.map((row) => ({
      product_id: Number(row.shopify_product_id),
      cpm_target: row.cpm_target != null ? Number(row.cpm_target) : null,
      ctr_target: row.ctr_target != null ? Number(row.ctr_target) : null,
      cpc_target: row.cpc_target != null ? Number(row.cpc_target) : null,
      roas_target: row.roas_target != null ? Number(row.roas_target) : null,
      cpa_target: row.cpa_target != null ? Number(row.cpa_target) : null,
    }));
    res.json({ targets });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error:
          'Falta la tabla shopify_product_marketing_targets. Reinicia el backend o aplica backend/db/schema.sql.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al leer indicadores de marketing' });
  }
});

app.put('/api/shopify/product-marketing-targets', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const pid = Number.parseInt(String(req.body?.product_id ?? ''), 10);
    if (!Number.isFinite(pid)) {
      return res.status(400).json({ error: 'product_id inválido' });
    }
    const cpm_target = parseMarketingTargetNum(req.body?.cpm_target);
    const ctr_target = parseMarketingTargetNum(req.body?.ctr_target);
    const cpc_target = parseMarketingTargetNum(req.body?.cpc_target);
    const roas_target = parseMarketingTargetNum(req.body?.roas_target);
    const cpa_target = parseMarketingTargetNum(req.body?.cpa_target);

    await pool.query(
      `INSERT INTO shopify_product_marketing_targets
        (organization_id, shopify_product_id, cpm_target, ctr_target, cpc_target, roas_target, cpa_target, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (organization_id, shopify_product_id) DO UPDATE SET
         cpm_target = EXCLUDED.cpm_target,
         ctr_target = EXCLUDED.ctr_target,
         cpc_target = EXCLUDED.cpc_target,
         roas_target = EXCLUDED.roas_target,
         cpa_target = EXCLUDED.cpa_target,
         updated_at = now()`,
      [req.organizationId, pid, cpm_target, ctr_target, cpc_target, roas_target, cpa_target],
    );
    res.json({
      ok: true,
      product_id: pid,
      cpm_target,
      ctr_target,
      cpc_target,
      roas_target,
      cpa_target,
    });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error:
          'Falta la tabla shopify_product_marketing_targets. Reinicia el backend o aplica backend/db/schema.sql.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al guardar indicadores de marketing' });
  }
});

app.put('/api/shopify/product-manual-pricing', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const pid = Number.parseInt(String(req.body?.product_id ?? ''), 10);
    if (!Number.isFinite(pid)) {
      return res.status(400).json({ error: 'product_id inválido' });
    }
    const productPriceParsed = parseManualPricingNum(req.body?.manual_product_price);
    if (!productPriceParsed.ok) {
      return res.status(400).json({ error: 'manual_product_price inválido' });
    }
    const freightPriceParsed = parseManualPricingNum(req.body?.manual_avg_freight_price);
    if (!freightPriceParsed.ok) {
      return res.status(400).json({ error: 'manual_avg_freight_price inválido' });
    }
    const productPriceMoticoParsed = parseManualPricingNum(req.body?.manual_product_price_motico);
    if (!productPriceMoticoParsed.ok) {
      return res.status(400).json({ error: 'manual_product_price_motico inválido' });
    }
    const freightPriceMoticoParsed = parseManualPricingNum(req.body?.manual_avg_freight_price_motico);
    if (!freightPriceMoticoParsed.ok) {
      return res.status(400).json({ error: 'manual_avg_freight_price_motico inválido' });
    }
    const deliveryEffectivenessParsed = parseDeliveryEffectivenessPct(req.body?.delivery_effectiveness_pct);
    if (!deliveryEffectivenessParsed.ok) {
      return res.status(400).json({ error: 'delivery_effectiveness_pct inválido (0-100)' });
    }
    const manualProductPrice = productPriceParsed.value;
    const manualAvgFreightPrice = freightPriceParsed.value;
    const manualProductPriceMotico = productPriceMoticoParsed.value;
    const manualAvgFreightPriceMotico = freightPriceMoticoParsed.value;
    const deliveryEffectivenessPct = deliveryEffectivenessParsed.value;
    if (
      manualProductPrice == null &&
      manualAvgFreightPrice == null &&
      manualProductPriceMotico == null &&
      manualAvgFreightPriceMotico == null &&
      deliveryEffectivenessPct == null
    ) {
      await pool.query(
        `DELETE FROM shopify_product_manual_pricing
         WHERE organization_id = $1 AND shopify_product_id = $2`,
        [req.organizationId, pid],
      );
      return res.json({
        ok: true,
        product_id: pid,
        manual_product_price: null,
        manual_avg_freight_price: null,
        manual_product_price_motico: null,
        manual_avg_freight_price_motico: null,
        delivery_effectiveness_pct: null,
      });
    }
    await pool.query(
      `INSERT INTO shopify_product_manual_pricing
        (
          organization_id,
          shopify_product_id,
          manual_product_price,
          manual_avg_freight_price,
          manual_product_price_motico,
          manual_avg_freight_price_motico,
          delivery_effectiveness_pct,
          updated_at
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (organization_id, shopify_product_id) DO UPDATE SET
         manual_product_price = EXCLUDED.manual_product_price,
         manual_avg_freight_price = EXCLUDED.manual_avg_freight_price,
         manual_product_price_motico = EXCLUDED.manual_product_price_motico,
         manual_avg_freight_price_motico = EXCLUDED.manual_avg_freight_price_motico,
         delivery_effectiveness_pct = EXCLUDED.delivery_effectiveness_pct,
         updated_at = now()`,
      [
        req.organizationId,
        pid,
        manualProductPrice,
        manualAvgFreightPrice,
        manualProductPriceMotico,
        manualAvgFreightPriceMotico,
        deliveryEffectivenessPct,
      ],
    );
    return res.json({
      ok: true,
      product_id: pid,
      manual_product_price: manualProductPrice,
      manual_avg_freight_price: manualAvgFreightPrice,
      manual_product_price_motico: manualProductPriceMotico,
      manual_avg_freight_price_motico: manualAvgFreightPriceMotico,
      delivery_effectiveness_pct: deliveryEffectivenessPct,
    });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error:
          'Falta la tabla shopify_product_manual_pricing. Reinicia el backend o aplica backend/db/schema.sql.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    return res.status(500).json({ error: 'Error al guardar precios manuales de inventario' });
  }
});

app.get('/api/meta/funnel', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const period = String(req.query.period || 'hoy');
    const datePreset = datePresetFromDashboardPeriod(period);

    const row = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    if (!row || !String(row.access_token || '').trim()) {
      return res.status(400).json({
        error: 'Falta token de usuario en la conexión Meta.',
        code: 'no_token',
      });
    }
    const resolved = resolveAdAccountIdsForRequest(req.query.adAccountId, row.selected_ad_account_ids);
    if (!resolved.ok) {
      return res.status(400).json({
        error: 'Esa cuenta no está entre las vinculadas en la conexión Meta.',
        code: resolved.code || 'invalid_ad_account',
      });
    }
    const actIds = resolved.actIds;
    if (actIds.length === 0) {
      return res.status(400).json({
        error: 'No hay cuentas publicitarias seleccionadas.',
        code: 'no_ad_accounts',
      });
    }

    const { merged, partialErrors, ok } = await fetchFunnelForAdAccounts(
      actIds,
      row.access_token,
      datePreset,
    );
    if (!ok || !merged) {
      return res.status(502).json({
        error: 'Meta no devolvió datos de embudo para las cuentas indicadas.',
        code: 'funnel_empty',
        partialErrors,
      });
    }

    const drops = [];
    for (let i = 0; i < merged.stages.length - 1; i++) {
      const from = merged.stages[i].people;
      const to = merged.stages[i + 1].people;
      drops.push(from > 0 ? ((from - to) / from) * 100 : 0);
    }
    const linkClicks = merged.stages[1] ? merged.stages[1].people : 0;
    const purchases = merged.stages[merged.stages.length - 1]
      ? merged.stages[merged.stages.length - 1].people
      : 0;
    const convRate = linkClicks > 0 ? (purchases / linkClicks) * 100 : 0;
    const cpa = purchases > 0 ? merged.spend / purchases : 0;
    const roas = merged.spend > 0 && merged.revenue > 0 ? merged.revenue / merged.spend : 0;

    res.json({
      live: true,
      datePreset,
      period,
      adAccountId: actIds.length === 1 ? actIds[0] : null,
      fetchedAt: new Date().toISOString(),
      stages: merged.stages,
      drops,
      spend: merged.spend,
      revenue: merged.revenue,
      impressions: merged.impressions,
      purchases,
      linkClicks,
      convRate,
      cpa,
      roas,
      partialErrors,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener embudo de Meta' });
  }
});

/** Embudo + anuncios + serie diaria (panel Ads Funnel). */
app.get('/api/meta/ads-funnel-panel', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const cacheKey = cacheKeyForRequest(req, 'meta_ads_funnel_panel');
    const cachedPayload = readCachedJsonResponse(cacheKey);
    if (cachedPayload) {
      return res.json(cachedPayload);
    }
    const sendCached = (payload) => {
      writeCachedJsonResponse(cacheKey, payload, 60_000);
      return res.json(payload);
    };
    const period = String(req.query.period || '7d');
    const datePreset = datePresetFromDashboardPeriod(period);

    const row = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    if (!row || !String(row.access_token || '').trim()) {
      return res.status(400).json({
        error: 'Falta token de usuario en la conexión Meta.',
        code: 'no_token',
      });
    }
    const resolved = resolveAdAccountIdsForRequest(req.query.adAccountId, row.selected_ad_account_ids);
    if (!resolved.ok) {
      return res.status(400).json({
        error: 'Esa cuenta no está entre las vinculadas en la conexión Meta.',
        code: resolved.code || 'invalid_ad_account',
      });
    }
    const actIds = resolved.actIds;
    if (actIds.length === 0) {
      return res.status(400).json({
        error: 'No hay cuentas publicitarias seleccionadas.',
        code: 'no_ad_accounts',
      });
    }

    const partialErrors = [];

    const { merged, partialErrors: funnelPartial, ok: funnelOk } = await fetchFunnelForAdAccounts(
      actIds,
      row.access_token,
      datePreset,
    );
    if (Array.isArray(funnelPartial)) {
      for (const e of funnelPartial) {
        partialErrors.push({ source: 'funnel', adAccountId: e.adAccountId, error: e.error });
      }
    }
    if (!funnelOk || !merged) {
      return res.status(502).json({
        error: 'Meta no devolvió datos de embudo para las cuentas indicadas.',
        code: 'funnel_empty',
        partialErrors,
      });
    }

    const drops = [];
    for (let i = 0; i < merged.stages.length - 1; i++) {
      const from = merged.stages[i].people;
      const to = merged.stages[i + 1].people;
      drops.push(from > 0 ? ((from - to) / from) * 100 : 0);
    }
    const linkClicks = merged.stages[1] ? merged.stages[1].people : 0;
    const purchases = merged.stages[merged.stages.length - 1]
      ? merged.stages[merged.stages.length - 1].people
      : 0;
    const convRate = linkClicks > 0 ? (purchases / linkClicks) * 100 : 0;
    const cpa = purchases > 0 ? merged.spend / purchases : 0;
    const roas = merged.spend > 0 && merged.revenue > 0 ? merged.revenue / merged.spend : 0;

    const funnelPayload = {
      stages: merged.stages,
      drops,
      spend: merged.spend,
      revenue: merged.revenue,
      impressions: merged.impressions,
      purchases,
      linkClicks,
      convRate,
      cpa,
      roas,
    };

    const allRows = [];
    for (const actId of actIds) {
      const norm = normalizeActId(actId);
      const r = await fetchInsightsForAdAccount(norm, row.access_token, 'ads', datePreset);
      if (!r.ok) {
        partialErrors.push({ source: 'ads', adAccountId: norm, error: r.error || 'Error al leer anuncios' });
        continue;
      }
      allRows.push(...r.rows);
    }

    const totals = allRows.reduce(
      (acc, x) => ({
        impressions: acc.impressions + x.impressions,
        clicks: acc.clicks + x.clicks,
        spend: acc.spend + x.spend,
        purchases: acc.purchases + x.purchases,
        revenue: acc.revenue + x.revenue,
      }),
      { impressions: 0, clicks: 0, spend: 0, purchases: 0, revenue: 0 },
    );
    totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
    totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.roas = totals.spend > 0 && totals.revenue > 0 ? totals.revenue / totals.spend : 0;
    totals.cpa = totals.purchases > 0 ? totals.spend / totals.purchases : 0;

    const adsSorted = [...allRows].sort((a, b) => b.spend - a.spend).slice(0, 25);

    const { series: daily, partialErrors: dailyPartial } = await fetchMergedDailyInsightsForAdAccounts(
      actIds,
      row.access_token,
      datePreset,
    );
    if (Array.isArray(dailyPartial)) {
      for (const e of dailyPartial) {
        partialErrors.push({ source: 'daily', adAccountId: e.adAccountId, error: e.error });
      }
    }

    const convSitePct = totals.clicks > 0 ? (totals.purchases / totals.clicks) * 100 : 0;

    sendCached({
      live: true,
      period,
      datePreset,
      adAccountId: actIds.length === 1 ? actIds[0] : null,
      fetchedAt: new Date().toISOString(),
      funnel: funnelPayload,
      totals,
      adsRows: adsSorted,
      daily,
      kpi: {
        ctr: totals.ctr,
        cpc: totals.cpc,
        convRate: convSitePct,
      },
      partialErrors,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al cargar panel Ads Funnel' });
  }
});

app.delete('/api/meta/connections/:id', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await pool.query(
      'DELETE FROM meta_connections WHERE id = $1 AND organization_id = $2',
      [id, req.organizationId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Conexión no encontrada' });
    }
    res.json({ ok: true, limits: await getUsageSnapshot(req.organizationId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar la conexión' });
  }
});

async function cleanupShopifyOauthStates() {
  await pool.query(`DELETE FROM shopify_oauth_states WHERE expires_at < now()`);
}

async function getActiveShopifyConnection(organizationId) {
  const { rows } = await pool.query(
    `SELECT id, shop_domain, access_token, scope, status, installed_at, updated_at
     FROM shopify_connections
     WHERE organization_id = $1 AND status = 'connected'
     ORDER BY id DESC
     LIMIT 1`,
    [organizationId],
  );
  return rows[0] || null;
}

/** Estados operativos unificados (Pedidos + Motico). */
const UNIFIED_ORDER_ESTADO_LIST = [
  'sin_revisar',
  'sin_confirmar',
  'no_llego_mensaje',
  'confirmado',
  'despachado',
  'devolucion',
  'prueba',
  'cancelado',
];
const SHOPIFY_INTERNAL_STATUSES = new Set(UNIFIED_ORDER_ESTADO_LIST);
const SHOPIFY_MOTICO_STATUSES = SHOPIFY_INTERNAL_STATUSES;
const SHOPIFY_MENSAJEROS = new Set(['motico', 'dropi', 'effix']);
const MOTICO_STATUS_DEFAULT = 'sin_revisar';
const MOTICO_PAYMENT_STATUSES = new Set(['pending', 'paid', 'refunded', 'double_freight', 'cancelado']);
const MOTICO_RELACION_PAGO_ESTADOS = new Set(['pendiente_pago', 'pagado', 'cancelado', 'devolucion']);
const LOCKED_MOTICO_STATUSES = new Set(['despachado', 'cancelado']);
const LOCKED_INTERNAL_STATUSES = new Set(['despachado', 'cancelado']);

const UNIFIED_ESTADO_RANK = {
  sin_revisar: 10,
  sin_confirmar: 20,
  no_llego_mensaje: 25,
  confirmado: 30,
  prueba: 35,
  despachado: 50,
  devolucion: 55,
  cancelado: 60,
};

/** Mapea valores antiguos (motico_status / internal) al conjunto unificado actual. */
function normalizeLegacyMoticoEstadoToUnified(raw) {
  const s = String(raw || 'sin_revisar')
    .trim()
    .toLowerCase();
  if (SHOPIFY_INTERNAL_STATUSES.has(s)) return s;
  const legacy = {
    imprimir_guia: 'confirmado',
    /** Antes Motico usaba «pagado» como estado operativo; ya no debe bloquear edición como «despachado». */
    pagado: 'confirmado',
    pendiente_pago: 'sin_confirmar',
    devolucion: 'cancelado',
    motico: 'confirmado',
  };
  const m = legacy[s];
  return m && SHOPIFY_INTERNAL_STATUSES.has(m) ? m : MOTICO_STATUS_DEFAULT;
}

/** Unifica internal_status y motico_status para la respuesta API (mayor “avance” gana). */
function mergeDisplayedOrderEstado(internalRaw, moticoRaw) {
  const a = normalizeLegacyMoticoEstadoToUnified(internalRaw);
  const b = normalizeLegacyMoticoEstadoToUnified(moticoRaw);
  const ra = UNIFIED_ESTADO_RANK[a] || 0;
  const rb = UNIFIED_ESTADO_RANK[b] || 0;
  return ra >= rb ? a : b;
}

function comisionVentasPeriodDeps() {
  return {
    listOrganizationRoleRows,
    fetchShopifyTotalsByOrderIds,
    normalizeLegacyMoticoEstadoToUnified,
  };
}

async function ensureCommissionPaymentCutRow(
  organizationId,
  periodStartStr,
  periodEndStr,
  cutKind,
  sinceMs,
  untilExclusiveMs,
) {
  const ex = await pool.query(
    `SELECT 1 FROM commission_payment_cuts WHERE organization_id = $1 AND period_start = $2::date AND period_end = $3::date`,
    [organizationId, periodStartStr, periodEndStr],
  );
  if (ex.rowCount > 0) return;
  const { gain_total, ventas_total } = await computeOrganizationCommissionPeriodTotals(
    pool,
    organizationId,
    sinceMs,
    untilExclusiveMs,
    comisionVentasPeriodDeps(),
  );
  await pool.query(
    `INSERT INTO commission_payment_cuts (organization_id, period_start, period_end, cut_kind, commission_total, ventas_despachadas_total, payment_status, created_at, updated_at)
     VALUES ($1, $2::date, $3::date, $4, $5, $6, 'pending', now(), now())`,
    [organizationId, periodStartStr, periodEndStr, cutKind, gain_total, ventas_total],
  );
}

/** Crea filas faltantes: primer corte desde el primer despacho hasta fin de mes; luego 1–15 y 16–fin de mes (UTC). */
async function syncCommissionPaymentCutsForOrg(organizationId) {
  const minMs = await findMinDespachadoCommissionUpdatedAtMs(
    pool,
    organizationId,
    normalizeLegacyMoticoEstadoToUnified,
  );
  if (minMs == null || !Number.isFinite(minMs)) return;
  const specs = buildClosedCommissionCutSpecs(minMs, Date.now());
  for (const s of specs) {
    await ensureCommissionPaymentCutRow(
      organizationId,
      s.periodStartStr,
      s.periodEndStr,
      s.cut_kind,
      s.sinceMs,
      s.untilExclusiveMs,
    );
  }
}

/** Fecha de corte (columna DATE u objeto Date de pg) → `YYYY-MM-DD` para API y etiquetas. */
function commissionPaymentCutDateToYmd(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function formatComisionCutPeriodLabel(periodStartStr, periodEndStr, cutKind) {
  const ps = String(periodStartStr || '').trim();
  const pe = String(periodEndStr || '').trim();
  const [ys, ms, ds] = ps.split('-').map(Number);
  const [ye, me, de] = pe.split('-').map(Number);
  if (![ys, ms, ds, ye, me, de].every((n) => Number.isFinite(n))) {
    return ps && pe ? `${ps} al ${pe}` : ps || pe || '—';
  }
  const monthLong = (y, m) => {
    const raw = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleString('es-CO', { month: 'long', timeZone: 'UTC' })
      .replace(/\./g, '');
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };
  if (ys === ye && ms === me) {
    if (cutKind === 'first_half') {
      return `1 al 15 de ${monthLong(ys, ms)} de ${ys}`;
    }
    if (cutKind === 'second_half') {
      return `16 al ${de} de ${monthLong(ys, ms)} de ${ys}`;
    }
    return `${ds} al ${de} de ${monthLong(ys, ms)} de ${ys}`;
  }
  return `${ds} de ${monthLong(ys, ms)} de ${ys} al ${de} de ${monthLong(ye, me)} de ${ye}`;
}

function isUnifiedEstadoPrueba(raw) {
  return normalizeLegacyMoticoEstadoToUnified(raw) === 'prueba';
}

function normalizeMoticoPaymentStatus(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'paid') return 'paid';
  if (v === 'refunded') return 'refunded';
  return 'pending';
}

const PAYMENT_STATUS_MUTABLE_FIELDS_ONLY = new Set([
  'payment_status',
  'total_a_pagar_override',
  'pago_al_recibir_override',
  'pagado_al_recibir_override',
]);

function isOnlyPaymentStatusMutation(bodyKeys) {
  return (
    Array.isArray(bodyKeys) &&
    bodyKeys.length > 0 &&
    bodyKeys.every((k) => PAYMENT_STATUS_MUTABLE_FIELDS_ONLY.has(String(k || '').trim()))
  );
}

const SHOPIFY_ORDER_LIST_FIELDS =
  'id,name,phone,email,created_at,total_price,total_outstanding,currency,financial_status,fulfillment_status,customer,order_number,line_items,shipping_address,billing_address,landing_site,referring_site,source_name,note_attributes';

/** Total a pagar por defecto (Shopify): pagado → 0; si no, total_outstanding o total del pedido. */
function shopifyDefaultTotalAPagar(o) {
  const fin = String(o.financialStatus || '').toLowerCase();
  if (fin === 'paid') return 0;
  const outRaw = o.totalOutstanding;
  if (outRaw != null && String(outRaw).trim() !== '') {
    const out = Number.parseFloat(String(outRaw));
    if (Number.isFinite(out) && out >= 0) return out;
  }
  const t = Number.parseFloat(String(o.total || '0'));
  return Number.isFinite(t) && t >= 0 ? t : 0;
}

/**
 * Mismo criterio de Pedidos para ventas:
 * 1) price_override en local fields (si existe)
 * 2) price_override en el objeto de orden (si existe)
 * 3) total base del pedido
 */
function resolveOrderRevenueAmount(order, localFields) {
  const ovLocal =
    localFields?.price_override != null && Number.isFinite(Number(localFields.price_override))
      ? Number(localFields.price_override)
      : null;
  if (ovLocal != null && ovLocal >= 0) return ovLocal;
  const ovOrder =
    order?.price_override != null && Number.isFinite(Number(order.price_override))
      ? Number(order.price_override)
      : null;
  if (ovOrder != null && ovOrder >= 0) return ovOrder;
  const baseRaw = Number.parseFloat(String(order?.shopifyTotal ?? order?.total ?? '0').replace(',', '.'));
  if (Number.isFinite(baseRaw) && baseRaw >= 0) return baseRaw;
  return NaN;
}

function moticoPhoneDigitsLocal(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('57') && d.length >= 10) d = d.slice(2);
  return d;
}

function normalizeCityForMoticoRule(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isMoticoEligibleCityName(raw) {
  const c = normalizeCityForMoticoRule(raw);
  return c === 'bogota' || c === 'soacha';
}

/** @param {object} r fila motico_manual_orders */
function mapMoticoManualOrderRowFromDb(r) {
  const vid = -Number(r.id);
  let ship = {};
  if (r.shipping_json && typeof r.shipping_json === 'object') ship = r.shipping_json;
  else if (typeof r.shipping_json === 'string') {
    try {
      ship = JSON.parse(r.shipping_json);
    } catch {
      ship = {};
    }
  }
  const clientName = String(r.client_name || '');
  const sa = {
    name: String(ship.name || clientName || ''),
    address1: String(ship.address1 || ''),
    address2: String(ship.address2 || ''),
    city: String(ship.city || ''),
    province: String(ship.province || ''),
    zip: String(ship.zip || ''),
    country: String(ship.country || ''),
    phone: String(ship.phone || ''),
  };
  let lineItemsRaw = r.line_items_json;
  if (typeof lineItemsRaw === 'string') {
    try {
      lineItemsRaw = JSON.parse(lineItemsRaw);
    } catch {
      lineItemsRaw = [];
    }
  }
  if (!Array.isArray(lineItemsRaw)) lineItemsRaw = [];
  const qo = r.quantity_override != null ? Number(r.quantity_override) : null;
  const po = r.price_override != null ? Number(r.price_override) : null;
  const totalStr = String(r.total_price ?? '0');
  const defQty = lineItemsRaw.length
    ? lineItemsRaw.reduce((s, li) => s + (parseInt(String(li.quantity), 10) || 0), 0) || 1
    : 1;
  const shopQty = qo != null && Number.isFinite(qo) && qo > 0 ? qo : defQty;
  const lineItemsDetail =
    lineItemsRaw.length > 0
      ? lineItemsRaw.map((li, idx) => ({
          id: Number(li.id) && Number.isFinite(Number(li.id)) ? Number(li.id) : idx + 1,
          product_id:
            li.product_id != null && Number.isFinite(Number(li.product_id)) ? Number(li.product_id) : null,
          variant_id:
            li.variant_id != null && Number.isFinite(Number(li.variant_id)) ? Number(li.variant_id) : null,
          title: String(li.title || li.name || 'Producto').trim() || 'Producto',
          name: String(li.name || '').trim(),
          variant_title: li.variant_title != null ? String(li.variant_title).trim() : '',
          quantity: parseInt(String(li.quantity), 10) || 0,
          price: li.price != null ? String(li.price) : '',
          sku: li.sku != null ? String(li.sku).trim() : '',
          barcode: li.barcode != null ? String(li.barcode).trim() : '',
          properties: Array.isArray(li.properties)
            ? li.properties
                .filter((p) => p && typeof p === 'object')
                .map((p) => ({ name: String(p.name || '').trim(), value: String(p.value || '').trim() }))
                .filter((p) => p.name || p.value)
            : [],
        }))
      : [
          {
            id: 1,
            title: String(r.product_summary || 'Producto').trim() || 'Producto',
            name: '',
            variant_title: '',
            quantity: shopQty,
            price: totalStr,
            sku: '',
            properties: [],
          },
        ];
  const financialStatus = String(r.financial_status || 'pending');
  const financialStatusLower = financialStatus.toLowerCase();
  const payment_status_override = MOTICO_PAYMENT_STATUSES.has(financialStatusLower) ? financialStatusLower : null;
  const b = mapFinancialToBadge(financialStatus);
  const totalOutstanding =
    r.total_outstanding != null && String(r.total_outstanding).trim() !== ''
      ? String(r.total_outstanding)
      : null;
  const oLike = { financialStatus, totalOutstanding, total: totalStr };
  const total_a_pagar_default = shopifyDefaultTotalAPagar(oLike);
  const total_a_pagar_override =
    r.total_a_pagar_override != null && r.total_a_pagar_override !== ''
      ? Number(r.total_a_pagar_override)
      : null;
  const total_a_pagar =
    total_a_pagar_override != null && Number.isFinite(total_a_pagar_override)
      ? total_a_pagar_override
      : total_a_pagar_default;
  const pago_al_recibir_override =
    r.pago_al_recibir_override != null && Number.isFinite(Number(r.pago_al_recibir_override))
      ? Number(r.pago_al_recibir_override)
      : 0;
  const rawPhone = (sa.phone || '').trim();
  const phoneLocal = moticoPhoneDigitsLocal(rawPhone);
  const moticoRaw = r.motico_status;
  const motico_status = normalizeLegacyMoticoEstadoToUnified(moticoRaw);
  const assignedDateRaw =
    ship && typeof ship === 'object'
      ? String(ship.assigned_date || ship.fecha_asignada || ship.assignedDate || '').trim()
      : '';
  const assigned_date = /^\d{4}-\d{2}-\d{2}$/.test(assignedDateRaw) ? assignedDateRaw : null;
  const manualMensajeroRaw = String(ship.mensajero || ship.mensajero_tag || ship.courier || '')
    .trim()
    .toLowerCase();
  const manualMensajero = SHOPIFY_MENSAJEROS.has(manualMensajeroRaw) ? manualMensajeroRaw : null;
  const last_despachado_at =
    r.last_despachado_at != null ? new Date(r.last_despachado_at).toISOString() : null;
  return {
    id: vid,
    orderName: String(r.order_name || `M-${r.id}`),
    client: clientName,
    email: String(r.client_email || '').trim() || '—',
    createdAt: new Date(r.created_at).toISOString(),
    total: totalStr,
    currency: String(r.currency || ''),
    financialStatus,
    totalOutstanding,
    fulfillmentStatus: '',
    label: b.label,
    badgeVariant: b.variant,
    defaultQuantity: shopQty,
    shopifyQuantity: shopQty,
    productIds: [],
    shippingAddress: sa,
    shippingCity: sa.city,
    shippingProvince: sa.province,
    shippingAddressLine: [sa.address1, sa.address2].filter(Boolean).join(' · '),
    phoneLocal: phoneLocal || '',
    lineItemsDetail,
    landingSite: '',
    referringSite: '',
    sourceName: 'motico_manual',
    utm: {},
    internal_status: motico_status,
    mensajero: manualMensajero,
    motico_status,
    price_override: po != null && Number.isFinite(po) ? po : null,
    quantity_override: qo != null && Number.isFinite(qo) ? qo : null,
    shopifyTotal: totalStr,
    total_a_pagar_default,
    total_a_pagar_override:
      total_a_pagar_override != null && Number.isFinite(total_a_pagar_override) ? total_a_pagar_override : null,
    total_a_pagar,
    pago_al_recibir_override,
    payment_status_override,
    assigned_date,
    is_motico_manual: true,
    last_despachado_at,
  };
}

function moticoManualOrderAssignedYmd(order, shopTz) {
  const ymdRaw = String(order?.assigned_date || '').trim();
  const parsedAssigned = parseIsoDateYmd(ymdRaw);
  if (parsedAssigned) return gananciaDiariaYmdKey(parsedAssigned);
  const t = Date.parse(String(order?.createdAt || ''));
  if (!Number.isFinite(t)) return '';
  const ymd = shopCalendarYmdFromInstant(t, shopTz || 'UTC');
  return gananciaDiariaYmdKey(ymd);
}

async function loadMoticoManualOrdersForOrg(organizationId, minIso, maxIso) {
  const params = [organizationId];
  let sql = `SELECT * FROM motico_manual_orders
             WHERE organization_id = $1
             AND COALESCE(LOWER(NULLIF(BTRIM(shipping_json->>'removed_from_motico'), '')), 'false') <> 'true'`;
  if (minIso && maxIso) {
    params.push(String(minIso));
    const minPos = params.length;
    params.push(String(maxIso));
    const maxPos = params.length;
    params.push(String(minIso).slice(0, 10));
    const minYmdPos = params.length;
    params.push(String(maxIso).slice(0, 10));
    const maxYmdPos = params.length;
    sql += ` AND (
      (created_at >= $${minPos}::timestamptz AND created_at <= $${maxPos}::timestamptz)
      OR (
        COALESCE(
          NULLIF(BTRIM(shipping_json->>'assigned_date'), ''),
          NULLIF(BTRIM(shipping_json->>'fecha_asignada'), ''),
          NULLIF(BTRIM(shipping_json->>'assignedDate'), '')
        ) BETWEEN $${minYmdPos} AND $${maxYmdPos}
      )
    )`;
  } else if (minIso) {
    params.push(String(minIso));
    const minPos = params.length;
    params.push(String(minIso).slice(0, 10));
    const minYmdPos = params.length;
    sql += ` AND (
      created_at >= $${minPos}::timestamptz
      OR COALESCE(
        NULLIF(BTRIM(shipping_json->>'assigned_date'), ''),
        NULLIF(BTRIM(shipping_json->>'fecha_asignada'), ''),
        NULLIF(BTRIM(shipping_json->>'assignedDate'), '')
      ) >= $${minYmdPos}
    )`;
  } else if (maxIso) {
    params.push(String(maxIso));
    const maxPos = params.length;
    params.push(String(maxIso).slice(0, 10));
    const maxYmdPos = params.length;
    sql += ` AND (
      created_at <= $${maxPos}::timestamptz
      OR COALESCE(
        NULLIF(BTRIM(shipping_json->>'assigned_date'), ''),
        NULLIF(BTRIM(shipping_json->>'fecha_asignada'), ''),
        NULLIF(BTRIM(shipping_json->>'assignedDate'), '')
      ) <= $${maxYmdPos}
    )`;
  }
  sql += ` ORDER BY created_at DESC`;
  const { rows } = await pool.query(sql, params);
  return rows.map((r) => mapMoticoManualOrderRowFromDb(r));
}

/**
 * Pedidos manuales relevantes para ganancia diaria en un rango de calendario tienda:
 * creados en el rango ISO de Shopify O con fecha asignada (shipping_json) entre ymdStart y ymdEnd.
 * Evita cargar toda la tabla cuando la org tiene muchos manuales históricos.
 */
async function loadMoticoManualOrdersForOrgGananciaSeries(
  organizationId,
  rangeMinIso,
  rangeMaxIso,
  ymdStartStr,
  ymdEndStr,
) {
  const params = [
    organizationId,
    String(rangeMinIso),
    String(rangeMaxIso),
    String(ymdStartStr),
    String(ymdEndStr),
  ];
  const sql = `
    SELECT * FROM motico_manual_orders
    WHERE organization_id = $1
    AND (
      (created_at >= $2::timestamptz AND created_at <= $3::timestamptz)
      OR (
        COALESCE(
          NULLIF(btrim(shipping_json->>'assigned_date'), ''),
          NULLIF(btrim(shipping_json->>'fecha_asignada'), ''),
          NULLIF(btrim(shipping_json->>'assignedDate'), '')
        ) BETWEEN $4 AND $5
      )
    )
    ORDER BY created_at DESC
  `;
  try {
    const { rows } = await pool.query(sql, params);
    return rows.map((r) => mapMoticoManualOrderRowFromDb(r));
  } catch (e) {
    if (e && e.code === '42P01') return [];
    console.warn('loadMoticoManualOrdersForOrgGananciaSeries fallback:', e && e.message);
    return loadMoticoManualOrdersForOrg(organizationId, rangeMinIso, rangeMaxIso);
  }
}

/** Gasto Meta por día + divisa (insights + listado de cuentas en paralelo). */
async function gananciaFetchMetaSpendPack(organizationId, sinceYmd, untilYmd) {
  const out = { spendByDay: {}, metaPartialErrors: [], metaCurrency: '' };
  const metaRow = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, organizationId);
  if (!metaRow || !String(metaRow.access_token || '').trim()) {
    const snapRows = await loadMetaDailySnapshotsForRange(organizationId, sinceYmd, untilYmd);
    if (snapRows.length) {
      out.spendByDay = spendByDayFromMetaSnapshotRows(snapRows);
      const currency = snapRows.find((r) => String(r.currency || '').trim())?.currency || '';
      if (currency) out.metaCurrency = currency;
      out.metaPartialErrors.push({
        source: 'meta_snapshot',
        error: 'Meta desconectado: gasto Meta cargado desde respaldo KOVO.',
      });
    }
    return out;
  }
  const resolved = resolveAdAccountIdsForRequest(undefined, metaRow.selected_ad_account_ids);
  if (!resolved.ok || resolved.actIds.length === 0) {
    const snapRows = await loadMetaDailySnapshotsForRange(organizationId, sinceYmd, untilYmd);
    if (snapRows.length) {
      out.spendByDay = spendByDayFromMetaSnapshotRows(snapRows);
      const currency = snapRows.find((r) => String(r.currency || '').trim())?.currency || '';
      if (currency) out.metaCurrency = currency;
      out.metaPartialErrors.push({
        source: 'meta_snapshot',
        error: 'Sin cuentas Meta activas: gasto Meta cargado desde respaldo KOVO.',
      });
    }
    return out;
  }
  const token = metaRow.access_token;
  const [spendRes, la] = await Promise.all([
    fetchDailySpendByDayForAdAccountsTimeRange(resolved.actIds, token, sinceYmd, untilYmd),
    listAdAccounts(token),
  ]);
  out.spendByDay = spendRes.byDay || {};
  for (const pe of spendRes.partialErrors || []) out.metaPartialErrors.push(pe);
  if (la.ok && Array.isArray(la.accounts)) {
    const curSet = new Set();
    for (const aid of resolved.actIds) {
      const n = normalizeActId(aid);
      const hit = la.accounts.find((a) => normalizeActId(a.id) === n);
      if (hit && hit.currency) curSet.add(String(hit.currency).trim());
    }
    if (curSet.size === 1) out.metaCurrency = [...curSet][0];
    else if (curSet.size > 1) out.metaCurrency = [...curSet].join(', ');
  }
  if (!Object.keys(out.spendByDay).length) {
    const snapRows = await loadMetaDailySnapshotsForRange(organizationId, sinceYmd, untilYmd);
    if (snapRows.length) {
      out.spendByDay = spendByDayFromMetaSnapshotRows(snapRows);
      if (!out.metaCurrency) {
        const currency = snapRows.find((r) => String(r.currency || '').trim())?.currency || '';
        if (currency) out.metaCurrency = currency;
      }
      out.metaPartialErrors.push({
        source: 'meta_snapshot',
        error: 'Meta sin datos live: gasto Meta cargado desde respaldo KOVO.',
      });
    }
  }
  return out;
}

/** Gasto Meta un solo día (insights + listado de cuentas en paralelo). */
async function gananciaFetchMetaSpendSingleDay(organizationId, dateStr) {
  const out = { spend: 0, metaPartialErrors: [], metaCurrency: '' };
  const metaRow = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, organizationId);
  if (!metaRow || !String(metaRow.access_token || '').trim()) {
    const snapRows = await loadMetaDailySnapshotsForRange(organizationId, dateStr, dateStr);
    if (snapRows.length) {
      out.spend = Number(snapRows[0].spend) || 0;
      const currency = String(snapRows[0].currency || '').trim();
      if (currency) out.metaCurrency = currency;
      out.metaPartialErrors.push({
        source: 'meta_snapshot',
        error: 'Meta desconectado: gasto diario cargado desde respaldo KOVO.',
      });
    }
    return out;
  }
  const resolved = resolveAdAccountIdsForRequest(undefined, metaRow.selected_ad_account_ids);
  if (!resolved.ok || resolved.actIds.length === 0) {
    const snapRows = await loadMetaDailySnapshotsForRange(organizationId, dateStr, dateStr);
    if (snapRows.length) {
      out.spend = Number(snapRows[0].spend) || 0;
      const currency = String(snapRows[0].currency || '').trim();
      if (currency) out.metaCurrency = currency;
      out.metaPartialErrors.push({
        source: 'meta_snapshot',
        error: 'Sin cuentas Meta activas: gasto diario cargado desde respaldo KOVO.',
      });
    }
    return out;
  }
  const token = metaRow.access_token;
  const [spendRes, la] = await Promise.all([
    fetchTotalSpendForAdAccountsTimeRange(resolved.actIds, token, dateStr, dateStr),
    listAdAccounts(token),
  ]);
  out.spend = spendRes.spend;
  for (const pe of spendRes.partialErrors || []) out.metaPartialErrors.push(pe);
  if (la.ok && Array.isArray(la.accounts)) {
    const curSet = new Set();
    for (const aid of resolved.actIds) {
      const n = normalizeActId(aid);
      const hit = la.accounts.find((a) => normalizeActId(a.id) === n);
      if (hit && hit.currency) curSet.add(String(hit.currency).trim());
    }
    if (curSet.size === 1) out.metaCurrency = [...curSet][0];
    else if (curSet.size > 1) out.metaCurrency = [...curSet].join(', ');
  }
  if (!(Number.isFinite(out.spend) && out.spend > 0) && Array.isArray(spendRes.partialErrors) && spendRes.partialErrors.length) {
    const snapRows = await loadMetaDailySnapshotsForRange(organizationId, dateStr, dateStr);
    if (snapRows.length) {
      out.spend = Number(snapRows[0].spend) || 0;
      if (!out.metaCurrency) {
        const currency = String(snapRows[0].currency || '').trim();
        if (currency) out.metaCurrency = currency;
      }
      out.metaPartialErrors.push({
        source: 'meta_snapshot',
        error: 'Meta sin datos live: gasto diario cargado desde respaldo KOVO.',
      });
    }
  }
  return out;
}

/** Líneas de producto guardadas solo en KOVO (JSON en shopify_order_local_fields). */
function parseShopifyOrderLineItemsOverrideFromBody(bodyLineItems) {
  if (!Array.isArray(bodyLineItems) || bodyLineItems.length === 0) return null;
  const parsed = [];
  for (const raw of bodyLineItems) {
    if (!raw || typeof raw !== 'object') continue;
    const q = parseInt(String(raw.quantity != null ? raw.quantity : '1'), 10);
    if (!Number.isFinite(q) || q < 1) continue;
    const title = String(raw.title || raw.name || '').trim();
    if (!title) continue;
    parsed.push({
      product_id: raw.product_id != null && Number.isFinite(Number(raw.product_id)) ? Number(raw.product_id) : null,
      variant_id: raw.variant_id != null && Number.isFinite(Number(raw.variant_id)) ? Number(raw.variant_id) : null,
      title,
      variant_title: String(raw.variant_title || '').trim(),
      sku: String(raw.sku || '').trim(),
      barcode: String(raw.barcode || '').trim(),
      quantity: q,
    });
  }
  return parsed.length ? parsed : null;
}

async function loadLocalFieldsMap(organizationId, orderIds) {
  if (!orderIds.length) return new Map();
  const CHUNK = 2500;
  const m = new Map();
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const slice = orderIds.slice(i, i + CHUNK);
    const { rows } = await pool.query(
      `SELECT shopify_order_id, internal_status, price_override, quantity_override, mensajero, motico_status, payment_status_override, pago_al_recibir_override, anticipo_kovo_explicit, pagado_al_recibir_override, total_a_pagar_override, shipping_address_override, line_items_override_json, last_despachado_at
       FROM shopify_order_local_fields WHERE organization_id = $1 AND shopify_order_id = ANY($2::bigint[])`,
      [organizationId, slice],
    );
    for (const r of rows) m.set(Number(r.shopify_order_id), r);
  }
  return m;
}

/**
 * Aplica overrides guardados en KOVO sobre un pedido ya normalizado desde Shopify (solo lectura desde la API).
 * @param {object} order
 * @param {object|null|undefined} lf fila shopify_order_local_fields
 */
function applyShopifyOrderKovoDisplayOverrides(order, lf) {
  if (!order || typeof order !== 'object') return order;
  if (!lf || typeof lf !== 'object') return { ...order };
  let next = { ...order };
  const shipOv = lf.shipping_address_override;
  if (shipOv && typeof shipOv === 'object' && !Array.isArray(shipOv)) {
    const base = next.shippingAddress && typeof next.shippingAddress === 'object' ? { ...next.shippingAddress } : {};
    const merged = { ...base };
    for (const k of ['name', 'address1', 'address2', 'city', 'province', 'zip', 'country', 'phone']) {
      if (Object.prototype.hasOwnProperty.call(shipOv, k)) {
        merged[k] = shipOv[k] == null ? '' : String(shipOv[k]);
      }
    }
    next.shippingAddress = merged;
    next.shippingCity = String(merged.city || '').trim();
    next.shippingProvince = String(merged.province || '').trim();
    next.shippingAddressLine = [merged.address1, merged.address2].filter(Boolean).join(' · ').trim();
    const rawPhone = String(merged.phone || '').trim();
    next.phoneLocal = phoneWithoutColombia57(rawPhone);
  }
  let linesOv = lf.line_items_override_json;
  if (typeof linesOv === 'string') {
    try {
      linesOv = JSON.parse(linesOv);
    } catch {
      linesOv = null;
    }
  }
  if (Array.isArray(linesOv) && linesOv.length > 0) {
    const lineItemsDetail = linesOv.map((li, idx) => {
      const title = String(li.title || li.name || '').trim() || 'Producto';
      const name = String(li.name || '').trim();
      const variant_title = String(li.variant_title != null ? li.variant_title : '').trim();
      return {
        id: li.id != null && Number.isFinite(Number(li.id)) ? Number(li.id) : idx + 1,
        product_id: li.product_id != null && Number.isFinite(Number(li.product_id)) ? Number(li.product_id) : null,
        variant_id: li.variant_id != null && Number.isFinite(Number(li.variant_id)) ? Number(li.variant_id) : null,
        title,
        name,
        variant_title,
        quantity: parseInt(String(li.quantity != null ? li.quantity : '0'), 10) || 0,
        price: li.price != null ? String(li.price) : '',
        sku: li.sku != null ? String(li.sku).trim() : '',
        properties: Array.isArray(li.properties)
          ? li.properties.map((p) => ({
              name: String(p.name != null ? p.name : '').trim(),
              value: String(p.value != null ? p.value : '').trim(),
            }))
          : [],
      };
    });
    const defaultQuantity = lineItemsDetail.reduce((s, li) => s + (li.quantity || 0), 0);
    const productIds = [
      ...new Set(
        lineItemsDetail
          .map((li) => (li.product_id != null ? Number(li.product_id) : NaN))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
    next = {
      ...next,
      lineItemsDetail,
      defaultQuantity: defaultQuantity > 0 ? defaultQuantity : next.defaultQuantity,
      productIds,
    };
  }
  return next;
}

async function loadProductManualPricingMap(organizationId, productIds) {
  if (!productIds.length) return new Map();
  const CHUNK = 2500;
  const m = new Map();
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const slice = productIds.slice(i, i + CHUNK);
    const { rows } = await pool.query(
      `SELECT shopify_product_id, manual_product_price, manual_avg_freight_price, manual_product_price_motico, manual_avg_freight_price_motico, delivery_effectiveness_pct
       FROM shopify_product_manual_pricing
       WHERE organization_id = $1 AND shopify_product_id = ANY($2::bigint[])`,
      [organizationId, slice],
    );
    for (const r of rows) {
      m.set(Number(r.shopify_product_id), {
        manual_product_price:
          r.manual_product_price != null && Number.isFinite(Number(r.manual_product_price))
            ? Number(r.manual_product_price)
            : null,
        manual_avg_freight_price:
          r.manual_avg_freight_price != null && Number.isFinite(Number(r.manual_avg_freight_price))
            ? Number(r.manual_avg_freight_price)
            : null,
        manual_product_price_motico:
          r.manual_product_price_motico != null && Number.isFinite(Number(r.manual_product_price_motico))
            ? Number(r.manual_product_price_motico)
            : null,
        manual_avg_freight_price_motico:
          r.manual_avg_freight_price_motico != null && Number.isFinite(Number(r.manual_avg_freight_price_motico))
            ? Number(r.manual_avg_freight_price_motico)
            : null,
        delivery_effectiveness_pct:
          r.delivery_effectiveness_pct != null && Number.isFinite(Number(r.delivery_effectiveness_pct))
            ? Number(r.delivery_effectiveness_pct)
            : null,
      });
    }
  }
  return m;
}

function normalizeLineItemLookupKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildLineItemTitleToProductIdMap(orders) {
  const m = new Map();
  for (const o of Array.isArray(orders) ? orders : []) {
    const detail = Array.isArray(o?.lineItemsDetail) ? o.lineItemsDetail : [];
    for (const li of detail) {
      if (!li || typeof li !== 'object') continue;
      const pid = Number(li.product_id);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      const key = normalizeLineItemLookupKey(li.title || li.name || '');
      if (!key || m.has(key)) continue;
      m.set(key, pid);
    }
  }
  return m;
}

/**
 * IDs Shopify para `shopify_product_manual_pricing`: cada línea con `product_id` o el mismo ID inferido
 * por título que en `calculateOrderMoticoProductCost` (así el mapa incluye costos de **todas** las líneas del lote).
 */
function collectOrderLineProductIdsForPricing(orders, lineTitleToProductIdMap) {
  const pids = [];
  const map = lineTitleToProductIdMap instanceof Map ? lineTitleToProductIdMap : new Map();
  for (const o of Array.isArray(orders) ? orders : []) {
    const detail = Array.isArray(o?.lineItemsDetail) ? o.lineItemsDetail : [];
    for (const li of detail) {
      let pid = li?.product_id != null ? Number(li.product_id) : NaN;
      if (!Number.isFinite(pid) || pid <= 0) {
        const key = normalizeLineItemLookupKey(li.title || li.name || '');
        if (key && map.has(key)) pid = Number(map.get(key));
      }
      if (Number.isFinite(pid) && pid > 0) pids.push(pid);
    }
    if (Array.isArray(o?.productIds)) {
      for (const pid of o.productIds) {
        const n = Number(pid);
        if (Number.isFinite(n) && n > 0) pids.push(n);
      }
    }
  }
  return pids;
}

function calculateOrderManualCosts(order, pricingMap, titleToProductIdMap) {
  const detail = Array.isArray(order?.lineItemsDetail) ? order.lineItemsDetail : [];
  let productCost = 0;
  let productDeliveredCost = 0;
  const freightByProduct = new Map();
  let deliveryEffectivenessWeight = 0;
  let deliveryEffectivenessQty = 0;
  for (const li of detail) {
    if (!li || typeof li !== 'object') continue;
    let pid = Number(li.product_id);
    if (!Number.isFinite(pid) || pid <= 0) {
      const key = normalizeLineItemLookupKey(li.title || li.name || '');
      if (key && titleToProductIdMap instanceof Map) {
        const mappedPid = Number(titleToProductIdMap.get(key));
        if (Number.isFinite(mappedPid) && mappedPid > 0) pid = mappedPid;
      }
    }
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const qty = Number.parseInt(String(li.quantity ?? 0), 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const pricing = pricingMap.get(pid);
    const deliveryEffectivenessRaw = pricing?.delivery_effectiveness_pct;
    const deliveryEffectivenessPct =
      deliveryEffectivenessRaw != null && Number.isFinite(Number(deliveryEffectivenessRaw))
        ? Math.min(100, Math.max(0, Number(deliveryEffectivenessRaw)))
        : 100;
    if (pricing?.manual_product_price != null && Number.isFinite(pricing.manual_product_price)) {
      const lineProductCost = pricing.manual_product_price * qty;
      productCost += lineProductCost;
      productDeliveredCost += lineProductCost * (deliveryEffectivenessPct / 100);
    }
    if (pricing?.manual_avg_freight_price != null && Number.isFinite(pricing.manual_avg_freight_price)) {
      // Flete promedio: se aplica por pedido (no por cantidad de unidades).
      // Si hay varios productos en un mismo pedido, promediamos sus fletes configurados.
      if (!freightByProduct.has(pid)) {
        freightByProduct.set(pid, pricing.manual_avg_freight_price);
      }
    }
    deliveryEffectivenessWeight += deliveryEffectivenessPct * qty;
    deliveryEffectivenessQty += qty;
  }
  let avgFreightCost = 0;
  if (freightByProduct.size > 0) {
    let freightSum = 0;
    for (const value of freightByProduct.values()) freightSum += value;
    avgFreightCost = freightSum / freightByProduct.size;
  }
  const deliveryEffectivenessPct =
    deliveryEffectivenessQty > 0 ? deliveryEffectivenessWeight / deliveryEffectivenessQty : 100;
  return {
    productCost,
    productDeliveredCost,
    avgFreightCost,
    deliveryEffectivenessPct,
  };
}

/**
 * Cantidad para costo Motico × línea: con **una sola** línea de detalle, si `quantity_override` (KOVO) supera
 * la suma de cantidades en líneas, se usa el override (misma idea que «cantidad final» en Motico).
 */
function quantityForMoticoProductCostLine(li, order, detail) {
  const lineQtyRaw = Number.parseInt(String(li?.quantity ?? 0), 10);
  const lineQty = Number.isFinite(lineQtyRaw) && lineQtyRaw > 0 ? lineQtyRaw : 0;
  if (!Array.isArray(detail) || detail.length !== 1) return lineQty;
  let sumLines = 0;
  for (const x of detail) {
    const q = Number.parseInt(String(x?.quantity ?? 0), 10);
    if (Number.isFinite(q) && q > 0) sumLines += q;
  }
  const headRaw = order?.quantity_override;
  const headOv =
    headRaw != null && headRaw !== '' && Number.isFinite(Number(headRaw)) && Number(headRaw) > 0
      ? Number(headRaw)
      : null;
  if (headOv != null && headOv > sumLines) return headOv;
  return lineQty;
}

/**
 * Suma (costo producto Motico en inventario) × cantidad por línea (`manual_product_price_motico`).
 * @returns {number|null} total o null si no hay ninguna línea con costo Motico configurado.
 */
function calculateOrderMoticoProductCost(order, pricingMap, titleToProductIdMap) {
  const detail = Array.isArray(order?.lineItemsDetail) ? order.lineItemsDetail : [];
  let total = 0;
  let matched = false;
  for (const li of detail) {
    if (!li || typeof li !== 'object') continue;
    let pid = Number(li.product_id);
    if (!Number.isFinite(pid) || pid <= 0) {
      const key = normalizeLineItemLookupKey(li.title || li.name || '');
      if (key && titleToProductIdMap instanceof Map) {
        const mappedPid = Number(titleToProductIdMap.get(key));
        if (Number.isFinite(mappedPid) && mappedPid > 0) pid = mappedPid;
      }
    }
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const qty = quantityForMoticoProductCostLine(li, order, detail);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const pricing = pricingMap.get(pid);
    const unitMotico =
      pricing?.manual_product_price_motico != null && Number.isFinite(Number(pricing.manual_product_price_motico))
        ? Number(pricing.manual_product_price_motico)
        : null;
    if (unitMotico != null) {
      total += unitMotico * qty;
      matched = true;
    }
  }
  if (!matched && detail.length === 0 && Array.isArray(order?.productIds) && order.productIds.length === 1) {
    const pid = Number(order.productIds[0]);
    if (Number.isFinite(pid) && pid > 0) {
      const pricing = pricingMap.get(pid);
      const unitMotico =
        pricing?.manual_product_price_motico != null && Number.isFinite(Number(pricing.manual_product_price_motico))
          ? Number(pricing.manual_product_price_motico)
          : null;
      if (unitMotico != null) {
        const qEff = effectiveOrderProductQuantityForGanancia(order, null);
        const qty =
          Number.isFinite(qEff) && qEff > 0
            ? qEff
            : (() => {
                const qtyRaw = Number.parseInt(String(order.defaultQuantity ?? order.shopifyQuantity ?? 1), 10);
                return Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
              })();
        total += unitMotico * qty;
        matched = true;
      }
    }
  }
  return matched ? total : null;
}

/**
 * Flete Motico del inventario (`manual_avg_freight_price_motico`): un valor por producto en el pedido;
 * si hay varios productos, se promedia (misma idea que `manual_avg_freight_price` en costes manuales).
 * @returns {number|null} valor por pedido o null si ningún producto del pedido tiene flete Motico configurado.
 */
function calculateOrderMoticoFreightCost(order, pricingMap, titleToProductIdMap) {
  const detail = Array.isArray(order?.lineItemsDetail) ? order.lineItemsDetail : [];
  const freightByProduct = new Map();
  for (const li of detail) {
    if (!li || typeof li !== 'object') continue;
    let pid = Number(li.product_id);
    if (!Number.isFinite(pid) || pid <= 0) {
      const key = normalizeLineItemLookupKey(li.title || li.name || '');
      if (key && titleToProductIdMap instanceof Map) {
        const mappedPid = Number(titleToProductIdMap.get(key));
        if (Number.isFinite(mappedPid) && mappedPid > 0) pid = mappedPid;
      }
    }
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const qty = Number.parseInt(String(li.quantity ?? 0), 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const pricing = pricingMap.get(pid);
    const fl =
      pricing?.manual_avg_freight_price_motico != null &&
      Number.isFinite(Number(pricing.manual_avg_freight_price_motico))
        ? Number(pricing.manual_avg_freight_price_motico)
        : null;
    if (fl != null && !freightByProduct.has(pid)) {
      freightByProduct.set(pid, fl);
    }
  }
  if (freightByProduct.size > 0) {
    let sum = 0;
    for (const v of freightByProduct.values()) sum += v;
    return sum / freightByProduct.size;
  }
  if (detail.length === 0 && Array.isArray(order?.productIds) && order.productIds.length === 1) {
    const pid = Number(order.productIds[0]);
    if (Number.isFinite(pid) && pid > 0) {
      const pricing = pricingMap.get(pid);
      const fl =
        pricing?.manual_avg_freight_price_motico != null &&
        Number.isFinite(Number(pricing.manual_avg_freight_price_motico))
          ? Number(pricing.manual_avg_freight_price_motico)
          : null;
      if (fl != null) return fl;
    }
  }
  return null;
}

/**
 * Reparte ventas, costos y flete del pedido entre productos (líneas) por participación en ingreso de líneas.
 * Devuelve Map productKey -> acumulados para agregar por día.
 */
function gananciaProductContributionsForOrder(order, pricingMap, titleToProductIdMap) {
  const amt = parseFloat(String(order?.total || '0').replace(',', '.'));
  if (!Number.isFinite(amt) || amt < 0) return null;
  const costs = calculateOrderManualCosts(order, pricingMap, titleToProductIdMap);
  const effPct = Number.isFinite(costs.deliveryEffectivenessPct) ? costs.deliveryEffectivenessPct : 100;
  const orderVentasEntregadas = amt * (effPct / 100);
  const detail = Array.isArray(order?.lineItemsDetail) ? order.lineItemsDetail : [];
  const lines = [];
  for (const li of detail) {
    if (!li || typeof li !== 'object') continue;
    let pid = Number(li.product_id);
    if (!Number.isFinite(pid) || pid <= 0) {
      const keyT = normalizeLineItemLookupKey(li.title || li.name || '');
      if (keyT && titleToProductIdMap instanceof Map) {
        const mappedPid = Number(titleToProductIdMap.get(keyT));
        if (Number.isFinite(mappedPid) && mappedPid > 0) pid = mappedPid;
      }
    }
    const qty = Number.parseInt(String(li.quantity ?? 0), 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const price = parseFloat(String(li.price ?? '0').replace(',', '.'));
    const lineRev = Number.isFinite(price) && price >= 0 ? price * qty : 0;
    const label = String(li.title || li.name || 'Producto').trim() || 'Producto';
    const pk = Number.isFinite(pid) && pid > 0 ? `p:${pid}` : `t:${normalizeLineItemLookupKey(label)}`;
    lines.push({ pk, label, qty, lineRev, pid: Number.isFinite(pid) && pid > 0 ? pid : null });
  }
  if (!lines.length) {
    const k = '__sin_lineas__';
    return {
      contrib: new Map([
        [
          k,
          {
            label: 'Sin líneas / otro',
            product_id: null,
            ventas_despachadas: amt,
            ventas_entregadas: orderVentasEntregadas,
            costo_producto: costs.productCost,
            costo_entregado: costs.productDeliveredCost,
            flete: costs.avgFreightCost,
            qty: 0,
            pedidos: 1,
          },
        ],
      ]),
    };
  }
  let totalRev = 0;
  for (const L of lines) totalRev += L.lineRev;
  const n = lines.length;
  const contrib = new Map();
  for (const L of lines) {
    const share = totalRev > 0 ? L.lineRev / totalRev : 1 / n;
    const vd = share * amt;
    const ve = share * orderVentasEntregadas;
    const fl = share * costs.avgFreightCost;
    const pricing = L.pid != null ? pricingMap.get(L.pid) : null;
    const lineEffRaw = pricing?.delivery_effectiveness_pct;
    const lineEff =
      lineEffRaw != null && Number.isFinite(Number(lineEffRaw))
        ? Math.min(100, Math.max(0, Number(lineEffRaw)))
        : 100;
    let lineProductCost = 0;
    let lineCostDelivered = 0;
    if (pricing?.manual_product_price != null && Number.isFinite(pricing.manual_product_price)) {
      lineProductCost = pricing.manual_product_price * L.qty;
      lineCostDelivered = lineProductCost * (lineEff / 100);
    }
    const prev = contrib.get(L.pk);
    if (prev) {
      prev.ventas_despachadas += vd;
      prev.ventas_entregadas += ve;
      prev.costo_producto += lineProductCost;
      prev.costo_entregado += lineCostDelivered;
      prev.flete += fl;
      prev.qty += L.qty;
    } else {
      contrib.set(L.pk, {
        label: L.label,
        product_id: L.pid,
        ventas_despachadas: vd,
        ventas_entregadas: ve,
        costo_producto: lineProductCost,
        costo_entregado: lineCostDelivered,
        flete: fl,
        qty: L.qty,
        pedidos: 1,
      });
    }
  }
  return { contrib };
}

function gananciaMergeProductDay(innerMap, contrib) {
  if (!contrib || !(contrib instanceof Map)) return;
  for (const [pk, row] of contrib) {
    const cur = innerMap.get(pk) || {
      label: row.label,
      product_id: row.product_id,
      ventas_despachadas: 0,
      ventas_entregadas: 0,
      costo_producto: 0,
      costo_entregado: 0,
      flete: 0,
      qty: 0,
      pedidos: 0,
    };
    cur.label = row.label || cur.label;
    if (row.product_id != null) cur.product_id = row.product_id;
    cur.ventas_despachadas += row.ventas_despachadas;
    cur.ventas_entregadas += row.ventas_entregadas;
    cur.costo_producto += row.costo_producto;
    cur.costo_entregado += row.costo_entregado;
    cur.flete += row.flete;
    cur.qty += row.qty;
    cur.pedidos += row.pedidos;
    innerMap.set(pk, cur);
  }
}

/**
 * Unidades de producto para ganancia diaria (tabla / totales): misma prioridad que Motico "cantidad final".
 * Suma cantidades de líneas si hay alguna > 0; si no, override (shopify_order_local_fields o pedido manual);
 * luego defaultQuantity / shopifyQuantity.
 */
function effectiveOrderProductQuantityForGanancia(order, localFieldsRow) {
  const detail = Array.isArray(order?.lineItemsDetail) ? order.lineItemsDetail : [];
  let fromLines = 0;
  for (const li of detail) {
    const q = Number.parseInt(String(li?.quantity ?? 0), 10);
    if (Number.isFinite(q) && q > 0) fromLines += q;
  }
  if (fromLines > 0) return fromLines;
  let qo = null;
  if (localFieldsRow) {
    const raw = localFieldsRow.quantity_override;
    if (raw != null && raw !== '' && Number.isFinite(Number(raw))) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) qo = n;
    }
  }
  if (qo == null && order?.quantity_override != null && Number.isFinite(Number(order.quantity_override))) {
    const n = Number(order.quantity_override);
    if (n > 0) qo = n;
  }
  if (qo != null) return qo;
  const def = Number(order?.defaultQuantity ?? 0);
  if (Number.isFinite(def) && def > 0) return def;
  const sq = Number(order?.shopifyQuantity ?? 0);
  return Number.isFinite(sq) && sq > 0 ? sq : 0;
}

function shopifyConfigured() {
  return Boolean(SHOPIFY_API_KEY && SHOPIFY_API_SECRET && SHOPIFY_REDIRECT_URI);
}

function shopifyMissingEnvKeys() {
  const missing = [];
  if (!SHOPIFY_API_KEY) missing.push('SHOPIFY_API_KEY');
  if (!SHOPIFY_API_SECRET) missing.push('SHOPIFY_API_SECRET');
  if (!SHOPIFY_REDIRECT_URI) missing.push('SHOPIFY_REDIRECT_URI o SHOPIFY_APP_URL');
  return missing;
}

/** Inserta state OAuth y devuelve la URL de autorización en Shopify (dominio myshopify.com). */
async function buildShopifyAuthorizeUrlForOrg(organizationId, shop) {
  await cleanupShopifyOauthStates();
  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await pool.query(
    `INSERT INTO shopify_oauth_states (state, organization_id, shop_domain, expires_at) VALUES ($1, $2, $3, $4)`,
    [state, organizationId, shop, expiresAt],
  );
  console.log('State guardado en BD:', { state, shop, expiresAt });
  const redirectUri = SHOPIFY_REDIRECT_URI;
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  const authUrl = `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  console.log('Redirect URI enviada a Shopify:', redirectUri);
  console.log('Auth URL completa:', authUrl);
  return authUrl;
}

/**
 * Inicio OAuth: navegación top-level del navegador (sin fetch). El JWT va en query `kovo_token`
 * porque un GET directo no puede enviar header Authorization.
 * Siempre responde con 302 (a Shopify, login o error).
 */
app.get('/api/shopify/auth', async (req, res) => {
  const appBase = (SHOPIFY_APP_URL || '').replace(/\/$/, '');
  const redirectCanalesErr = () =>
    res.redirect(302, appBase ? `${appBase}/canales?shopify=error` : '/canales?shopify=error');
  const redirectLogin = () => res.redirect(302, appBase ? `${appBase}/login` : '/login');

  try {
    const qTok = req.query.kovo_token;
    const qAlt = req.query.token;
    const fromQuery =
      (typeof qTok === 'string' && qTok) || (typeof qAlt === 'string' && qAlt) || null;
    const auth = req.headers.authorization;
    const fromHeader =
      auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const accessToken = fromQuery || fromHeader;

    if (!accessToken) {
      return redirectLogin();
    }

    const session = await loadSessionFromAccessToken(accessToken, req);
    if (session === 'jwt' || session === 'user') {
      return redirectCanalesErr();
    }

    if (!shopifyConfigured()) {
      console.warn('[shopify auth] OAuth no configurado:', shopifyMissingEnvKeys().join(', '));
      return redirectCanalesErr();
    }

    const shop = sanitizeShopDomain(req.query.shop);
    if (!shop) {
      return redirectCanalesErr();
    }

    const authorizeUrl = await buildShopifyAuthorizeUrlForOrg(req.organizationId, shop);
    return res.redirect(302, authorizeUrl);
  } catch (e) {
    console.error('[shopify auth]', e);
    return redirectCanalesErr();
  }
});

/** Callback OAuth de Shopify: sin verifyToken (Shopify redirige el navegador sin Bearer). */
app.get('/api/shopify/callback', async (req, res) => {
  const base = SHOPIFY_APP_URL || '';
  const redirectErr = () => res.redirect(302, `${base}/canales?shopify=error`);
  const redirectOk = () => res.redirect(302, `${base}/canales?shopify=connected`);

  console.log('Shopify callback params:', {
    shop: req.query.shop,
    code: !!req.query.code,
    state: req.query.state,
    hmac: !!req.query.hmac,
  });

  try {
    if (!SHOPIFY_API_SECRET || !SHOPIFY_API_KEY) {
      console.log('[shopify callback] fail: falta SHOPIFY_API_KEY o SHOPIFY_API_SECRET');
      return redirectErr();
    }

    console.log(
      '[shopify callback] SHOPIFY_REDIRECT_URI efectivo (debe coincidir carácter a carácter con la URL en Shopify Partner):',
      SHOPIFY_REDIRECT_URI || '(vacío)',
    );

    const query = req.query;
    const code = query.code;
    const shop = sanitizeShopDomain(query.shop);
    const state = query.state;

    if (!code || !shop || !state) {
      console.log('[shopify callback] fail: falta code, shop normalizado o state', {
        hasCode: Boolean(code),
        shop,
        hasState: Boolean(state),
      });
      return redirectErr();
    }

    console.log('Raw callback query:', JSON.stringify(req.query));
    console.log('[shopify callback] antes de verificar HMAC');
    const hmacOk = verifyShopifyOAuthHmac(query, SHOPIFY_API_SECRET);
    if (!hmacOk) {
      console.log('[shopify callback] fail: HMAC inválido o parámetro hmac ausente');
      return redirectErr();
    }

    console.log('[shopify callback] antes de verificar state en BD');
    let rows;
    try {
      const result = await pool.query(
        `SELECT organization_id, shop_domain FROM shopify_oauth_states WHERE state = $1 AND expires_at > now()`,
        [state],
      );
      rows = result.rows;
    } catch (dbErr) {
      console.error('[shopify callback] error en consulta shopify_oauth_states:', dbErr.code, dbErr.message);
      if (dbErr.code === '42P01') {
        console.error(
          '[shopify callback] la tabla shopify_oauth_states no existe: aplica backend/db/schema.sql o reinicia el backend para que initDb la cree (IF NOT EXISTS).',
        );
      }
      throw dbErr;
    }

    const stateRow = rows[0];
    if (!stateRow) {
      const stale = await pool.query(
        `SELECT shop_domain, expires_at FROM shopify_oauth_states WHERE state = $1`,
        [state],
      );
      if (stale.rows[0]) {
        console.log('[shopify callback] fail: state caducado (>10 min) o reloj del servidor', {
          expiresAt: stale.rows[0].expires_at,
          nowIso: new Date().toISOString(),
          ventanaMinutos: 10,
        });
      } else {
        console.log(
          '[shopify callback] fail: state no encontrado (otra instancia, limpieza, o flujo no iniciado en este servidor)',
        );
      }
      return redirectErr();
    }

    const shopInicio = sanitizeShopDomain(stateRow.shop_domain);
    if (shopInicio && shopInicio !== shop) {
      console.warn(
        '[shopify callback] la tienda en el callback difiere de la indicada al conectar (p. ej. otra sesión o tienda de desarrollo); se usa la tienda que devolvió Shopify',
        { indicadoAlIniciar: stateRow.shop_domain, desdeShopify: shop },
      );
    }

    await pool.query(`DELETE FROM shopify_oauth_states WHERE state = $1`, [state]);

    console.log('[shopify callback] antes de intercambiar code por access_token', { shop });
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      }),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.access_token) {
      console.error('[shopify callback] fail: respuesta access_token', {
        httpStatus: tokenRes.status,
        body: tokenBody,
      });
      return redirectErr();
    }
    const scopeStr =
      typeof tokenBody.scope === 'string' ? tokenBody.scope : SHOPIFY_SCOPES || '';
    await pool.query(
      `INSERT INTO shopify_connections (organization_id, shop_domain, access_token, scope, status, installed_at, updated_at)
       VALUES ($1, $2, $3, $4, 'connected', now(), now())
       ON CONFLICT (organization_id, shop_domain)
       DO UPDATE SET
         access_token = EXCLUDED.access_token,
         scope = EXCLUDED.scope,
         status = 'connected',
         updated_at = now()`,
      [stateRow.organization_id, shop, tokenBody.access_token, scopeStr],
    );
    await registerUninstallWebhook(shop, tokenBody.access_token);
    console.log('[shopify callback] OAuth OK, redirigiendo a canales?shopify=connected');
    return redirectOk();
  } catch (e) {
    console.error('[shopify callback] error no capturado antes del redirect:', e);
    return redirectErr();
  }
});

/**
 * Temporal: insertar conexión Shopify manualmente (solo owner/admin de la misma organización).
 * Valida el token offline contra GET /admin/api/2026-04/shop.json antes de persistir.
 */
app.post(
  '/api/shopify/manual-connect',
  verifyToken,
  scopeToOrganization,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const organizationId = Number(req.body?.organizationId);
      const shop = sanitizeShopDomain(req.body?.shop);
      const accessToken = String(req.body?.accessToken || '').trim();

      if (!Number.isFinite(organizationId) || organizationId <= 0) {
        return res.status(400).json({ error: 'organizationId inválido' });
      }
      if (organizationId !== req.organizationId) {
        return res.status(403).json({ error: 'organizationId no coincide con tu organización' });
      }
      if (!shop) {
        return res.status(400).json({ error: 'shop inválido (usa mitienda.myshopify.com)' });
      }
      if (!accessToken) {
        return res.status(400).json({ error: 'accessToken requerido' });
      }

      const validateVersion = '2026-04';
      const shopUrl = `https://${shop}/admin/api/${validateVersion}/shop.json`;
      const checkRes = await fetch(shopUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          Accept: 'application/json',
        },
      });
      const checkJson = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok || !checkJson?.shop) {
        return res.status(400).json({
          error: 'Token de Shopify inválido o sin acceso a shop.json',
          httpStatus: checkRes.status,
        });
      }

      const scopeStr = SHOPIFY_SCOPES || '';
      await pool.query(
        `INSERT INTO shopify_connections (organization_id, shop_domain, access_token, scope, status, installed_at, updated_at)
         VALUES ($1, $2, $3, $4, 'connected', now(), now())
         ON CONFLICT (organization_id, shop_domain)
         DO UPDATE SET
           access_token = EXCLUDED.access_token,
           scope = EXCLUDED.scope,
           status = 'connected',
           updated_at = now()`,
        [organizationId, shop, accessToken, scopeStr],
      );

      await registerUninstallWebhook(shop, accessToken);

      return res.json({
        ok: true,
        organization_id: organizationId,
        shop_domain: shop,
        shop_name: checkJson.shop?.name || null,
      });
    } catch (e) {
      console.error('[shopify manual-connect]', e);
      return res.status(500).json({ error: 'Error al guardar conexión' });
    }
  },
);

app.post('/api/shopify/webhooks/uninstalled', async (req, res) => {
  try {
    if (!SHOPIFY_API_SECRET) {
      return res.status(503).send('Config');
    }
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = req.rawBody;
    if (!rawBody || !verifyShopifyWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET)) {
      return res.status(401).send('Invalid HMAC');
    }
    const shopHeader = req.get('X-Shopify-Shop-Domain');
    const normalized = shopHeader ? sanitizeShopDomain(shopHeader) : null;
    const domain = normalized || (shopHeader ? String(shopHeader).toLowerCase().trim() : '');
    if (!domain) {
      return res.status(400).send('Missing shop');
    }
    await pool.query(
      `UPDATE shopify_connections SET status = 'disconnected', updated_at = now() WHERE lower(shop_domain) = lower($1)`,
      [domain],
    );
    return res.status(200).send('OK');
  } catch (e) {
    console.error('[shopify webhook]', e);
    return res.status(500).send('Error');
  }
});

/** Email del comprador en payloads Hotmart (varía según versión del webhook). */
function hotmartBuyerEmailFromPayload(body) {
  const d = body && typeof body === 'object' ? body.data : null;
  if (!d || typeof d !== 'object') return '';
  const buyer = d.buyer;
  if (buyer && typeof buyer === 'object' && buyer.email) return String(buyer.email).trim().toLowerCase();
  if (d.user && typeof d.user === 'object' && d.user.email) return String(d.user.email).trim().toLowerCase();
  if (d.subscriber && typeof d.subscriber === 'object' && d.subscriber.email) {
    return String(d.subscriber.email).trim().toLowerCase();
  }
  if (d.purchase && typeof d.purchase === 'object' && d.purchase.buyer_email) {
    return String(d.purchase.buyer_email).trim().toLowerCase();
  }
  return '';
}

app.post('/api/hotmart/webhook', async (req, res) => {
  const expected = String(process.env.HOTMART_WEBHOOK_TOKEN || '').trim();
  if (!expected) {
    console.warn('[hotmart] HOTMART_WEBHOOK_TOKEN no configurado');
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  const token = req.get('x-hotmart-webhook-token');
  if (token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const event = String(body.event || '');
    const email = hotmartBuyerEmailFromPayload(body);
    console.log('Hotmart event:', event, email);

    if (email) {
      const uq = await pool.query(
        `SELECT organization_id FROM users WHERE lower(trim(email)) = $1 AND organization_id IS NOT NULL LIMIT 1`,
        [email],
      );
      const orgId = uq.rows[0]?.organization_id;
      if (!orgId) {
        console.log('[hotmart] sin usuario u organización para email', email);
      } else if (event === 'PURCHASE_APPROVED') {
        await pool.query(
          `UPDATE organizations SET plan = 'pro', hotmart_email = $2, plan_activated_at = now() WHERE id = $1`,
          [orgId, email],
        );
      } else if (
        event === 'PURCHASE_CANCELED' ||
        event === 'SUBSCRIPTION_CANCELLATION' ||
        event === 'PURCHASE_REFUNDED'
      ) {
        await pool.query(
          `UPDATE organizations SET plan = 'free', hotmart_email = NULL, plan_activated_at = NULL WHERE id = $1`,
          [orgId],
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('[hotmart webhook]', e);
    return res.status(200).json({ received: true });
  }
});

app.get('/api/shopify/connection', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.json({ status: 'disconnected', shop_domain: null, scope: null, installed_at: null });
    }
    res.json({
      status: row.status,
      shop_domain: row.shop_domain,
      scope: row.scope,
      installed_at: row.installed_at,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al leer conexión Shopify' });
  }
});

app.delete('/api/shopify/connection', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE shopify_connections SET status = 'disconnected', updated_at = now()
       WHERE organization_id = $1 AND status = 'connected'`,
      [req.organizationId],
    );
    res.json({ ok: true, disconnected: result.rowCount > 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al desconectar Shopify' });
  }
});

app.get('/api/shopify/orders', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const mensajeroFilter =
      typeof req.query.mensajero_filter === 'string' ? req.query.mensajero_filter.trim().toLowerCase() : '';
    const qs = new URLSearchParams();
    qs.set('status', 'any');
    /** Motico necesita cada línea de producto completa; `fields` en listados puede acortar `line_items`. */
    if (mensajeroFilter !== 'motico') {
      qs.set('fields', SHOPIFY_ORDER_LIST_FIELDS);
    }
    let min = typeof req.query.created_at_min === 'string' ? req.query.created_at_min.trim() : '';
    let max = typeof req.query.created_at_max === 'string' ? req.query.created_at_max.trim() : '';
    const metaPeriodRaw = typeof req.query.meta_period === 'string' ? req.query.meta_period.trim().toLowerCase() : '';
    const metaPeriodAllowed = new Set(['hoy', 'ayer', '3d', '7d', '14d', '30d', 'custom']);
    let shopCalendarTz = null;
    let metaPeriodApplied = null;
    if (metaPeriodRaw && metaPeriodAllowed.has(metaPeriodRaw)) {
      const sr = await shopifyRequest(row.shop_domain, row.access_token, 'shop.json?fields=iana_timezone');
      shopCalendarTz =
        sr.ok && sr.data && sr.data.shop && sr.data.shop.iana_timezone
          ? String(sr.data.shop.iana_timezone)
          : 'UTC';
      const eff = metaPeriodRaw === 'custom' ? '7d' : metaPeriodRaw;
      const range = shopifyOrderCreatedRangeForMetaPeriod(eff, shopCalendarTz);
      min = range.min;
      max = range.max;
      metaPeriodApplied = eff;
    }
    if (!shopCalendarTz) {
      const srTz = await shopifyRequest(row.shop_domain, row.access_token, 'shop.json?fields=iana_timezone');
      shopCalendarTz =
        srTz.ok && srTz.data && srTz.data.shop && srTz.data.shop.iana_timezone
          ? String(srTz.data.shop.iana_timezone)
          : 'UTC';
    }
    const shopTz = shopCalendarTz || 'UTC';
    if (!metaPeriodRaw || !metaPeriodAllowed.has(metaPeriodRaw)) {
      if (!min && !max) {
        const ytd = shopifyInformativeOrdersRangeYearToDate(shopTz);
        min = ytd.min;
        max = ytd.max;
      } else if (min && !max) {
        max = shopifyOrderCreatedRangeForMetaPeriod('hoy', shopTz).max;
      } else if (!min && max) {
        const tMax = Date.parse(max);
        const y = shopCalendarYmdFromInstant(Number.isFinite(tMax) ? tMax : Date.now(), shopTz).y;
        min = shopifyOrderCreatedRangeForCalendarDate(shopTz, y, 1, 1).min;
      }
    }
    if (min && max) {
      const c = shopifyClampInformativeCreatedAtRange(shopTz, min, max);
      min = c.min;
      max = c.max;
    }
    if (min) qs.set('created_at_min', min);
    if (max) qs.set('created_at_max', max);
    const r = await shopifyFetchAllOrders(row.shop_domain, row.access_token, qs);
    if (!r.ok) {
      const st = Number(r.status) >= 400 ? Number(r.status) : 502;
      return res.status(Number.isFinite(st) ? st : 502).json({ error: r.error, data: r.data });
    }
    const normalized = normalizeShopifyOrdersForApp({ orders: r.orders });
    const ids = normalized.map((o) => o.id);
    let localMap;
    try {
      localMap = await loadLocalFieldsMap(req.organizationId, ids);
    } catch (dbErr) {
      if (dbErr && dbErr.code === '42P01') {
        return res.status(503).json({
          error:
            'Falta la tabla shopify_order_local_fields. Reinicia el backend para ejecutar initDb o aplica backend/db/schema.sql.',
          code: 'schema_missing',
        });
      }
      throw dbErr;
    }
    let orders = normalized.map((o) => {
      const lf = localMap.get(Number(o.id));
      const oBase = applyShopifyOrderKovoDisplayOverrides(o, lf);
      const paymentOverrideRaw =
        lf?.payment_status_override != null && String(lf.payment_status_override).trim() !== ''
          ? String(lf.payment_status_override).toLowerCase().trim()
          : '';
      const payment_status_override = MOTICO_PAYMENT_STATUSES.has(paymentOverrideRaw) ? paymentOverrideRaw : null;
      const financialStatus =
        payment_status_override != null ? payment_status_override : String(oBase.financialStatus || '').toLowerCase();
      const paymentBadge = mapFinancialToBadge(financialStatus);
      const unifiedEstado = mergeDisplayedOrderEstado(lf?.internal_status, lf?.motico_status);
      const total_a_pagar_default = shopifyDefaultTotalAPagar(oBase);
      const total_a_pagar_override =
        lf?.total_a_pagar_override != null && lf.total_a_pagar_override !== ''
          ? Number(lf.total_a_pagar_override)
          : null;
      const total_a_pagar =
        total_a_pagar_override != null && Number.isFinite(total_a_pagar_override)
          ? total_a_pagar_override
          : total_a_pagar_default;
      const pago_al_recibir_override =
        lf?.pago_al_recibir_override != null && Number.isFinite(Number(lf.pago_al_recibir_override))
          ? Number(lf.pago_al_recibir_override)
          : 0;
      const anticipo_kovo_explicit = lf?.anticipo_kovo_explicit === true;
      const pagado_al_recibir_override =
        lf?.pagado_al_recibir_override != null && Number.isFinite(Number(lf.pagado_al_recibir_override))
          ? Number(lf.pagado_al_recibir_override)
          : 0;
      return {
        ...oBase,
        financialStatus,
        label: paymentBadge.label,
        badgeVariant: paymentBadge.variant,
        internal_status: unifiedEstado,
        price_override:
          lf?.price_override != null && lf.price_override !== '' ? Number(lf.price_override) : null,
        quantity_override:
          lf?.quantity_override != null && lf.quantity_override !== '' ? Number(lf.quantity_override) : null,
        mensajero: lf?.mensajero || null,
        motico_status: unifiedEstado,
        total_a_pagar_default,
        total_a_pagar_override: total_a_pagar_override != null && Number.isFinite(total_a_pagar_override)
          ? total_a_pagar_override
          : null,
        total_a_pagar,
        pago_al_recibir_override,
        anticipo_kovo_explicit,
        pagado_al_recibir_override,
        payment_status_override,
        shopifyTotal: o.total,
        shopifyQuantity: o.defaultQuantity,
        last_despachado_at:
          lf?.last_despachado_at != null ? new Date(lf.last_despachado_at).toISOString() : null,
      };
    });
    try {
      const minIso = min && String(min).trim() ? String(min).trim() : null;
      const maxIso = max && String(max).trim() ? String(max).trim() : null;
      const manualRows = await loadMoticoManualOrdersForOrg(req.organizationId, minIso, maxIso);
      orders = [...manualRows, ...orders];
    } catch (me) {
      if (!(me && me.code === '42P01')) throw me;
    }
    if (mensajeroFilter === 'motico') {
      orders = orders.filter((o) => {
        const mensajero = String(o.mensajero || '')
          .trim()
          .toLowerCase();
        const internalStatus = String(o.internal_status || '')
          .trim()
          .toLowerCase();
        return mensajero === 'motico' || internalStatus === 'motico';
      });
    }
    const productIdQ = typeof req.query.product_id === 'string' ? req.query.product_id.trim() : '';
    if (productIdQ) {
      const want = Number(productIdQ);
      if (Number.isFinite(want)) {
        orders = orders.filter((o) => Array.isArray(o.productIds) && o.productIds.includes(want));
      }
    }
    if (orders.length > 0) {
      const lineTitleToProductIdMap = buildLineItemTitleToProductIdMap(orders);
      const pidCollector = collectOrderLineProductIdsForPricing(orders, lineTitleToProductIdMap);
      const uniqPids = [...new Set(pidCollector)];
      let pricingMap = new Map();
      if (uniqPids.length) {
        try {
          pricingMap = await loadProductManualPricingMap(req.organizationId, uniqPids);
        } catch (pe) {
          if (!(pe && pe.code === '42P01')) throw pe;
        }
      }
      orders = orders.map((o) => {
        const costs = calculateOrderManualCosts(o, pricingMap, lineTitleToProductIdMap);
        return {
          ...o,
          product_cost: costs.productCost,
          freight_cost: costs.avgFreightCost,
          product_cost_motico: calculateOrderMoticoProductCost(o, pricingMap, lineTitleToProductIdMap),
          freight_cost_motico: calculateOrderMoticoFreightCost(o, pricingMap, lineTitleToProductIdMap),
        };
      });
    }
    orders.sort((a, b) => {
      const ta = Date.parse(String(a.createdAt)) || 0;
      const tb = Date.parse(String(b.createdAt)) || 0;
      return tb - ta;
    });
    res.json({
      source: 'shopify',
      shop_domain: row.shop_domain,
      ...(shopCalendarTz ? { shop_calendar_timezone: shopCalendarTz, meta_period: metaPeriodApplied } : {}),
      fetchedAt: new Date().toISOString(),
      orders,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

app.get('/api/shopify/orders/:orderId', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const orderId = parseInt(String(req.params.orderId), 10);
    if (!Number.isFinite(orderId) || orderId === 0) {
      return res.status(400).json({ error: 'ID de pedido inválido' });
    }
    /** Pedidos manuales KOVO (antes «Motico»): id negativo, fila en motico_manual_orders. */
    if (orderId < 0) {
      const manualId = -orderId;
      const { rows } = await pool.query(
        `SELECT * FROM motico_manual_orders WHERE id = $1 AND organization_id = $2`,
        [manualId, req.organizationId],
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Pedido manual no encontrado' });
      }
      const mapped = mapMoticoManualOrderRowFromDb(rows[0]);
      const order = {
        ...mapped,
        internal_status: normalizeLegacyMoticoEstadoToUnified(
          rows[0].motico_status != null && String(rows[0].motico_status) !== ''
            ? String(rows[0].motico_status)
            : MOTICO_STATUS_DEFAULT,
        ),
      };
      return res.json({
        source: 'motico_manual',
        shop_domain: null,
        fetchedAt: new Date().toISOString(),
        order,
      });
    }
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const r = await shopifyRequest(
      row.shop_domain,
      row.access_token,
      `orders/${orderId}.json?fields=${SHOPIFY_ORDER_LIST_FIELDS}`,
    );
    if (!r.ok) {
      const st = Number(r.status) >= 400 ? Number(r.status) : 502;
      return res.status(Number.isFinite(st) ? st : 502).json({ error: r.error, data: r.data });
    }
    const normalized = normalizeShopifyOrdersForApp({
      orders: r.data && r.data.order ? [r.data.order] : [],
    });
    if (!normalized.length) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const o = normalized[0];
    const localMap = await loadLocalFieldsMap(req.organizationId, [orderId]);
    const lf = localMap.get(orderId);
    const oBase = applyShopifyOrderKovoDisplayOverrides(o, lf);
    const paymentOverrideRaw =
      lf?.payment_status_override != null && String(lf.payment_status_override).trim() !== ''
        ? String(lf.payment_status_override).toLowerCase().trim()
        : '';
    const payment_status_override = MOTICO_PAYMENT_STATUSES.has(paymentOverrideRaw) ? paymentOverrideRaw : null;
    const financialStatus =
      payment_status_override != null ? payment_status_override : String(oBase.financialStatus || '').toLowerCase();
    const paymentBadge = mapFinancialToBadge(financialStatus);
    const unifiedEstado = mergeDisplayedOrderEstado(lf?.internal_status, lf?.motico_status);
    const total_a_pagar_default = shopifyDefaultTotalAPagar(oBase);
    const total_a_pagar_override =
      lf?.total_a_pagar_override != null && lf.total_a_pagar_override !== ''
        ? Number(lf.total_a_pagar_override)
        : null;
    const total_a_pagar =
      total_a_pagar_override != null && Number.isFinite(total_a_pagar_override)
        ? total_a_pagar_override
        : total_a_pagar_default;
    const pago_al_recibir_override =
      lf?.pago_al_recibir_override != null && Number.isFinite(Number(lf.pago_al_recibir_override))
        ? Number(lf.pago_al_recibir_override)
        : 0;
    const anticipo_kovo_explicit = lf?.anticipo_kovo_explicit === true;
    const pagado_al_recibir_override =
      lf?.pagado_al_recibir_override != null && Number.isFinite(Number(lf.pagado_al_recibir_override))
        ? Number(lf.pagado_al_recibir_override)
        : 0;
    const enriched = {
      ...oBase,
      financialStatus,
      label: paymentBadge.label,
      badgeVariant: paymentBadge.variant,
      internal_status: unifiedEstado,
      price_override: lf?.price_override != null && lf.price_override !== '' ? Number(lf.price_override) : null,
      quantity_override:
        lf?.quantity_override != null && lf.quantity_override !== '' ? Number(lf.quantity_override) : null,
      mensajero: lf?.mensajero || null,
      motico_status: unifiedEstado,
      total_a_pagar_default,
      total_a_pagar_override:
        total_a_pagar_override != null && Number.isFinite(total_a_pagar_override) ? total_a_pagar_override : null,
      total_a_pagar,
      pago_al_recibir_override,
      anticipo_kovo_explicit,
      pagado_al_recibir_override,
      payment_status_override,
      shopifyTotal: o.total,
      shopifyQuantity: o.defaultQuantity,
      last_despachado_at:
        lf?.last_despachado_at != null ? new Date(lf.last_despachado_at).toISOString() : null,
    };
    res.json({
      source: 'shopify',
      shop_domain: row.shop_domain,
      fetchedAt: new Date().toISOString(),
      order: enriched,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener el pedido' });
  }
});

function gananciaDiariaYmdKey(x) {
  return `${String(x.y).padStart(4, '0')}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
}

function gananciaDiariaExpandYmdRange(sinceYmdStr, untilYmdStr) {
  const a = parseIsoDateYmd(sinceYmdStr);
  const b = parseIsoDateYmd(untilYmdStr);
  if (!a || !b) return [];
  const out = [];
  let cur = gananciaDiariaYmdKey(a);
  const end = gananciaDiariaYmdKey(b);
  if (cur > end) return [];
  while (cur <= end) {
    out.push(cur);
    cur = shiftYmdString(cur, 1);
  }
  return out;
}

function gananciaDiariaWindowFromMetaPeriod(periodRaw, todayYmd) {
  const period = String(periodRaw || '').trim().toLowerCase();
  let days = 0;
  if (period === 'hoy') days = 1;
  else if (period === 'ayer') days = 2;
  else if (period === '3d') days = 3;
  else if (period === '7d') days = 7;
  else if (period === '14d') days = 14;
  else if (period === '30d') days = 30;
  if (!days) return null;
  const until = gananciaDiariaYmdKey(todayYmd);
  const since = shiftYmdString(until, -(days - 1));
  return { since, until, days };
}

/** Meses YYYY-MM desde enero hasta el mes actual (calendario tienda). */
function gananciaDiariaSelectableMonthKeys(todayYmd) {
  const keys = [];
  for (let m = 1; m <= todayYmd.m; m += 1) {
    keys.push(`${String(todayYmd.y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
  }
  return keys;
}

function gananciaDiariaDaysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/** @param {string} s @returns {{ y: number, m: number } | null} */
function gananciaDiariaParseYm(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

function gananciaDiariaExpandMonthKeysToDayStrings(monthKeys, jan1Ymd, todayYmd) {
  const k0 = gananciaDiariaYmdKey(jan1Ymd);
  const k1 = gananciaDiariaYmdKey(todayYmd);
  const out = new Set();
  for (const mkRaw of monthKeys) {
    const pr = gananciaDiariaParseYm(mkRaw);
    if (!pr) continue;
    const { y, m } = pr;
    const dim = gananciaDiariaDaysInMonth(y, m);
    for (let d = 1; d <= dim; d += 1) {
      const ymd = { y, m, d };
      const k = gananciaDiariaYmdKey(ymd);
      if (k < k0 || k > k1) continue;
      out.add(k);
    }
  }
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function gananciaDiariaParseMonthsQuery(q) {
  if (q == null || q === '') return [];
  if (Array.isArray(q)) {
    return q.flatMap((s) => String(s).split(',')).map((x) => x.trim()).filter(Boolean);
  }
  return String(q)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Ventas Shopify despachadas (estado KOVO) vs gasto Meta en el mismo día de calendario de la tienda. */
app.get('/api/ganancia-diaria', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const shopRow = await getActiveShopifyConnection(req.organizationId);
    if (!shopRow) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const sr = await shopifyRequest(shopRow.shop_domain, shopRow.access_token, 'shop.json?fields=iana_timezone,currency');
    const iana =
      sr.ok && sr.data && sr.data.shop && sr.data.shop.iana_timezone
        ? String(sr.data.shop.iana_timezone)
        : 'UTC';
    const shopCurrency =
      sr.ok && sr.data && sr.data.shop && sr.data.shop.currency ? String(sr.data.shop.currency).trim() : '';

    const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    let ymd = parseIsoDateYmd(dateParam);
    if (!ymd) {
      ymd = shopCalendarYmdFromInstant(Date.now(), iana);
    }
    const todayYmd = shopCalendarYmdFromInstant(Date.now(), iana);
    const jan1Ymd = { y: todayYmd.y, m: 1, d: 1 };
    if (gananciaDiariaYmdKey(ymd) < gananciaDiariaYmdKey(jan1Ymd)) {
      ymd = jan1Ymd;
    }
    if (gananciaDiariaYmdKey(ymd) > gananciaDiariaYmdKey(todayYmd)) {
      ymd = todayYmd;
    }
    const dateStr = `${String(ymd.y).padStart(4, '0')}-${String(ymd.m).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;
    const range = shopifyOrderCreatedRangeForCalendarDate(iana, ymd.y, ymd.m, ymd.d);

    const qs = new URLSearchParams();
    qs.set('status', 'any');
    qs.set('fields', SHOPIFY_ORDER_LIST_FIELDS);
    qs.set('created_at_min', range.min);
    qs.set('created_at_max', range.max);
    const [r, manualRows] = await Promise.all([
      shopifyFetchAllOrders(shopRow.shop_domain, shopRow.access_token, qs),
      loadMoticoManualOrdersForOrgGananciaSeries(
        req.organizationId,
        range.min,
        range.max,
        dateStr,
        dateStr,
      ),
    ]);
    if (!r.ok) {
      const st = Number(r.status) >= 400 ? Number(r.status) : 502;
      return res.status(Number.isFinite(st) ? st : 502).json({ error: r.error || 'Error Shopify', data: r.data });
    }
    const normalized = normalizeShopifyOrdersForApp({ orders: r.orders });
    const ids = normalized.map((o) => Number(o.id)).filter((n) => Number.isFinite(n));
    let localMapGanancia = new Map();
    try {
      localMapGanancia = await loadLocalFieldsMap(req.organizationId, ids);
    } catch (ganLfErr) {
      if (!(ganLfErr && ganLfErr.code === '42P01')) throw ganLfErr;
    }
    const normalizedMerged = normalized.map((o) =>
      applyShopifyOrderKovoDisplayOverrides(o, localMapGanancia.get(Number(o.id))),
    );
    const mergedForPricing = [...normalizedMerged, ...manualRows];
    const lineTitleToProductIdMap = buildLineItemTitleToProductIdMap(mergedForPricing);
    const productIds = collectOrderLineProductIdsForPricing(mergedForPricing, lineTitleToProductIdMap);
    const uniqPids = [...new Set(productIds)];
    const [metaSingle, manualPricingMap] = await Promise.all([
      gananciaFetchMetaSpendSingleDay(req.organizationId, dateStr),
      (async () => {
        try {
          if (!uniqPids.length) return new Map();
          return await loadProductManualPricingMap(req.organizationId, uniqPids);
        } catch (pricingErr) {
          if (pricingErr && pricingErr.code === '42P01') return new Map();
          throw pricingErr;
        }
      })(),
    ]);

    const excludeFin = new Set(['voided', 'cancelled']);
    let ventasTotal = 0;
    let ventasEntregadasTotal = 0;
    let ventasPedidos = 0;
    let costoProductoTotal = 0;
    let costoProductoEntregadoTotal = 0;
    let costoFletePromedioTotal = 0;
    for (const o of normalizedMerged) {
      const lf = localMapGanancia.get(Number(o.id));
      const estadoUnified = mergeDisplayedOrderEstado(lf?.internal_status, lf?.motico_status);
      if (isUnifiedEstadoPrueba(estadoUnified)) continue;
      const st = String(estadoUnified || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      if (st !== 'despachado') continue;
      const fs = String(o.financialStatus || '').toLowerCase();
      if (excludeFin.has(fs)) continue;
      const amt = resolveOrderRevenueAmount(o, lf);
      if (!Number.isFinite(amt) || amt < 0) continue;
      ventasTotal += amt;
      ventasPedidos += 1;
      const costs = calculateOrderManualCosts(o, manualPricingMap, lineTitleToProductIdMap);
      ventasEntregadasTotal += amt * ((costs.deliveryEffectivenessPct ?? 100) / 100);
      costoProductoTotal += costs.productCost;
      costoProductoEntregadoTotal += costs.productDeliveredCost;
      costoFletePromedioTotal += costs.avgFreightCost;
    }
    for (const o of manualRows) {
      const manualDay = moticoManualOrderAssignedYmd(o, iana);
      if (manualDay !== dateStr) continue;
      if (isUnifiedEstadoPrueba(o?.motico_status)) continue;
      const st = String(o?.motico_status || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      if (st !== 'despachado') continue;
      const fs = String(o?.financialStatus || '').toLowerCase();
      if (excludeFin.has(fs)) continue;
      const amt = resolveOrderRevenueAmount(o, null);
      if (!Number.isFinite(amt) || amt < 0) continue;
      ventasTotal += amt;
      ventasPedidos += 1;
      const costs = calculateOrderManualCosts(o, manualPricingMap, lineTitleToProductIdMap);
      ventasEntregadasTotal += amt * ((costs.deliveryEffectivenessPct ?? 100) / 100);
      costoProductoTotal += costs.productCost;
      costoProductoEntregadoTotal += costs.productDeliveredCost;
      costoFletePromedioTotal += costs.avgFreightCost;
    }

    const gastoAds = metaSingle.spend;
    const metaPartialErrors = metaSingle.metaPartialErrors || [];
    const metaCurrency = metaSingle.metaCurrency || '';

    const shopC = shopCurrency.toUpperCase();
    const metaC = metaCurrency.toUpperCase();
    const sameCurrency =
      Boolean(shopC && metaC && shopC === metaC) ||
      (gastoAds === 0 && Boolean(shopC) && !metaC) ||
      (gastoAds === 0 && !shopC && !metaC);
    let ganancia = null;
    let utilidad = null;
    let warning = null;
    if (sameCurrency && shopC) {
      ganancia = Math.round((ventasTotal - gastoAds) * 100) / 100;
      utilidad =
        Math.round((ventasEntregadasTotal - gastoAds - costoProductoEntregadoTotal - costoFletePromedioTotal) * 100) /
        100;
    } else if (gastoAds > 0 && shopC && !metaC) {
      warning =
        'Hay gasto en Meta pero no se pudo determinar la divisa de la cuenta; no se calcula la ganancia automática.';
    } else if (gastoAds > 0 && shopC && metaC && shopC !== metaC) {
      warning = `La tienda usa ${shopCurrency} y la(s) cuenta(s) Meta ${metaCurrency}. Convierte manualmente para comparar.`;
    } else if (ventasTotal > 0 && !shopC) {
      warning = 'La tienda no reportó divisa en Shopify; revisa el total en el admin.';
    }

    res.json({
      date: dateStr,
      shop_calendar_timezone: iana,
      ventas_despachadas_total: Math.round(ventasTotal * 100) / 100,
      ventas_entregadas_total: Math.round(ventasEntregadasTotal * 100) / 100,
      ventas_despachadas_pedidos: ventasPedidos,
      costo_producto_total: Math.round(costoProductoTotal * 100) / 100,
      costo_producto_entregado_total: Math.round(costoProductoEntregadoTotal * 100) / 100,
      costo_flete_promedio_total: Math.round(costoFletePromedioTotal * 100) / 100,
      ventas_currency: shopCurrency || null,
      gasto_publicitario_total: Math.round(gastoAds * 100) / 100,
      meta_currency: metaCurrency || null,
      ganancia,
      utilidad,
      ganancia_comparable: ganancia != null,
      warning,
      meta_partial_errors: metaPartialErrors,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al calcular ganancia diaria' });
  }
});

/** Detalle por día (tabla). ?months=2026-04,2026-03 opcional; por defecto el mes calendario actual en la tienda. */
app.get('/api/ganancia-diaria/series', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const cacheKey = cacheKeyForRequest(req, 'ganancia_diaria_series');
    const cachedPayload = readCachedJsonResponse(cacheKey);
    if (cachedPayload) {
      return res.json(cachedPayload);
    }
    const sendCached = (payload) => {
      writeCachedJsonResponse(cacheKey, payload, 300_000);
      return res.json(payload);
    };
    const shopRow = await getActiveShopifyConnection(req.organizationId);
    if (!shopRow) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const sr = await shopifyRequest(shopRow.shop_domain, shopRow.access_token, 'shop.json?fields=iana_timezone,currency');
    const iana =
      sr.ok && sr.data && sr.data.shop && sr.data.shop.iana_timezone
        ? String(sr.data.shop.iana_timezone)
        : 'UTC';
    const shopCurrency =
      sr.ok && sr.data && sr.data.shop && sr.data.shop.currency ? String(sr.data.shop.currency).trim() : '';
    const productIdQ = typeof req.query.product_id === 'string' ? req.query.product_id.trim() : '';
    const productIdFilterNum = Number.parseInt(productIdQ, 10);
    const hasProductFilter = Number.isFinite(productIdFilterNum) && productIdFilterNum > 0;

    const todayYmd = shopCalendarYmdFromInstant(Date.now(), iana);
    const jan1Ymd = { y: todayYmd.y, m: 1, d: 1 };
    const available_months = gananciaDiariaSelectableMonthKeys(todayYmd);
    const allowed = new Set(available_months);
    const metaPeriodRaw = typeof req.query.meta_period === 'string' ? req.query.meta_period.trim().toLowerCase() : '';

    let requested = gananciaDiariaParseMonthsQuery(req.query.months);
    requested = [...new Set(requested)].filter((k) => allowed.has(k));
    if (requested.length === 0) {
      requested = [
        `${String(todayYmd.y).padStart(4, '0')}-${String(todayYmd.m).padStart(2, '0')}`,
      ];
    }
    requested.sort();

    let sortedAsc = [];
    if (metaPeriodRaw) {
      const win = gananciaDiariaWindowFromMetaPeriod(metaPeriodRaw, todayYmd);
      if (win) {
        let since = win.since;
        const jan1 = gananciaDiariaYmdKey(jan1Ymd);
        const today = gananciaDiariaYmdKey(todayYmd);
        if (since < jan1) since = jan1;
        if (since > today) since = today;
        sortedAsc = gananciaDiariaExpandYmdRange(since, today);
        const monthSet = new Set(sortedAsc.map((d) => String(d).slice(0, 7)).filter((m) => allowed.has(m)));
        if (monthSet.size) requested = [...monthSet].sort();
      }
    }
    if (!sortedAsc.length) {
      sortedAsc = gananciaDiariaExpandMonthKeysToDayStrings(requested, jan1Ymd, todayYmd);
    }
    if (sortedAsc.length === 0) {
      return sendCached({
        shop_calendar_timezone: iana,
        ventas_currency: shopCurrency || null,
        meta_currency: null,
        ganancia_comparable: false,
        warning: null,
        meta_partial_errors: [],
        available_months,
        months_applied: requested,
        days: [],
        product_options: [],
      });
    }

    const partsFirst = parseIsoDateYmd(sortedAsc[0]);
    const partsLast = parseIsoDateYmd(sortedAsc[sortedAsc.length - 1]);
    if (!partsFirst || !partsLast) {
      return res.status(400).json({ error: 'Rango de fechas inválido' });
    }
    const rangeMin = shopifyOrderCreatedRangeForCalendarDate(iana, partsFirst.y, partsFirst.m, partsFirst.d).min;
    const rangeMax = shopifyOrderCreatedRangeForCalendarDate(iana, partsLast.y, partsLast.m, partsLast.d).max;

    const qs = new URLSearchParams();
    qs.set('status', 'any');
    qs.set('fields', SHOPIFY_ORDER_LIST_FIELDS);
    qs.set('created_at_min', rangeMin);
    qs.set('created_at_max', rangeMax);
    const sinceYmd = sortedAsc[0];
    const untilYmd = sortedAsc[sortedAsc.length - 1];
    const [r, manualRows, metaPack] = await Promise.all([
      shopifyFetchAllOrders(shopRow.shop_domain, shopRow.access_token, qs),
      loadMoticoManualOrdersForOrgGananciaSeries(
        req.organizationId,
        rangeMin,
        rangeMax,
        sinceYmd,
        untilYmd,
      ),
      gananciaFetchMetaSpendPack(req.organizationId, sinceYmd, untilYmd),
    ]);
    if (!r.ok) {
      const st = Number(r.status) >= 400 ? Number(r.status) : 502;
      return res.status(Number.isFinite(st) ? st : 502).json({ error: r.error || 'Error Shopify', data: r.data });
    }
    const normalized = normalizeShopifyOrdersForApp({ orders: r.orders });
    const ids = normalized.map((o) => Number(o.id)).filter((n) => Number.isFinite(n));
    let localMapGanancia2 = new Map();
    try {
      localMapGanancia2 = await loadLocalFieldsMap(req.organizationId, ids);
    } catch (ganLfErr2) {
      if (!(ganLfErr2 && ganLfErr2.code === '42P01')) throw ganLfErr2;
    }
    const normalizedMerged2 = normalized.map((o) =>
      applyShopifyOrderKovoDisplayOverrides(o, localMapGanancia2.get(Number(o.id))),
    );
    const mergedForPricing2 = [...normalizedMerged2, ...manualRows];
    const lineTitleToProductIdMap = buildLineItemTitleToProductIdMap(mergedForPricing2);
    const productIds = collectOrderLineProductIdsForPricing(mergedForPricing2, lineTitleToProductIdMap);
    const uniqPids = [...new Set(productIds)];
    const manualPricingMap = await (async () => {
      try {
        if (!uniqPids.length) return new Map();
        return await loadProductManualPricingMap(req.organizationId, uniqPids);
      } catch (pricingErr) {
        if (pricingErr && pricingErr.code === '42P01') return new Map();
        throw pricingErr;
      }
    })();

    const daySet = new Set(sortedAsc);
    const ventasByDay = new Map();
    const ventasEntregadasByDay = new Map();
    const pedidosByDay = new Map();
    const qtyByDay = new Map();
    const costoProductoByDay = new Map();
    const costoProductoEntregadoByDay = new Map();
    const costoFletePromedioByDay = new Map();
    for (const k of sortedAsc) {
      ventasByDay.set(k, 0);
      ventasEntregadasByDay.set(k, 0);
      pedidosByDay.set(k, 0);
      qtyByDay.set(k, 0);
      costoProductoByDay.set(k, 0);
      costoProductoEntregadoByDay.set(k, 0);
      costoFletePromedioByDay.set(k, 0);
    }

    /** @type {Map<string, Map<string, object>>} */
    const productByDay = new Map();
    const touchDayProducts = (dayKey) => {
      let inner = productByDay.get(dayKey);
      if (!inner) {
        inner = new Map();
        productByDay.set(dayKey, inner);
      }
      return inner;
    };

    const excludeFin = new Set(['voided', 'cancelled']);
    for (const o of normalizedMerged2) {
      const t = Date.parse(String(o.createdAt || ''));
      if (!Number.isFinite(t)) continue;
      const od = shopCalendarYmdFromInstant(t, iana);
      const key = gananciaDiariaYmdKey(od);
      if (!daySet.has(key)) continue;
      const lf = localMapGanancia2.get(Number(o.id));
      const estadoUnified = mergeDisplayedOrderEstado(lf?.internal_status, lf?.motico_status);
      if (isUnifiedEstadoPrueba(estadoUnified)) continue;
      const st = String(estadoUnified || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      if (st !== 'despachado') continue;
      const fs = String(o.financialStatus || '').toLowerCase();
      if (excludeFin.has(fs)) continue;
      const amt = resolveOrderRevenueAmount(o, lf);
      if (!Number.isFinite(amt) || amt < 0) continue;
      ventasByDay.set(key, (ventasByDay.get(key) || 0) + amt);
      pedidosByDay.set(key, (pedidosByDay.get(key) || 0) + 1);
      const qtyOrder = effectiveOrderProductQuantityForGanancia(o, lf);
      qtyByDay.set(key, (qtyByDay.get(key) || 0) + qtyOrder);
      const costs = calculateOrderManualCosts(o, manualPricingMap, lineTitleToProductIdMap);
      ventasEntregadasByDay.set(
        key,
        (ventasEntregadasByDay.get(key) || 0) + amt * ((costs.deliveryEffectivenessPct ?? 100) / 100),
      );
      costoProductoByDay.set(key, (costoProductoByDay.get(key) || 0) + costs.productCost);
      costoProductoEntregadoByDay.set(
        key,
        (costoProductoEntregadoByDay.get(key) || 0) + costs.productDeliveredCost,
      );
      costoFletePromedioByDay.set(
        key,
        (costoFletePromedioByDay.get(key) || 0) + costs.avgFreightCost,
      );
      const pack = gananciaProductContributionsForOrder(o, manualPricingMap, lineTitleToProductIdMap);
      if (pack) gananciaMergeProductDay(touchDayProducts(key), pack.contrib);
    }
    for (const o of manualRows) {
      const key = moticoManualOrderAssignedYmd(o, iana);
      if (!key) continue;
      if (!daySet.has(key)) continue;
      if (isUnifiedEstadoPrueba(o?.motico_status)) continue;
      const st = String(o?.motico_status || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      if (st !== 'despachado') continue;
      const fs = String(o?.financialStatus || '').toLowerCase();
      if (excludeFin.has(fs)) continue;
      const amt = resolveOrderRevenueAmount(o, null);
      if (!Number.isFinite(amt) || amt < 0) continue;
      ventasByDay.set(key, (ventasByDay.get(key) || 0) + amt);
      pedidosByDay.set(key, (pedidosByDay.get(key) || 0) + 1);
      const qtyOrder = effectiveOrderProductQuantityForGanancia(o, null);
      qtyByDay.set(key, (qtyByDay.get(key) || 0) + qtyOrder);
      const costs = calculateOrderManualCosts(o, manualPricingMap, lineTitleToProductIdMap);
      ventasEntregadasByDay.set(
        key,
        (ventasEntregadasByDay.get(key) || 0) + amt * ((costs.deliveryEffectivenessPct ?? 100) / 100),
      );
      costoProductoByDay.set(key, (costoProductoByDay.get(key) || 0) + costs.productCost);
      costoProductoEntregadoByDay.set(
        key,
        (costoProductoEntregadoByDay.get(key) || 0) + costs.productDeliveredCost,
      );
      costoFletePromedioByDay.set(
        key,
        (costoFletePromedioByDay.get(key) || 0) + costs.avgFreightCost,
      );
      const packM = gananciaProductContributionsForOrder(o, manualPricingMap, lineTitleToProductIdMap);
      if (packM) gananciaMergeProductDay(touchDayProducts(key), packM.contrib);
    }

    const spendByDay = metaPack.spendByDay || {};
    const metaPartialErrors = metaPack.metaPartialErrors || [];
    const metaCurrency = metaPack.metaCurrency || '';

    const totalMetaSpend = Object.values(spendByDay).reduce((sum, v) => sum + (Number(v) || 0), 0);
    const shopC = shopCurrency.toUpperCase();
    const metaC = metaCurrency.toUpperCase();
    const sameCurrency =
      Boolean(shopC && metaC && shopC === metaC) ||
      (totalMetaSpend === 0 && Boolean(shopC) && !metaC) ||
      (totalMetaSpend === 0 && !shopC && !metaC);
    let warning = null;
    if (sameCurrency && shopC) {
      /* ok */
    } else if (totalMetaSpend > 0 && shopC && !metaC) {
      warning =
        'Hay gasto en Meta pero no se pudo determinar la divisa de la cuenta; no se calcula la ganancia automática.';
    } else if (totalMetaSpend > 0 && shopC && metaC && shopC !== metaC) {
      warning = `La tienda usa ${shopCurrency} y la(s) cuenta(s) Meta ${metaCurrency}. Convierte manualmente para comparar.`;
    } else if (totalMetaSpend > 0 && !shopC) {
      warning = 'La tienda no reportó divisa en Shopify; revisa el total en el admin.';
    }

    const gananciaComparable = Boolean(sameCurrency && shopC);
    const sortedDesc = [...sortedAsc].reverse();
    const days = [];
    for (const dateStr of sortedDesc) {
      const ventasTotal = ventasByDay.get(dateStr) || 0;
      const ventasEntregadasTotal = ventasEntregadasByDay.get(dateStr) || 0;
      const ventasPedidos = pedidosByDay.get(dateStr) || 0;
      const cantidadProductoTotal = qtyByDay.get(dateStr) || 0;
      const costoProducto = costoProductoByDay.get(dateStr) || 0;
      const costoProductoEntregado = costoProductoEntregadoByDay.get(dateStr) || 0;
      const costoFletePromedio = costoFletePromedioByDay.get(dateStr) || 0;
      const gastoAds = Number(spendByDay[dateStr] || 0);
      let ganancia = null;
      let utilidad = null;
      if (gananciaComparable) {
        ganancia = Math.round((ventasTotal - gastoAds) * 100) / 100;
        utilidad =
          Math.round((ventasEntregadasTotal - gastoAds - costoProductoEntregado - costoFletePromedio) * 100) / 100;
      }
      const innerProd = productByDay.get(dateStr);
      let by_product = {};
      if (innerProd && innerProd.size) {
        by_product = Object.fromEntries(
          [...innerProd.entries()].map(([pk, v]) => [
            pk,
            {
              label: v.label,
              product_id: v.product_id,
              ventas_despachadas_total: Math.round(v.ventas_despachadas * 100) / 100,
              ventas_entregadas_total: Math.round(v.ventas_entregadas * 100) / 100,
              ventas_despachadas_pedidos: v.pedidos,
              cantidad_producto_total: Math.round(v.qty * 100) / 100,
              costo_producto_total: Math.round(v.costo_producto * 100) / 100,
              costo_producto_entregado_total: Math.round(v.costo_entregado * 100) / 100,
              costo_flete_promedio_total: Math.round(v.flete * 100) / 100,
            },
          ]),
        );
      }
      days.push({
        date: dateStr,
        ventas_despachadas_total: Math.round(ventasTotal * 100) / 100,
        ventas_entregadas_total: Math.round(ventasEntregadasTotal * 100) / 100,
        ventas_despachadas_pedidos: ventasPedidos,
        cantidad_producto_total: Math.round(cantidadProductoTotal * 100) / 100,
        costo_producto_total: Math.round(costoProducto * 100) / 100,
        costo_producto_entregado_total: Math.round(costoProductoEntregado * 100) / 100,
        costo_flete_promedio_total: Math.round(costoFletePromedio * 100) / 100,
        gasto_publicitario_total: Math.round(gastoAds * 100) / 100,
        ganancia,
        utilidad,
        by_product,
      });
    }

    const productLabelByKey = new Map();
    for (const inner of productByDay.values()) {
      for (const [pk, v] of inner) {
        if (!productLabelByKey.has(pk)) {
          productLabelByKey.set(pk, { key: pk, label: String(v.label || pk), product_id: v.product_id ?? null });
        } else {
          const x = productLabelByKey.get(pk);
          if (x && !x.product_id && v.product_id != null) x.product_id = v.product_id;
        }
      }
    }
    const product_options = [...productLabelByKey.values()].sort((a, b) =>
      String(a.label).localeCompare(String(b.label), 'es', { sensitivity: 'base' }),
    );

    const filteredDays = hasProductFilter
      ? days.map((row) => {
          const byp = row && row.by_product && typeof row.by_product === 'object' ? row.by_product : {};
          const selected = Object.values(byp).find(
            (x) => x && Number.isFinite(Number(x.product_id)) && Number(x.product_id) === productIdFilterNum,
          );
        const totalVentasDay = Number(row.ventas_despachadas_total || 0);
        const totalGastoAdsDay = Number(row.gasto_publicitario_total || 0);
          if (!selected) {
            return {
              ...row,
              ventas_despachadas_total: 0,
              ventas_entregadas_total: 0,
              ventas_despachadas_pedidos: 0,
              cantidad_producto_total: 0,
              costo_producto_total: 0,
              costo_producto_entregado_total: 0,
              costo_flete_promedio_total: 0,
              gasto_publicitario_total: 0,
              ganancia: gananciaComparable ? 0 : null,
              utilidad: gananciaComparable ? 0 : null,
              by_product: {},
            };
          }
          const ventasDesp = Number(selected.ventas_despachadas_total || 0);
          const ventasEnt = Number(selected.ventas_entregadas_total || 0);
          const pedidos = Number(selected.ventas_despachadas_pedidos || 0);
          const qty = Number(selected.cantidad_producto_total || 0);
          const costoProd = Number(selected.costo_producto_total || 0);
          const costoProdEnt = Number(selected.costo_producto_entregado_total || 0);
          const costoFlete = Number(selected.costo_flete_promedio_total || 0);
          const shareByVentas =
            totalVentasDay > 0 && Number.isFinite(totalVentasDay) ? Math.max(0, Math.min(1, ventasDesp / totalVentasDay)) : 0;
          const gastoAds = Math.round(totalGastoAdsDay * shareByVentas * 100) / 100;
          return {
            ...row,
            ventas_despachadas_total: Math.round(ventasDesp * 100) / 100,
            ventas_entregadas_total: Math.round(ventasEnt * 100) / 100,
            ventas_despachadas_pedidos: pedidos,
            cantidad_producto_total: Math.round(qty * 100) / 100,
            costo_producto_total: Math.round(costoProd * 100) / 100,
            costo_producto_entregado_total: Math.round(costoProdEnt * 100) / 100,
            costo_flete_promedio_total: Math.round(costoFlete * 100) / 100,
            gasto_publicitario_total: gastoAds,
            ganancia: gananciaComparable ? Math.round((ventasDesp - gastoAds) * 100) / 100 : null,
            utilidad: gananciaComparable ? Math.round((ventasEnt - gastoAds - costoProdEnt - costoFlete) * 100) / 100 : null,
            by_product: {
              [String(selected.product_id ?? productIdFilterNum)]: selected,
            },
          };
        })
      : days;

    sendCached({
      shop_calendar_timezone: iana,
      ventas_currency: shopCurrency || null,
      meta_currency: metaCurrency || null,
      ganancia_comparable: gananciaComparable,
      warning,
      meta_partial_errors: metaPartialErrors,
      available_months,
      months_applied: requested,
      days: filteredDays,
      product_options,
      product_id_applied: hasProductFilter ? productIdFilterNum : null,
      product_spend_allocation: hasProductFilter ? 'ventas_despachadas_prorrata_dia' : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al calcular la serie de ganancia diaria' });
  }
});

app.get(
  '/api/calculadora-cod/productos',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('calculadora_cod'),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (c.product_name)
                c.product_name,
                (SELECT COUNT(*)::int FROM calculadora_cod_calculos x
                   WHERE x.user_id = $1 AND x.product_name = c.product_name) AS versions_count,
                GREATEST(c.created_at, COALESCE(c.updated_at, c.created_at)) AS last_updated,
                c.kpis_json,
                c.currency
           FROM calculadora_cod_calculos c
          WHERE c.user_id = $1
          ORDER BY c.product_name, c.created_at DESC`,
        [req.user.userId],
      );
      res.json({
        productos: rows.map((r) => {
          const mixK = mixObjetivoPonderadoFromKpisJson(r.kpis_json);
          const cur = String(r.currency || 'COP').trim().toUpperCase();
          const currency = ['COP', 'USD', 'MXN'].includes(cur) ? cur : 'COP';
          return {
            product_name: r.product_name,
            last_updated: r.last_updated ? new Date(r.last_updated).toISOString() : null,
            versions_count: Number(r.versions_count) || 0,
            currency,
            cpa_objetivo_ponderado: mixK.cpa_objetivo_ponderado,
            roas_objetivo_ponderado: mixK.roas_objetivo_ponderado,
          };
        }),
      });
    } catch (e) {
      if (e && e.code === '42P01') {
        return res.status(503).json({
          error: 'Falta la tabla calculadora_cod_calculos. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[calculadora-cod/productos]', e);
      res.status(500).json({ error: 'Error al listar productos' });
    }
  },
);

app.get(
  '/api/calculadora-cod/productos/:nombre/historico',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('calculadora_cod'),
  async (req, res) => {
    try {
      const raw = req.params.nombre != null ? String(req.params.nombre) : '';
      const productName = normalizeCalculadoraProductName(decodeURIComponent(raw.replace(/\+/g, ' ')));
      if (!productName) {
        return res.status(400).json({ error: 'Nombre de producto inválido' });
      }
      const { rows } = await pool.query(
        `SELECT id, created_at, updated_at, inputs_json, kpis_json, currency, notes
           FROM calculadora_cod_calculos
          WHERE user_id = $1 AND product_name = $2
          ORDER BY created_at ASC`,
        [req.user.userId, productName],
      );
      res.json({
        historico: rows.map((r) => calculadoraCalculoRowToJson(r)),
      });
    } catch (e) {
      if (e && e.code === '42P01') {
        return res.status(503).json({
          error: 'Falta la tabla calculadora_cod_calculos. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[calculadora-cod/historico]', e);
      res.status(500).json({ error: 'Error al cargar histórico' });
    }
  },
);

app.get(
  '/api/calculadora-cod/productos/:nombre/ultimo',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('calculadora_cod'),
  async (req, res) => {
    try {
      const raw = req.params.nombre != null ? String(req.params.nombre) : '';
      const productName = normalizeCalculadoraProductName(decodeURIComponent(raw.replace(/\+/g, ' ')));
      if (!productName) {
        return res.status(400).json({ error: 'Nombre de producto inválido' });
      }
      const { rows } = await pool.query(
        `SELECT id, created_at, updated_at, inputs_json, kpis_json, currency, notes
           FROM calculadora_cod_calculos
          WHERE user_id = $1 AND product_name = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [req.user.userId, productName],
      );
      const row = rows[0];
      res.json({
        calculo: row ? calculadoraCalculoRowToJson(row) : null,
      });
    } catch (e) {
      if (e && e.code === '42P01') {
        return res.status(503).json({
          error: 'Falta la tabla calculadora_cod_calculos. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[calculadora-cod/ultimo]', e);
      res.status(500).json({ error: 'Error al cargar el último cálculo' });
    }
  },
);

app.post(
  '/api/calculadora-cod/calculos',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('calculadora_cod'),
  async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const product_name = normalizeCalculadoraProductName(body.product_name);
      if (!product_name) {
        return res.status(400).json({ error: 'product_name es obligatorio' });
      }
      if (!body.inputs_json || typeof body.inputs_json !== 'object' || Array.isArray(body.inputs_json)) {
        return res.status(400).json({ error: 'inputs_json debe ser un objeto' });
      }
      if (!body.kpis_json || typeof body.kpis_json !== 'object' || Array.isArray(body.kpis_json)) {
        return res.status(400).json({ error: 'kpis_json debe ser un objeto' });
      }
      const cur = String(body.currency || 'COP')
        .trim()
        .toUpperCase();
      if (!['COP', 'USD', 'MXN'].includes(cur)) {
        return res.status(400).json({ error: 'currency debe ser COP, USD o MXN' });
      }
      const notes = body.notes != null ? String(body.notes).slice(0, 4000) : null;
      const inputsStr = JSON.stringify(body.inputs_json);
      const kpisStr = JSON.stringify(body.kpis_json);
      const { rows: prevRows } = await pool.query(
        `SELECT id FROM calculadora_cod_calculos
          WHERE user_id = $1 AND product_name = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [req.user.userId, product_name],
      );
      const prevId = prevRows[0]?.id;
      let row;
      if (prevId) {
        const upd = await pool.query(
          `UPDATE calculadora_cod_calculos
              SET inputs_json = $3::jsonb,
                  kpis_json = $4::jsonb,
                  currency = $5,
                  notes = $6,
                  updated_at = now()
            WHERE id = $1 AND user_id = $2
          RETURNING id, created_at, updated_at, inputs_json, kpis_json, currency, notes`,
          [prevId, req.user.userId, inputsStr, kpisStr, cur, notes],
        );
        row = upd.rows[0];
      } else {
        const ins = await pool.query(
          `INSERT INTO calculadora_cod_calculos (user_id, product_name, inputs_json, kpis_json, currency, notes)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
           RETURNING id, created_at, updated_at, inputs_json, kpis_json, currency, notes`,
          [req.user.userId, product_name, inputsStr, kpisStr, cur, notes],
        );
        row = ins.rows[0];
      }
      res.status(prevId ? 200 : 201).json({
        calculo: calculadoraCalculoRowToJson(row),
      });
    } catch (e) {
      if (e && e.code === '42P01') {
        return res.status(503).json({
          error: 'Falta la tabla calculadora_cod_calculos. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[calculadora-cod/calculos POST]', e);
      res.status(500).json({ error: 'Error al guardar el cálculo' });
    }
  },
);

app.delete(
  '/api/calculadora-cod/calculos/:id',
  verifyToken,
  scopeToOrganization,
  requireModuleAccess('calculadora_cod'),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const del = await pool.query(
        `DELETE FROM calculadora_cod_calculos WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, req.user.userId],
      );
      if (del.rowCount === 0) {
        return res.status(404).json({ error: 'Cálculo no encontrado' });
      }
      res.json({ success: true });
    } catch (e) {
      if (e && e.code === '42P01') {
        return res.status(503).json({
          error: 'Falta la tabla calculadora_cod_calculos. Reinicia el backend para ejecutar initDb.',
        });
      }
      console.error('[calculadora-cod/calculos DELETE]', e);
      res.status(500).json({ error: 'Error al eliminar el cálculo' });
    }
  },
);

app.put('/api/shopify/orders/:orderId/local-fields', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const orderIdRaw = parseInt(String(req.params.orderId), 10);
    if (!Number.isFinite(orderIdRaw) || orderIdRaw === 0) {
      return res.status(400).json({ error: 'ID de pedido inválido' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const bodyKeys = Object.keys(body);
    if (orderIdRaw < 0) {
      if (body.sync_to_shopify === true) {
        return res.status(400).json({ error: 'Los pedidos manuales Motico no se sincronizan con Shopify.' });
      }
      const manualId = -orderIdRaw;
      const onlyPaymentStatusUpdate = isOnlyPaymentStatusMutation(bodyKeys);
      const { rows: mrows } = await pool.query(
        `SELECT id, price_override, quantity_override, motico_status, financial_status, pago_al_recibir_override, total_a_pagar_override, total_price, product_summary, line_items_json, shipping_json
         FROM motico_manual_orders
         WHERE id = $1 AND organization_id = $2`,
        [manualId, req.organizationId],
      );
      if (!mrows.length) {
        return res.status(404).json({ error: 'Pedido manual no encontrado' });
      }
      const cur = mrows[0];
      const currentMoticoStatus =
        cur.motico_status != null && String(cur.motico_status) !== '' ? String(cur.motico_status) : MOTICO_STATUS_DEFAULT;
      const currentMoticoStatusNormalized = String(currentMoticoStatus || '').toLowerCase();
      const unlockReason = String(body.unlock_reason || '').trim();
      const requestedMoticoStatus = body.motico_status !== undefined ? String(body.motico_status) : '';
      const requestedInternalManual = body.internal_status !== undefined ? String(body.internal_status) : '';
      const requestedEstadoUnlock = requestedInternalManual || requestedMoticoStatus;
      const unlockFromMoticoLockedRequested =
        (currentMoticoStatusNormalized === 'despachado' || currentMoticoStatusNormalized === 'cancelado') &&
        requestedEstadoUnlock === 'sin_revisar' &&
        unlockReason.length >= 5;
      if (
        (currentMoticoStatusNormalized === 'despachado' || currentMoticoStatusNormalized === 'cancelado') &&
        !onlyPaymentStatusUpdate &&
        !unlockFromMoticoLockedRequested
      ) {
        const msg =
          currentMoticoStatusNormalized === 'cancelado'
            ? 'Pedido cancelado: responde el motivo y desbloquea antes de editar.'
            : 'Pedido despachado: responde el motivo y desbloquea antes de editar.';
        return res.status(409).json({ error: msg });
      }
      let price_override = cur.price_override != null ? Number(cur.price_override) : null;
      if (body.price_override !== undefined) {
        if (body.price_override === null) price_override = null;
        else {
          const n = Number(body.price_override);
          if (!Number.isFinite(n) || n < 0) {
            return res.status(400).json({ error: 'Precio no válido' });
          }
          price_override = n;
        }
      }
      let quantity_override = cur.quantity_override != null ? Number(cur.quantity_override) : null;
      if (body.quantity_override !== undefined) {
        if (body.quantity_override === null) quantity_override = null;
        else {
          const q = parseInt(String(body.quantity_override), 10);
          if (!Number.isFinite(q) || q < 0) {
            return res.status(400).json({ error: 'Cantidad no válida' });
          }
          quantity_override = q;
        }
      }
      let motico_status = normalizeLegacyMoticoEstadoToUnified(
        cur.motico_status != null && String(cur.motico_status) !== '' ? String(cur.motico_status) : MOTICO_STATUS_DEFAULT,
      );
      if (body.internal_status !== undefined) {
        const s = String(body.internal_status);
        if (!SHOPIFY_INTERNAL_STATUSES.has(s)) {
          return res.status(400).json({ error: 'Estado interno no válido' });
        }
        motico_status = s;
      } else if (body.motico_status !== undefined) {
        const ms = String(body.motico_status);
        if (!SHOPIFY_INTERNAL_STATUSES.has(ms)) {
          return res.status(400).json({ error: 'Estado Motico no válido' });
        }
        motico_status = ms;
      }
      let financial_status = cur.financial_status != null ? String(cur.financial_status).toLowerCase() : 'pending';
      if (!MOTICO_PAYMENT_STATUSES.has(financial_status)) financial_status = 'pending';
      if (body.payment_status !== undefined) {
        const ps = String(body.payment_status || '').toLowerCase();
        if (!MOTICO_PAYMENT_STATUSES.has(ps)) {
          return res.status(400).json({ error: 'Estado de pago no válido' });
        }
        financial_status = ps;
      }
      let total_a_pagar_override = cur.total_a_pagar_override != null ? Number(cur.total_a_pagar_override) : null;
      if (total_a_pagar_override != null && !Number.isFinite(total_a_pagar_override)) total_a_pagar_override = null;
      let pago_al_recibir_override =
        cur.pago_al_recibir_override != null ? Number(cur.pago_al_recibir_override) : 0;
      if (!Number.isFinite(pago_al_recibir_override) || pago_al_recibir_override < 0) pago_al_recibir_override = 0;
      if (body.pago_al_recibir_override !== undefined) {
        const recv = Number(body.pago_al_recibir_override);
        if (!Number.isFinite(recv) || recv < 0) {
          return res.status(400).json({ error: 'Pago al recibir no válido' });
        }
        pago_al_recibir_override = recv;
      }
      if (body.total_a_pagar_override !== undefined) {
        if (body.total_a_pagar_override === null) total_a_pagar_override = null;
        else {
          const bal = Number(body.total_a_pagar_override);
          if (!Number.isFinite(bal) || bal < 0) {
            return res.status(400).json({ error: 'Total a pagar no válido' });
          }
          total_a_pagar_override = bal;
        }
      }
      let line_items_json = Array.isArray(cur.line_items_json) ? cur.line_items_json : [];
      if (typeof cur.line_items_json === 'string') {
        try {
          const parsed = JSON.parse(cur.line_items_json);
          line_items_json = Array.isArray(parsed) ? parsed : [];
        } catch {
          line_items_json = [];
        }
      }
      let product_summary = String(cur.product_summary || '').trim();
      if (body.line_items !== undefined) {
        if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
          return res.status(400).json({ error: 'Envía al menos un producto válido' });
        }
        const parsedLines = [];
        for (const raw of body.line_items) {
          if (!raw || typeof raw !== 'object') continue;
          const li = raw;
          const title = String(li.title || li.name || '').trim();
          if (!title) continue;
          const q = parseInt(String(li.quantity != null ? li.quantity : '1'), 10);
          if (!Number.isFinite(q) || q < 1) continue;
          parsedLines.push({
            product_id: li.product_id != null ? Number(li.product_id) || null : null,
            variant_id: li.variant_id != null ? Number(li.variant_id) || null : null,
            title,
            variant_title: String(li.variant_title || '').trim(),
            sku: String(li.sku || '').trim(),
            barcode: String(li.barcode || '').trim(),
            quantity: q,
          });
        }
        if (!parsedLines.length) {
          return res.status(400).json({ error: 'Envía al menos un producto válido' });
        }
        const effectiveTotal =
          price_override != null && Number.isFinite(Number(price_override))
            ? Number(price_override)
            : Number(cur.total_price || 0);
        const qtyTotal = parsedLines.reduce((acc, li) => acc + li.quantity, 0) || 1;
        const unitPrice = Math.round((effectiveTotal / qtyTotal) * 10000) / 10000;
        line_items_json = parsedLines.map((li, idx) => ({
          id: idx + 1,
          product_id: li.product_id,
          variant_id: li.variant_id,
          title: li.title,
          variant_title: li.variant_title,
          sku: li.sku,
          barcode: li.barcode,
          quantity: li.quantity,
          price: String(unitPrice),
          properties: [],
        }));
        product_summary = parsedLines
          .map((li) => (li.variant_title ? `${li.title} (${li.variant_title})` : li.title))
          .join(' + ')
          .slice(0, 600);
        // La cantidad vive en las líneas; el override de cabecera deja de aplicar y evita mostrar 1 cuando hay 2+ unidades en líneas.
        quantity_override = null;
      }
      let shipping_json = {};
      if (cur.shipping_json && typeof cur.shipping_json === 'object') shipping_json = { ...cur.shipping_json };
      else if (typeof cur.shipping_json === 'string') {
        try {
          const parsedShip = JSON.parse(cur.shipping_json);
          if (parsedShip && typeof parsedShip === 'object') shipping_json = parsedShip;
        } catch {
          shipping_json = {};
        }
      }
      if (body.mensajero !== undefined) {
        if (body.mensajero === null || body.mensajero === '') {
          delete shipping_json.mensajero;
          shipping_json.removed_from_motico = true;
          shipping_json.removed_from_motico_at = new Date().toISOString();
          if (unlockReason.length >= 5) shipping_json.removed_from_motico_reason = unlockReason;
        } else {
          const m = String(body.mensajero).trim().toLowerCase();
          if (!SHOPIFY_MENSAJEROS.has(m)) {
            return res.status(400).json({ error: 'Mensajero no válido' });
          }
          shipping_json.mensajero = m;
          if (m === 'motico') {
            shipping_json.removed_from_motico = false;
            // Para pedidos manuales antiguos, registrar la fecha de asignación permite que entren por filtro de fecha en Motico.
            const assignedDateRaw = String(
              shipping_json.assigned_date || shipping_json.fecha_asignada || shipping_json.assignedDate || '',
            ).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(assignedDateRaw)) {
              shipping_json.assigned_date = new Date().toISOString().slice(0, 10);
            }
            delete shipping_json.removed_from_motico_at;
            delete shipping_json.removed_from_motico_reason;
          } else {
            shipping_json.removed_from_motico = true;
            shipping_json.removed_from_motico_at = new Date().toISOString();
            if (unlockReason.length >= 5) shipping_json.removed_from_motico_reason = unlockReason;
            delete shipping_json.assigned_date;
            delete shipping_json.fecha_asignada;
            delete shipping_json.assignedDate;
          }
        }
      }
      const prevManualUnifiedDespacho = normalizeLegacyMoticoEstadoToUnified(currentMoticoStatus);
      const nextManualUnifiedDespacho = normalizeLegacyMoticoEstadoToUnified(motico_status);
      const manualStampLastDespachado =
        nextManualUnifiedDespacho === 'despachado' && prevManualUnifiedDespacho !== 'despachado';
      const manualLastDespachadoParam = manualStampLastDespachado ? new Date() : null;
      await pool.query(
        `UPDATE motico_manual_orders SET
          price_override = $1,
          quantity_override = $2,
          motico_status = $3,
          total_a_pagar_override = $4,
          financial_status = $5,
          pago_al_recibir_override = $6,
          line_items_json = $7::jsonb,
          product_summary = $8,
          shipping_json = $9::jsonb,
          last_despachado_at = COALESCE($10::timestamptz, motico_manual_orders.last_despachado_at),
          updated_at = now()
        WHERE id = $11 AND organization_id = $12`,
        [
          price_override,
          quantity_override,
          motico_status,
          total_a_pagar_override,
          financial_status,
          pago_al_recibir_override,
          JSON.stringify(line_items_json),
          product_summary,
          JSON.stringify(shipping_json),
          manualLastDespachadoParam,
          manualId,
          req.organizationId,
        ],
      );
      await appendOrderChangeLog(req, {
        orderSource: 'motico_manual',
        orderId: manualId,
        action: 'update_local_fields',
        payload: {
          internal_status: motico_status,
          financial_status,
          price_override,
          quantity_override,
          pago_al_recibir_override,
          total_a_pagar_override,
          has_line_items: Array.isArray(line_items_json) && line_items_json.length > 0,
        },
      });
      const paymentBadge = mapFinancialToBadge(financial_status);
      const { rows: refreshedRows } = await pool.query(
        `SELECT * FROM motico_manual_orders WHERE id = $1 AND organization_id = $2`,
        [manualId, req.organizationId],
      );
      const refreshedMapped = refreshedRows[0] ? mapMoticoManualOrderRowFromDb(refreshedRows[0]) : null;
      const responseMensajero = refreshedMapped ? refreshedMapped.mensajero : null;
      return res.json({
        ok: true,
        internal_status: motico_status,
        price_override,
        quantity_override,
        mensajero: responseMensajero,
        motico_status,
        payment_status_override: financial_status,
        financial_status,
        label: paymentBadge.label,
        badgeVariant: paymentBadge.variant,
        pago_al_recibir_override,
        total_a_pagar_override,
      });
    }

    const orderId = orderIdRaw;
    const { rows: existing } = await pool.query(
      `SELECT internal_status, price_override, quantity_override, mensajero, motico_status, payment_status_override, pago_al_recibir_override, anticipo_kovo_explicit, pagado_al_recibir_override, total_a_pagar_override, shipping_address_override, line_items_override_json
       FROM shopify_order_local_fields WHERE organization_id = $1 AND shopify_order_id = $2`,
      [req.organizationId, orderId],
    );
    const cur = existing[0] || {};
    const onlyPaymentStatusUpdate = isOnlyPaymentStatusMutation(bodyKeys);
    const curEstado = mergeDisplayedOrderEstado(cur.internal_status, cur.motico_status);
    const unlockReasonCombined = String(body.unlock_reason || '').trim();
    const requestedMoticoStatus = body.motico_status !== undefined ? String(body.motico_status) : '';
    const requestedInternalStatus = body.internal_status !== undefined ? String(body.internal_status) : '';
    const requestedEstadoUnlock = requestedInternalStatus || requestedMoticoStatus;
    const unlockFromLockedCombined =
      (curEstado === 'despachado' || curEstado === 'cancelado') &&
      requestedEstadoUnlock === 'sin_revisar' &&
      unlockReasonCombined.length >= 5;
    if ((curEstado === 'despachado' || curEstado === 'cancelado') && !onlyPaymentStatusUpdate && !unlockFromLockedCombined) {
      const msg =
        curEstado === 'cancelado'
          ? 'Pedido cancelado: responde el motivo y desbloquea antes de editar.'
          : 'Pedido despachado: responde el motivo y desbloquea antes de editar.';
      return res.status(409).json({ error: msg });
    }
    let internal_status = curEstado;
    if (body.internal_status !== undefined) {
      const s = String(body.internal_status);
      if (!SHOPIFY_INTERNAL_STATUSES.has(s)) {
        return res.status(400).json({ error: 'Estado interno no válido' });
      }
      internal_status = s;
    }
    let price_override = cur.price_override != null ? Number(cur.price_override) : null;
    if (body.price_override !== undefined) {
      if (body.price_override === null) price_override = null;
      else {
        const n = Number(body.price_override);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ error: 'Precio no válido' });
        }
        price_override = n;
      }
    }
    let quantity_override = cur.quantity_override != null ? Number(cur.quantity_override) : null;
    if (body.quantity_override !== undefined) {
      if (body.quantity_override === null) quantity_override = null;
      else {
        const q = parseInt(String(body.quantity_override), 10);
        if (!Number.isFinite(q) || q < 0) {
          return res.status(400).json({ error: 'Cantidad no válida' });
        }
        quantity_override = q;
      }
    }
    let mensajero = cur.mensajero || null;
    if (body.mensajero !== undefined) {
      if (body.mensajero === null || body.mensajero === '') mensajero = null;
      else {
        const m = String(body.mensajero).toLowerCase();
        if (!SHOPIFY_MENSAJEROS.has(m)) {
          return res.status(400).json({ error: 'Mensajero no válido' });
        }
        mensajero = m;
      }
    }
    let motico_status = curEstado;
    if (body.motico_status !== undefined) {
      const ms = String(body.motico_status);
      if (!SHOPIFY_INTERNAL_STATUSES.has(ms)) {
        return res.status(400).json({ error: 'Estado Motico no válido' });
      }
      motico_status = ms;
    }
    if (body.internal_status !== undefined) {
      motico_status = internal_status;
    } else if (body.motico_status !== undefined) {
      internal_status = motico_status;
    }
    let payment_status_override =
      cur.payment_status_override != null ? String(cur.payment_status_override).toLowerCase() : null;
    if (payment_status_override != null && !MOTICO_PAYMENT_STATUSES.has(payment_status_override)) {
      payment_status_override = null;
    }
    if (body.payment_status !== undefined) {
      const ps = String(body.payment_status || '').toLowerCase();
      if (!MOTICO_PAYMENT_STATUSES.has(ps)) {
        return res.status(400).json({ error: 'Estado de pago no válido' });
      }
      payment_status_override = ps;
    }

    let total_a_pagar_override = cur.total_a_pagar_override != null ? Number(cur.total_a_pagar_override) : null;
    if (total_a_pagar_override != null && !Number.isFinite(total_a_pagar_override)) total_a_pagar_override = null;
    let anticipo_kovo_explicit = cur.anticipo_kovo_explicit === true;
    let pago_al_recibir_override =
      cur.pago_al_recibir_override != null ? Number(cur.pago_al_recibir_override) : 0;
    if (!Number.isFinite(pago_al_recibir_override) || pago_al_recibir_override < 0) pago_al_recibir_override = 0;
    if (body.pago_al_recibir_override !== undefined) {
      const recv = Number(body.pago_al_recibir_override);
      if (!Number.isFinite(recv) || recv < 0) {
        return res.status(400).json({ error: 'Pago al recibir no válido' });
      }
      pago_al_recibir_override = recv;
      anticipo_kovo_explicit = true;
    }
    let pagado_al_recibir_override =
      cur.pagado_al_recibir_override != null ? Number(cur.pagado_al_recibir_override) : 0;
    if (!Number.isFinite(pagado_al_recibir_override) || pagado_al_recibir_override < 0) {
      pagado_al_recibir_override = 0;
    }
    if (body.pagado_al_recibir_override !== undefined) {
      const paid = Number(body.pagado_al_recibir_override);
      if (!Number.isFinite(paid) || paid < 0) {
        return res.status(400).json({ error: 'Pagado al recibir no válido' });
      }
      pagado_al_recibir_override = paid;
    }
    if (body.total_a_pagar_override !== undefined) {
      if (body.total_a_pagar_override === null) total_a_pagar_override = null;
      else {
        const bal = Number(body.total_a_pagar_override);
        if (!Number.isFinite(bal) || bal < 0) {
          return res.status(400).json({ error: 'Total a pagar no válido' });
        }
        total_a_pagar_override = bal;
      }
    }
    let line_items_override_json = cur.line_items_override_json;
    if (typeof line_items_override_json === 'string') {
      try {
        line_items_override_json = JSON.parse(line_items_override_json);
      } catch {
        line_items_override_json = null;
      }
    }
    let shipping_address_override = cur.shipping_address_override;
    if (typeof shipping_address_override === 'string') {
      try {
        shipping_address_override = JSON.parse(shipping_address_override);
      } catch {
        shipping_address_override = null;
      }
    }
    if (body.line_items !== undefined) {
      if (body.line_items === null) {
        line_items_override_json = null;
      } else if (!Array.isArray(body.line_items)) {
        return res.status(400).json({ error: 'line_items debe ser un arreglo o null' });
      } else if (body.line_items.length === 0) {
        line_items_override_json = null;
      } else {
        const parsedLines = parseShopifyOrderLineItemsOverrideFromBody(body.line_items);
        if (!parsedLines) {
          return res.status(400).json({ error: 'Envía al menos una línea de producto válida (título y cantidad).' });
        }
        line_items_override_json = parsedLines;
        const sumQ = parsedLines.reduce((acc, li) => acc + li.quantity, 0);
        if (Number.isFinite(sumQ) && sumQ > 0) quantity_override = sumQ;
      }
    }

    const prevUnifiedDespacho = mergeDisplayedOrderEstado(cur.internal_status, cur.motico_status);
    const nextUnifiedDespacho = mergeDisplayedOrderEstado(internal_status, motico_status);
    const shouldStampLastDespachado =
      nextUnifiedDespacho === 'despachado' && prevUnifiedDespacho !== 'despachado';
    const lastDespachadoParam = shouldStampLastDespachado ? new Date() : null;

    const insertSql = `INSERT INTO shopify_order_local_fields (organization_id, shopify_order_id, internal_status, price_override, quantity_override, mensajero, motico_status, payment_status_override, pago_al_recibir_override, pagado_al_recibir_override, total_a_pagar_override, shipping_address_override, line_items_override_json, last_despachado_at, anticipo_kovo_explicit, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16)
       ON CONFLICT (organization_id, shopify_order_id) DO UPDATE SET
         internal_status = EXCLUDED.internal_status,
         price_override = EXCLUDED.price_override,
         quantity_override = EXCLUDED.quantity_override,
         mensajero = EXCLUDED.mensajero,
         motico_status = EXCLUDED.motico_status,
         payment_status_override = EXCLUDED.payment_status_override,
         pago_al_recibir_override = EXCLUDED.pago_al_recibir_override,
         anticipo_kovo_explicit = EXCLUDED.anticipo_kovo_explicit,
         pagado_al_recibir_override = EXCLUDED.pagado_al_recibir_override,
         total_a_pagar_override = EXCLUDED.total_a_pagar_override,
         shipping_address_override = EXCLUDED.shipping_address_override,
         line_items_override_json = EXCLUDED.line_items_override_json,
         last_despachado_at = COALESCE(EXCLUDED.last_despachado_at, shopify_order_local_fields.last_despachado_at),
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`;
    const insertParams = [
      req.organizationId,
      orderId,
      internal_status,
      price_override,
      quantity_override,
      mensajero,
      motico_status,
      payment_status_override,
      pago_al_recibir_override,
      pagado_al_recibir_override,
      total_a_pagar_override,
      shipping_address_override && typeof shipping_address_override === 'object'
        ? JSON.stringify(shipping_address_override)
        : null,
      line_items_override_json && typeof line_items_override_json === 'object'
        ? JSON.stringify(line_items_override_json)
        : null,
      lastDespachadoParam,
      anticipo_kovo_explicit,
      req.user.userId,
    ];

    await pool.query(insertSql, insertParams);
    await appendOrderChangeLog(req, {
      orderSource: 'shopify',
      orderId,
      action: 'update_local_fields',
      payload: {
        internal_status,
        motico_status,
        payment_status_override,
        price_override,
        quantity_override,
        mensajero,
        pago_al_recibir_override,
        anticipo_kovo_explicit,
        pagado_al_recibir_override,
        total_a_pagar_override,
        has_line_items: !!(line_items_override_json && typeof line_items_override_json === 'object'),
        has_shipping_override: !!(shipping_address_override && typeof shipping_address_override === 'object'),
      },
    });

    res.json({
      ok: true,
      internal_status,
      price_override,
      quantity_override,
      mensajero,
      motico_status,
      payment_status_override,
      financial_status: payment_status_override || null,
      label: payment_status_override ? mapFinancialToBadge(payment_status_override).label : null,
      badgeVariant: payment_status_override ? mapFinancialToBadge(payment_status_override).variant : null,
      pago_al_recibir_override,
      anticipo_kovo_explicit,
      pagado_al_recibir_override,
      total_a_pagar_override,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al guardar campos del pedido' });
  }
});

app.get('/api/shopify/orders/:orderId/audit-log', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const orderIdRaw = parseInt(String(req.params.orderId), 10);
    if (!Number.isFinite(orderIdRaw) || orderIdRaw === 0) {
      return res.status(400).json({ error: 'ID de pedido inválido' });
    }
    const orderSource = orderIdRaw < 0 ? 'motico_manual' : 'shopify';
    const normalizedOrderId = orderIdRaw < 0 ? -orderIdRaw : orderIdRaw;
    const { rows } = await pool.query(
      `SELECT id, order_source, order_id, action, user_id, user_name, user_email, user_role, payload, created_at
       FROM order_change_logs
       WHERE organization_id = $1 AND order_source = $2 AND order_id = $3
       ORDER BY created_at DESC
       LIMIT 150`,
      [req.organizationId, orderSource, normalizedOrderId],
    );
    return res.json({
      logs: rows.map((r) => ({
        id: Number(r.id),
        order_source: String(r.order_source || ''),
        order_id: Number(r.order_id),
        action: String(r.action || ''),
        user_id: r.user_id != null ? Number(r.user_id) : null,
        user_name: String(r.user_name || ''),
        user_email: String(r.user_email || ''),
        user_role: String(r.user_role || ''),
        payload: r.payload && typeof r.payload === 'object' ? r.payload : {},
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      })),
    });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.json({ logs: [] });
    }
    console.error('[shopify/orders/:orderId/audit-log]', e);
    return res.status(500).json({ error: 'Error al cargar historial del pedido' });
  }
});

app.put(
  '/api/shopify/orders/:orderId/shipping-address',
  verifyToken,
  scopeToOrganization,
  async (req, res) => {
    try {
      const orderId = parseInt(String(req.params.orderId), 10);
      if (!Number.isFinite(orderId) || orderId === 0) {
        return res.status(400).json({ error: 'ID de pedido inválido' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const allowed = ['province', 'city', 'address1', 'address2', 'zip', 'country', 'phone'];
      const updates = {};
      for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(body, k)) {
          updates[k] = body[k] == null ? '' : String(body[k]);
        }
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Envía al menos un campo de dirección (province, city, address1, …)' });
      }
      if (orderId < 0) {
        const manualId = -orderId;
        const { rows } = await pool.query(
          `SELECT shipping_json, client_name, motico_status, financial_status FROM motico_manual_orders WHERE id = $1 AND organization_id = $2`,
          [manualId, req.organizationId],
        );
        if (!rows.length) {
          return res.status(404).json({ error: 'Pedido manual no encontrado' });
        }
        const manualStatus =
          rows[0].motico_status != null && String(rows[0].motico_status) !== ''
            ? String(rows[0].motico_status)
            : MOTICO_STATUS_DEFAULT;
        if (LOCKED_MOTICO_STATUSES.has(manualStatus)) {
          return res.status(409).json({ error: 'El pedido está bloqueado (despachado/cancelado) y no se puede modificar.' });
        }
        let ship = rows[0].shipping_json;
        if (typeof ship === 'string') {
          try {
            ship = JSON.parse(ship);
          } catch {
            ship = {};
          }
        }
        if (!ship || typeof ship !== 'object') ship = {};
        const merged = { ...ship };
        merged.name = String(merged.name || rows[0].client_name || '');
        merged.address1 = String(merged.address1 || '');
        merged.address2 = String(merged.address2 || '');
        merged.city = String(merged.city || '');
        merged.province = String(merged.province || '');
        merged.zip = String(merged.zip || '');
        merged.country = String(merged.country || '');
        merged.phone = String(merged.phone || '');
        for (const k of allowed) {
          if (Object.prototype.hasOwnProperty.call(updates, k)) merged[k] = updates[k];
        }
        await pool.query(
          `UPDATE motico_manual_orders SET shipping_json = $1::jsonb, updated_at = now() WHERE id = $2 AND organization_id = $3`,
          [JSON.stringify(merged), manualId, req.organizationId],
        );
        await appendOrderChangeLog(req, {
          orderSource: 'motico_manual',
          orderId: manualId,
          action: 'update_shipping_address',
          payload: {
            fields: Object.keys(updates),
            shipping_address_override: merged,
          },
        });
        const s = merged;
        return res.json({
          ok: true,
          shippingAddress: {
            name: String(s.name || ''),
            address1: String(s.address1 || ''),
            address2: String(s.address2 || ''),
            city: String(s.city || ''),
            province: String(s.province || ''),
            zip: String(s.zip || ''),
            country: String(s.country || ''),
            phone: String(s.phone || ''),
          },
        });
      }
      const { rows: lockRows } = await pool.query(
        `SELECT motico_status, payment_status_override, shipping_address_override
         FROM shopify_order_local_fields
         WHERE organization_id = $1 AND shopify_order_id = $2
         LIMIT 1`,
        [req.organizationId, orderId],
      );
      const lockedStatus =
        lockRows[0]?.motico_status != null && String(lockRows[0].motico_status) !== ''
          ? String(lockRows[0].motico_status)
          : MOTICO_STATUS_DEFAULT;
      if (LOCKED_MOTICO_STATUSES.has(lockedStatus)) {
        return res.status(409).json({ error: 'El pedido está bloqueado (despachado/cancelado) y no se puede modificar.' });
      }
      const { rows: internalLockRows } = await pool.query(
        `SELECT internal_status
         FROM shopify_order_local_fields
         WHERE organization_id = $1 AND shopify_order_id = $2
         LIMIT 1`,
        [req.organizationId, orderId],
      );
      const internalLockedStatus =
        internalLockRows[0]?.internal_status != null && String(internalLockRows[0].internal_status) !== ''
          ? String(internalLockRows[0].internal_status)
          : 'sin_revisar';
      if (LOCKED_INTERNAL_STATUSES.has(internalLockedStatus)) {
        return res.status(409).json({ error: 'El pedido está bloqueado (despachado/cancelado) y no se puede modificar.' });
      }
      let prevOv = lockRows[0]?.shipping_address_override;
      if (typeof prevOv === 'string') {
        try {
          prevOv = JSON.parse(prevOv);
        } catch {
          prevOv = {};
        }
      }
      if (!prevOv || typeof prevOv !== 'object') prevOv = {};
      const mergedOv = { ...prevOv };
      for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(updates, k)) mergedOv[k] = updates[k];
      }
      await pool.query(
        `INSERT INTO shopify_order_local_fields (organization_id, shopify_order_id, internal_status, motico_status, shipping_address_override, updated_by)
         VALUES ($1, $2, 'sin_revisar', 'sin_revisar', $3::jsonb, $4)
         ON CONFLICT (organization_id, shopify_order_id) DO UPDATE SET
           shipping_address_override = EXCLUDED.shipping_address_override,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [req.organizationId, orderId, JSON.stringify(mergedOv), req.user.userId],
      );
      await appendOrderChangeLog(req, {
        orderSource: 'shopify',
        orderId,
        action: 'update_shipping_address',
        payload: {
          fields: Object.keys(updates),
          shipping_address_override: mergedOv,
        },
      });
      const s = mergedOv;
      res.json({
        ok: true,
        shippingAddress: {
          name: String(s.name || ''),
          address1: String(s.address1 || ''),
          address2: String(s.address2 || ''),
          city: String(s.city || ''),
          province: String(s.province || ''),
          zip: String(s.zip || ''),
          country: String(s.country || ''),
          phone: String(s.phone || ''),
        },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar la dirección de envío' });
    }
  },
);

app.get('/api/motico/relacion-pagos/estados', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT order_ref, estado_pago, pagos_por_nequi, updated_at
       FROM motico_relacion_pago_estado
       WHERE organization_id = $1`,
      [req.organizationId],
    );
    res.json({ rows });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error: 'Falta la tabla motico_relacion_pago_estado. Reinicia el backend para ejecutar initDb.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al leer estados de relación de pagos' });
  }
});

app.put('/api/motico/relacion-pagos/estado', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const orderRef = String(body.order_ref || '').trim();
    const estadoPago = String(body.estado_pago || '').trim();
    if (!orderRef || !MOTICO_RELACION_PAGO_ESTADOS.has(estadoPago)) {
      return res.status(400).json({ error: 'order_ref o estado_pago no válido' });
    }
    if (!/^shopify:\d+$/.test(orderRef) && !/^motico_manual:\d+$/.test(orderRef)) {
      return res.status(400).json({ error: 'order_ref debe ser shopify:<id> o motico_manual:<id>' });
    }
    const uid = req.user?.userId || null;
    const ins = await pool.query(
      `INSERT INTO motico_relacion_pago_estado (organization_id, order_ref, estado_pago, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, order_ref)
       DO UPDATE SET
         estado_pago = EXCLUDED.estado_pago,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
       RETURNING order_ref, estado_pago, updated_at`,
      [req.organizationId, orderRef, estadoPago, uid],
    );
    res.json(ins.rows[0] || { order_ref: orderRef, estado_pago: estadoPago });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error: 'Falta la tabla motico_relacion_pago_estado. Reinicia el backend para ejecutar initDb.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al guardar estado de pago' });
  }
});

app.put('/api/motico/relacion-pagos/pagos-nequi', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const orderRef = String(body.order_ref || '').trim();
    if (!/^shopify:\d+$/.test(orderRef) && !/^motico_manual:\d+$/.test(orderRef)) {
      return res.status(400).json({ error: 'order_ref debe ser shopify:<id> o motico_manual:<id>' });
    }
    let pagos = body.pagos_por_nequi;
    if (typeof pagos === 'string') {
      const t = String(pagos).trim().replace(/\s/g, '');
      pagos = Number.parseFloat(t.replace(/\./g, '').replace(',', '.'));
    } else {
      pagos = Number(pagos);
    }
    if (!Number.isFinite(pagos) || pagos < 0) pagos = 0;
    const uid = req.user?.userId || null;
    const ins = await pool.query(
      `INSERT INTO motico_relacion_pago_estado (organization_id, order_ref, estado_pago, pagos_por_nequi, updated_by)
       VALUES ($1, $2, 'pendiente_pago', $3, $4)
       ON CONFLICT (organization_id, order_ref)
       DO UPDATE SET
         pagos_por_nequi = EXCLUDED.pagos_por_nequi,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
       RETURNING order_ref, pagos_por_nequi, estado_pago, updated_at`,
      [req.organizationId, orderRef, pagos, uid],
    );
    res.json(ins.rows[0] || { order_ref: orderRef, pagos_por_nequi: pagos });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error: 'Falta la tabla motico_relacion_pago_estado. Reinicia el backend para ejecutar initDb.',
        code: 'schema_missing',
      });
    }
    if (e && e.code === '42703') {
      return res.status(503).json({
        error: 'Falta la columna pagos_por_nequi. Reinicia el backend para ejecutar initDb.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al guardar pagos por Nequi' });
  }
});

app.get('/api/motico/settings', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT logo_data_url, default_currency, updated_at FROM motico_org_settings WHERE organization_id = $1`,
      [req.organizationId],
    );
    res.json({
      logo_data_url: rows[0]?.logo_data_url || null,
      default_currency: rows[0]?.default_currency || 'COP',
      updated_at: rows[0]?.updated_at || null,
    });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error: 'Falta la tabla motico_org_settings. Reinicia el backend para ejecutar initDb.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al leer ajustes Motico' });
  }
});

app.put('/api/motico/settings', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const hasLogo = Object.prototype.hasOwnProperty.call(body, 'logo_data_url');
    const hasCurrency = Object.prototype.hasOwnProperty.call(body, 'default_currency');
    if (!hasLogo && !hasCurrency) {
      return res.status(400).json({ error: 'Envía logo_data_url y/o default_currency' });
    }

    let logo = null;
    if (hasLogo) {
      const raw = body.logo_data_url;
      if (raw !== null && raw !== '') {
        if (typeof raw !== 'string' || raw.length > 600000) {
          return res.status(400).json({ error: 'Logo demasiado grande (máx. ~450 KB en base64)' });
        }
        if (!/^data:image\/(png|jpeg|jpg);base64,/i.test(raw)) {
          return res.status(400).json({ error: 'Formato no válido: usa PNG o JPEG en base64 (data:image/...)' });
        }
        logo = raw;
      }
    } else {
      const current = await pool.query(
        `SELECT logo_data_url FROM motico_org_settings WHERE organization_id = $1`,
        [req.organizationId],
      );
      logo = current.rows[0]?.logo_data_url || null;
    }

    const allowedCurrencies = new Set(['COP', 'USD', 'EUR', 'MXN', 'PEN', 'CLP', 'ARS']);
    let defaultCurrency = 'COP';
    if (hasCurrency) {
      const rawCurrency = String(body.default_currency || '')
        .trim()
        .toUpperCase();
      if (!allowedCurrencies.has(rawCurrency)) {
        return res.status(400).json({ error: 'default_currency inválida' });
      }
      defaultCurrency = rawCurrency;
    } else {
      const current = await pool.query(
        `SELECT default_currency FROM motico_org_settings WHERE organization_id = $1`,
        [req.organizationId],
      );
      defaultCurrency = String(current.rows[0]?.default_currency || 'COP')
        .trim()
        .toUpperCase();
      if (!allowedCurrencies.has(defaultCurrency)) defaultCurrency = 'COP';
    }

    await pool.query(
      `INSERT INTO motico_org_settings (organization_id, logo_data_url, default_currency, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (organization_id) DO UPDATE SET
         logo_data_url = EXCLUDED.logo_data_url,
         default_currency = EXCLUDED.default_currency,
         updated_at = now()`,
      [req.organizationId, logo, defaultCurrency],
    );
    res.json({ ok: true, logo_data_url: logo, default_currency: defaultCurrency });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error: 'Falta la tabla motico_org_settings. Reinicia el backend para ejecutar initDb.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al guardar logo Motico' });
  }
});

/** Pedido solo en KOVO / Motico (no crea pedido en Shopify). Aparece en Motico con id negativo. */
app.post('/api/motico/manual-orders', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const client_name = String(body.client_name || '').trim();
    const product_summary_in = String(body.product_summary || '').trim();
    if (!client_name) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
    }
    const total = Number.parseFloat(String(body.total != null ? body.total : '').replace(',', '.'));
    if (!Number.isFinite(total) || total < 0) {
      return res.status(400).json({ error: 'Total no válido' });
    }
    const anticipoRaw = body.anticipo != null ? String(body.anticipo).replace(',', '.').trim() : '';
    const anticipo = anticipoRaw === '' ? 0 : Number.parseFloat(anticipoRaw);
    if (!Number.isFinite(anticipo) || anticipo < 0) {
      return res.status(400).json({ error: 'Pago anticipado no válido' });
    }
    const line_items_in = Array.isArray(body.line_items) ? body.line_items : [];
    const note = String(body.note || '').trim().slice(0, 500);
    const parsedLines = [];
    for (const raw of line_items_in) {
      if (!raw || typeof raw !== 'object') continue;
      const li = raw;
      const title = String(li.title || li.name || '').trim();
      if (!title) continue;
      const q = parseInt(String(li.quantity != null ? li.quantity : '1'), 10);
      if (!Number.isFinite(q) || q < 1) continue;
      parsedLines.push({
        product_id: li.product_id != null ? Number(li.product_id) || null : null,
        variant_id: li.variant_id != null ? Number(li.variant_id) || null : null,
        title,
        variant_title: String(li.variant_title || '').trim(),
        sku: String(li.sku || '').trim(),
        barcode: String(li.barcode || '').trim(),
        quantity: q,
      });
    }
    if (!parsedLines.length && !product_summary_in) {
      return res.status(400).json({ error: 'Selecciona al menos un producto del inventario' });
    }
    const qtyFallback = parseInt(String(body.quantity != null ? body.quantity : '1'), 10);
    const qty = parsedLines.length
      ? parsedLines.reduce((acc, li) => acc + li.quantity, 0)
      : Number.isFinite(qtyFallback) && qtyFallback > 0
        ? qtyFallback
        : 1;
    const fin = String(body.financial_status || 'pending').toLowerCase();
    const allowedFin = new Set([
      'paid',
      'pending',
      'unpaid',
      'partially_paid',
      'authorized',
      'voided',
      'refunded',
      'double_freight',
      'cancelado',
    ]);
    const financial_status = allowedFin.has(fin) ? fin : 'pending';

    let currency = String(body.currency || '').trim();
    if (!currency) {
      const shopRow = await getActiveShopifyConnection(req.organizationId);
      if (shopRow) {
        const sr = await shopifyRequest(shopRow.shop_domain, shopRow.access_token, 'shop.json?fields=currency');
        if (sr.ok && sr.data && sr.data.shop && sr.data.shop.currency) {
          currency = String(sr.data.shop.currency).trim();
        }
      }
    }
    if (!currency) currency = 'USD';

    const client_email = String(body.client_email || '').trim().slice(0, 320);
    const province = String(body.province || '').trim();
    const city = String(body.city || '').trim();
    const address1 = String(body.address1 || '').trim();
    const address2 = String(body.address2 || '').trim();
    const zip = String(body.zip || '').trim();
    const country = String(body.country || '').trim();
    const phone = String(body.phone || '').trim();
    const rawCreated = body.created_at != null ? String(body.created_at).trim() : '';
    let assignedDateYmd = null;
    if (rawCreated) {
      const parsed = parseIsoDateYmd(rawCreated.slice(0, 10));
      if (parsed) assignedDateYmd = gananciaDiariaYmdKey(parsed);
    }

    const shipping_json = {
      name: client_name,
      province,
      city,
      address1,
      address2,
      zip,
      country,
      phone,
      assigned_date: assignedDateYmd,
    };
    const unitPrice = qty > 0 ? Math.round((total / qty) * 10000) / 10000 : total;
    const line_items_json = parsedLines.length
      ? parsedLines.map((li, idx) => ({
          id: idx + 1,
          product_id: li.product_id,
          variant_id: li.variant_id,
          title: li.title,
          variant_title: li.variant_title,
          sku: li.sku,
          barcode: li.barcode,
          quantity: li.quantity,
          price: String(unitPrice),
          properties: idx === 0 && note ? [{ name: 'Observacion', value: note }] : [],
        }))
      : [
          {
            id: 1,
            title: product_summary_in || 'Producto',
            quantity: qty,
            price: String(unitPrice),
            properties: note ? [{ name: 'Observacion', value: note }] : [],
          },
        ];
    const baseSummary = parsedLines.length
      ? parsedLines
          .map((li) => (li.variant_title ? `${li.title} (${li.variant_title})` : li.title))
          .join(' + ')
      : (product_summary_in || 'Producto');
    const product_summary = `${baseSummary}${note ? ` · Observación: ${note}` : ''}`.slice(0, 600);
    const anticipoClamped = Math.min(Math.max(0, anticipo), total);
    const total_outstanding =
      financial_status === 'paid' || financial_status === 'refunded' || financial_status === 'cancelado'
        ? 0
        : Math.max(0, total - anticipoClamped);

    let createdAtParam = null;
    if (rawCreated) {
      const t = Date.parse(rawCreated);
      if (!Number.isFinite(t)) {
        return res.status(400).json({ error: 'Fecha de creación no válida' });
      }
      const now = Date.now();
      if (t > now + 60_000) {
        return res.status(400).json({ error: 'La fecha de creación no puede ser futura' });
      }
      const minMs = now - 10 * 365 * 86400000;
      if (t < minMs) {
        return res.status(400).json({ error: 'La fecha de creación no puede ser anterior a hace 10 años' });
      }
      createdAtParam = new Date(t).toISOString();
    }

    const initialOrderName = 'WHATSAPP_PENDING';
    const { rows: insRows } = await pool.query(
      `INSERT INTO motico_manual_orders (
        organization_id,
        order_name,
        client_name,
        client_email,
        financial_status,
        total_price,
        total_outstanding,
        currency,
        shipping_json,
        product_summary,
        line_items_json,
        created_by,
        motico_status,
        pago_al_recibir_override,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14, COALESCE($15::timestamptz, now()))
      RETURNING *`,
      [
        req.organizationId,
        initialOrderName,
        client_name,
        client_email,
        financial_status,
        total,
        total_outstanding,
        currency,
        JSON.stringify(shipping_json),
        product_summary.slice(0, 600),
        JSON.stringify(line_items_json),
        req.user.userId,
        MOTICO_STATUS_DEFAULT,
        anticipoClamped,
        createdAtParam,
      ],
    );
    const row = insRows[0];
    const finalName = `Whatsapp #${row.id}`;
    await pool.query(
      `UPDATE motico_manual_orders SET order_name = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
      [finalName, row.id, req.organizationId],
    );
    row.order_name = finalName;
    await appendOrderChangeLog(req, {
      orderSource: 'motico_manual',
      orderId: Number(row.id),
      action: 'create_manual_order',
      payload: {
        order_name: finalName,
        client_name,
        financial_status,
        total_price: total,
        quantity: qty,
        currency,
      },
    });

    res.status(201).json({ ok: true, order: mapMoticoManualOrderRowFromDb(row) });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error: 'Falta la tabla motico_manual_orders. Reinicia el backend para ejecutar initDb.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al crear el pedido manual' });
  }
});

/** Elimina pedido manual Motico solo si está en estado "prueba" y se aporta motivo. */
app.delete('/api/motico/manual-orders/:manualId', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const manualId = parseInt(String(req.params.manualId), 10);
    if (!Number.isFinite(manualId) || manualId <= 0) {
      return res.status(400).json({ error: 'ID de pedido manual inválido' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deleteReason = String(body.delete_reason || '').trim();
    if (deleteReason.length < 5) {
      return res.status(400).json({ error: 'Escribe un motivo de eliminación (mínimo 5 caracteres).' });
    }
    const { rows } = await pool.query(
      `SELECT id, motico_status
       FROM motico_manual_orders
       WHERE id = $1 AND organization_id = $2`,
      [manualId, req.organizationId],
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Pedido manual no encontrado' });
    }
    const st = normalizeLegacyMoticoEstadoToUnified(rows[0].motico_status);
    if (st !== 'prueba') {
      return res.status(409).json({ error: 'Solo se pueden eliminar pedidos en estado prueba.' });
    }
    await pool.query(
      `DELETE FROM motico_manual_orders
       WHERE id = $1 AND organization_id = $2`,
      [manualId, req.organizationId],
    );
    return res.json({ ok: true, id: manualId });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.status(503).json({
        error: 'Falta la tabla motico_manual_orders. Reinicia el backend para ejecutar initDb.',
        code: 'schema_missing',
      });
    }
    console.error(e);
    return res.status(500).json({ error: 'Error al eliminar el pedido manual' });
  }
});

app.get('/api/shopify/dashboard', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const srTz = await shopifyRequest(row.shop_domain, row.access_token, 'shop.json?fields=iana_timezone');
    const shopTz =
      srTz.ok && srTz.data && srTz.data.shop && srTz.data.shop.iana_timezone
        ? String(srTz.data.shop.iana_timezone)
        : 'UTC';
    let min = typeof req.query.created_at_min === 'string' ? req.query.created_at_min.trim() : '';
    let max = typeof req.query.created_at_max === 'string' ? req.query.created_at_max.trim() : '';
    if (!min && !max) {
      const ytd = shopifyInformativeOrdersRangeYearToDate(shopTz);
      min = ytd.min;
      max = ytd.max;
    } else if (min && !max) {
      max = shopifyOrderCreatedRangeForMetaPeriod('hoy', shopTz).max;
    } else if (!min && max) {
      const tMax = Date.parse(max);
      const y = shopCalendarYmdFromInstant(Number.isFinite(tMax) ? tMax : Date.now(), shopTz).y;
      min = shopifyOrderCreatedRangeForCalendarDate(shopTz, y, 1, 1).min;
    }
    if (min && max) {
      const c = shopifyClampInformativeCreatedAtRange(shopTz, min, max);
      min = c.min;
      max = c.max;
    }
    const qs = new URLSearchParams();
    qs.set('status', 'any');
    qs.set(
      'fields',
      'id,name,email,created_at,total_price,currency,financial_status,line_items,customer,order_number',
    );
    if (min) qs.set('created_at_min', min);
    if (max) qs.set('created_at_max', max);

    const productIdFilter = req.query.product_id;
    const hasProductFilter = typeof productIdFilter === 'string' && productIdFilter.trim() !== '';

    const r = await shopifyFetchAllOrders(row.shop_domain, row.access_token, qs);
    if (!r.ok) {
      const st = Number(r.status) >= 400 ? Number(r.status) : 502;
      return res.status(Number.isFinite(st) ? st : 502).json({ error: r.error, data: r.data });
    }

    let orders = r.orders || [];
    if (hasProductFilter) {
      const pid = productIdFilter.trim();
      orders = orders.filter((o) =>
        (o.line_items || []).some((li) => String(li.product_id) === pid),
      );
    }

    const ids = orders.map((o) => o.id);
    let localMap;
    try {
      localMap = await loadLocalFieldsMap(req.organizationId, ids);
    } catch (dbErr) {
      if (dbErr && dbErr.code === '42P01') {
        return res.status(503).json({
          error:
            'Falta la tabla shopify_order_local_fields. Reinicia el backend o aplica backend/db/schema.sql.',
          code: 'schema_missing',
        });
      }
      throw dbErr;
    }

    const currency = orders[0]?.currency || 'EUR';
    let salesAll = 0;
    let salesDesp = 0;
    let n = 0;
    let nDesp = 0;
    let nCancel = 0;
    const byDay = new Map();
    /** @type {Map<string, { product_id: number, title: string, sales_total: number, sales_despachados: number, orderIds: Set<number>, despOrderIds: Set<number> }>} */
    const byProduct = new Map();

    for (const o of orders) {
      const lf = localMap.get(Number(o.id)) || {};
      const internal = String(lf.internal_status || 'sin_revisar');
      const price = Number.parseFloat(String(o.total_price ?? 0)) || 0;
      const dayKey = String(o.created_at || '').slice(0, 10);
      const fin = String(o.financial_status || '').toLowerCase();
      const isCancel =
        internal === 'cancelado' || fin === 'voided' || fin === 'refunded';

      salesAll += price;
      n += 1;
      if (internal === 'despachado') {
        salesDesp += price;
        nDesp += 1;
      }
      if (isCancel) nCancel += 1;

      if (dayKey && dayKey.length >= 10) {
        byDay.set(dayKey, (byDay.get(dayKey) || 0) + price);
      }

      const isDesp = internal === 'despachado';
      const oid = Number(o.id);
      for (const li of o.line_items || []) {
        const pid = li.product_id;
        if (pid == null || pid === '') continue;
        const key = String(pid);
        const lineRev =
          (Number.parseFloat(String(li.price ?? 0)) || 0) * (Number.parseInt(String(li.quantity ?? 1), 10) || 0);
        const lineTitle = String(li.name || li.title || `Producto ${key}`).trim() || `Producto ${key}`;
        let pr = byProduct.get(key);
        if (!pr) {
          pr = {
            product_id: Number(pid),
            title: lineTitle,
            sales_total: 0,
            sales_despachados: 0,
            orderIds: new Set(),
            despOrderIds: new Set(),
          };
          byProduct.set(key, pr);
        } else if (lineTitle.length > pr.title.length) {
          pr.title = lineTitle;
        }
        pr.sales_total += lineRev;
        pr.orderIds.add(oid);
        if (isDesp) {
          pr.sales_despachados += lineRev;
          pr.despOrderIds.add(oid);
        }
      }
    }

    const chart = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));

    const recent = orders.slice(0, 8).map((o) => {
      const customer = o.customer || {};
      const client =
        [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || 'Invitado';
      const fb = mapFinancialToBadge(o.financial_status);
      return {
        id: o.id,
        orderName: o.name || (o.order_number != null ? `#${o.order_number}` : `#${o.id}`),
        client,
        total: o.total_price,
        currency: o.currency || currency,
        financialLabel: fb.label,
        badgeVariant: fb.variant,
      };
    });

    const top_products = [...byProduct.values()]
      .map((pr) => ({
        product_id: pr.product_id,
        title: pr.title,
        orders_count: pr.orderIds.size,
        orders_despachados: pr.despOrderIds.size,
        sales_total: pr.sales_total,
        sales_despachados: pr.sales_despachados,
      }))
      .sort((a, b) => b.sales_total - a.sales_total)
      .slice(0, 12);

    let ad_spend = null;
    let roas = null;
    let roas_despachado = null;
    const minIso = typeof min === 'string' && min.trim().length >= 10 ? min.trim() : '';
    const maxIso = typeof max === 'string' && max.trim().length >= 10 ? max.trim() : '';
    const sinceDay = minIso.slice(0, 10);
    const untilDay = maxIso.slice(0, 10);

    if (sinceDay && untilDay) {
      try {
        const metaRow = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
        if (metaRow && String(metaRow.access_token || '').trim()) {
          const resolved = resolveAdAccountIdsForRequest(undefined, metaRow.selected_ad_account_ids);
          if (resolved.ok && resolved.actIds.length > 0) {
            const { spend, partialErrors } = await fetchTotalSpendForAdAccountsTimeRange(
              resolved.actIds,
              metaRow.access_token,
              sinceDay,
              untilDay,
            );
            ad_spend = spend;
            if (spend > 0) {
              roas = salesAll / spend;
              roas_despachado = salesDesp / spend;
            }
            if (partialErrors.length > 0 && ad_spend === 0 && resolved.actIds.length === partialErrors.length) {
              ad_spend = null;
              roas = null;
              roas_despachado = null;
            }
          }
        }
      } catch (metaErr) {
        console.error('[shopify/dashboard] meta spend:', metaErr);
      }
    }

    res.json({
      source: 'shopify',
      currency,
      totals: {
        sales_all: salesAll,
        sales_despachados: salesDesp,
        orders_count: n,
        orders_despachados: nDesp,
        despachados_pct: n > 0 ? (nDesp / n) * 100 : 0,
        orders_cancelados: nCancel,
        cancelados_pct: n > 0 ? (nCancel / n) * 100 : 0,
        ad_spend,
        roas,
        roas_despachado,
      },
      chart,
      top_products,
      recent,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al calcular el dashboard' });
  }
});

app.get('/api/shopify/products', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const lim = Math.min(250, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const wantAllVariants = ['1', 'true', 'yes', 'on'].includes(
      String(req.query.all_variants || '')
        .trim()
        .toLowerCase(),
    );
    const r = await shopifyRequest(row.shop_domain, row.access_token, `products.json?limit=${lim}`);
    if (!r.ok) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: r.error, data: r.data });
    }
    const pricingByProductId = new Map();
    try {
      const pricingRes = await pool.query(
        `SELECT shopify_product_id, manual_product_price, manual_avg_freight_price, manual_product_price_motico, manual_avg_freight_price_motico, delivery_effectiveness_pct
         FROM shopify_product_manual_pricing
         WHERE organization_id = $1`,
        [req.organizationId],
      );
      for (const rowPricing of pricingRes.rows) {
        pricingByProductId.set(Number(rowPricing.shopify_product_id), {
          manual_product_price:
            rowPricing.manual_product_price != null ? Number(rowPricing.manual_product_price) : null,
          manual_avg_freight_price:
            rowPricing.manual_avg_freight_price != null ? Number(rowPricing.manual_avg_freight_price) : null,
          manual_product_price_motico:
            rowPricing.manual_product_price_motico != null ? Number(rowPricing.manual_product_price_motico) : null,
          manual_avg_freight_price_motico:
            rowPricing.manual_avg_freight_price_motico != null ? Number(rowPricing.manual_avg_freight_price_motico) : null,
          delivery_effectiveness_pct:
            rowPricing.delivery_effectiveness_pct != null ? Number(rowPricing.delivery_effectiveness_pct) : null,
        });
      }
    } catch (pricingErr) {
      if (!pricingErr || pricingErr.code !== '42P01') {
        throw pricingErr;
      }
    }
    const payload = r.data && typeof r.data === 'object' ? { ...r.data } : { products: [] };
    let products = Array.isArray(payload.products) ? payload.products : [];
    if (wantAllVariants && products.length > 0) {
      const fetchAllVariantsForProduct = async (productId) => {
        const all = [];
        let sinceId = null;
        const MAX_PAGES = 60;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const qs = sinceId != null ? `?limit=250&since_id=${sinceId}` : '?limit=250';
          const vr = await shopifyRequest(row.shop_domain, row.access_token, `products/${productId}/variants.json${qs}`);
          if (!vr.ok) {
            const st = Number(vr.status) >= 400 ? Number(vr.status) : 502;
            throw new Error(`No se pudieron cargar variantes (${st}) para producto ${productId}`);
          }
          const chunk = Array.isArray(vr.data?.variants) ? vr.data.variants : [];
          all.push(...chunk);
          if (chunk.length < 250) break;
          const lastId = Number(chunk[chunk.length - 1]?.id);
          if (!Number.isFinite(lastId) || lastId <= 0) break;
          sinceId = lastId;
        }
        return all;
      };
      products = await Promise.all(
        products.map(async (product) => {
          const pid = Number(product?.id);
          if (!Number.isFinite(pid) || pid <= 0) return product;
          const fullVariants = await fetchAllVariantsForProduct(pid);
          return {
            ...product,
            variants: fullVariants,
          };
        }),
      );
    }
    payload.products = products.map((product) => {
      if (!product || typeof product !== 'object') return product;
      const productId = Number(product.id);
      const manual = pricingByProductId.get(productId) || {
        manual_product_price: null,
        manual_avg_freight_price: null,
        manual_product_price_motico: null,
        manual_avg_freight_price_motico: null,
        delivery_effectiveness_pct: null,
      };
      return {
        ...product,
        manual_product_price: manual.manual_product_price,
        manual_avg_freight_price: manual.manual_avg_freight_price,
        manual_product_price_motico: manual.manual_product_price_motico,
        manual_avg_freight_price_motico: manual.manual_avg_freight_price_motico,
        delivery_effectiveness_pct: manual.delivery_effectiveness_pct,
      };
    });
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

app.get('/api/shopify/products/:productId/variants', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const productId = Number.parseInt(String(req.params.productId || ''), 10);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'ID de producto inválido' });
    }
    const lim = Math.min(250, Math.max(1, parseInt(String(req.query.limit || '250'), 10) || 250));
    const out = [];
    let sinceId = null;
    const MAX_PAGES = 60;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const qs = sinceId != null ? `?limit=${lim}&since_id=${sinceId}` : `?limit=${lim}`;
      const r = await shopifyRequest(row.shop_domain, row.access_token, `products/${productId}/variants.json${qs}`);
      if (!r.ok) {
        return res.status(r.status >= 400 ? r.status : 502).json({ error: r.error, data: r.data });
      }
      const chunk = Array.isArray(r.data?.variants) ? r.data.variants : [];
      out.push(...chunk);
      if (chunk.length < lim) break;
      const lastId = Number(chunk[chunk.length - 1]?.id);
      if (!Number.isFinite(lastId) || lastId <= 0) break;
      sinceId = lastId;
    }
    res.json({ product_id: productId, variants: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener variantes del producto' });
  }
});

app.get('/api/shopify/inventory', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const r = await shopifyRequest(row.shop_domain, row.access_token, 'inventory_levels.json?limit=50');
    if (!r.ok) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: r.error, data: r.data });
    }
    res.json(r.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

app.get('/api/shopify/analytics', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const srTz = await shopifyRequest(row.shop_domain, row.access_token, 'shop.json?fields=iana_timezone');
    const shopTz =
      srTz.ok && srTz.data && srTz.data.shop && srTz.data.shop.iana_timezone
        ? String(srTz.data.shop.iana_timezone)
        : 'UTC';
    const ytd = shopifyInformativeOrdersRangeYearToDate(shopTz);
    const qsPaid = new URLSearchParams();
    qsPaid.set('status', 'paid');
    qsPaid.set('fields', 'id,total_price,currency');
    qsPaid.set('created_at_min', ytd.min);
    qsPaid.set('created_at_max', ytd.max);
    const r = await shopifyFetchAllOrders(row.shop_domain, row.access_token, qsPaid);
    if (!r.ok) {
      const st = Number(r.status) >= 400 ? Number(r.status) : 502;
      return res.status(Number.isFinite(st) ? st : 502).json({ error: r.error, data: r.data });
    }
    const orders = r.orders || [];
    let revenue = 0;
    for (const o of orders) {
      revenue += Number.parseFloat(String(o.total_price ?? 0)) || 0;
    }
    const n = orders.length;
    const currency = n > 0 && orders[0].currency ? orders[0].currency : '';
    res.json({
      orders_count: n,
      revenue,
      aov: n > 0 ? revenue / n : 0,
      currency,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al calcular analítica' });
  }
});

if (hasFrontendDist) {
  /** Evita que index.html quede cacheado (CDN/navegador) y siga cargando bundles viejos tras un deploy. */
  function cacheControlForStatic(absFilePath, res) {
    const rel = path.relative(staticDir, absFilePath).replace(/\\/g, '/');
    if (rel === 'index.html') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }
    if (rel.startsWith('assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }

  app.use(
    express.static(staticDir, {
      setHeaders(res, absPath) {
        cacheControlForStatic(absPath, res);
      },
    }),
  );
  /** React Router (SPA): en Express 5 el path '*' es inválido; el catch-all es una RegExp en app.get/app.head. */
  const spaIndex = path.join(staticDir, 'index.html');
  function sendSpaIfNotApi(req, res, next) {
    if (req.path.startsWith('/api')) {
      return next();
    }
    cacheControlForStatic(spaIndex, res);
    res.sendFile(spaIndex, (err) => next(err));
  }
  app.get(/.*/, sendSpaIfNotApi);
  app.head(/.*/, sendSpaIfNotApi);
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

function logDbStartupError(err) {
  const code = err && err.code;
  const msg = err && err.message ? String(err.message) : String(err);
  console.error('\n--- Error al conectar con PostgreSQL (initDb) ---');
  console.error(msg);
  if (code === 'ENOTFOUND' || msg.includes('getaddrinfo')) {
    console.error(
      '→ DNS: no se resuelve el host. Si el host coincide con el panel (db.<ref>.supabase.co) y sigues en Windows/red solo IPv4, Supabase avisa: la conexión directa puede no ser compatible con IPv4.',
    );
    console.error(
      '→ Solución: en Supabase → Connect → pestaña "Session pooler" o "Transaction" (IPv4) y pega esa URI en DATABASE_URL (suele ser *.pooler.supabase.com y puerto 6543).',
    );
  }
  if (code === '28P01' || /password authentication failed/i.test(msg)) {
    console.error(
      '→ Contraseña o usuario incorrectos. Usa la "Database password" del proyecto; si la contraseña tiene caracteres especiales, codifícala en la URL.',
    );
  }
  if (/SSL|certificate|TLS/i.test(msg)) {
    console.error(
      '→ Revisa SSL: con Supabase no pongas DB_SSL=false salvo Postgres local. La pool usa SSL compatible con Supabase.',
    );
  }
  if (code === 'ECONNREFUSED') {
    console.error('→ Conexión rechazada: puerto mal, firewall o instancia pausada en Supabase.');
  }
  console.error('---\n');
}

async function start() {
  try {
    await initDb(pool);
  } catch (err) {
    logDbStartupError(err);
    console.error(
      '[server] El arranque continúa; si faltan tablas o columnas, corrige schema.sql / DATABASE_URL y reinicia.',
    );
  }

  const oauthTableCheck = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'shopify_oauth_states'
     ) AS ok`,
  );
  if (!oauthTableCheck.rows[0].ok) {
    console.error(
      '[shopify] La tabla public.shopify_oauth_states no existe tras initDb. Ejecuta el SQL de backend/db/schema.sql en la BD de producción o despliega la versión actual del backend y reinicia.',
    );
  }

  const rawShopifySecretEnv = process.env.SHOPIFY_API_SECRET;
  console.log(
    'SHOPIFY_API_SECRET length:',
    rawShopifySecretEnv != null ? String(rawShopifySecretEnv).trim().length : '(env no definida)',
  );
  console.log(
    'SHOPIFY_API_SECRET has spaces:',
    rawShopifySecretEnv != null && String(rawShopifySecretEnv).includes(' '),
  );

  if (shopifyConfigured()) {
    console.log(
      '[shopify] OAuth configurado. SHOPIFY_REDIRECT_URI debe ser exactamente la URL permitida en Partner Dashboard (ej. https://kovo.services/api/shopify/callback):',
      SHOPIFY_REDIRECT_URI,
    );
  } else {
    console.warn('[shopify] OAuth no configurado. Faltan:', shopifyMissingEnvKeys().join(', '));
  }

  const cronTz = META_SNAPSHOT_TIMEZONE;
  cron.schedule(
    '0 7 * * *',
    () => {
      runMetaDailySnapshotCron(pool, META_GRAPH_VERSION, cronTz).catch((e) => console.error('[meta-snapshot-cron]', e));
    },
    { timezone: cronTz },
  );
  console.log(`[meta-snapshot-cron] respaldo diario 07:00 (${cronTz}, guarda métricas Meta del día anterior)`);

  cron.schedule(
    '0 9 * * *',
    () => {
      runEvaluatorTokenRefreshCron(pool, META_GRAPH_VERSION).catch((e) =>
        console.error('[meta-token-cron]', e),
      );
    },
    { timezone: cronTz },
  );
  console.log(`[meta-token-cron] renovación diaria 09:00 (${cronTz}, tokens tipo evaluator)`);

  const backfillEnabled = !['0', 'false', 'no', 'off'].includes(
    String(process.env.META_SNAPSHOT_BACKFILL_ON_START || 'true').trim().toLowerCase(),
  );
  if (backfillEnabled) {
    setTimeout(() => {
      runMetaHistoricalSnapshotBackfill(pool, META_GRAPH_VERSION, cronTz).catch((e) =>
        console.error('[meta-snapshot-backfill]', e),
      );
    }, 12_000);
    console.log('[meta-snapshot-backfill] programado al inicio (12s después del arranque)');
  } else {
    console.log('[meta-snapshot-backfill] desactivado por META_SNAPSHOT_BACKFILL_ON_START');
  }

  const mailInfo = getMailTransportInfo();
  if (mailInfo.configured) {
    console.log(
      `[mail] Envío activo (${mailInfo.transport}). Invitaciones y “olvidé mi contraseña” usan correo si PUBLIC_APP_URL apunta al front.`,
    );
  } else {
    console.warn(
      '[mail] Sin RESEND_API_KEY ni SMTP_HOST/SMTP_USER/SMTP_PASS: no se envían correos. Añade una de las dos opciones (ver backend/.env.example).',
    );
  }

  app.listen(PORT, HOST, () => {
    const where = HOST === '0.0.0.0' ? 'todas las interfaces' : HOST;
    console.log(`Servidor en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (${where})`);
    console.log(`Comprobación de BD: GET http://localhost:${PORT}/api/health`);
  });
}

start().catch(() => {
  process.exit(1);
});
