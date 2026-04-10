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
const adspowerClient = require('./adspowerClient');

const JWT_SECRET = process.env.JWT_SECRET || 'kovo-dev-secret-change-in-production';
const JWT_EXPIRES = '7d';
const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_HOURS = 1;
const INVITE_DAYS = 7;

const PLAN_LIMITS = {
  free: { users: 1, metaConnections: 1 },
  pro: { users: 10, metaConnections: 5 },
  enterprise: { users: Infinity, metaConnections: Infinity },
};

const pool = createPool();

function parseCorsOrigins() {
  const devDefaults = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const raw = process.env.CORS_ORIGINS;
  if (!raw || !String(raw).trim()) {
    return devDefaults;
  }
  const fromEnv = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...devDefaults, ...fromEnv])];
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
app.use(express.json());

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
            ? 'El plan gratuito permite solo 1 usuario. Mejora tu plan para invitar al equipo.'
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

async function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  let decoded;
  try {
    decoded = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const { rows } = await pool.query(
    `SELECT u.id as "userId", u.email, u.name, u.created_at, u.organization_id, u.role, u.is_active
     FROM users u
     WHERE u.id = $1`,
    [decoded.userId],
  );
  const row = rows[0];

  if (!row || !row.is_active || !row.organization_id) {
    return res.status(401).json({ error: 'Usuario no válido' });
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
  next();
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
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

function normalizeAdsPowerProfileId(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 128) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return null;
  return s;
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
    limits,
  };
}

function simulateMetaVerify(appId, appSecret, accessToken) {
  const id = String(appId || '').replace(/\s/g, '');
  const secret = String(appSecret || '').trim();
  const token = String(accessToken || '').trim();

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
  if (token.length > 0 && token.length < 30) {
    const e = new Error('token');
    e.code = 'token_expired';
    throw e;
  }
  return { accountName: `Cuenta publicitaria · App ${id.slice(-4)}` };
}

app.get('/', (req, res) => {
  res.send('Backend funcionando 🚀 (PostgreSQL / multi-tenant)');
});

app.get('/api/cookies', (req, res) => {
  res.json({
    ok: true,
    message:
      'Backend respondiendo. Conteo por perfil AdsPower: GET /api/adspower/cookies/count (requiere JWT y perfil configurado).',
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

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[dev] Recuperación contraseña para ${em}: token=${token}. URL: http://localhost:5173/reset-password?token=${token}`,
        );
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
      limits: session.limits,
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

      res.json({
        members,
        invitations,
        limits: await getUsageSnapshot(req.organizationId),
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
      if (!['admin', 'member'].includes(role)) {
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

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[dev] Invitación ${email} rol ${role} token=${token} (aceptación futura; por ahora solo listado)`,
        );
      }

      res.status(201).json({
        ok: true,
        invitation: { email, role, expires_at: expires },
        limits: await getUsageSnapshot(req.organizationId),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al crear la invitación' });
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
      if (!['owner', 'admin', 'member'].includes(newRole)) {
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
        `SELECT id, app_id, status, connected_at, account_name
         FROM meta_connections WHERE organization_id = $1 ORDER BY id DESC`,
        [req.organizationId],
      )
    ).rows;

    const list = rows.map((r) => {
      const digits = String(r.app_id).replace(/\D/g, '');
      const hint = digits.length >= 4 ? `····${digits.slice(-4)}` : '····';
      return {
        id: r.id,
        app_id_hint: hint,
        status: r.status,
        connected_at: r.connected_at,
        account_name: r.account_name,
      };
    });
    res.json({ connections: list, limits: await getUsageSnapshot(req.organizationId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar conexiones' });
  }
});

app.post('/api/meta/connections', verifyToken, scopeToOrganization, async (req, res) => {
  try {
    const appId = String(req.body?.appId || '').trim();
    const appSecret = String(req.body?.appSecret || '').trim();
    const accessToken = req.body?.accessToken ? String(req.body.accessToken).trim() : '';

    const limit = await checkPlanLimit(req.organizationId, 'meta_connection');
    if (!limit.ok) {
      return res.status(403).json({ error: limit.message, code: 'plan_limit' });
    }

    let verified;
    try {
      verified = simulateMetaVerify(appId, appSecret, accessToken || undefined);
    } catch (err) {
      const code = err.code || 'unknown';
      const map = {
        invalid_credentials: 'El App ID o App Secret son incorrectos',
        token_expired: 'El Access Token ha expirado, genera uno nuevo',
      };
      return res.status(400).json({ error: map[code] || 'No se pudo validar', code });
    }

    const ins = await pool.query(
      `INSERT INTO meta_connections
       (organization_id, created_by, app_id, app_secret, access_token, status, connected_at, account_name)
       VALUES ($1, $2, $3, $4, $5, 'connected', now(), $6) RETURNING id, connected_at`,
      [
        req.organizationId,
        req.user.userId,
        appId.replace(/\s/g, ''),
        appSecret,
        accessToken || null,
        verified.accountName,
      ],
    );

    res.status(201).json({
      connection: {
        id: ins.rows[0].id,
        account_name: verified.accountName,
        connected_at: ins.rows[0].connected_at,
        app_id_hint:
          appId.replace(/\D/g, '').length >= 4
            ? `····${appId.replace(/\D/g, '').slice(-4)}`
            : '····',
      },
      limits: await getUsageSnapshot(req.organizationId),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al guardar la conexión' });
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

app.get('/api/adspower/status', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT adspower_profile_id FROM users WHERE id = $1 AND organization_id = $2',
      [req.user.userId, req.user.organizationId],
    );
    const row = rows[0];
    const profileId = row?.adspower_profile_id ? String(row.adspower_profile_id).trim() : '';
    res.json({
      configured: Boolean(profileId),
      profileId: profileId || null,
      apiBaseHint: adspowerClient.getBaseUrl(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo leer la configuración de AdsPower' });
  }
});

app.put('/api/adspower/profile', verifyToken, async (req, res) => {
  try {
    const profileId = normalizeAdsPowerProfileId(req.body?.profileId);
    if (!profileId) {
      return res.status(400).json({
        error:
          'Profile ID no válido. Usa el identificador del perfil en AdsPower (solo letras, números, guiones y guión bajo; máx. 128).',
      });
    }
    const result = await pool.query(
      'UPDATE users SET adspower_profile_id = $1 WHERE id = $2 AND organization_id = $3',
      [profileId, req.user.userId, req.user.organizationId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ ok: true, profileId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar el perfil de AdsPower' });
  }
});

app.delete('/api/adspower/profile', verifyToken, async (req, res) => {
  try {
    await pool.query('UPDATE users SET adspower_profile_id = NULL WHERE id = $1 AND organization_id = $2', [
      req.user.userId,
      req.user.organizationId,
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar la vinculación' });
  }
});

app.get('/api/adspower/cookies/count', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT adspower_profile_id FROM users WHERE id = $1 AND organization_id = $2',
      [req.user.userId, req.user.organizationId],
    );
    const profileId = rows[0]?.adspower_profile_id
      ? String(rows[0].adspower_profile_id).trim()
      : '';
    if (!profileId) {
      return res.status(400).json({
        error: 'No tienes un perfil de AdsPower configurado. Guarda tu Profile ID primero.',
        code: 'not_configured',
      });
    }
    const result = await adspowerClient.getProfileCookieCount(profileId);
    if (!result.ok) {
      return res.status(502).json({
        error: result.error,
        detail: result.detail,
        status: result.status,
      });
    }
    res.json({ count: result.count, profileId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al consultar cookies en AdsPower' });
  }
});

const staticDir = process.env.STATIC_DIR || path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(staticDir, 'index.html'), (err) => next(err));
  });
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
    throw err;
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
