#!/usr/bin/env node
require('../loadEnv').loadEnv();

const SHOPIFY_API_KEY = String(process.env.SHOPIFY_API_KEY || '23fbda83063d6cb677699efeb2cacab0').trim();
const SHOPIFY_API_SECRET = String(process.env.SHOPIFY_API_SECRET || '').trim();
const PARTNER_ACCESS_TOKEN = String(process.env.SHOPIFY_PARTNER_ACCESS_TOKEN || '').trim();
const PARTNER_APP_ID = String(process.env.SHOPIFY_PARTNER_APP_ID || '').trim();
const PARTNER_API_VERSION = String(process.env.SHOPIFY_PARTNER_API_VERSION || '2025-10').trim();
const PARTNER_API_URL = `https://partners.shopify.com/api/${PARTNER_API_VERSION}/graphql.json`;

const GDPR_WEBHOOKS = [
  {
    topic: 'customers/data_request',
    uri: 'https://kovo.services/webhooks/customers/data_request',
  },
  {
    topic: 'customers/redact',
    uri: 'https://kovo.services/webhooks/customers/redact',
  },
  {
    topic: 'shop/redact',
    uri: 'https://kovo.services/webhooks/shop/redact',
  },
];

async function partnerGraphqlRequest(query, variables = {}) {
  const res = await fetch(PARTNER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': PARTNER_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  return { ok: res.ok, status: res.status, data: json };
}

function printStatuses(status, extra = {}) {
  for (const hook of GDPR_WEBHOOKS) {
    console.log(
      `[gdpr webhook] ${hook.topic} -> ${hook.uri} | status=${status}${extra.reason ? ` | reason=${extra.reason}` : ''}`,
    );
  }
}

async function main() {
  console.log('[gdpr webhook] Inicio de registro de webhooks de cumplimiento');
  console.log('[gdpr webhook] API key:', SHOPIFY_API_KEY || '(vacía)');

  if (!SHOPIFY_API_SECRET) {
    console.error('[gdpr webhook] Falta SHOPIFY_API_SECRET en entorno.');
    process.exitCode = 1;
    return;
  }

  if (!PARTNER_ACCESS_TOKEN) {
    console.error(
      '[gdpr webhook] Falta SHOPIFY_PARTNER_ACCESS_TOKEN. No se puede consultar Shopify Partner GraphQL.',
    );
    printStatuses('error', { reason: 'missing_partner_token' });
    process.exitCode = 1;
    return;
  }

  if (!PARTNER_APP_ID) {
    console.error(
      '[gdpr webhook] Falta SHOPIFY_PARTNER_APP_ID (gid de la app en Partner GraphQL, ej: gid://partners/App/123456).',
    );
    printStatuses('error', { reason: 'missing_partner_app_id' });
    process.exitCode = 1;
    return;
  }

  // Smoke test de autenticación/alcance en Partner API.
  const smoke = await partnerGraphqlRequest(
    `
      query AppBasicInfo($id: ID!) {
        app(id: $id) {
          id
          title
          apiKey
        }
      }
    `,
    { id: PARTNER_APP_ID },
  );

  if (!smoke.ok || !smoke.data || smoke.data.errors) {
    console.error('[gdpr webhook] Error consultando Partner API:', {
      httpStatus: smoke.status,
      errors: smoke.data && smoke.data.errors ? smoke.data.errors : null,
    });
    printStatuses('error', { reason: 'partner_api_unreachable_or_unauthorized' });
    process.exitCode = 1;
    return;
  }

  const app = smoke.data.data && smoke.data.data.app ? smoke.data.data.app : null;
  console.log('[gdpr webhook] App encontrada en Partner API:', app ? app.title : '(sin título)');

  /**
   * Shopify no expone una mutación pública en Admin REST/GraphQL ni Partner GraphQL
   * para crear/actualizar los topics de cumplimiento obligatorios:
   * - customers/data_request
   * - customers/redact
   * - shop/redact
   *
   * Estos se configuran en app config (shopify.app.toml) y se publican con deploy,
   * o desde opciones equivalentes en el dashboard cuando están disponibles.
   */
  printStatuses('unsupported_by_api', { reason: 'shopify_requires_app_config_for_compliance_topics' });
  console.log(
    '[gdpr webhook] Resultado: no se registraron vía API porque Shopify exige configuración de app para compliance topics.',
  );
}

main().catch((err) => {
  console.error('[gdpr webhook] Error inesperado:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
