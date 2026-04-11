'use strict';

const DEFAULT_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

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
    '3d': 'last_3d',
    '7d': 'last_7d',
    '14d': 'last_14d',
    '30d': 'last_30d',
    custom: 'last_7d',
  };
  return map[period] || 'last_7d';
}

async function graphFetchJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data, status: res.status };
}

async function fetchAllGraphPages(firstUrl) {
  const items = [];
  let url = firstUrl;
  while (url) {
    const { ok, data } = await graphFetchJson(url);
    if (!ok) {
      return { ok: false, data, items };
    }
    if (Array.isArray(data.data)) items.push(...data.data);
    url = data.paging?.next || null;
  }
  return { ok: true, items };
}

/**
 * @param {string} accessToken
 */
async function listAdAccounts(accessToken) {
  const v = DEFAULT_VERSION;
  const fields = 'id,name,account_status,currency';
  const base = `https://graph.facebook.com/${v}/me/adaccounts?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetchAllGraphPages(base);
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

const INSIGHT_FIELDS =
  'impressions,clicks,spend,cpm,cpc,ctr,reach,frequency,actions,action_values';

function buildObjectFields(level, datePreset) {
  const ins = `insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`;
  if (level === 'campaigns') return `id,name,status,effective_status,${ins}`;
  if (level === 'adsets') return `id,name,campaign_id,status,effective_status,${ins}`;
  return `id,name,adset_id,campaign_id,status,effective_status,${ins}`;
}

async function fetchAccountName(actId, accessToken) {
  const v = DEFAULT_VERSION;
  const id = normalizeActId(actId);
  if (!id) return actId;
  const u = `https://graph.facebook.com/${v}/${id}?fields=name&access_token=${encodeURIComponent(accessToken)}`;
  const { ok, data } = await graphFetchJson(u);
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
    id: entity.id,
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
async function fetchInsightsForAdAccount(actId, accessToken, level, datePreset) {
  const v = DEFAULT_VERSION;
  const id = normalizeActId(actId);
  if (!id) {
    return { ok: false, rows: [], error: 'ID de cuenta publicitaria no válido' };
  }
  const fields = buildObjectFields(level, datePreset);
  const base = `https://graph.facebook.com/${v}/${id}/${level}?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetchAllGraphPages(base);
  if (!r.ok) {
    const fb = r.data && r.data.error;
    return {
      ok: false,
      rows: [],
      error: (fb && fb.message) || 'Error al leer insights',
      fb,
    };
  }
  const acctName = await fetchAccountName(id, accessToken);
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

async function fetchAccountAggregatedInsights(actId, accessToken, datePreset) {
  const v = DEFAULT_VERSION;
  const id = normalizeActId(actId);
  if (!id) {
    return { ok: false, error: 'ID de cuenta no válido', funnel: null };
  }
  const fields = 'actions,action_values,spend,impressions,clicks,inline_link_clicks,reach';
  const url = `https://graph.facebook.com/${v}/${id}/insights?date_preset=${encodeURIComponent(datePreset)}&fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;
  const { ok, data } = await graphFetchJson(url);
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
async function fetchFunnelForAdAccounts(actIds, accessToken, datePreset) {
  const partialErrors = [];
  const payloads = [];
  for (const raw of actIds) {
    const id = normalizeActId(raw);
    const r = await fetchAccountAggregatedInsights(id, accessToken, datePreset);
    if (!r.ok) {
      partialErrors.push({ adAccountId: id, error: r.error || 'Error' });
      continue;
    }
    payloads.push(r.funnel);
  }
  const merged = mergeFunnelPayloads(payloads);
  return { merged, partialErrors, ok: payloads.length > 0 };
}

module.exports = {
  normalizeActId,
  datePresetFromDashboardPeriod,
  listAdAccounts,
  fetchInsightsForAdAccount,
  filterValidAdAccountIds,
  fetchFunnelForAdAccounts,
  mergeFunnelPayloads,
};
