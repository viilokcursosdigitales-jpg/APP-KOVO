'use strict';

const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;

function metaSnapshotIsFresh(fetchedAtIso) {
  if (!fetchedAtIso) return false;
  const t = Date.parse(String(fetchedAtIso));
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < TWENTY_FOUR_H_MS;
}

function setMetaDataHeaders(res, source, fresh) {
  res.setHeader('X-Data-Source', source);
  if (fresh !== undefined) {
    res.setHeader('X-Data-Fresh', fresh ? 'true' : 'false');
  }
}

/**
 * Cache → snapshot inmediato → refresh en background → (fallback sync live).
 * @param {import('express').Response} res
 * @param {{ cacheKey: string, cacheTtl: number, readCache: (k: string) => any, writeCache: (k: string, p: any, ttl: number) => void, getSnapshot: () => { payload: any, fetchedAt?: string } | null, fetchLive: () => Promise<any> }} opts
 */
async function respondMetaStaleFirst(res, opts) {
  const { cacheKey, cacheTtl, readCache, writeCache, getSnapshot, fetchLive } = opts;

  const cached = readCache(cacheKey);
  if (cached) {
    setMetaDataHeaders(res, 'cache', true);
    return res.json(cached);
  }

  const snap = getSnapshot();
  if (snap && snap.payload) {
    const fresh = metaSnapshotIsFresh(snap.fetchedAt);
    setMetaDataHeaders(res, 'snapshot', fresh);
    res.json(snap.payload);
    setImmediate(() => {
      fetchLive()
        .then((live) => {
          if (live) writeCache(cacheKey, live, cacheTtl);
        })
        .catch((err) => {
          console.error('[meta-bg-refresh]', err && err.message ? err.message : err);
        });
    });
    return;
  }

  const live = await fetchLive();
  setMetaDataHeaders(res, 'live', true);
  if (live) writeCache(cacheKey, live, cacheTtl);
  return res.json(live);
}

module.exports = {
  metaSnapshotIsFresh,
  respondMetaStaleFirst,
  setMetaDataHeaders,
};
