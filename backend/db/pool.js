const { Pool } = require('pg');

function normalizeConnectionString(raw) {
  if (raw == null) return raw;
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

/** Transaction pooler (6543): node-pg + Supabase recomiendan pgbouncer=true */
function withSupabasePoolerQueryParams(url) {
  if (!url.includes('pooler.supabase.com')) {
    return url;
  }
  if (/[?&]pgbouncer=true\b/i.test(url)) {
    return url;
  }
  if (/:6543(\/|\?|$)/.test(url)) {
    return `${url}${url.includes('?') ? '&' : '?'}pgbouncer=true`;
  }
  return url;
}

function createPool() {
  let connectionString = normalizeConnectionString(process.env.DATABASE_URL || process.env.DB_URL);
  connectionString = withSupabasePoolerQueryParams(connectionString);
  if (!connectionString) {
    throw new Error(
      'Configura DATABASE_URL o DB_URL en .env (raíz del proyecto) o en backend/.env — cadena PostgreSQL (p. ej. Supabase).',
    );
  }

  const ssl =
    process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };

  return new Pool({
    connectionString,
    ssl,
    max: Number(process.env.DB_POOL_MAX || 20),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 15_000),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  });
}

module.exports = { createPool };
