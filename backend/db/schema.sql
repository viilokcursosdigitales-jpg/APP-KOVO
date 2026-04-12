-- PostgreSQL (Supabase). Ejecutar con initDb o psql.

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reset_token TEXT,
  reset_token_expires TIMESTAMPTZ,
  organization_id INTEGER REFERENCES organizations (id) ON DELETE SET NULL,
  role TEXT DEFAULT 'member',
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by INTEGER NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meta_connections (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  app_id TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  token_type TEXT NOT NULL DEFAULT 'evaluator',
  disconnect_reason TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_name TEXT,
  selected_ad_account_ids JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  cliente TEXT NOT NULL,
  total DOUBLE PRECISION NOT NULL,
  estado TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users (organization_id);
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_invitations_organization_id ON invitations (organization_id);
CREATE INDEX IF NOT EXISTS idx_orders_organization_id ON orders (organization_id);

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
);

CREATE INDEX IF NOT EXISTS idx_shopify_connections_org ON shopify_connections (organization_id);
CREATE INDEX IF NOT EXISTS idx_shopify_connections_shop ON shopify_connections (shop_domain);

CREATE TABLE IF NOT EXISTS shopify_oauth_states (
  state TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  shop_domain VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_oauth_states_expires ON shopify_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS shopify_order_local_fields (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  shopify_order_id BIGINT NOT NULL,
  internal_status VARCHAR(32) NOT NULL DEFAULT 'sin_confirmar',
  price_override NUMERIC(14, 4),
  quantity_override INTEGER,
  mensajero VARCHAR(32),
  motico_status VARCHAR(32) NOT NULL DEFAULT 'confirmado',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_order_local_org ON shopify_order_local_fields (organization_id);

CREATE TABLE IF NOT EXISTS meta_campaign_product_links (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  meta_campaign_id TEXT NOT NULL,
  product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, meta_campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_links_org ON meta_campaign_product_links (organization_id);

CREATE TABLE IF NOT EXISTS organization_custom_roles (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  slug VARCHAR(64) NOT NULL,
  label VARCHAR(120) NOT NULL,
  base_role VARCHAR(16) NOT NULL CHECK (base_role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_org_custom_roles_org ON organization_custom_roles (organization_id);

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
);

CREATE INDEX IF NOT EXISTS idx_shopify_mkt_targets_org ON shopify_product_marketing_targets (organization_id);

CREATE TABLE IF NOT EXISTS motico_org_settings (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  logo_data_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
