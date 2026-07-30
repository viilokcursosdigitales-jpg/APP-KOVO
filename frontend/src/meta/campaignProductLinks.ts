export type CampaignProductLinkDetail = {
  product_ids: number[];
  complementary_product_ids: number[];
};

export const EMPTY_CAMPAIGN_LINK: CampaignProductLinkDetail = {
  product_ids: [],
  complementary_product_ids: [],
};

export function normalizeCampaignLinkDetail(raw: unknown): CampaignProductLinkDetail {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CAMPAIGN_LINK };
  const o = raw as { product_ids?: unknown; complementary_product_ids?: unknown };
  const parse = (arr: unknown) =>
    Array.isArray(arr)
      ? arr.map((x) => Number.parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
  return {
    product_ids: parse(o.product_ids),
    complementary_product_ids: parse(o.complementary_product_ids),
  };
}

export function campaignLinkHasPrimary(link: CampaignProductLinkDetail | undefined): boolean {
  return (link?.product_ids?.length ?? 0) > 0;
}

export function campaignLinkHasAnyProduct(link: CampaignProductLinkDetail | undefined): boolean {
  return campaignLinkHasPrimary(link) || (link?.complementary_product_ids?.length ?? 0) > 0;
}

export function campaignLinkIncludesProduct(link: CampaignProductLinkDetail | undefined, pid: number): boolean {
  if (!link) return false;
  return link.product_ids.includes(pid) || link.complementary_product_ids.includes(pid);
}

export function parseCampaignLinkDetailsFromApi(data: {
  links?: Record<string, number[]>;
  linkDetails?: Record<string, CampaignProductLinkDetail | unknown>;
}): Record<string, CampaignProductLinkDetail> {
  const out: Record<string, CampaignProductLinkDetail> = {};
  const details = data.linkDetails && typeof data.linkDetails === 'object' ? data.linkDetails : {};
  for (const [cid, raw] of Object.entries(details)) {
    out[cid] = normalizeCampaignLinkDetail(raw);
  }
  const legacy = data.links && typeof data.links === 'object' ? data.links : {};
  for (const [cid, ids] of Object.entries(legacy)) {
    if (out[cid]) continue;
    out[cid] = {
      product_ids: Array.isArray(ids)
        ? ids.map((x) => Number.parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n > 0)
        : [],
      complementary_product_ids: [],
    };
  }
  return out;
}
