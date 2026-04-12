/**
 * Envío de correo vía SMTP (Nodemailer).
 * Configura SMTP_HOST, SMTP_USER, SMTP_PASS y opcionalmente SMTP_PORT, SMTP_SECURE, MAIL_FROM, PUBLIC_APP_URL.
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

function getPublicAppUrl() {
  const u =
    String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.VITE_APP_URL || '').trim() ||
    'http://localhost:5173';
  return u.replace(/\/$/, '');
}

function isMailConfigured() {
  return getSmtpConfig() != null;
}

/**
 * @param {{ to: string, organizationName: string, inviterName: string, roleLabel: string, acceptUrl: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, skipped?: boolean }>}
 */
async function sendInvitationEmail(opts) {
  const cfg = getSmtpConfig();
  if (!cfg) {
    return { ok: false, skipped: true };
  }
  const from = String(process.env.MAIL_FROM || '').trim() || cfg.auth.user;
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

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
    });
    await transporter.sendMail({
      from,
      to: opts.to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (e) {
    console.error('[mail] sendInvitationEmail:', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? String(e.message) : 'send_failed' };
  }
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
  isMailConfigured,
  sendInvitationEmail,
};
