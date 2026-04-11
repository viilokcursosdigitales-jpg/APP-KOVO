/**
 * Migración opcional (legado): backend/data/kovo.sqlite → PostgreSQL.
 *
 * Solo hace falta si ya tenías datos en SQLite y quieres pasarlos a la nueva BD.
 * Si nunca usaste SQLite o no existe `data/kovo.sqlite`, no ejecutes este script:
 * el servidor crea el esquema y datos mínimos con `initDb` al arrancar.
 *
 * Requiere: DATABASE_URL o DB_URL (p. ej. Supabase). La BD puede estar vacía o
 *   tener ya el mismo esquema; los INSERT usan ON CONFLICT para ser re-ejecutables.
 * Dependencia: better-sqlite3 (en devDependencies del backend o `npm install better-sqlite3`).
 *
 * Uso: npm run migrate:sqlite --prefix backend
 *   o: node scripts/migrate-sqlite-to-pg.js  (desde la carpeta backend)
 */
const path = require('path');
require(path.join(__dirname, '..', 'loadEnv')).loadEnv();
const fs = require('fs');
const { Pool } = require('pg');
const { createPool } = require('../db/pool');
const { runSchemaStatements } = require('../db/initDb');

const sqlitePath = path.join(__dirname, '..', 'data', 'kovo.sqlite');
if (!fs.existsSync(sqlitePath)) {
  console.log(
    '[migrate-sqlite-to-pg] No hay archivo SQLite; migración omitida (es opcional).\n' +
      `  Ruta esperada: ${sqlitePath}\n` +
      '  Si solo usas PostgreSQL, arranca el backend y deja que initDb prepare el esquema.',
  );
  process.exit(0);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('Instala better-sqlite3: npm install better-sqlite3');
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const pool = createPool();

function toTs(val) {
  if (val == null || val === '') return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function run() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await runSchemaStatements(pool, schema);

  const orgs = sqlite.prepare('SELECT * FROM organizations ORDER BY id').all();
  for (const o of orgs) {
    await pool.query(
      `INSERT INTO organizations (id, name, slug, plan, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, slug = EXCLUDED.slug, plan = EXCLUDED.plan`,
      [o.id, o.name, o.slug, o.plan, toTs(o.created_at)],
    );
  }

  const users = sqlite.prepare('SELECT * FROM users ORDER BY id').all();
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (
         id, name, email, password_hash, created_at, reset_token, reset_token_expires,
         organization_id, role, is_active
       ) VALUES (
         $1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $7::timestamptz,
         $8, $9, $10
       )
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
         organization_id = EXCLUDED.organization_id, role = EXCLUDED.role, is_active = EXCLUDED.is_active`,
      [
        u.id,
        u.name,
        u.email,
        u.password_hash,
        toTs(u.created_at),
        u.reset_token || null,
        toTs(u.reset_token_expires),
        u.organization_id ?? null,
        u.role || 'member',
        Boolean(u.is_active === 1 || u.is_active === true),
      ],
    );
  }

  const invites = sqlite.prepare('SELECT * FROM invitations ORDER BY id').all();
  for (const i of invites) {
    await pool.query(
      `INSERT INTO invitations (
         id, organization_id, email, role, token, expires_at, invited_by, created_at, accepted_at
       ) VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, COALESCE($8::timestamptz, now()), $9::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        i.id,
        i.organization_id,
        i.email,
        i.role,
        i.token,
        toTs(i.expires_at),
        i.invited_by,
        toTs(i.created_at),
        i.accepted_at ? toTs(i.accepted_at) : null,
      ],
    );
  }

  const metas = sqlite.prepare('SELECT * FROM meta_connections ORDER BY id').all();
  for (const m of metas) {
    await pool.query(
      `INSERT INTO meta_connections (
         id, organization_id, created_by, app_id, app_secret, access_token, status, connected_at, account_name, selected_ad_account_ids
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9, COALESCE($10::jsonb, '[]'::jsonb))
       ON CONFLICT (id) DO NOTHING`,
      [
        m.id,
        m.organization_id,
        m.created_by ?? null,
        m.app_id,
        m.app_secret,
        m.access_token || null,
        m.status || 'connected',
        toTs(m.connected_at),
        m.account_name || null,
        m.selected_ad_account_ids != null
          ? typeof m.selected_ad_account_ids === 'string'
            ? m.selected_ad_account_ids
            : JSON.stringify(m.selected_ad_account_ids)
          : '[]',
      ],
    );
  }

  const orders = sqlite.prepare('SELECT * FROM orders ORDER BY id').all();
  for (const ord of orders) {
    await pool.query(
      `INSERT INTO orders (id, organization_id, cliente, total, estado)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [ord.id, ord.organization_id, ord.cliente, ord.total, ord.estado],
    );
  }

  const tables = ['organizations', 'users', 'invitations', 'meta_connections', 'orders'];
  for (const t of tables) {
    const r = await pool.query(`SELECT MAX(id) AS m FROM ${t}`);
    const m = r.rows[0].m;
    if (m == null) continue;
    const sq = await pool.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [t]);
    const seqName = sq.rows[0].s;
    if (seqName) {
      await pool.query('SELECT setval($1::regclass, $2)', [seqName, m]);
    }
  }

  console.log('Migración completada.');
  await pool.end();
  sqlite.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
