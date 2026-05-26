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
 * Quita primero las líneas que empiezan por --; si no, un ; dentro de un comentario rompe el split por `;`.
 */
async function runSchemaStatements(pool, sql) {
  const withoutLineComments = String(sql)
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  const parts = withoutLineComments.split(';').map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
  for (const stmt of parts) {
    await pool.query(stmt);
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

  try {
    await pool.query(`ALTER TABLE calculadora_cod_calculos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
    await pool.query(`UPDATE calculadora_cod_calculos SET updated_at = created_at WHERE updated_at IS NULL`);
    await pool.query(`ALTER TABLE calculadora_cod_calculos ALTER COLUMN updated_at SET DEFAULT now()`);
    await pool.query(`ALTER TABLE calculadora_cod_calculos ALTER COLUMN updated_at SET NOT NULL`);
  } catch (e) {
    if (e && e.code !== '42P01') {
      console.warn('[initDb] calculadora_cod_calculos.updated_at:', e && e.message);
    }
  }

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

  try {
    await pool.query(`
      ALTER TABLE meta_connections
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `);
  } catch (e) {
    if (e && e.code !== '42701') {
      console.warn('[initDb] meta_connections.updated_at:', e && e.message);
    }
  }

  try {
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS hotmart_email TEXT`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_activated_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ`);
    await pool.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial'`,
    );
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shopify_form_ingest_token_hash TEXT`);
    await pool.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shopify_form_ingest_token_rotated_at TIMESTAMPTZ`,
    );
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_shopify_form_ingest_token_hash
       ON organizations (shopify_form_ingest_token_hash)
       WHERE shopify_form_ingest_token_hash IS NOT NULL`,
    );
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shopify_shop_domain VARCHAR(255)`);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_organizations_shopify_shop_domain
       ON organizations (lower(shopify_shop_domain))
       WHERE shopify_shop_domain IS NOT NULL`,
    );
    await pool.query(
      `UPDATE organizations o
       SET shopify_shop_domain = sc.shop_domain
       FROM shopify_connections sc
       WHERE sc.organization_id = o.id
         AND sc.status = 'connected'
         AND o.shopify_shop_domain IS NULL`,
    );
    await pool.query(
      `ALTER TABLE organizations
       DROP CONSTRAINT IF EXISTS organizations_subscription_status_check`,
    );
    await pool.query(
      `ALTER TABLE organizations
       ADD CONSTRAINT organizations_subscription_status_check
       CHECK (subscription_status IN ('trial', 'active', 'expired'))`,
    );
  } catch (e) {
    console.error('[initDb] organizations subscription columns:', e && e.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_content (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL CHECK (type IN ('banner', 'alert', 'news')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        image_url TEXT,
        link_url TEXT,
        link_text TEXT,
        color VARCHAR(20) NOT NULL DEFAULT 'blue' CHECK (color IN ('green', 'yellow', 'red', 'blue')),
        active BOOLEAN NOT NULL DEFAULT true,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_content_active_order ON dashboard_content (active, order_index, id)`,
    );
  } catch (e) {
    console.error('[initDb] dashboard_content table:', e && e.message);
  }

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
      internal_status VARCHAR(32) NOT NULL DEFAULT 'sin_revisar',
      price_override NUMERIC(14, 4),
      quantity_override INTEGER,
      mensajero VARCHAR(32),
      motico_status VARCHAR(32) NOT NULL DEFAULT 'sin_revisar',
      updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, shopify_order_id)
    )
  `);
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS motico_status VARCHAR(32) DEFAULT 'sin_revisar'`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ALTER COLUMN internal_status SET DEFAULT 'sin_revisar'`,
  );
  await pool.query(
    `UPDATE shopify_order_local_fields SET motico_status = 'sin_revisar' WHERE motico_status IS NULL`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ALTER COLUMN motico_status SET DEFAULT 'sin_revisar'`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS total_a_pagar_override NUMERIC(14, 4)`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS payment_status_override VARCHAR(32)`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS pago_al_recibir_override NUMERIC(14, 4) NOT NULL DEFAULT 0`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS pagado_al_recibir_override NUMERIC(14, 4) NOT NULL DEFAULT 0`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_shopify_order_local_org ON shopify_order_local_fields (organization_id)`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS shipping_address_override JSONB`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS line_items_override_json JSONB`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS last_despachado_at TIMESTAMPTZ`,
  );
  await pool.query(
    `ALTER TABLE shopify_order_local_fields ADD COLUMN IF NOT EXISTS anticipo_kovo_explicit BOOLEAN NOT NULL DEFAULT FALSE`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_campaign_product_links (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      meta_campaign_id TEXT NOT NULL,
      product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, meta_campaign_id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_meta_campaign_links_org ON meta_campaign_product_links (organization_id)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_product_marketing_targets (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      shopify_product_id BIGINT NOT NULL,
      cpm_target NUMERIC(14, 4),
      ctr_target NUMERIC(14, 4),
      cpc_target NUMERIC(14, 4),
      roas_target NUMERIC(14, 4),
      cpa_target NUMERIC(14, 4),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, shopify_product_id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_shopify_mkt_targets_org ON shopify_product_marketing_targets (organization_id)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_ad_spend_entries (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      spend_date DATE NOT NULL,
      platform VARCHAR(32) NOT NULL CHECK (platform IN ('meta', 'tiktok', 'google', 'otros')),
      shopify_product_id BIGINT NOT NULL,
      product_title VARCHAR(500) NOT NULL,
      amount NUMERIC(14, 2) NOT NULL,
      currency VARCHAR(8) NOT NULL DEFAULT 'COP',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_marketing_ad_spend_org_date
     ON marketing_ad_spend_entries (organization_id, spend_date DESC)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_product_manual_pricing (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      shopify_product_id BIGINT NOT NULL,
      manual_product_price NUMERIC(14, 4),
      manual_avg_freight_price NUMERIC(14, 4),
      manual_product_price_motico NUMERIC(14, 4),
      manual_avg_freight_price_motico NUMERIC(14, 4),
      delivery_effectiveness_pct NUMERIC(7, 4),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, shopify_product_id)
    )
  `);
  await pool.query(
    `ALTER TABLE shopify_product_manual_pricing ADD COLUMN IF NOT EXISTS delivery_effectiveness_pct NUMERIC(7, 4)`,
  );
  await pool.query(
    `ALTER TABLE shopify_product_manual_pricing ADD COLUMN IF NOT EXISTS manual_product_price_motico NUMERIC(14, 4)`,
  );
  await pool.query(
    `ALTER TABLE shopify_product_manual_pricing ADD COLUMN IF NOT EXISTS manual_avg_freight_price_motico NUMERIC(14, 4)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_shopify_manual_pricing_org ON shopify_product_manual_pricing (organization_id)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS motico_org_settings (
      organization_id INTEGER PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
      logo_data_url TEXT,
      default_currency VARCHAR(8) NOT NULL DEFAULT 'COP',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `ALTER TABLE motico_org_settings ADD COLUMN IF NOT EXISTS default_currency VARCHAR(8) NOT NULL DEFAULT 'COP'`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS motico_manual_orders (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      order_name VARCHAR(64) NOT NULL,
      client_name VARCHAR(255) NOT NULL DEFAULT '',
      client_email VARCHAR(320) NOT NULL DEFAULT '',
      financial_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      total_price NUMERIC(14, 4) NOT NULL DEFAULT 0,
      total_outstanding NUMERIC(14, 4),
      currency VARCHAR(8) NOT NULL DEFAULT '',
      shipping_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      product_summary VARCHAR(600) NOT NULL DEFAULT '',
      line_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      price_override NUMERIC(14, 4),
      quantity_override INTEGER,
      motico_status VARCHAR(32) NOT NULL DEFAULT 'sin_revisar',
      pago_al_recibir_override NUMERIC(14, 4) NOT NULL DEFAULT 0,
      total_a_pagar_override NUMERIC(14, 4)
    )
  `);
  await pool.query(
    `ALTER TABLE motico_manual_orders ADD COLUMN IF NOT EXISTS pago_al_recibir_override NUMERIC(14, 4) NOT NULL DEFAULT 0`,
  );
  await pool.query(
    `ALTER TABLE motico_manual_orders ALTER COLUMN motico_status SET DEFAULT 'sin_revisar'`,
  );
  await pool.query(
    `ALTER TABLE motico_manual_orders ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users (id) ON DELETE SET NULL`,
  );
  await pool.query(
    `ALTER TABLE motico_manual_orders ADD COLUMN IF NOT EXISTS last_despachado_at TIMESTAMPTZ`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_motico_manual_org_created ON motico_manual_orders (organization_id, created_at DESC)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS motico_relacion_pago_estado (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      order_ref VARCHAR(96) NOT NULL,
      estado_pago VARCHAR(32) NOT NULL DEFAULT 'pendiente_pago'
        CHECK (estado_pago IN ('pendiente_pago', 'pagado', 'cancelado', 'devolucion')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      UNIQUE (organization_id, order_ref)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_motico_relacion_pago_org ON motico_relacion_pago_estado (organization_id)`,
  );
  await pool.query(
    `ALTER TABLE motico_relacion_pago_estado ADD COLUMN IF NOT EXISTS pagos_por_nequi NUMERIC(14, 4) NOT NULL DEFAULT 0`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_change_logs (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      order_source VARCHAR(32) NOT NULL CHECK (order_source IN ('shopify', 'motico_manual')),
      order_id BIGINT NOT NULL,
      action VARCHAR(64) NOT NULL,
      user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
      user_name TEXT,
      user_email TEXT,
      user_role VARCHAR(64),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_order_change_logs_org_order
     ON order_change_logs (organization_id, order_source, order_id, created_at DESC)`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_role_commissions (
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      role_slug VARCHAR(64) NOT NULL,
      commission_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, role_slug)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_org_role_commissions_org
     ON organization_role_commissions (organization_id)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_custom_roles (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      slug VARCHAR(64) NOT NULL,
      label VARCHAR(120) NOT NULL,
      base_role VARCHAR(16) NOT NULL CHECK (base_role IN ('admin', 'member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, slug)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_org_custom_roles_org ON organization_custom_roles (organization_id)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_role_modules (
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      role_slug VARCHAR(64) NOT NULL,
      full_access BOOLEAN NOT NULL DEFAULT true,
      modules JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, role_slug)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_org_role_modules_org ON organization_role_modules (organization_id)`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commission_payment_cuts (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      cut_kind VARCHAR(20) NOT NULL CHECK (cut_kind IN ('first_half', 'second_half', 'first_partial')),
      commission_total NUMERIC(14, 4) NOT NULL DEFAULT 0,
      ventas_despachadas_total NUMERIC(14, 4) NOT NULL DEFAULT 0,
      payment_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
      paid_at TIMESTAMPTZ,
      payment_proof_rel_path TEXT,
      updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, period_start, period_end)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_commission_payment_cuts_org_end ON commission_payment_cuts (organization_id, period_end DESC)`,
  );
  await pool.query(`ALTER TABLE commission_payment_cuts ADD COLUMN IF NOT EXISTS payment_proof_rel_path TEXT`);

  try {
    await pool.query(`ALTER TABLE commission_payment_cuts DROP CONSTRAINT IF EXISTS commission_payment_cuts_cut_kind_check`);
    await pool.query(
      `ALTER TABLE commission_payment_cuts ADD CONSTRAINT commission_payment_cuts_cut_kind_check CHECK (cut_kind IN ('first_half', 'second_half', 'first_partial'))`,
    );
  } catch (e) {
    console.warn('[initDb] commission_payment_cuts cut_kind check:', e && e.message);
  }

  try {
    await pool.query(`ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check`);
  } catch (e) {
    console.warn('[initDb] invitations_role_check:', e && e.message);
  }

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
      `INSERT INTO organizations (name, slug, plan, trial_started_at, subscription_status, subscription_expires_at)
       VALUES ($1, $2, 'free', now(), 'active', now() + interval '30 days')
       RETURNING id`,
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

  await pool.query(
    `UPDATE organizations
     SET trial_started_at = COALESCE(trial_started_at, now()),
         subscription_status = 'active',
         subscription_expires_at = COALESCE(subscription_expires_at, now() + interval '30 days'),
         last_payment_at = COALESCE(last_payment_at, now())
     WHERE subscription_status IS NULL OR subscription_status <> 'active' OR subscription_expires_at IS NULL`,
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
