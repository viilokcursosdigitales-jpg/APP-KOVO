const fs = require('fs');
const path = require('path');

function slugify(str) {
  return (
    String(str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workspace'
  );
}

async function uniqueSlug(pool, base) {
  let s = slugify(base);
  let n = 0;
  for (;;) {
    const r = await pool.query('SELECT 1 FROM organizations WHERE slug = $1', [s]);
    if (r.rowCount === 0) return s;
    n += 1;
    s = `${slugify(base)}-${n}`;
  }
}

/**
 * Ejecuta el SQL del esquema en sentencias sueltas (necesario con Supabase Transaction pooler / PgBouncer).
 */
async function runSchemaStatements(pool, sql) {
  const parts = sql.split(';').map((chunk) =>
    chunk
      .split('\n')
      .filter((line) => !/^\s*--/.test(line))
      .join('\n')
      .trim(),
  );
  for (const stmt of parts) {
    if (stmt.length > 0) {
      await pool.query(stmt);
    }
  }
}

/**
 * Crea tablas y aplica migraciones lógicas (usuarios sin org, pedidos demo).
 * @param {import('pg').Pool} pool
 */
async function initDb(pool) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await runSchemaStatements(pool, sql);

  await pool.query(`
    ALTER TABLE meta_connections
    ADD COLUMN IF NOT EXISTS selected_ad_account_ids JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE meta_connections
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE meta_connections
    ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'evaluator'
  `);
  await pool.query(`
    ALTER TABLE meta_connections
    ADD COLUMN IF NOT EXISTS disconnect_reason TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_connections (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      shop_domain VARCHAR(255) NOT NULL,
      access_token TEXT NOT NULL,
      scope TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'connected',
      installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, shop_domain)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_shopify_connections_org ON shopify_connections (organization_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_shopify_connections_shop ON shopify_connections (shop_domain)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_oauth_states (
      state TEXT PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      shop_domain VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_shopify_oauth_states_expires ON shopify_oauth_states (expires_at)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_order_local_fields (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      shopify_order_id BIGINT NOT NULL,
      internal_status VARCHAR(32) NOT NULL DEFAULT 'sin_confirmar',
      price_override NUMERIC(14, 4),
      quantity_override INTEGER,
      mensajero VARCHAR(32),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, shopify_order_id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_shopify_order_local_org ON shopify_order_local_fields (organization_id)`,
  );

  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'shopify_oauth_states'
    ) AS table_exists
  `);
  console.log('shopify_oauth_states existe:', tableCheck.rows[0].table_exists);

  const { rows: orphans } = await pool.query(
    'SELECT * FROM users WHERE organization_id IS NULL',
  );
  for (const u of orphans) {
    const orgName = `${(u.name || 'Usuario').split(' ')[0]} — empresa`;
    const slug = await uniqueSlug(pool, orgName);
    const ins = await pool.query(
      `INSERT INTO organizations (name, slug, plan) VALUES ($1, $2, 'free') RETURNING id`,
      [orgName, slug],
    );
    const orgId = ins.rows[0].id;
    await pool.query(
      `UPDATE users SET organization_id = $1, role = 'owner' WHERE id = $2`,
      [orgId, u.id],
    );
  }

  await pool.query(
    `UPDATE users SET role = 'owner'
     WHERE organization_id IS NOT NULL AND (role IS NULL OR role = '')`,
  );

  const { rows: orgs } = await pool.query('SELECT id FROM organizations');
  for (const o of orgs) {
    const c = await pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE organization_id = $1', [
      o.id,
    ]);
    if (c.rows[0].n === 0) {
      await pool.query(
        `INSERT INTO orders (organization_id, cliente, total, estado) VALUES
         ($1, 'Carlos', 120, 'Pagado'),
         ($1, 'Ana', 80, 'Pendiente'),
         ($1, 'Luis', 200, 'Pagado')`,
        [o.id],
      );
    }
  }
}

module.exports = { initDb, uniqueSlug, slugify, runSchemaStatements };
