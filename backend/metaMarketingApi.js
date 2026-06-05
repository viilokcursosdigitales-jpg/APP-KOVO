'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const metaApiContextStorage = new AsyncLocalStorage();

const MAX_CONCURRENT_PER_TOKEN = 2;
const MAX_RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_BACKOFF_MS = [2000, 4000, 8000, 16000];
const HOURLY_CALL_WARN_THRESHOLD = 200;

/** @type {Map<string, { running: number, queue: Array<() => void> }>} */
const tokenSlotState = new Map();
/** @type {Map<string, { hourKey: string, count: number }>} */
const hourlyCallCounts = new Map();

function getGraphVersion() {
  return String(process.env.META_GRAPH_VERSION || 'v21.0').trim() || 'v21.0';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function graphErrorCode(data) {
  const fb = data && data.error;
  if (!fb) return null;
  const code = fb.code;
  return typeof code === 'number' ? code : null;
}

function accessTokenFromGraphUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('access_token') || '';
  } catch {
    return '';
  }
}

function trackHourlyCall(connectionId, accessToken) {
  const key = connectionId != null ? `conn:${connectionId}` : `tok:${String(accessToken || '').slice(0, 12)}`;
  const hourKey = new Date().toISOString().slice(0, 13);
  const cur = hourlyCallCounts.get(key) || { hourKey, count: 0 };
  if (cur.hourKey !== hourKey) {
    cur.hourKey = hourKey;
    cur.count = 0;
  }
  cur.count += 1;
  hourlyCallCounts.set(key, cur);
  if (cur.count === HOURLY_CALL_WARN_THRESHOLD + 1) {
    console.warn(`[meta-rate-warn] token ${key} superó ${HOURLY_CALL_WARN_THRESHOLD} llamadas/hora`);
  }
}

function acquireTokenSlot(tokenKey) {
  return new Promise((resolve) => {
    let state = tokenSlotState.get(tokenKey);
    if (!state) {
      state = { running: 0, queue: [] };
      tokenSlotState.set(tokenKey, state);
    }
    const tryRun = () => {
      if (state.running < MAX_CONCURRENT_PER_TOKEN) {
        state.running += 1;
        resolve();
        return;
      }
      state.queue.push(tryRun);
    };
    tryRun();
  });
}

function releaseTokenSlot(tokenKey) {
  const state = tokenSlotState.get(tokenKey);
  if (!state) return;
  state.running = Math.max(0, state.running - 1);
  const next = state.queue.shift();
  if (next) next();
}

/**
 * @param {() => Promise<{ ok: boolean, data: any, status: number }>} fn
 * @param {{ accessToken?: string, connectionId?: number, pool?: import('pg').Pool, organizationId?: number }} [options]
 */
async function metaApiCall(fn, options = {}) {
  const store = metaApiContextStorage.getStore() || {};
  const accessToken = options.accessToken || store.accessToken || '';
  const tokenKey = accessToken ? accessToken.slice(0, 24) : 'anon';
  const connectionId = options.connectionId ?? store.connectionId;
  const pool = options.pool ?? store.pool;
  const organizationId = options.organizationId ?? store.organizationId;

  trackHourlyCall(connectionId, accessToken);
  await acquireTokenSlot(tokenKey);

  try {
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      const result = await fn();
      const code = graphErrorCode(result.data);

      if (code === 190) {
        if (pool && connectionId && organizationId) {
          const { markConnectionMetaTokenInvalid } = require('./metaTokenService');
          await markConnectionMetaTokenInvalid(pool, connectionId, organizationId);
        }
        const err = new Error('Token de Meta inválido o expirado');
        err.code = 190;
        throw err;
      }

      if ((code === 17 || code === 32) && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(RATE_LIMIT_BACKOFF_MS[attempt] || 16000);
        continue;
      }

      if (code === 17 || code === 32) {
        const err = new Error('Meta rate limit alcanzado, intenta en unos minutos');
        err.code = code;
        throw err;
      }

      return result;
    }
    const err = new Error('Meta rate limit alcanzado, intenta en unos minutos');
    err.code = 32;
    throw err;
  } finally {
    releaseTokenSlot(tokenKey);
  }
}

/**
 * @param {object} ctx
 * @param {() => Promise<any>} fn
 */
function runWithMetaApiContext(ctx, fn) {
  return metaApiContextStorage.run(ctx || {}, fn);
}

async function graphFetchJson(url, options = {}) {
  const accessToken = options.accessToken || accessTokenFromGraphUrl(url);
  return metaApiCall(async () => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data, status: res.status };
  }, { ...options, accessToken });
}

async function fetchAllGraphPages(firstUrl, options = {}) {
  const items = [];
  let url = firstUrl;
  while (url) {
    const { ok, data } = await graphFetchJson(url, options);
    if (!ok) {
      return { ok: false, data, items };
    }
    if (Array.isArray(data.data)) items.push(...data.data);
    url = data.paging?.next || null;
  }
  return { ok: true, items };
}

function normalizeActId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/^act_/i, '');
  if (!/^\d+$/.test(digits)) return '';
  return `act_${digits}`;
}

/** @param {string} period */
function datePresetFromDashboardPeriod(period) {
  const map = {
    hoy: 'today',
    ayer: 'yesterday',
    '3d': 'last_3d',
    '7d': 'last_7d',
    '14d': 'last_14d',
    '30d': 'last_30d',
    custom: 'last_7d',
  };
  return map[period] || 'last_7d';
}

async function listAdAccounts(accessToken, apiOptions = {}) {
  const v = getGraphVersion();
  const fields = 'id,name,account_status,currency';
  const base = `https://graph.facebook.com/${v}/me/adaccounts?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetchAllGraphPages(base, { ...apiOptions, accessToken });
  if (!r.ok) {
    const fb = r.data && r.data.error;
    const code190 = fb && fb.code === 190;
    const code200 = fb && fb.code === 200;
    return {
      ok: false,
      code: code190 ? 'token_expired' : code200 ? 'permissions' : 'api_error',
      message: (fb && fb.message) || 'No se pudieron listar las cuentas publicitarias',
      accounts: [],
      fb,
    };
  }
  return { ok: true, accounts: r.items, code: null, message: null, fb: null };
}

// Solo campos admitidos en insights anidados (act_*/campaigns|adsets|ads?fields=…,insights.date_preset(…) {…}).
// omni_purchase_roas / website_purchase_roas / cost_per_action_type suelen devolver (#100) en este modo; ROAS y CPA se calculan con actions + action_values + spend.
const INSIGHT_FIELDS =
  'impressions,clicks,spend,cpm,cpc,ctr,reach,frequency,actions,action_values';

function buildObjectFields(level, datePreset) {
  const ins = `insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`;
  if (level === 'campaigns') return `id,name,status,effective_status,${ins}`;
  if (level === 'adsets') return `id,name,campaign_id,status,effective_status,${ins}`;
  return `id,name,adset_id,campaign_id,status,effective_status,${ins}`;
}

async function fetchAccountName(actId, accessToken, apiOptions = {}) {
  const v = getGraphVersion();
  const id = normalizeActId(actId);
  if (!id) return actId;
  const u = `https://graph.facebook.com/${v}/${id}?fields=name&access_token=${encodeURIComponent(accessToken)}`;
  const { ok, data } = await graphFetchJson(u, { ...apiOptions, accessToken });
  if (ok && data.name) return String(data.name);
  return id;
}

function firstInsight(entity) {
  const ins = entity.insights;
  if (!ins || !Array.isArray(ins.data) || !ins.data[0]) return {};
  return ins.data[0];
}

function parseNum(v) {
  const n = parseFloat(String(v ?? '0').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const PURCHASE_TYPES = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase',
  'web_in_store_purchase',
  'onsite_web_purchase',
  'onsite_web_app_purchase',
]);

function purchaseCountFromActions(actions) {
  if (!Array.isArray(actions)) return 0;
  let n = 0;
  for (const a of actions) {
    if (a && PURCHASE_TYPES.has(a.action_type)) n += parseNum(a.value);
  }
  return Math.round(n);
}

function purchaseValueFromActionValues(actionValues) {
  if (!Array.isArray(actionValues)) return 0;
  let sum = 0;
  for (const a of actionValues) {
    if (a && PURCHASE_TYPES.has(a.action_type)) sum += parseNum(a.value);
  }
  return sum;
}

function normalizeEntity(entity, level, adAccountId, adAccountName) {
  const ins = firstInsight(entity);
  const impressions = parseNum(ins.impressions);
  const clicks = parseNum(ins.clicks);
  const spend = parseNum(ins.spend);
  const purchases = purchaseCountFromActions(ins.actions);
  const revenue = purchaseValueFromActionValues(ins.action_values);
  const roas = spend > 0 && revenue > 0 ? revenue / spend : 0;
  const cpa = purchases > 0 ? spend / purchases : 0;
  return {
    adAccountId,
    adAccountName,
    id: entity.id != null ? String(entity.id) : '',
    name: entity.name || '(sin nombre)',
    status: entity.effective_status || entity.status || '',
    campaignId: entity.campaign_id ? String(entity.campaign_id) : '',
    adsetId: entity.adset_id ? String(entity.adset_id) : '',
    impressions,
    clicks,
    spend,
    cpm: parseNum(ins.cpm),
    cpc: parseNum(ins.cpc),
    ctr: parseNum(ins.ctr),
    reach: parseNum(ins.reach),
    purchases,
    revenue,
    roas,
    cpa,
    level,
  };
}

/**
 * @param {string} actId
 * @param {string} accessToken
 * @param {'campaigns'|'adsets'|'ads'} level
 * @param {string} datePreset
 */
async function fetchInsightsForAdAccount(actId, accessToken, level, datePreset, apiOptions = {}) {
  const v = getGraphVersion();
  const id = normalizeActId(actId);
  if (!id) {
    return { ok: false, rows: [], error: 'ID de cuenta publicitaria no válido' };
  }
  const fields = buildObjectFields(level, datePreset);
  const base = `https://graph.facebook.com/${v}/${id}/${level}?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetchAllGraphPages(base, { ...apiOptions, accessToken });
  if (!r.ok) {
    const fb = r.data && r.data.error;
    return {
      ok: false,
      rows: [],
      error: (fb && fb.message) || 'Error al leer insights',
      fb,
    };
  }
  const acctName = await fetchAccountName(id, accessToken, apiOptions);
  const rows = r.items.map((entity) => normalizeEntity(entity, level, id, acctName));
  return { ok: true, rows, error: null, fb: null };
}

/**
 * @param {string[]} selectedRaw
 * @param {{ id: string }[]} accountsFromApi
 */
function filterValidAdAccountIds(selectedRaw, accountsFromApi) {
  const allowed = new Set(
    (accountsFromApi || []).map((a) => normalizeActId(a.id)).filter(Boolean),
  );
  const out = [];
  const seen = new Set();
  for (const raw of selectedRaw || []) {
    const n = normalizeActId(raw);
    if (!n || !allowed.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

const FUNNEL_ACTION_GROUPS = {
  linkEngagement: [
    'link_click',
    'inline_link_click',
    'cta_click',
    'outbound_click',
  ],
  landing: [
    'landing_page_view',
    'omni_landing_page_view',
    'view_content',
    'offsite_conversion.fb_pixel_view_content',
  ],
  addToCart: [
    'add_to_cart',
    'offsite_conversion.fb_pixel_add_to_cart',
    'onsite_conversion.add_to_cart',
    'web_in_store_add_to_cart',
  ],
  checkout: [
    'initiate_checkout',
    'offsite_conversion.fb_pixel_initiate_checkout',
    'onsite_conversion.initiate_checkout',
  ],
  purchase: [
    'purchase',
    'omni_purchase',
    'offsite_conversion.fb_pixel_purchase',
    'onsite_conversion.purchase',
    'web_in_store_purchase',
  ],
};

function sumActionsByTypes(actions, types) {
  if (!Array.isArray(actions) || !types || types.length === 0) return 0;
  const set = new Set(types);
  let n = 0;
  for (const a of actions) {
    if (a && set.has(a.action_type)) n += parseNum(a.value);
  }
  return n;
}

/**
 * Embudo aproximado desde fila única de /act_xxx/insights (agregado de cuenta).
 */
function buildFunnelFromAccountInsight(insight) {
  const imp = parseNum(insight.impressions);
  const clicksField = parseNum(insight.clicks);
  const ilc = parseNum(insight.inline_link_clicks);
  const actions = insight.actions;
  const linkEngagement = Math.max(
    ilc,
    sumActionsByTypes(actions, FUNNEL_ACTION_GROUPS.linkEngagement),
    clicksField,
  );
  const landing = sumActionsByTypes(actions, FUNNEL_ACTION_GROUPS.landing);
  const atc = sumActionsByTypes(actions, FUNNEL_ACTION_GROUPS.addToCart);
  const checkout = sumActionsByTypes(actions, FUNNEL_ACTION_GROUPS.checkout);
  const purchase = sumActionsByTypes(actions, FUNNEL_ACTION_GROUPS.purchase);
  const spend = parseNum(insight.spend);
  const revenue = purchaseValueFromActionValues(insight.action_values);

  const stages = [
    { key: 'imp', label: 'Impresiones', people: Math.round(imp) },
    { key: 'clk', label: 'Clics (enlace)', people: Math.round(linkEngagement) },
    { key: 'lpv', label: 'Vistas / contenido', people: Math.round(landing) },
    { key: 'atc', label: 'Añadir al carrito', people: Math.round(atc) },
    { key: 'ico', label: 'Checkout iniciado', people: Math.round(checkout) },
    { key: 'pur', label: 'Compras', people: Math.round(purchase) },
  ];

  return {
    stages,
    spend,
    impressions: imp,
    revenue,
    purchases: Math.round(purchase),
  };
}

async function fetchAccountAggregatedInsights(actId, accessToken, datePreset, apiOptions = {}) {
  const v = getGraphVersion();
  const id = normalizeActId(actId);
  if (!id) {
    return { ok: false, error: 'ID de cuenta no válido', funnel: null };
  }
  const fields = 'actions,action_values,spend,impressions,clicks,inline_link_clicks,reach';
  const url = `https://graph.facebook.com/${v}/${id}/insights?date_preset=${encodeURIComponent(datePreset)}&fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;
  const { ok, data } = await graphFetchJson(url, { ...apiOptions, accessToken });
  if (!ok || !data || !Array.isArray(data.data) || !data.data[0]) {
    const msg = (data && data.error && data.error.message) || 'Sin datos de insights para esta cuenta';
    return { ok: false, error: msg, funnel: null };
  }
  const funnel = buildFunnelFromAccountInsight(data.data[0]);
  return { ok: true, funnel, error: null };
}

function mergeFunnelPayloads(payloads) {
  if (!payloads || payloads.length === 0) return null;
  const keys = payloads[0].stages.map((s) => s.key);
  const labelByKey = Object.fromEntries(payloads[0].stages.map((s) => [s.key, s.label]));
  const people = {};
  let spend = 0;
  let revenue = 0;
  let impressions = 0;
  let purchases = 0;
  for (const p of payloads) {
    spend += p.spend;
    revenue += p.revenue;
    impressions += p.impressions;
    purchases += p.purchases;
    for (const s of p.stages) {
      people[s.key] = (people[s.key] || 0) + s.people;
    }
  }
  const stages = keys.map((k) => ({
    key: k,
    label: labelByKey[k],
    people: Math.round(people[k] || 0),
  }));
  return { stages, spend, revenue, impressions, purchases };
}

/**
 * @param {string[]} actIds
 * @param {string} accessToken
 * @param {string} datePreset
 */
async function fetchFunnelForAdAccounts(actIds, accessToken, datePreset, apiOptions = {}) {
  const partialErrors = [];
  const payloads = [];
  for (const raw of actIds) {
    const id = normalizeActId(raw);
    const r = await fetchAccountAggregatedInsights(id, accessToken, datePreset, apiOptions);
    if (!r.ok) {
      partialErrors.push({ adAccountId: id, error: r.error || 'Error' });
      continue;
    }
    payloads.push(r.funnel);
  }
  const merged = mergeFunnelPayloads(payloads);
  return { merged, partialErrors, ok: payloads.length > 0 };
}

/**
 * Insights diarios a nivel cuenta (date_preset + time_increment=1).
 * @param {string} actId
 * @param {string} accessToken
 * @param {string} datePreset
 */
async function fetchAccountDailyInsightsForPreset(actId, accessToken, datePreset, apiOptions = {}) {
  const v = getGraphVersion();
  const id = normalizeActId(actId);
  if (!id) {
    return { ok: false, rows: [], error: 'ID de cuenta no válido' };
  }
  const fields = 'impressions,clicks,spend,actions,action_values,date_start';
  const base = `https://graph.facebook.com/${v}/${id}/insights?date_preset=${encodeURIComponent(datePreset)}&fields=${encodeURIComponent(fields)}&time_increment=1&limit=999&access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetchAllGraphPages(base, { ...apiOptions, accessToken });
  if (!r.ok) {
    const fb = r.data && r.data.error;
    return {
      ok: false,
      rows: [],
      error: (fb && fb.message) || 'Error al leer series diarias',
    };
  }
  return { ok: true, rows: r.items, error: null };
}

function mergeDailyAccountInsightRows(rowArrays) {
  const map = new Map();
  for (const rows of rowArrays) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const ds = row.date_start;
      if (!ds || typeof ds !== 'string') continue;
      const cur = map.get(ds) || {
        date_start: ds,
        impressions: 0,
        clicks: 0,
        spend: 0,
        purchases: 0,
        revenue: 0,
      };
      cur.impressions += parseNum(row.impressions);
      cur.clicks += parseNum(row.clicks);
      cur.spend += parseNum(row.spend);
      cur.purchases += purchaseCountFromActions(row.actions);
      cur.revenue += purchaseValueFromActionValues(row.action_values);
      map.set(ds, cur);
    }
  }
  const sorted = [...map.values()].sort((a, b) => a.date_start.localeCompare(b.date_start));
  return sorted.map((v) => {
    const cpc = v.clicks > 0 ? v.spend / v.clicks : 0;
    const cpm = v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0;
    const ctr = v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0;
    const roas = v.spend > 0 && v.revenue > 0 ? v.revenue / v.spend : 0;
    const convPct = v.clicks > 0 ? (v.purchases / v.clicks) * 100 : 0;
    return {
      date_start: v.date_start,
      impressions: v.impressions,
      clicks: v.clicks,
      spend: v.spend,
      purchases: v.purchases,
      revenue: v.revenue,
      cpc,
      cpm,
      ctr,
      roas,
      convPct,
    };
  });
}

/**
 * Serie diaria agregada (suma por date_start) para todas las cuentas.
 * @param {string[]} actIds
 * @param {string} accessToken
 * @param {string} datePreset
 */
async function fetchMergedDailyInsightsForAdAccounts(actIds, accessToken, datePreset, apiOptions = {}) {
  const partialErrors = [];
  const rowArrays = [];
  for (const raw of actIds) {
    const id = normalizeActId(raw);
    const r = await fetchAccountDailyInsightsForPreset(id, accessToken, datePreset, apiOptions);
    if (!r.ok) {
      partialErrors.push({ adAccountId: id || String(raw), error: r.error || 'Error' });
      continue;
    }
    rowArrays.push(r.rows);
  }
  const series = mergeDailyAccountInsightRows(rowArrays);
  return { series, partialErrors, ok: rowArrays.length > 0 };
}

/**
 * Gasto agregado de cuenta para un rango since/until (YYYY-MM-DD), API de insights de cuenta.
 * @param {string} actId
 * @param {string} accessToken
 * @param {string} since
 * @param {string} until
 */
async function fetchAccountSpendForTimeRange(actId, accessToken, since, until, apiOptions = {}) {
  const v = getGraphVersion();
  const id = normalizeActId(actId);
  if (!id) {
    return { ok: false, spend: 0, error: 'ID de cuenta publicitaria no válido' };
  }
  const tr = JSON.stringify({ since, until });
  const fields = 'spend';
  const url = `https://graph.facebook.com/${v}/${id}/insights?fields=${encodeURIComponent(fields)}&time_range=${encodeURIComponent(tr)}&access_token=${encodeURIComponent(accessToken)}`;
  const { ok, data } = await graphFetchJson(url, { ...apiOptions, accessToken });
  if (!ok || !data) {
    const fb = data && data.error;
    return {
      ok: false,
      spend: 0,
      error: (fb && fb.message) || 'Error al leer gasto en el rango',
    };
  }
  const row0 = Array.isArray(data.data) && data.data[0] ? data.data[0] : null;
  if (!row0) {
    return { ok: true, spend: 0, error: null };
  }
  return { ok: true, spend: parseNum(row0.spend), error: null };
}

/**
 * @param {string[]} actIds
 * @param {string} accessToken
 * @param {string} since YYYY-MM-DD
 * @param {string} until YYYY-MM-DD
 */
async function fetchTotalSpendForAdAccountsTimeRange(actIds, accessToken, since, until, apiOptions = {}) {
  let spend = 0;
  const partialErrors = [];
  for (const raw of actIds) {
    const id = normalizeActId(raw);
    const r = await fetchAccountSpendForTimeRange(id, accessToken, since, until, apiOptions);
    if (!r.ok) {
      partialErrors.push({ adAccountId: id, error: r.error || 'Error' });
      continue;
    }
    spend += r.spend;
  }
  return { spend, partialErrors };
}

/**
 * Gasto publicitario por día (date_start YYYY-MM-DD), rango since/until inclusive.
 * Suma todas las cuentas en actIds para cada día.
 * @param {string[]} actIds
 * @param {string} accessToken
 * @param {string} since YYYY-MM-DD
 * @param {string} until YYYY-MM-DD
 * @returns {Promise<{ byDay: Record<string, number>, partialErrors: { adAccountId: string, error: string }[] }>}
 */
async function fetchDailySpendByDayForAdAccountsTimeRange(actIds, accessToken, since, until, apiOptions = {}) {
  const v = getGraphVersion();
  const tr = JSON.stringify({ since, until });
  const fields = 'spend,date_start';
  const partialErrors = [];
  const merged = new Map();

  for (const raw of actIds) {
    const id = normalizeActId(raw);
    if (!id) {
      partialErrors.push({ adAccountId: String(raw || ''), error: 'ID de cuenta no válido' });
      continue;
    }
    const base = `https://graph.facebook.com/${v}/${id}/insights?fields=${encodeURIComponent(fields)}&time_range=${encodeURIComponent(tr)}&time_increment=1&limit=999&access_token=${encodeURIComponent(accessToken)}`;
    const r = await fetchAllGraphPages(base, { ...apiOptions, accessToken });
    if (!r.ok) {
      const fb = r.data && r.data.error;
      partialErrors.push({
        adAccountId: id,
        error: (fb && fb.message) || 'Error al leer gasto diario',
      });
      continue;
    }
    for (const row of r.items) {
      const ds = row.date_start;
      if (!ds || typeof ds !== 'string') continue;
      const spend = parseNum(row.spend);
      merged.set(ds, (merged.get(ds) || 0) + spend);
    }
  }
  return { byDay: Object.fromEntries(merged), partialErrors };
}

/**
 * Insights diarios por cuenta en rango since/until (YYYY-MM-DD) con métricas completas.
 * @param {string} actId
 * @param {string} accessToken
 * @param {string} since YYYY-MM-DD
 * @param {string} until YYYY-MM-DD
 */
async function fetchAccountDailyInsightsForTimeRange(actId, accessToken, since, until, apiOptions = {}) {
  const v = getGraphVersion();
  const id = normalizeActId(actId);
  if (!id) {
    return { ok: false, rows: [], error: 'ID de cuenta no válido' };
  }
  const tr = JSON.stringify({ since, until });
  const fields = 'impressions,clicks,spend,actions,action_values,date_start';
  const base = `https://graph.facebook.com/${v}/${id}/insights?fields=${encodeURIComponent(fields)}&time_range=${encodeURIComponent(tr)}&time_increment=1&limit=999&access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetchAllGraphPages(base, { ...apiOptions, accessToken });
  if (!r.ok) {
    const fb = r.data && r.data.error;
    return {
      ok: false,
      rows: [],
      error: (fb && fb.message) || 'Error al leer series diarias por rango',
    };
  }
  return { ok: true, rows: r.items, error: null };
}

/**
 * Serie diaria agregada (sumando cuentas) para rango since/until (YYYY-MM-DD).
 * @param {string[]} actIds
 * @param {string} accessToken
 * @param {string} since YYYY-MM-DD
 * @param {string} until YYYY-MM-DD
 */
async function fetchDailyInsightsByDayForAdAccountsTimeRange(actIds, accessToken, since, until, apiOptions = {}) {
  const partialErrors = [];
  const rowArrays = [];
  for (const raw of actIds || []) {
    const id = normalizeActId(raw);
    const r = await fetchAccountDailyInsightsForTimeRange(id, accessToken, since, until, apiOptions);
    if (!r.ok) {
      partialErrors.push({ adAccountId: id || String(raw || ''), error: r.error || 'Error' });
      continue;
    }
    rowArrays.push(r.rows);
  }
  const series = mergeDailyAccountInsightRows(rowArrays);
  return { series, partialErrors };
}

/**
 * @param {string} campaignId digits only
 * @param {string} accessToken
 * @returns {Promise<{ ok: boolean, accountId: string | null, error: string | null }>}
 */
async function getCampaignAdAccountId(campaignId, accessToken, apiOptions = {}) {
  const v = getGraphVersion();
  const rawId = String(campaignId || '').trim();
  if (!/^\d+$/.test(rawId)) {
    return { ok: false, accountId: null, error: 'ID de campaña inválido' };
  }
  const u = `https://graph.facebook.com/${v}/${rawId}?fields=account_id&access_token=${encodeURIComponent(accessToken)}`;
  const { ok, data } = await graphFetchJson(u, { ...apiOptions, accessToken });
  if (!ok || !data) {
    const fb = data && data.error;
    return {
      ok: false,
      accountId: null,
      error: (fb && fb.message) || 'No se pudo comprobar la campaña',
    };
  }
  const aid = data.account_id ? normalizeActId(String(data.account_id)) : '';
  if (!aid) {
    return { ok: false, accountId: null, error: 'Campaña sin cuenta publicitaria asociada' };
  }
  return { ok: true, accountId: aid, error: null };
}

/**
 * @param {string} campaignId digits only
 * @param {string} accessToken
 * @param {'PAUSED'|'ACTIVE'} status
 */
async function updateCampaignStatusGraph(campaignId, accessToken, status, apiOptions = {}) {
  const v = getGraphVersion();
  const rawId = String(campaignId || '').trim();
  if (!/^\d+$/.test(rawId)) {
    return { ok: false, error: 'ID de campaña inválido', fb: null };
  }
  if (status !== 'PAUSED' && status !== 'ACTIVE') {
    return { ok: false, error: 'Estado no permitido', fb: null };
  }
  const u = `https://graph.facebook.com/${v}/${rawId}`;
  const body = new URLSearchParams();
  body.set('status', status);
  body.set('access_token', accessToken);
  const result = await metaApiCall(async () => {
    const res = await fetch(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data, status: res.status };
  }, { ...apiOptions, accessToken });
  const data = result.data;
  if (!result.ok || (data && data.error)) {
    const fb = data && data.error;
    return {
      ok: false,
      error: (fb && fb.message) || 'Error al actualizar la campaña en Meta',
      fb: fb || null,
    };
  }
  return { ok: true, error: null, fb: null, data };
}

module.exports = {
  normalizeActId,
  datePresetFromDashboardPeriod,
  getGraphVersion,
  runWithMetaApiContext,
  metaApiCall,
  listAdAccounts,
  fetchInsightsForAdAccount,
  filterValidAdAccountIds,
  fetchFunnelForAdAccounts,
  fetchMergedDailyInsightsForAdAccounts,
  mergeFunnelPayloads,
  fetchAccountSpendForTimeRange,
  fetchTotalSpendForAdAccountsTimeRange,
  fetchDailySpendByDayForAdAccountsTimeRange,
  fetchDailyInsightsByDayForAdAccountsTimeRange,
  getCampaignAdAccountId,
  updateCampaignStatusGraph,
};
