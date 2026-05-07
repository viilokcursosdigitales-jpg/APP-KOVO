import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth/api';
import { ds } from '../design-system/ds';

type ContentItem = {
  id: number;
  type: 'banner' | 'alert' | 'news';
  title: string;
  description: string;
  image_url: string | null;
  link_url: string | null;
  link_text: string | null;
  color: 'green' | 'yellow' | 'red' | 'blue';
  active: boolean;
  order_index: number;
};

type DashboardContentPayload = {
  banners: ContentItem[];
  alerts: ContentItem[];
  news: ContentItem[];
};

function alertColors(color: ContentItem['color']) {
  if (color === 'green') return { bg: '#dcfce7', fg: '#166534', dot: '#16a34a' };
  if (color === 'yellow') return { bg: '#fef3c7', fg: '#92400e', dot: '#d97706' };
  if (color === 'red') return { bg: '#fee2e2', fg: '#991b1b', dot: '#dc2626' };
  return { bg: '#dbeafe', fg: '#1e3a8a', dot: '#2563eb' };
}

function linkProps(url: string | null) {
  const href = String(url || '').trim();
  if (!href) return null;
  const external = /^https?:\/\//i.test(href);
  return external ? { href, target: '_blank', rel: 'noreferrer noopener' } : { href };
}

export default function InicioEditorialPage() {
  const [payload, setPayload] = useState<DashboardContentPayload>({ banners: [], alerts: [], news: [] });
  const [loading, setLoading] = useState(true);
  const [activeBanner, setActiveBanner] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await apiFetch('/api/dashboard-content');
        const data = (await res.json().catch(() => ({}))) as Partial<DashboardContentPayload>;
        if (cancelled || !res.ok) return;
        setPayload({
          banners: Array.isArray(data.banners) ? data.banners : [],
          alerts: Array.isArray(data.alerts) ? data.alerts : [],
          news: Array.isArray(data.news) ? data.news : [],
        });
      } catch {
        if (!cancelled) setPayload({ banners: [], alerts: [], news: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const banners = payload.banners;
  const alerts = payload.alerts;
  const news = payload.news;
  const hasAny = banners.length > 0 || alerts.length > 0 || news.length > 0;

  useEffect(() => {
    if (banners.length <= 1) return;
    const id = window.setInterval(() => {
      setActiveBanner((prev) => (prev + 1) % banners.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [banners.length]);

  useEffect(() => {
    if (activeBanner >= banners.length) setActiveBanner(0);
  }, [activeBanner, banners.length]);

  const currentBanner = useMemo(() => {
    if (!banners.length) return null;
    return banners[Math.max(0, Math.min(activeBanner, banners.length - 1))];
  }, [activeBanner, banners]);

  if (loading) {
    return <div style={{ color: ds.textMuted, fontSize: 13 }}>Cargando contenido de Inicio…</div>;
  }

  if (!hasAny) {
    return (
      <div
        style={{
          minHeight: '56vh',
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 16,
          background: ds.bgCard,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <div
            style={{
              margin: '0 auto 14px',
              width: 58,
              height: 58,
              borderRadius: 14,
              background: ds.brand,
              color: ds.textOnBrand,
              fontWeight: 800,
              display: 'grid',
              placeItems: 'center',
              fontSize: 20,
            }}
          >
            K
          </div>
          <h1 style={{ margin: '0 0 8px', color: ds.textPrimary, fontSize: 24 }}>Bienvenido a KOVO</h1>
          <p style={{ margin: 0, color: ds.textSecondary, fontSize: 14 }}>
            Bienvenido a KOVO — Tu panel de gestión está listo
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {currentBanner ? (
        <section
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            border: `1px solid ${ds.borderCard}`,
            background: currentBanner.image_url
              ? `linear-gradient(rgba(15,23,42,0.45), rgba(15,23,42,0.65)), url(${currentBanner.image_url}) center/cover no-repeat`
              : 'linear-gradient(135deg, #1e293b, #334155)',
            color: '#fff',
            minHeight: 240,
            display: 'flex',
            alignItems: 'flex-end',
          }}
        >
          <div style={{ padding: 'clamp(16px, 2.2vw, 24px)', width: '100%' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 28, lineHeight: 1.1 }}>{currentBanner.title}</h2>
            <p style={{ margin: '0 0 12px', fontSize: 14, maxWidth: 760, opacity: 0.95 }}>{currentBanner.description}</p>
            {currentBanner.link_url ? (
              <a
                {...linkProps(currentBanner.link_url)}
                style={{
                  display: 'inline-block',
                  padding: '9px 14px',
                  borderRadius: 9,
                  background: '#fff',
                  color: '#0f172a',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {currentBanner.link_text || 'Ver más'}
              </a>
            ) : null}
            {banners.length > 1 ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                {banners.map((b, idx) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setActiveBanner(idx)}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      background: idx === activeBanner ? '#fff' : 'rgba(255,255,255,0.45)',
                    }}
                    aria-label={`Ir al banner ${idx + 1}`}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {alerts.length > 0 ? (
        <section
          style={{
            background: ds.bgCard,
            border: `1px solid ${ds.borderCard}`,
            borderRadius: 14,
            padding: 'clamp(16px, 2vw, 24px)',
          }}
        >
          <h3 style={{ margin: '0 0 10px', color: ds.textPrimary, fontSize: 16 }}>Alertas</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((item) => {
              const c = alertColors(item.color || 'blue');
              return (
                <div key={item.id} style={{ borderRadius: 10, padding: '10px 12px', background: c.bg, color: c.fg }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: c.dot }} />
                    <strong style={{ fontSize: 14 }}>{item.title}</strong>
                  </div>
                  <div style={{ fontSize: 13 }}>{item.description}</div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section
        style={{
          background: ds.bgCard,
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 14,
          padding: 'clamp(16px, 2vw, 24px)',
        }}
      >
        <h3 style={{ margin: '0 0 10px', color: ds.textPrimary, fontSize: 16 }}>Novedades y actualizaciones</h3>
        {news.length === 0 ? (
          <div style={{ padding: 12, borderRadius: 10, background: ds.bgApp, color: ds.textSecondary, fontSize: 13 }}>
            Bienvenido a KOVO. Pronto compartiremos novedades y actualizaciones aquí.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {news.map((item) => (
              <article key={item.id} style={{ border: `1px solid ${ds.borderCard}`, borderRadius: 12, padding: 12 }}>
                <h4 style={{ margin: '0 0 8px', color: ds.textPrimary, fontSize: 15 }}>{item.title}</h4>
                <p style={{ margin: 0, color: ds.textSecondary, fontSize: 13, lineHeight: 1.45 }}>{item.description}</p>
                {item.link_url ? (
                  <a
                    {...linkProps(item.link_url)}
                    style={{
                      marginTop: 10,
                      display: 'inline-block',
                      color: ds.brand,
                      fontWeight: 700,
                      fontSize: 12,
                      textDecoration: 'none',
                    }}
                  >
                    {item.link_text || 'Ver más'}
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
