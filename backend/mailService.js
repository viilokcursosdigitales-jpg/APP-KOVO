/**
 * Envío transaccional: Resend (API) o SMTP (Nodemailer).
 *
 * Resend: RESEND_API_KEY (+ RESEND_FROM con dominio verificado, o onboarding@resend.dev para pruebas).
 * SMTP: SMTP_HOST, SMTP_USER, SMTP_PASS (+ opcionales en .env.example).
 * Enlaces: PUBLIC_APP_URL (o FRONTEND_URL / VITE_APP_URL).
 */

const nodemailer = require('nodemailer');

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  if (!host || !user || !pass) return null;
  const port = parseInt(String(process.env.SMTP_PORT || '587'), 10) || 587;
  const secure =
    process.env.SMTP_SECURE === '1' ||
    process.env.SMTP_SECURE === 'true' ||
    port === 465;
  return { host, port, secure, auth: { user, pass } };
}

function getResendConfig() {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  if (!key) return null;
  const from = String(process.env.RESEND_FROM || 'KOVO <onboarding@resend.dev>').trim();
  return { key, from };
}

function getPublicAppUrl() {
  const u =
    String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.VITE_APP_URL || '').trim() ||
    'http://localhost:5173';
  return u.replace(/\/$/, '');
}

/** @returns {{ transport: 'resend' | 'smtp' | 'none', configured: boolean }} */
function getMailTransportInfo() {
  if (getResendConfig()) return { transport: 'resend', configured: true };
  if (getSmtpConfig()) return { transport: 'smtp', configured: true };
  return { transport: 'none', configured: false };
}

function isMailConfigured() {
  return getMailTransportInfo().configured;
}

/**
 * @param {{ to: string, subject: string, text: string, html: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, skipped?: boolean }>}
 */
async function sendViaResend(opts) {
  const cfg = getResendConfig();
  if (!cfg) return { ok: false, skipped: true };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        (typeof data.message === 'string' && data.message) ||
        (typeof data.error === 'string' && data.error) ||
        `HTTP ${res.status}`;
      console.error('[mail] Resend:', msg);
      return { ok: false, error: String(msg) };
    }
    return { ok: true };
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'Tiempo de espera agotado al contactar Resend' : e && e.message;
    console.error('[mail] Resend:', msg || e);
    return { ok: false, error: String(msg || 'send_failed') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ to: string, subject: string, text: string, html: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, skipped?: boolean }>}
 */
async function sendViaSmtp(opts) {
  const cfg = getSmtpConfig();
  if (!cfg) return { ok: false, skipped: true };

  const from = String(process.env.MAIL_FROM || '').trim() || cfg.auth.user;
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
      connectionTimeout: 18_000,
      greetingTimeout: 15_000,
      socketTimeout: 25_000,
    });
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { ok: true };
  } catch (e) {
    console.error('[mail] SMTP:', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? String(e.message) : 'send_failed' };
  }
}

/**
 * Prioridad: Resend si hay RESEND_API_KEY; si no, SMTP.
 * @param {{ to: string, subject: string, text: string, html: string }} opts
 */
async function sendTransactionalEmail(opts) {
  if (getResendConfig()) {
    return sendViaResend(opts);
  }
  if (getSmtpConfig()) {
    return sendViaSmtp(opts);
  }
  return { ok: false, skipped: true };
}

/**
 * @param {{ to: string, organizationName: string, inviterName: string, roleLabel: string, acceptUrl: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, skipped?: boolean }>}
 */
async function sendInvitationEmail(opts) {
  const subject = `Invitación a ${opts.organizationName} en KOVO`;
  const text = [
    `Hola,`,
    ``,
    `${opts.inviterName} te ha invitado a unirte al workspace «${opts.organizationName}» en KOVO con el rol: ${opts.roleLabel}.`,
    ``,
    `Para aceptar y crear tu cuenta, abre este enlace (válido unos días):`,
    opts.acceptUrl,
    ``,
    `Si no esperabas este correo, puedes ignorarlo.`,
    ``,
    `— KOVO`,
  ].join('\n');

  const html = `
    <p>Hola,</p>
    <p><strong>${escapeHtml(opts.inviterName)}</strong> te ha invitado a unirte al workspace
    <strong>${escapeHtml(opts.organizationName)}</strong> en KOVO con el rol: <strong>${escapeHtml(opts.roleLabel)}</strong>.</p>
    <p><a href="${escapeAttr(opts.acceptUrl)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Aceptar invitación</a></p>
    <p style="font-size:13px;color:#666;">O copia y pega esta URL en el navegador:<br/><span style="word-break:break-all;">${escapeHtml(opts.acceptUrl)}</span></p>
    <p style="font-size:13px;color:#666;">Si no esperabas este correo, puedes ignorarlo.</p>
    <p>— KOVO</p>
  `;

  return sendTransactionalEmail({ to: opts.to, subject, text, html });
}

/**
 * @param {{ to: string, resetUrl: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, skipped?: boolean }>}
 */
async function sendPasswordResetEmail(opts) {
  const subject = 'Restablecer contraseña en KOVO';
  const text = [
    `Hola,`,
    ``,
    `Has solicitado restablecer tu contraseña en KOVO.`,
    ``,
    `Abre este enlace (válido un tiempo limitado):`,
    opts.resetUrl,
    ``,
    `Si no fuiste tú, ignora este correo.`,
    ``,
    `— KOVO`,
  ].join('\n');

  const html = `
    <p>Hola,</p>
    <p>Has solicitado restablecer tu contraseña en KOVO.</p>
    <p><a href="${escapeAttr(opts.resetUrl)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Restablecer contraseña</a></p>
    <p style="font-size:13px;color:#666;">O copia esta URL:<br/><span style="word-break:break-all;">${escapeHtml(opts.resetUrl)}</span></p>
    <p style="font-size:13px;color:#666;">Si no fuiste tú, ignora este correo.</p>
    <p>— KOVO</p>
  `;

  return sendTransactionalEmail({ to: opts.to, subject, text, html });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

module.exports = {
  getPublicAppUrl,
  getMailTransportInfo,
  isMailConfigured,
  sendInvitationEmail,
  sendPasswordResetEmail,
};
