const path = require('path');
const dotenv = require('dotenv');

/**
 * Carga `.env` en la raíz del monorepo y luego `backend/.env`.
 * Con la API por defecto de dotenv, las variables ya definidas no se sobrescriben:
 * lo que quede fijado en el primer archivo tiene prioridad para claves repetidas.
 */
function maskConnectionUrl() {
  const raw = process.env.DATABASE_URL || process.env.DB_URL;
  if (!raw) {
    return '(no definida; usa DATABASE_URL o DB_URL)';
  }
  // postgresql://user:password@host:port/db  → enmascarar userinfo antes de @
  return raw.replace(/:([^:@/]+)@/, ':****@');
}

function loadEnv() {
  const rootEnv = path.join(__dirname, '..', '.env');
  const backendEnv = path.join(__dirname, '.env');

  dotenv.config({ path: rootEnv });
  dotenv.config({ path: backendEnv });

  if (process.env.LOG_ENV_DEBUG === '1' || process.env.NODE_ENV !== 'production') {
    console.log('[env] DATABASE_URL (enmascarada):', maskConnectionUrl());
    console.log('[env] Archivos revisados:', rootEnv, '|', backendEnv);
  }

  const raw = process.env.DATABASE_URL || process.env.DB_URL;
  return { hasDatabaseUrl: Boolean(raw) };
}

module.exports = { loadEnv, maskConnectionUrl };
