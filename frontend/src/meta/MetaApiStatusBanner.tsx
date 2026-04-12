import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ds } from '../design-system/ds';
import { META_CONEXION_TAB_PATH, type MetaDataIssue } from './metaDataIssues';

const linkBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: 14,
  padding: '8px 18px',
  borderRadius: 8,
  background: ds.brand,
  color: '#ffffff',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
  border: 'none',
  cursor: 'pointer',
};

const detailsStyle: CSSProperties = {
  marginTop: 14,
  fontSize: 12,
  color: ds.textSecondary,
};

export function MetaLiveDataStrip({
  issue,
  meta,
  variant = 'insights',
}: {
  issue: MetaDataIssue | null;
  meta: { datePreset: string; fetchedAt: string } | null;
  variant?: 'insights' | 'funnel';
}) {
  if (issue?.type === 'token_expired') {
    return (
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 13,
          color: ds.warningText,
          background: ds.warningBg,
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${ds.borderCard}`,
          maxWidth: 900,
        }}
      >
        <strong>Meta rechazó el token guardado.</strong> La conexión en KOVO sigue activa, pero hace falta un{' '}
        <strong>Access Token de usuario nuevo</strong> para volver a leer métricas.
        {meta && (
          <span style={{ display: 'block', marginTop: 6, fontSize: 12, fontWeight: 500, color: ds.warningText }}>
            Último intento: {new Date(meta.fetchedAt).toLocaleString('es-ES')} · preset: {meta.datePreset}
          </span>
        )}
      </p>
    );
  }

  if (issue?.type === 'permissions') {
    return (
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 13,
          color: ds.infoText,
          background: ds.infoBg,
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${ds.borderCard}`,
          maxWidth: 900,
        }}
      >
        <strong>Faltan permisos en el token de Meta.</strong> Vuelve a conectar y acepta los permisos de anuncios que pide
        la app.
        {meta && (
          <span style={{ display: 'block', marginTop: 6, fontSize: 12, fontWeight: 500, color: ds.infoText }}>
            Último intento: {new Date(meta.fetchedAt).toLocaleString('es-ES')} · preset: {meta.datePreset}
          </span>
        )}
      </p>
    );
  }

  if (variant === 'funnel') {
    return (
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 13,
          color: ds.infoText,
          background: ds.infoBg,
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${ds.borderCard}`,
          maxWidth: 920,
        }}
      >
        Embudo construido con los <strong>actions</strong> agregados que devuelve Meta por cuenta (insights a nivel
        cuenta). Los nombres de eventos dependen de tu pixel / CAPI; si falta un paso, verás 0 en esa etapa.
        {meta && (
          <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: ds.infoText }}>
            Actualizado: {new Date(meta.fetchedAt).toLocaleString('es-ES')} · preset: {meta.datePreset}
          </span>
        )}
      </p>
    );
  }

  return (
    <p
      style={{
        margin: '0 0 12px',
        fontSize: 13,
        color: ds.successText,
        background: ds.successBg,
        padding: '10px 14px',
        borderRadius: 8,
        border: `1px solid ${ds.borderCard}`,
        maxWidth: 900,
      }}
    >
      Métricas en vivo desde la API de Meta (Marketing API) para las cuentas publicitarias que elegiste al conectar. Los
      datos dependen del período seleccionado y pueden tardar unos segundos en cargar.
      {meta && (
        <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: ds.successText }}>
          Actualizado: {new Date(meta.fetchedAt).toLocaleString('es-ES')} · preset Meta: {meta.datePreset}
        </span>
      )}
    </p>
  );
}

export function MetaDataIssueCard({ issue }: { issue: MetaDataIssue }) {
  if (issue.type === 'token_expired') {
    return (
      <div
        style={{
          marginBottom: 16,
          padding: '18px 20px',
          borderRadius: 14,
          border: `1px solid ${ds.borderCard}`,
          background: ds.bgCard,
          maxWidth: 720,
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.textPrimary }}>
          Renovar access token de Meta
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: ds.textSecondary, lineHeight: 1.5 }}>
          Los tokens de usuario caducan (a veces en horas, a veces en semanas) o dejan de valer si cambias la contraseña o
          revocas permisos. KOVO sigue teniendo tu app y cuentas guardadas; solo necesitas generar un token nuevo con
          permisos de anuncios y guardarlo en la conexión.
        </p>
        <Link to={META_CONEXION_TAB_PATH} style={linkBtn}>
          Ir a Conexión Meta ADS
        </Link>
        {issue.sampleMessage ? (
          <details style={detailsStyle}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: ds.textPrimary }}>Mensaje de Meta</summary>
            <pre
              style={{
                margin: '8px 0 0',
                padding: 12,
                borderRadius: 8,
                background: ds.bgSubtle,
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: ds.textSecondary,
                border: `1px solid ${ds.borderRow}`,
              }}
            >
              {issue.sampleMessage}
            </pre>
          </details>
        ) : null}
      </div>
    );
  }

  if (issue.type === 'permissions') {
    return (
      <div
        style={{
          marginBottom: 16,
          padding: '18px 20px',
          borderRadius: 14,
          border: `1px solid ${ds.borderCard}`,
          background: ds.infoBg,
          maxWidth: 720,
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: ds.infoText }}>
          Permisos insuficientes en Meta
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: ds.textSecondary, lineHeight: 1.5 }}>
          El token no incluye los permisos necesarios (por ejemplo <code style={{ fontSize: 12 }}>ads_read</code>). Vuelve
          a conectar y acepta los permisos que pide la app.
        </p>
        <Link
          to={META_CONEXION_TAB_PATH}
          style={{ ...linkBtn, background: ds.infoText, marginTop: 14 }}
        >
          Revisar conexión
        </Link>
        {issue.sampleMessage ? (
          <details style={detailsStyle}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: ds.textPrimary }}>Detalle</summary>
            <pre
              style={{
                margin: '8px 0 0',
                padding: 12,
                borderRadius: 8,
                background: ds.bgCard,
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: ds.textSecondary,
                border: `1px solid ${ds.borderRow}`,
              }}
            >
              {issue.sampleMessage}
            </pre>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '16px 18px',
        borderRadius: 14,
        border: `1px solid ${ds.borderCard}`,
        background: ds.warningBg,
        maxWidth: 900,
      }}
    >
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: ds.warningText }}>
        Algunas cuentas no devolvieron datos
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: ds.textSecondary, lineHeight: 1.45 }}>
        Revisa cada cuenta abajo. Si el problema persiste, confirma que el token siga vigente en{' '}
        <Link to={META_CONEXION_TAB_PATH} style={{ color: ds.brand, fontWeight: 600 }}>
          Conexión Meta ADS
        </Link>
        .
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: ds.textSecondary }}>
        {issue.partialErrors.map((e) => (
          <li key={e.adAccountId} style={{ marginBottom: 8 }}>
            <strong style={{ color: ds.textPrimary }}>{e.adAccountId}</strong>
            <span style={{ display: 'block', marginTop: 2 }}>{e.error}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MetaFetchErrorPanel({
  error,
  code,
}: {
  error: string;
  code: string | null;
}) {
  const showConexion =
    code === 'no_token' || code === 'no_ad_accounts' || code === 'token_expired' || /token/i.test(error);

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '18px 20px',
        borderRadius: 14,
        border: `1px solid ${ds.borderCard}`,
        background: ds.dangerBg,
        color: ds.dangerText,
        fontSize: 13,
        maxWidth: 720,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 15 }}>No se pudieron obtener los datos de Meta</div>
      <div style={{ lineHeight: 1.5 }}>{error}</div>
      {code === 'no_ad_accounts' && (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: ds.dangerText }}>
          Elige al menos una cuenta publicitaria y guarda un token de usuario con permisos de anuncios.
        </p>
      )}
      {showConexion && (
        <Link to={META_CONEXION_TAB_PATH} style={{ ...linkBtn, background: ds.dangerText, marginTop: 14 }}>
          Abrir Conexión Meta ADS
        </Link>
      )}
    </div>
  );
}
