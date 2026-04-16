import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';
import { MetaDataIssueCard, MetaFetchErrorPanel, MetaLiveDataStrip } from './MetaApiStatusBanner';
import { MetaCampaignProductAssign } from './MetaCampaignProductAssign';
import {
  aggregateTargetsForProducts,
  campaignIdForInsightRow,
  evaluateInsightAgainstTargets,
  insightMetricCellBg,
  insightRowBg,
  type ProductMarketingTargets,
} from './marketingTargetEval';
import { formatMetaMoneyWhole } from './formatMetaMoney';
import { resolveMetaDataIssue } from './metaDataIssues';

export type MetaInsightPeriod = 'hoy' | 'ayer' | '3d' | '7d' | '14d' | '30d' | 'custom';

const PERIOD_LABELS: Record<MetaInsightPeriod, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  '3d': 'Últimos 3 días',
  '7d': 'Últimos 7 días',
  '14d': 'Últimos 14 días',
  '30d': 'Últimos 30 días',
  custom: 'Personalizado',
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(Math.round(n));
}

const formatMoney2 = formatMetaMoneyWhole;

function formatPct(n: number, decimals = 0): string {
  return `${n.toFixed(decimals)} %`;
}

/** ROAS como en Meta Ads (decimales, no redondeo entero). */
function formatRoasMeta(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}×`;
}

type InsightLevel = 'campaigns' | 'adsets' | 'ads';

type CampaignActivityFilter = 'active' | 'inactive' | 'all';

type ShopifyProductOption = { id: number; title: string };

type InsightRow = {
  adAccountId: string;
  adAccountName: string;
  id: string;
  name: string;
  status: string;
  campaignId: string;
  adsetId: string;
  impressions: number;
  clicks: number;
  spend: number;
  cpm: number;
  cpc: number;
  ctr: number;
  reach: number;
  purchases: number;
  revenue: number;
  roas: number;
  cpa: number;
  level: string;
};

type Totals = {
  impressions: number;
  clicks: number;
  spend: number;
  purchases: number;
  revenue: number;
  cpm: number;
  cpc: number;
  ctr: number;
  roas: number;
  cpa: number;
};

type ShopifyOrderAttribution = {
  productIds?: number[];
  utm?: Record<string, string>;
  landingSite?: string;
  referringSite?: string;
  sourceName?: string;
  total?: string;
  shopifyTotal?: string;
  price_override?: number | null;
};

function normalizeAttributionKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function digitsOnlyKey(s: string): string {
  return String(s || '').replace(/\D/g, '');
}

/** Query params de una URL (igual criterio que backend: landing pisa referrer en claves repetidas). */
function collectQueryParamsFromUrl(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const s = String(raw || '').trim();
  if (!s) return out;
  try {
    const href =
      s.startsWith('http://') || s.startsWith('https://')
        ? s
        : `https://shop.local${s.startsWith('/') ? '' : '/'}${s}`;
    const u = new URL(href);
    u.searchParams.forEach((v, k) => {
      const lk = k.toLowerCase();
      try {
        out[lk] = decodeURIComponent(String(v).replace(/\+/g, ' '));
      } catch {
        out[lk] = String(v);
      }
    });
  } catch {
    /* ignore */
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Texto amplio donde puede aparecer el id de Meta (URL cruda + params parseados). */
function buildShopifyAttributionHaystack(o: ShopifyOrderAttribution): string {
  const merged = {
    ...collectQueryParamsFromUrl(o.referringSite),
    ...collectQueryParamsFromUrl(o.landingSite),
    ...(o.utm && typeof o.utm === 'object' ? o.utm : {}),
  };
  const valueParts = Object.values(merged).map((v) => String(v));
  const blobs = [
    o.landingSite,
    o.referringSite,
    JSON.stringify(o.utm || {}),
    ...valueParts,
  ].filter(Boolean) as string[];
  let s = blobs.join(' ').toLowerCase();
  try {
    s = decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    /* ignore */
  }
  return s;
}

/** Evita coincidencias parciales entre ids numéricos distintos (límites no-dígito). */
function haystackContainsMetaEntityId(hay: string, metaId: string | undefined): boolean {
  const raw = String(metaId || '').trim();
  if (!raw || !hay) return false;
  if (hay.includes(raw.toLowerCase())) return true;
  const digits = digitsOnlyKey(raw);
  if (digits.length < 10) return false;
  try {
    const re = new RegExp(`(^|[^0-9])${escapeRegExp(digits)}([^0-9]|$)`);
    return re.test(hay);
  } catch {
    return hay.includes(digits);
  }
}

/**
 * Anuncios cuyo id aparece en el haystack del pedido.
 */
function adRowsWhoseIdAppearsInHaystack(rows: InsightRow[], hay: string): InsightRow[] {
  if (!hay) return [];
  return rows.filter((r) => {
    const adId = String(r.id || '').trim();
    return adId && haystackContainsMetaEntityId(hay, adId);
  });
}

/** Meta suele enviar el nombre del anuncio en utm_term / utm_content, no el id numérico. */
function adRowsMatchingUtmCreativeName(rows: InsightRow[], utm: Record<string, string>): InsightRow[] {
  const rawStrings = [String(utm['utm_term'] || '').trim(), String(utm['utm_content'] || '').trim()].filter(Boolean);
  const norms = [...new Set(rawStrings.map((s) => normalizeAttributionKey(s)).filter(Boolean))];
  if (norms.length === 0) return [];

  return rows.filter((r) => {
    const nameNorm = r.name ? normalizeAttributionKey(String(r.name)) : '';
    if (!nameNorm) return false;
    for (const u of norms) {
      if (u === nameNorm) return true;
      if (nameNorm.length <= 4 || u.length <= 4) continue;
      if (nameNorm.length >= 6 && u.length >= 6 && (u.includes(nameNorm) || nameNorm.includes(u))) return true;
    }
    return false;
  });
}

/**
 * Si varios anuncios matchean el mismo texto (p. ej. URL con campaña + id de anuncio),
 * reduce por utm_campaign / adset en el haystack; si sigue habiendo varios, elige uno
 * estable (cada pedido cuenta solo 1 vez en total, sin reparto a todo el adset).
 * @param allowGuessWhenAmbiguous si false, no elige un anuncio al azar cuando solo hay señal de adset/campaña ambigua.
 */
function pickSingleAdRowFromCandidates(
  hits: InsightRow[],
  utm: Record<string, string>,
  hay: string,
  campaignRows: { id: string; name: string }[],
  allowGuessWhenAmbiguous = true,
): InsightRow | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];

  const byCamp = campaignsMatchedByUtm(utm, campaignRows);
  if (byCamp.size > 0) {
    const narrowed = hits.filter((r) => byCamp.has(String(r.campaignId || '').trim()));
    if (narrowed.length === 1) return narrowed[0];
    if (narrowed.length > 0) {
      const byAdset = narrowed.filter((r) => {
        const aid = String(r.adsetId || '').trim();
        return aid && haystackContainsMetaEntityId(hay, aid);
      });
      if (byAdset.length === 1) return byAdset[0];
      const pool = byAdset.length > 0 ? byAdset : narrowed;
      if (!allowGuessWhenAmbiguous && pool.length > 1) return null;
      const sorted = [...pool].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return sorted[0] ?? null;
    }
  }

  const byAdsetOnly = hits.filter((r) => {
    const aid = String(r.adsetId || '').trim();
    return aid && haystackContainsMetaEntityId(hay, aid);
  });
  if (byAdsetOnly.length === 1) return byAdsetOnly[0];
  const pool = byAdsetOnly.length > 0 ? byAdsetOnly : hits;
  if (!allowGuessWhenAmbiguous && pool.length > 1) return null;
  const sorted = [...pool].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return sorted[0] ?? null;
}

/**
 * Cada pedido suma como máximo 1 en toda la tabla.
 * utm_term / utm_content = id de anuncio; si no, ids de anuncio en el haystack (con desempate);
 * si no hay id de anuncio en el texto, un único anuncio cuyo adset aparece en el haystack.
 */
function buildCountsByAdFromOrders(rows: InsightRow[], orders: ShopifyOrderAttribution[]): Record<string, number> {
  const countsByAd: Record<string, number> = {};
  if (rows.length === 0 || orders.length === 0) return countsByAd;

  const campaignRows = campaignsFromInsightRows(rows, 'ads');

  for (const o of orders) {
    const hay = buildShopifyAttributionHaystack(o);
    const utm = o.utm && typeof o.utm === 'object' ? o.utm : {};
    const termRaw = String(utm['utm_term'] || '').trim();
    const termDig = digitsOnlyKey(termRaw);

    let target: string | null = null;

    if (termDig.length >= 10) {
      const byTerm = rows.filter(
        (r) => termDig === digitsOnlyKey(String(r.id || '')) || termRaw === String(r.id || '').trim(),
      );
      const picked = pickSingleAdRowFromCandidates(byTerm, utm, hay, campaignRows, true);
      if (picked) target = String(picked.id).trim();
    }

    if (!target) {
      const contentRaw = String(utm['utm_content'] || '').trim();
      const contentDig = digitsOnlyKey(contentRaw);
      if (contentDig.length >= 10) {
        const byContent = rows.filter((r) => contentDig === digitsOnlyKey(String(r.id || '')));
        const picked = pickSingleAdRowFromCandidates(byContent, utm, hay, campaignRows, true);
        if (picked) target = String(picked.id).trim();
      }
    }

    if (!target) {
      const utmIdDig = digitsOnlyKey(String(utm['utm_id'] || '').trim());
      if (utmIdDig.length >= 10) {
        const byUtmId = rows.filter((r) => utmIdDig === digitsOnlyKey(String(r.id || '')));
        const picked = pickSingleAdRowFromCandidates(byUtmId, utm, hay, campaignRows, true);
        if (picked) target = String(picked.id).trim();
      }
    }

    if (!target) {
      const byName = adRowsMatchingUtmCreativeName(rows, utm);
      const picked = pickSingleAdRowFromCandidates(byName, utm, hay, campaignRows, true);
      if (picked) target = String(picked.id).trim();
    }

    if (!target && hay) {
      const idHits = adRowsWhoseIdAppearsInHaystack(rows, hay);
      const picked = pickSingleAdRowFromCandidates(idHits, utm, hay, campaignRows, true);
      if (picked) target = String(picked.id).trim();
    }

    if (!target && hay) {
      const adsetHits = rows.filter((r) => {
        const aid = String(r.adsetId || '').trim();
        return aid && haystackContainsMetaEntityId(hay, aid);
      });
      const picked = pickSingleAdRowFromCandidates(adsetHits, utm, hay, campaignRows, false);
      if (picked) target = String(picked.id).trim();
    }

    if (target) {
      countsByAd[target] = (countsByAd[target] || 0) + 1;
    }
  }
  return countsByAd;
}

function resolveOrderRevenueAmount(order: ShopifyOrderAttribution): number {
  const overrideRaw = order.price_override != null ? Number(order.price_override) : NaN;
  if (Number.isFinite(overrideRaw) && overrideRaw >= 0) return overrideRaw;
  const baseRaw = Number.parseFloat(String(order.shopifyTotal ?? order.total ?? '0').replace(',', '.'));
  if (Number.isFinite(baseRaw) && baseRaw >= 0) return baseRaw;
  return 0;
}

function buildSalesByAdFromOrders(rows: InsightRow[], orders: ShopifyOrderAttribution[]): Record<string, number> {
  const salesByAd: Record<string, number> = {};
  if (rows.length === 0 || orders.length === 0) return salesByAd;
  const campaignRows = campaignsFromInsightRows(rows, 'ads');
  for (const o of orders) {
    const hay = buildShopifyAttributionHaystack(o);
    const utm = o.utm && typeof o.utm === 'object' ? o.utm : {};
    const termRaw = String(utm['utm_term'] || '').trim();
    const termDig = digitsOnlyKey(termRaw);

    let target: string | null = null;

    if (termDig.length >= 10) {
      const byTerm = rows.filter(
        (r) => termDig === digitsOnlyKey(String(r.id || '')) || termRaw === String(r.id || '').trim(),
      );
      const picked = pickSingleAdRowFromCandidates(byTerm, utm, hay, campaignRows, true);
      if (picked) target = String(picked.id).trim();
    }

    if (!target) {
      const contentRaw = String(utm['utm_content'] || '').trim();
      const contentDig = digitsOnlyKey(contentRaw);
      if (contentDig.length >= 10) {
        const byContent = rows.filter((r) => contentDig === digitsOnlyKey(String(r.id || '')));
        const picked = pickSingleAdRowFromCandidates(byContent, utm, hay, campaignRows, true);
        if (picked) target = String(picked.id).trim();
      }
    }

    if (!target) {
      const utmIdDig = digitsOnlyKey(String(utm['utm_id'] || '').trim());
      if (utmIdDig.length >= 10) {
        const byUtmId = rows.filter((r) => utmIdDig === digitsOnlyKey(String(r.id || '')));
        const picked = pickSingleAdRowFromCandidates(byUtmId, utm, hay, campaignRows, true);
        if (picked) target = String(picked.id).trim();
      }
    }

    if (!target) {
      const byName = adRowsMatchingUtmCreativeName(rows, utm);
      const picked = pickSingleAdRowFromCandidates(byName, utm, hay, campaignRows, true);
      if (picked) target = String(picked.id).trim();
    }

    if (!target && hay) {
      const idHits = adRowsWhoseIdAppearsInHaystack(rows, hay);
      const picked = pickSingleAdRowFromCandidates(idHits, utm, hay, campaignRows, true);
      if (picked) target = String(picked.id).trim();
    }

    if (!target && hay) {
      const adsetHits = rows.filter((r) => {
        const aid = String(r.adsetId || '').trim();
        return aid && haystackContainsMetaEntityId(hay, aid);
      });
      const picked = pickSingleAdRowFromCandidates(adsetHits, utm, hay, campaignRows, false);
      if (picked) target = String(picked.id).trim();
    }

    if (target) {
      const amount = resolveOrderRevenueAmount(o);
      salesByAd[target] = (salesByAd[target] || 0) + amount;
    }
  }
  return salesByAd;
}

function buildSalesByCampaignFromOrders(
  rows: InsightRow[],
  level: InsightLevel,
  orders: ShopifyOrderAttribution[],
  productToCampaigns: Map<number, string[]>,
): Record<string, number> {
  const salesByCampaign: Record<string, number> = {};
  if (rows.length === 0 || orders.length === 0) return salesByCampaign;
  const campaignRows = campaignsFromInsightRows(rows, level);
  for (const o of orders) {
    const matchedCampaigns = attributeOrderToCampaigns(o, campaignRows, productToCampaigns);
    if (matchedCampaigns.size === 0) continue;
    const amount = resolveOrderRevenueAmount(o);
    for (const cid of matchedCampaigns) {
      salesByCampaign[cid] = (salesByCampaign[cid] || 0) + amount;
    }
  }
  return salesByCampaign;
}

function buildSalesByAdsetFromOrders(rows: InsightRow[], orders: ShopifyOrderAttribution[]): Record<string, number> {
  const salesByAdset: Record<string, number> = {};
  if (rows.length === 0 || orders.length === 0) return salesByAdset;
  const adsetRows = rows
    .map((r) => ({ id: String(r.id || '').trim(), campaignId: String(r.campaignId || '').trim() }))
    .filter((r) => Boolean(r.id));

  for (const o of orders) {
    const hay = buildShopifyAttributionHaystack(o);
    const utm = o.utm && typeof o.utm === 'object' ? o.utm : {};
    const termDig = digitsOnlyKey(String(utm['utm_term'] || '').trim());
    const contentDig = digitsOnlyKey(String(utm['utm_content'] || '').trim());
    const utmIdDig = digitsOnlyKey(String(utm['utm_id'] || '').trim());
    let target: string | null = null;

    if (termDig.length >= 10) {
      const byTerm = adsetRows.filter((r) => termDig === digitsOnlyKey(r.id));
      if (byTerm.length === 1) target = byTerm[0].id;
    }
    if (!target && contentDig.length >= 10) {
      const byContent = adsetRows.filter((r) => contentDig === digitsOnlyKey(r.id));
      if (byContent.length === 1) target = byContent[0].id;
    }
    if (!target && utmIdDig.length >= 10) {
      const byUtmId = adsetRows.filter((r) => utmIdDig === digitsOnlyKey(r.id));
      if (byUtmId.length === 1) target = byUtmId[0].id;
    }
    if (!target && hay) {
      const byHayAdset = adsetRows.filter((r) => haystackContainsMetaEntityId(hay, r.id));
      if (byHayAdset.length === 1) target = byHayAdset[0].id;
    }

    if (target) {
      const amount = resolveOrderRevenueAmount(o);
      salesByAdset[target] = (salesByAdset[target] || 0) + amount;
    }
  }
  return salesByAdset;
}

function shopifyComprasCountForAdRow(counts: Record<string, number>, row: InsightRow): number {
  const id = String(row.id || '').trim();
  if (!id) return 0;
  const d = digitsOnlyKey(id);
  return counts[id] ?? counts[d] ?? 0;
}

function shopifySalesAmountForInsightRow(salesById: Record<string, number>, row: InsightRow): number {
  const id = String(row.id || '').trim();
  if (!id) return 0;
  const d = digitsOnlyKey(id);
  const v = salesById[id] ?? salesById[d] ?? 0;
  return Number.isFinite(v) ? v : 0;
}

/** Meta a veces devuelve el mismo anuncio en más de una fila; deduplicamos por id para métricas y sumas. */
function dedupeInsightRowsById(inRows: InsightRow[], level: InsightLevel): InsightRow[] {
  if (level !== 'ads') return inRows;
  const seen = new Set<string>();
  const out: InsightRow[] = [];
  for (const r of inRows) {
    const id = String(r.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

/** Campañas únicas presentes en insights (nombre solo en nivel campañas). */
function campaignsFromInsightRows(rows: InsightRow[], level: InsightLevel): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const r of rows) {
    const cid = campaignIdForInsightRow(r, level);
    if (!cid) continue;
    if (level === 'campaigns') {
      map.set(cid, r.name || '');
    } else if (!map.has(cid)) {
      map.set(cid, '');
    }
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

/**
 * Cruza utm_campaign / utm_content de Shopify con id o nombre de campaña Meta.
 * utm_content solo se usa para coincidencia por id (muchas tiendas guardan ahí el id dinámico).
 */
function campaignsMatchedByUtm(
  utm: Record<string, string>,
  campaignRows: { id: string; name: string }[],
): Set<string> {
  const matched = new Set<string>();
  const campRaw = (utm['utm_campaign'] || '').trim();
  const contentRaw = (utm['utm_content'] || '').trim();

  for (const c of campaignRows) {
    const idStr = String(c.id || '').trim();
    if (!idStr) continue;
    const nameNorm = c.name ? normalizeAttributionKey(c.name) : '';

    if (campRaw) {
      const tNorm = normalizeAttributionKey(campRaw);
      const tDig = digitsOnlyKey(campRaw);
      const idDig = digitsOnlyKey(idStr);
      if (campRaw === idStr || (tDig.length > 0 && tDig === idDig)) {
        matched.add(idStr);
        continue;
      }
      if (nameNorm && tNorm && nameNorm === tNorm) {
        matched.add(idStr);
        continue;
      }
      if (nameNorm && tNorm && nameNorm.length >= 6 && tNorm.length >= 6) {
        if (tNorm.includes(nameNorm) || nameNorm.includes(tNorm)) {
          matched.add(idStr);
          continue;
        }
      }
    }

    if (contentRaw) {
      const cDig = digitsOnlyKey(contentRaw);
      const idDig = digitsOnlyKey(idStr);
      if (contentRaw === idStr || (cDig.length > 0 && cDig === idDig)) {
        matched.add(idStr);
      }
    }
  }

  return matched;
}

function productCampaignMatches(productIds: number[], productToCampaigns: Map<number, string[]>): Set<string> {
  const matched = new Set<string>();
  for (const pid of productIds) {
    for (const cid of productToCampaigns.get(pid) || []) {
      matched.add(cid);
    }
  }
  return matched;
}

/** Prioridad: UTMs en landing/referring (servidor); si no hay match, productos vinculados en KOVO. */
function attributeOrderToCampaigns(
  order: ShopifyOrderAttribution,
  campaignRows: { id: string; name: string }[],
  productToCampaigns: Map<number, string[]>,
): Set<string> {
  const utm = order.utm && typeof order.utm === 'object' ? order.utm : {};
  const byUtm = campaignsMatchedByUtm(utm, campaignRows);
  if (byUtm.size > 0) return byUtm;
  const pids = Array.isArray(order.productIds) ? order.productIds : [];
  return productCampaignMatches(pids, productToCampaigns);
}

/** effective_status de Meta: ACTIVE → pausar; PAUSED → reactivar. */
function campaignMetaControlKind(status: string): 'pause' | 'activate' | null {
  const u = String(status || '').toUpperCase();
  if (u === 'ACTIVE') return 'pause';
  if (u === 'PAUSED') return 'activate';
  return null;
}

const META_DELIVERY_BLUE = '#1877f2';
const META_DELIVERY_GREY = '#3a3d44';

/** Interruptor tipo Meta Ads Manager: azul encendido (activa), gris apagado (pausada). */
function MetaCampaignDeliveryToggle({
  rowStatus,
  busy,
  tokenBlocked,
  onPause,
  onActivate,
}: {
  rowStatus: string;
  busy: boolean;
  tokenBlocked: boolean;
  onPause: () => void;
  onActivate: () => void;
}) {
  const kind = campaignMetaControlKind(rowStatus);
  const isOn = kind === 'pause';
  const notEditable = kind === null;
  const disabled = tokenBlocked || notEditable || busy;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-busy={busy}
      aria-label={notEditable ? 'Estado no editable' : isOn ? 'Campaña activa, pausar en Meta' : 'Campaña pausada, activar en Meta'}
      disabled={disabled}
      onClick={() => {
        if (isOn) onPause();
        else onActivate();
      }}
      title={
        notEditable
          ? 'Solo se puede activar o pausar campañas en estado Activa o Pausada'
          : isOn
            ? 'Campaña activa en Meta — clic para pausar'
            : 'Campaña pausada — clic para activar'
      }
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        padding: 0,
        background: notEditable ? '#aeb0b8' : isOn ? META_DELIVERY_BLUE : META_DELIVERY_GREY,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: tokenBlocked ? 0.45 : 1,
        flexShrink: 0,
        boxSizing: 'border-box',
        transition: 'background 0.2s ease',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 2,
          left: isOn ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.28)',
          transition: 'left 0.2s ease',
        }}
      />
    </button>
  );
}

function buildRowTargetEvaluation(
  row: InsightRow,
  level: InsightLevel,
  links: Record<string, number[]>,
  targetsByProduct: Record<number, ProductMarketingTargets>,
) {
  const cid = campaignIdForInsightRow(row, level);
  const pids = cid ? links[cid] || [] : [];
  if (pids.length === 0) {
    return {
      rowHighlight: 'neutral' as const,
      cpm: 'neutral' as const,
      ctr: 'neutral' as const,
      cpc: 'neutral' as const,
      roas: 'neutral' as const,
      cpa: 'neutral' as const,
      tooltip:
        'Vincula productos Shopify a esta campaña (columna Productos) para comparar con los objetivos de Indicadores de marketing.',
    };
  }
  const agg = aggregateTargetsForProducts(pids, targetsByProduct);
  return evaluateInsightAgainstTargets(
    {
      cpm: row.cpm,
      ctr: row.ctr,
      cpc: row.cpc,
      roas: row.roas,
      cpa: row.cpa,
      purchases: row.purchases,
    },
    agg,
  );
}

export function MetaInsightsPanel({
  period,
  setPeriod,
}: {
  period: MetaInsightPeriod;
  setPeriod: (p: MetaInsightPeriod) => void;
}) {
  const [level, setLevel] = useState<InsightLevel>('campaigns');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [partialErrors, setPartialErrors] = useState<{ adAccountId: string; error: string }[]>([]);
  const [meta, setMeta] = useState<{ datePreset: string; fetchedAt: string } | null>(null);
  const [accountOptions, setAccountOptions] = useState<{ id: string; name: string }[]>([]);
  const [filterActId, setFilterActId] = useState('');
  const [campaignActivityFilter, setCampaignActivityFilter] = useState<CampaignActivityFilter>('active');
  const [filterProductId, setFilterProductId] = useState('');
  const [campaignProductLinks, setCampaignProductLinks] = useState<Record<string, number[]>>({});
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductOption[]>([]);
  const [shopifyCatalogOk, setShopifyCatalogOk] = useState(false);
  const [targetsByProduct, setTargetsByProduct] = useState<Record<number, ProductMarketingTargets>>({});
  const [pausingCampaignId, setPausingCampaignId] = useState<string | null>(null);
  const [campaignStatusBanner, setCampaignStatusBanner] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [shopifyPedidosByCampaign, setShopifyPedidosByCampaign] = useState<Record<string, number>>({});
  const [shopifyComprasByAd, setShopifyComprasByAd] = useState<Record<string, number>>({});
  const [shopifyVentasByLevel, setShopifyVentasByLevel] = useState<Record<string, number>>({});
  const [shopifyPedidosAvailable, setShopifyPedidosAvailable] = useState(false);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await apiFetch('/api/meta/selected-ad-accounts');
        if (!res.ok || c) return;
        const data = (await res.json()) as { accounts?: { id: string; name: string }[] };
        if (c) return;
        setAccountOptions(Array.isArray(data.accounts) ? data.accounts : []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await apiFetch('/api/meta/campaign-product-links');
        if (!res.ok || c) return;
        const data = (await res.json()) as { links?: Record<string, number[]> };
        if (c) return;
        const raw = data.links && typeof data.links === 'object' ? data.links : {};
        const next: Record<string, number[]> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (Array.isArray(v)) {
            next[k] = v.map((x) => Number.parseInt(String(x), 10)).filter((n) => Number.isFinite(n));
          }
        }
        setCampaignProductLinks(next);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await apiFetch('/api/shopify/products?limit=250');
        if (c) return;
        if (!res.ok) {
          setShopifyCatalogOk(false);
          setShopifyProducts([]);
          return;
        }
        const data = (await res.json()) as { products?: { id: number | string; title?: string }[] };
        const list = Array.isArray(data.products)
          ? data.products.map((p) => ({
              id: Number.parseInt(String(p.id), 10),
              title: String(p.title || '(sin título)'),
            }))
          : [];
        setShopifyCatalogOk(true);
        setShopifyProducts(list.filter((p) => Number.isFinite(p.id)));
      } catch {
        setShopifyCatalogOk(false);
        setShopifyProducts([]);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await apiFetch('/api/shopify/product-marketing-targets');
        if (!res.ok || c) return;
        const data = (await res.json()) as {
          targets?: {
            product_id: number;
            cpm_target: number | null;
            ctr_target: number | null;
            cpc_target: number | null;
            roas_target: number | null;
            cpa_target: number | null;
          }[];
        };
        const map: Record<number, ProductMarketingTargets> = {};
        for (const t of Array.isArray(data.targets) ? data.targets : []) {
          map[t.product_id] = {
            cpm_target: t.cpm_target,
            ctr_target: t.ctr_target,
            cpc_target: t.cpc_target,
            roas_target: t.roas_target,
            cpa_target: t.cpa_target,
          };
        }
        if (!c) setTargetsByProduct(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const handleCampaignProductsSaved = useCallback((campaignId: string, ids: number[]) => {
    setCampaignProductLinks((prev) => ({ ...prev, [campaignId]: ids }));
  }, []);

  const loadShopifyPedidosCounts = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        meta_period: period,
      });
      const res = await apiFetch(`/api/shopify/orders?${qs.toString()}`);
      const raw = (await res.json().catch(() => ({}))) as {
        code?: string;
        orders?: ShopifyOrderAttribution[];
      };
      if (!res.ok) {
        setShopifyPedidosByCampaign({});
        setShopifyComprasByAd({});
        setShopifyVentasByLevel({});
        setShopifyPedidosAvailable(false);
        return;
      }
      const orders = Array.isArray(raw.orders) ? raw.orders : [];
      const productToCampaigns = new Map<number, string[]>();
      for (const [cid, pids] of Object.entries(campaignProductLinks)) {
        for (const pid of pids) {
          if (!productToCampaigns.has(pid)) productToCampaigns.set(pid, []);
          productToCampaigns.get(pid)!.push(cid);
        }
      }
      const campaignRows = campaignsFromInsightRows(rows, level);
      const counts: Record<string, number> = {};
      for (const o of orders) {
        const matchedCampaigns = attributeOrderToCampaigns(o, campaignRows, productToCampaigns);
        for (const c of matchedCampaigns) {
          counts[c] = (counts[c] || 0) + 1;
        }
      }
      setShopifyPedidosByCampaign(counts);

      const countsByAd =
        level === 'ads' ? buildCountsByAdFromOrders(dedupeInsightRowsById(rows, level), orders) : {};
      setShopifyComprasByAd(countsByAd);
      const dedupedRows = dedupeInsightRowsById(rows, level);
      let salesByLevel: Record<string, number> = {};
      if (level === 'ads') {
        salesByLevel = buildSalesByAdFromOrders(dedupedRows, orders);
      } else if (level === 'campaigns') {
        salesByLevel = buildSalesByCampaignFromOrders(dedupedRows, level, orders, productToCampaigns);
      } else {
        salesByLevel = buildSalesByAdsetFromOrders(dedupedRows, orders);
      }
      setShopifyVentasByLevel(salesByLevel);

      setShopifyPedidosAvailable(true);
    } catch {
      setShopifyPedidosByCampaign({});
      setShopifyComprasByAd({});
      setShopifyVentasByLevel({});
      setShopifyPedidosAvailable(false);
    }
  }, [period, campaignProductLinks, rows, level]);

  useEffect(() => {
    void loadShopifyPedidosCounts();
  }, [loadShopifyPedidosCounts]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const st = String(row.status || '').toUpperCase();
      if (campaignActivityFilter === 'active' && st !== 'ACTIVE') return false;
      if (campaignActivityFilter === 'inactive' && st === 'ACTIVE') return false;

      if (!filterProductId.trim()) return true;
      const pid = Number.parseInt(filterProductId, 10);
      if (!Number.isFinite(pid)) return true;
      const cid = level === 'campaigns' ? String(row.id) : String(row.campaignId || '');
      if (!cid) return false;
      const linked = campaignProductLinks[cid] || [];
      return linked.includes(pid);
    });
  }, [rows, campaignActivityFilter, filterProductId, level, campaignProductLinks]);

  const tableRows = useMemo(() => dedupeInsightRowsById(filteredRows, level), [filteredRows, level]);

  const displayTotals = useMemo(() => {
    const base = filteredRows.reduce(
      (acc, x) => ({
        impressions: acc.impressions + x.impressions,
        clicks: acc.clicks + x.clicks,
        spend: acc.spend + x.spend,
        purchases: acc.purchases + x.purchases,
        revenue: acc.revenue + x.revenue,
      }),
      { impressions: 0, clicks: 0, spend: 0, purchases: 0, revenue: 0 },
    );
    const cpm = base.impressions > 0 ? (base.spend / base.impressions) * 1000 : 0;
    const cpc = base.clicks > 0 ? base.spend / base.clicks : 0;
    const ctr = base.impressions > 0 ? (base.clicks / base.impressions) * 100 : 0;
    const roas = base.spend > 0 && base.revenue > 0 ? base.revenue / base.spend : 0;
    const cpa = base.purchases > 0 ? base.spend / base.purchases : 0;
    return { ...base, cpm, cpc, ctr, roas, cpa };
  }, [filteredRows]);

  /** Pedidos Shopify atribuidos a cualquier anuncio de la lista (cada pedido cuenta una vez en total). */
  const shopifyComprasTotalAttributed = useMemo(
    () => Object.values(shopifyComprasByAd).reduce((a, n) => a + (Number(n) || 0), 0),
    [shopifyComprasByAd],
  );
  const shopifyVentasTotalAttributed = useMemo(
    () => Object.values(shopifyVentasByLevel).reduce((a, n) => a + (Number(n) || 0), 0),
    [shopifyVentasByLevel],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCode(null);
    try {
      const q = new URLSearchParams({ level, period });
      if (filterActId) q.set('adAccountId', filterActId);
      const res = await apiFetch(`/api/meta/insights?${q.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        rows?: InsightRow[];
        totals?: Totals;
        partialErrors?: { adAccountId: string; error: string }[];
        datePreset?: string;
        fetchedAt?: string;
      };
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar las métricas');
        setCode(typeof data.code === 'string' ? data.code : null);
        setRows([]);
        setTotals(null);
        setPartialErrors([]);
        setMeta(null);
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotals(data.totals ?? null);
      setPartialErrors(Array.isArray(data.partialErrors) ? data.partialErrors : []);
      setMeta(
        data.datePreset && data.fetchedAt
          ? { datePreset: data.datePreset, fetchedAt: data.fetchedAt }
          : null,
      );
    } catch {
      setError('Error de red al consultar Meta');
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [level, period, filterActId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tableColCount = level === 'campaigns' ? 15 : level === 'ads' ? 15 : 14;

  const setCampaignStatusOnMeta = useCallback(
    async (campaignId: string, name: string, next: 'PAUSED' | 'ACTIVE') => {
      const verb = next === 'PAUSED' ? 'pausar' : 'reactivar';
      if (!window.confirm(`¿${verb.charAt(0).toUpperCase() + verb.slice(1)} la campaña «${name}» en Meta Ads?`)) {
        return;
      }
      setCampaignStatusBanner(null);
      setPausingCampaignId(campaignId);
      try {
        const res = await apiFetch('/api/meta/campaign-status', {
          method: 'POST',
          body: JSON.stringify({ campaign_id: campaignId, status: next }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        if (!res.ok) {
          const hint =
            data.code === 'ads_management_required'
              ? ' Genera un token con permiso ads_management (además de ads_read) en Conexión Meta ADS.'
              : '';
          setCampaignStatusBanner({
            kind: 'err',
            text: (typeof data.error === 'string' ? data.error : 'No se pudo actualizar la campaña') + hint,
          });
          return;
        }
        setCampaignStatusBanner({
          kind: 'ok',
          text:
            next === 'PAUSED'
              ? `Campaña pausada en Meta: ${name}`
              : `Campaña reactivada en Meta: ${name}`,
        });
        await load();
      } catch {
        setCampaignStatusBanner({ kind: 'err', text: 'Error de red al contactar con Meta' });
      } finally {
        setPausingCampaignId(null);
      }
    },
    [load],
  );

  const periods: MetaInsightPeriod[] = ['hoy', 'ayer', '3d', '7d', '14d', '30d', 'custom'];

  type MetricCard = { label: string; value: string; title?: string };

  const metricCards: MetricCard[] = useMemo(() => {
    const metaComprasTitle =
      level === 'ads'
        ? 'Compras de sitio web que Meta atribuye a los anuncios de esta tabla (periodo del selector). Suele ser mayor que Shopify: ventana de atribución, view-through, modelado y conversiones sin pedido enlazable aquí. Para comparar con Ads Manager usa la misma pestaña (Campañas vs Anuncios) y los mismos filtros.'
        : 'Compras de sitio web que Meta atribuye a las filas visibles en este periodo.';

    const cards: MetricCard[] = [
      { label: 'Impresiones', value: formatNumber(displayTotals.impressions) },
      { label: 'Clics', value: formatNumber(displayTotals.clicks) },
      { label: 'Compras', value: formatNumber(displayTotals.purchases), title: metaComprasTitle },
    ];
    if (level === 'ads' && shopifyPedidosAvailable) {
      cards.push({
        label: 'Comp. Shopify (Σ)',
        value: formatNumber(shopifyComprasTotalAttributed),
        title:
          'Total de pedidos Shopify del periodo (calendario de la tienda) que se pudieron enlazar a algún anuncio de esta lista (UTMs, URL, nombre). Cada pedido cuenta una vez. No incluye pedidos sin señal clara ni anuncios fuera de la lista.',
      });
    }
    const roasValue =
      shopifyPedidosAvailable
        ? formatRoasMeta(displayTotals.spend > 0 ? shopifyVentasTotalAttributed / displayTotals.spend : 0)
        : formatRoasMeta(displayTotals.roas);

    cards.push(
      { label: 'CPA', value: displayTotals.purchases > 0 ? formatMoney2(displayTotals.cpa) : '—' },
      { label: 'Gasto', value: formatMoney2(displayTotals.spend) },
      { label: 'CPM', value: formatMoney2(displayTotals.cpm) },
      { label: 'CPC', value: formatMoney2(displayTotals.cpc) },
      { label: 'CTR', value: formatPct(displayTotals.ctr) },
      { label: 'ROAS', value: roasValue },
    );
    return cards;
  }, [displayTotals, level, shopifyPedidosAvailable, shopifyComprasTotalAttributed, shopifyVentasTotalAttributed]);

  const levelTabs: { id: InsightLevel; label: string }[] = [
    { id: 'campaigns', label: 'Campañas' },
    { id: 'adsets', label: 'Conjuntos de anuncios' },
    { id: 'ads', label: 'Anuncios' },
  ];

  const dataIssue = useMemo(
    () => resolveMetaDataIssue(partialErrors, error, code),
    [partialErrors, error, code],
  );

  const activityFilterCopy = useMemo(() => {
    if (level === 'campaigns') {
      return {
        active: 'Solo campañas activas',
        inactive: 'Solo campañas no activas',
        all: 'Todas (activas y no activas)',
      };
    }
    if (level === 'adsets') {
      return {
        active: 'Solo conjuntos activos',
        inactive: 'Solo conjuntos no activos',
        all: 'Todos (activos y no activos)',
      };
    }
    return {
      active: 'Solo anuncios activos',
      inactive: 'Solo anuncios no activos',
      all: 'Todos (activos y no activos)',
    };
  }, [level]);

  const tokenBlocked = dataIssue?.type === 'token_expired';

  return (
    <div>
      <MetaLiveDataStrip issue={dataIssue} meta={meta} variant="insights" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 3,
            padding: 3,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 24,
            background: ds.bgCard,
          }}
        >
          {periods.map((key) => {
            const active = period === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  borderRadius: 21,
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  whiteSpace: 'nowrap',
                  background: active ? ds.brand : 'transparent',
                  color: active ? '#ffffff' : ds.textMuted,
                }}
              >
                {PERIOD_LABELS[key]}
              </button>
            );
          })}
        </div>
        {accountOptions.length > 1 && (
          <select
            value={filterActId}
            onChange={(e) => setFilterActId(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${ds.borderCard}`,
              fontSize: 13,
              maxWidth: 280,
              background: ds.bgCard,
              color: ds.textPrimary,
            }}
          >
            <option value="">Todas las cuentas</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.id})
              </option>
            ))}
          </select>
        )}
        <select
          value={campaignActivityFilter}
          onChange={(e) => setCampaignActivityFilter(e.target.value as CampaignActivityFilter)}
          title="Filtra por estado efectivo en Meta (campaña, conjunto o anuncio según la pestaña)"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 13,
            maxWidth: 240,
            background: ds.bgCard,
            color: ds.textPrimary,
          }}
        >
          <option value="active">{activityFilterCopy.active}</option>
          <option value="inactive">{activityFilterCopy.inactive}</option>
          <option value="all">{activityFilterCopy.all}</option>
        </select>
        <select
          value={filterProductId}
          onChange={(e) => setFilterProductId(e.target.value)}
          title="Muestra solo filas cuya campaña tiene vinculado este producto"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            fontSize: 13,
            maxWidth: 260,
            background: ds.bgCard,
            color: ds.textPrimary,
          }}
        >
          <option value="">Todos los productos</option>
          {shopifyProducts.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            void load();
            void loadShopifyPedidosCounts();
          }}
          disabled={loading}
          style={{
            marginLeft: 'auto',
            padding: '7px 14px',
            borderRadius: 8,
            border: `1px solid ${ds.borderCard}`,
            background: ds.bgCard,
            color: ds.textSecondary,
            fontWeight: 500,
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 12,
          }}
        >
          {loading ? 'Actualizando…' : 'Actualizar datos'}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0,
          marginBottom: 18,
          borderBottom: `1px solid ${ds.borderCard}`,
        }}
      >
        {levelTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setLevel(t.id)}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: level === t.id ? 600 : 500,
              color: level === t.id ? ds.brand : ds.textMuted,
              borderBottom: level === t.id ? `2px solid ${ds.brand}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <MetaFetchErrorPanel error={error} code={code} />}

      {dataIssue && !error && <MetaDataIssueCard issue={dataIssue} />}

      {level === 'campaigns' ? (
        <p style={{ margin: '0 0 14px', fontSize: 12, color: ds.textMuted, maxWidth: 720, lineHeight: 1.45 }}>
          En <strong style={{ color: ds.textSecondary }}>Campañas</strong>, la columna <strong>Act.</strong> usa el mismo
          tipo de interruptor que Meta Ads Manager (azul = entregando, gris = pausada). Requiere{' '}
          <code style={{ fontSize: 11 }}>ads_management</code> en el token.
        </p>
      ) : null}

      {level === 'ads' ? (
        <p style={{ margin: '0 0 14px', fontSize: 12, color: ds.textMuted, maxWidth: 900, lineHeight: 1.45 }}>
          La columna <strong style={{ color: ds.textSecondary }}>Compras</strong> es la de Meta (píxel / conversiones
          del periodo). <strong>Compras Shopify</strong> es otra cosa: pedidos del checkout enlazados a cada anuncio por
          UTMs o URL. Por eso el total de Shopify suele ser <strong>menor</strong> que el de Meta (view-through, ventana
          de atribución, compras sin UTMs en el pedido, anuncios que no están en esta tabla, etc.). Si comparas con Ads
          Manager, revisa la misma vista (Campañas vs Anuncios) y filtros activos.
        </p>
      ) : null}

      {campaignStatusBanner ? (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.45,
            background: campaignStatusBanner.kind === 'ok' ? ds.successBg : ds.dangerBg,
            color: campaignStatusBanner.kind === 'ok' ? ds.successText : ds.dangerText,
            border: `1px solid ${ds.borderCard}`,
          }}
        >
          {campaignStatusBanner.text}
        </div>
      ) : null}

      {loading && !totals ? (
        <p style={{ color: ds.textMuted }}>Cargando métricas desde Meta…</p>
      ) : totals ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 14,
            marginBottom: 20,
          }}
        >
          {metricCards.map((m) => (
            <div
              key={m.label}
              title={m.title}
              style={{
                background: ds.bgCard,
                borderRadius: 14,
                padding: '18px 20px',
                border: `1px solid ${ds.borderCard}`,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 500, color: ds.textMuted, marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: ds.textPrimary }}>{m.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          background: ds.bgCard,
          borderRadius: 14,
          border: `1px solid ${ds.borderCard}`,
          overflow: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1040 }}>
          <thead>
            <tr style={{ background: ds.bgApp, textAlign: 'left' }}>
              {[
                'Cuenta publicitaria',
                ...(level === 'campaigns' ? ['Act.'] : []),
                level === 'campaigns' ? 'Campaña' : level === 'adsets' ? 'Conjunto' : 'Anuncio',
                'Estado',
                ...(level === 'campaigns' ? ['Productos (Shopify)'] : []),
                ...(level !== 'campaigns' ? ['ID ref.'] : []),
                'Impresiones',
                'Clics',
                'Compras',
                'CPA',
                'Gasto',
                'CPM',
                'CTR',
                'CPC',
                'ROAS',
                'ROAS SHOPIFY',
                ...(level === 'ads' ? ['Compras Shopify'] : []),
              ].map((h) => (
                <th
                  key={h}
                  title={
                    h === 'Compras Shopify'
                      ? 'Pedidos del mismo rango que Meta: fechas en calendario de la tienda Shopify. Atribución por id en utm_term / utm_content / utm_id, por nombre del anuncio (como en Meta), o por URL; un pedido = una fila. Pedidos con UTM pero sin anuncio en esta lista no suman aquí.'
                      : undefined
                  }
                  style={{
                    padding: '11px 16px',
                    fontWeight: 500,
                    fontSize: 10.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    color: ds.textHint,
                    borderBottom: `1px solid ${ds.borderCard}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={tableColCount}
                  style={{ padding: 24, color: ds.textMuted, textAlign: 'center', fontSize: 13 }}
                >
                  {tokenBlocked ? (
                    <>
                      Meta no devolvió filas porque el access token no es válido.{' '}
                      <strong style={{ color: ds.textSecondary }}>Renueva el token</strong> en la pestaña Conexión Meta ADS
                      y vuelve a actualizar.
                    </>
                  ) : rows.length === 0 ? (
                    <>
                      No hay filas con datos de insights en este período (puede que no haya entregas o que el token no
                      tenga permisos).
                    </>
                  ) : (
                    <>
                      Ninguna fila coincide con los filtros de estado de campaña o producto. Prueba &quot;Todas las
                      campañas&quot; o &quot;Todos los productos&quot;.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              tableRows.map((row) => {
                const ev = buildRowTargetEvaluation(row, level, campaignProductLinks, targetsByProduct);
                const rowBg = insightRowBg(ev.rowHighlight);
                const roasRealLevel =
                  shopifyPedidosAvailable
                    ? (() => {
                        const sales = shopifySalesAmountForInsightRow(shopifyVentasByLevel, row);
                        return row.spend > 0 && sales > 0 ? sales / row.spend : 0;
                      })()
                    : null;
                return (
                  <tr
                    key={`${row.adAccountId}-${row.id}`}
                    style={{
                      borderBottom: `1px solid ${ds.borderRow}`,
                      background: rowBg,
                    }}
                    title={ev.tooltip}
                  >
                    <td style={{ padding: '12px 16px', maxWidth: 160 }} title={row.adAccountId}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{row.adAccountName}</div>
                      <div style={{ fontSize: 10.5, color: ds.textHint }}>{row.adAccountId}</div>
                    </td>
                    {level === 'campaigns' ? (
                      <td style={{ padding: '12px 14px', verticalAlign: 'middle', width: 56 }}>
                        <MetaCampaignDeliveryToggle
                          rowStatus={row.status}
                          busy={pausingCampaignId === row.id}
                          tokenBlocked={tokenBlocked}
                          onPause={() => void setCampaignStatusOnMeta(row.id, row.name, 'PAUSED')}
                          onActivate={() => void setCampaignStatusOnMeta(row.id, row.name, 'ACTIVE')}
                        />
                      </td>
                    ) : null}
                    <td style={{ padding: '12px 16px', maxWidth: 220 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: ds.textPrimary }}>{row.name}</div>
                      <div style={{ fontSize: 10.5, color: ds.textHint }}>id {row.id}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>{row.status || '—'}</td>
                    {level === 'campaigns' ? (
                      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
                        <MetaCampaignProductAssign
                          campaignId={String(row.id)}
                          productIds={campaignProductLinks[String(row.id)] || []}
                          products={shopifyProducts}
                          shopifyOk={shopifyCatalogOk}
                          onUpdate={handleCampaignProductsSaved}
                        />
                      </td>
                    ) : null}
                    {level !== 'campaigns' && (
                      <td style={{ padding: '12px 16px', fontSize: 11, color: ds.textMuted, maxWidth: 100 }}>
                        {level === 'adsets' ? row.campaignId : row.adsetId}
                      </td>
                    )}
                    <td style={{ padding: '12px 16px' }}>{formatNumber(row.impressions)}</td>
                    <td style={{ padding: '12px 16px' }}>{formatNumber(row.clicks)}</td>
                    <td style={{ padding: '12px 16px' }}>{formatNumber(row.purchases)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.cpa) }}>
                      {row.purchases > 0 ? formatMoney2(row.cpa) : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>{formatMoney2(row.spend)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.cpm) }}>{formatMoney2(row.cpm)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.ctr) }}>{formatPct(row.ctr)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.cpc) }}>{formatMoney2(row.cpc)}</td>
                    <td style={{ padding: '12px 16px', background: insightMetricCellBg(ev.roas) }}>
                      {roasRealLevel != null ? formatRoasMeta(roasRealLevel) : formatRoasMeta(row.roas)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {roasRealLevel != null
                        ? formatRoasMeta(roasRealLevel)
                        : row.spend > 0 && row.revenue > 0
                          ? formatRoasMeta(row.revenue / row.spend)
                          : '—'}
                    </td>
                    {level === 'ads' && (
                      <td
                        style={{ padding: '12px 16px' }}
                        title="Atribución por id de anuncio en UTMs o URL; con varios ids se desempata por campaña/adset. Sin id de anuncio no se adivina entre varios del mismo adset"
                      >
                        {shopifyPedidosAvailable
                          ? formatNumber(shopifyComprasCountForAdRow(shopifyComprasByAd, row))
                          : '—'}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
