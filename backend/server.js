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
  normalizeActId,
  datePresetFromDashboardPeriod,
  listAdAccounts,
  fetchInsightsForAdAccount,
  filterValidAdAccountIds,
  fetchFunnelForAdAccounts,
  fetchTotalSpendForAdAccountsTimeRange,
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
  shopifySyncFirstLineItemQuantityAndPrice,
  shopifyUpdateOrderShippingAddress,
  registerUninstallWebhook,
  normalizeShopifyOrdersForApp,
  mapFinancialToBadge,
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

/** Slugs de módulos configurables (sidebar); perfil y configuración no se restringen aquí. */
const CONFIGURABLE_MODULE_IDS = [
  'dashboard',
  'pedidos',
  'motico',
  'inventario',
  'meta_ads',
  'indicadores_marketing',
  'canales',
];

const MODULE_CATALOG_FOR_API = [
  { id: 'dashboard', label: 'Dashboard', group: 'Principal' },
  { id: 'pedidos', label: 'Pedidos', group: 'Principal' },
  { id: 'motico', label: 'Motico', group: 'Principal' },
  { id: 'inventario', label: 'Inventario', group: 'Principal' },
  { id: 'meta_ads', label: 'Meta Ads', group: 'Marketing' },
  { id: 'indicadores_marketing', label: 'Indicadores', group: 'Marketing' },
  { id: 'canales', label: 'Canales', group: 'Marketing' },
];

const pool = createPool();

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
    const id = String(x || '').trim();
    if (!id || seen.has(id) || !CONFIGURABLE_MODULE_IDS.includes(id)) continue;
    seen.add(id);
    out.push(id);
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
        return res.status(400).json({ error: 'El nivel debe ser admin o member' });
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
        return res.status(400).json({ error: 'Se esperaba entries: array' });
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
          return res.status(400).json({ error: `Rol no válido en entries: ${slug || '(vacío)'}` });
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
    const level = ['campaigns', 'adsets', 'ads'].includes(String(req.query.level))
      ? String(req.query.level)
      : 'campaigns';
    const period = String(req.query.period || 'hoy');
    const datePreset = datePresetFromDashboardPeriod(period);

    const row = await ensureValidMetaTokenForOrg(pool, META_GRAPH_VERSION, req.organizationId);
    if (!row || !String(row.access_token || '').trim()) {
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

    res.json({
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

function parseMarketingTargetNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
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

const SHOPIFY_INTERNAL_STATUSES = new Set(['sin_confirmar', 'confirmado', 'despachado', 'cancelado']);
const SHOPIFY_MENSAJEROS = new Set(['motico', 'dropi', 'effix']);
const SHOPIFY_MOTICO_STATUSES = new Set([
  'confirmado',
  'imprimir_guia',
  'despachado',
  'cancelado',
  'pagado',
  'pendiente_pago',
  'devolucion',
]);

const SHOPIFY_ORDER_LIST_FIELDS =
  'id,name,phone,email,created_at,total_price,currency,financial_status,fulfillment_status,customer,order_number,line_items,shipping_address,billing_address';

async function loadLocalFieldsMap(organizationId, orderIds) {
  if (!orderIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT shopify_order_id, internal_status, price_override, quantity_override, mensajero, motico_status
     FROM shopify_order_local_fields WHERE organization_id = $1 AND shopify_order_id = ANY($2::bigint[])`,
    [organizationId, orderIds],
  );
  const m = new Map();
  for (const r of rows) m.set(Number(r.shopify_order_id), r);
  return m;
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
    const limit = Math.min(250, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('status', 'any');
    qs.set('fields', SHOPIFY_ORDER_LIST_FIELDS);
    const min = req.query.created_at_min;
    const max = req.query.created_at_max;
    if (typeof min === 'string' && min.trim()) qs.set('created_at_min', min.trim());
    if (typeof max === 'string' && max.trim()) qs.set('created_at_max', max.trim());
    const r = await shopifyRequest(row.shop_domain, row.access_token, `orders.json?${qs.toString()}`);
    if (!r.ok) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: r.error, data: r.data });
    }
    const normalized = normalizeShopifyOrdersForApp(r.data);
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
      const moticoRaw = lf?.motico_status;
      const motico_status =
        typeof moticoRaw === 'string' && SHOPIFY_MOTICO_STATUSES.has(moticoRaw) ? moticoRaw : 'confirmado';
      return {
        ...o,
        internal_status: lf?.internal_status || 'sin_confirmar',
        price_override:
          lf?.price_override != null && lf.price_override !== '' ? Number(lf.price_override) : null,
        quantity_override:
          lf?.quantity_override != null && lf.quantity_override !== '' ? Number(lf.quantity_override) : null,
        mensajero: lf?.mensajero || null,
        motico_status,
        shopifyTotal: o.total,
        shopifyQuantity: o.defaultQuantity,
      };
    });
    const mensajeroFilter = typeof req.query.mensajero_filter === 'string' ? req.query.mensajero_filter.trim().toLowerCase() : '';
    if (mensajeroFilter === 'motico') {
      orders = orders.filter((o) => o.mensajero === 'motico');
    }
    const productIdQ = typeof req.query.product_id === 'string' ? req.query.product_id.trim() : '';
    if (productIdQ) {
      const want = Number(productIdQ);
      if (Number.isFinite(want)) {
        orders = orders.filter((o) => Array.isArray(o.productIds) && o.productIds.includes(want));
      }
    }
    res.json({
      source: 'shopify',
      shop_domain: row.shop_domain,
      fetchedAt: new Date().toISOString(),
      orders,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

app.put('/api/shopify/orders/:orderId/local-fields', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const orderId = parseInt(String(req.params.orderId), 10);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'ID de pedido inválido' });
    }
    const conn = await getActiveShopifyConnection(req.organizationId);
    if (!conn) {
      return res.status(400).json({ error: 'No hay tienda conectada', code: 'not_connected' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { rows: existing } = await pool.query(
      `SELECT internal_status, price_override, quantity_override, mensajero, motico_status
       FROM shopify_order_local_fields WHERE organization_id = $1 AND shopify_order_id = $2`,
      [req.organizationId, orderId],
    );
    const cur = existing[0] || {};
    let internal_status = cur.internal_status || 'sin_confirmar';
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
    let motico_status =
      cur.motico_status != null && String(cur.motico_status) !== ''
        ? String(cur.motico_status)
        : 'confirmado';
    if (!SHOPIFY_MOTICO_STATUSES.has(motico_status)) motico_status = 'confirmado';
    if (body.motico_status !== undefined) {
      const ms = String(body.motico_status);
      if (!SHOPIFY_MOTICO_STATUSES.has(ms)) {
        return res.status(400).json({ error: 'Estado Motico no válido' });
      }
      motico_status = ms;
    }

    const insertSql = `INSERT INTO shopify_order_local_fields (organization_id, shopify_order_id, internal_status, price_override, quantity_override, mensajero, motico_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, shopify_order_id) DO UPDATE SET
         internal_status = EXCLUDED.internal_status,
         price_override = EXCLUDED.price_override,
         quantity_override = EXCLUDED.quantity_override,
         mensajero = EXCLUDED.mensajero,
         motico_status = EXCLUDED.motico_status,
         updated_at = now()`;
    const insertParams = [
      req.organizationId,
      orderId,
      internal_status,
      price_override,
      quantity_override,
      mensajero,
      motico_status,
    ];

    const syncToShopify = body.sync_to_shopify === true;
    if (syncToShopify) {
      if (price_override == null || quantity_override == null) {
        return res.status(400).json({
          error: 'Para sincronizar con Shopify envía precio y cantidad explícitos (no vacíos).',
        });
      }
      const unit = Number(price_override) / Number(quantity_override);
      if (!Number.isFinite(unit) || unit < 0) {
        return res.status(400).json({ error: 'Precio o cantidad no válidos para calcular precio unitario' });
      }
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');
        await dbClient.query(insertSql, insertParams);
        const syncRes = await shopifySyncFirstLineItemQuantityAndPrice(
          conn.shop_domain,
          conn.access_token,
          orderId,
          quantity_override,
          unit,
        );
        if (!syncRes.ok) {
          await dbClient.query('ROLLBACK');
          return res.status(422).json({
            error: syncRes.error || 'Shopify rechazó la actualización del pedido',
          });
        }
        await dbClient.query('COMMIT');
      } catch (txErr) {
        try {
          await dbClient.query('ROLLBACK');
        } catch {
          /* noop */
        }
        throw txErr;
      } finally {
        dbClient.release();
      }
    } else {
      await pool.query(insertSql, insertParams);
    }

    res.json({
      ok: true,
      internal_status,
      price_override,
      quantity_override,
      mensajero,
      motico_status,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al guardar campos del pedido' });
  }
});

app.put(
  '/api/shopify/orders/:orderId/shipping-address',
  verifyToken,
  scopeToOrganization,
  async (req, res) => {
    try {
      const orderId = parseInt(String(req.params.orderId), 10);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ error: 'ID de pedido inválido' });
      }
      const conn = await getActiveShopifyConnection(req.organizationId);
      if (!conn) {
        return res.status(400).json({ error: 'No hay tienda conectada', code: 'not_connected' });
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
      const r = await shopifyUpdateOrderShippingAddress(conn.shop_domain, conn.access_token, orderId, updates);
      if (!r.ok) {
        return res.status(422).json({ error: r.error || 'No se pudo actualizar la dirección en Shopify' });
      }
      const s = r.shippingAddress;
      res.json({
        ok: true,
        shippingAddress: s
          ? {
              name: String(s.name || ''),
              address1: String(s.address1 || ''),
              address2: String(s.address2 || ''),
              city: String(s.city || ''),
              province: String(s.province || ''),
              zip: String(s.zip || ''),
              country: String(s.country || ''),
              phone: String(s.phone || ''),
            }
          : null,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar la dirección de envío' });
    }
  },
);

app.get('/api/motico/settings', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT logo_data_url, updated_at FROM motico_org_settings WHERE organization_id = $1`,
      [req.organizationId],
    );
    res.json({
      logo_data_url: rows[0]?.logo_data_url || null,
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
    if (!Object.prototype.hasOwnProperty.call(body, 'logo_data_url')) {
      return res.status(400).json({ error: 'logo_data_url requerido (o null para quitar)' });
    }
    const raw = body.logo_data_url;
    let logo = null;
    if (raw !== null && raw !== '') {
      if (typeof raw !== 'string' || raw.length > 600000) {
        return res.status(400).json({ error: 'Logo demasiado grande (máx. ~450 KB en base64)' });
      }
      if (!/^data:image\/(png|jpeg|jpg);base64,/i.test(raw)) {
        return res.status(400).json({ error: 'Formato no válido: usa PNG o JPEG en base64 (data:image/...)' });
      }
      logo = raw;
    }
    await pool.query(
      `INSERT INTO motico_org_settings (organization_id, logo_data_url, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (organization_id) DO UPDATE SET
         logo_data_url = EXCLUDED.logo_data_url,
         updated_at = now()`,
      [req.organizationId, logo],
    );
    res.json({ ok: true, logo_data_url: logo });
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

app.get('/api/shopify/dashboard', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const row = await getActiveShopifyConnection(req.organizationId);
    if (!row) {
      return res.status(400).json({ error: 'No hay tienda Shopify conectada', code: 'not_connected' });
    }
    const limit = 250;
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('status', 'any');
    qs.set(
      'fields',
      'id,name,email,created_at,total_price,currency,financial_status,line_items,customer,order_number',
    );
    const min = req.query.created_at_min;
    const max = req.query.created_at_max;
    if (typeof min === 'string' && min.trim()) qs.set('created_at_min', min.trim());
    if (typeof max === 'string' && max.trim()) qs.set('created_at_max', max.trim());

    const productIdFilter = req.query.product_id;
    const hasProductFilter = typeof productIdFilter === 'string' && productIdFilter.trim() !== '';

    const r = await shopifyRequest(row.shop_domain, row.access_token, `orders.json?${qs.toString()}`);
    if (!r.ok) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: r.error, data: r.data });
    }

    let orders = (r.data && r.data.orders) || [];
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
      const internal = String(lf.internal_status || 'sin_confirmar');
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
    const r = await shopifyRequest(row.shop_domain, row.access_token, `products.json?limit=${lim}`);
    if (!r.ok) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: r.error, data: r.data });
    }
    res.json(r.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener productos' });
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
    const r = await shopifyRequest(row.shop_domain, row.access_token, 'orders.json?status=paid&limit=250');
    if (!r.ok) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: r.error, data: r.data });
    }
    const orders = (r.data && r.data.orders) || [];
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

  const cronTz = process.env.CRON_TZ || 'Europe/Madrid';
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
