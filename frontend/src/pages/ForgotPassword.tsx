import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../auth/api';
import { ds } from '../design-system/ds';
import { CARD_BG, inputStyle, labelStyle, linkStyle, primaryButton } from './authStyles';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch(apiUrl('/api/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="kovo-auth-root">
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: CARD_BG,
          borderRadius: 14,
          padding: 'clamp(24px, 5vw, 40px)',
          border: `1px solid ${ds.borderCard}`,
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: ds.textPrimary }}>Recuperar contraseña</h1>
        <p style={{ margin: '0 0 24px', color: ds.textSecondary, fontSize: 13 }}>
          Te enviaremos instrucciones si el email está registrado
        </p>

        {sent ? (
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              background: '#f0fdf4',
              color: '#166534',
              fontSize: 15,
              lineHeight: 1.5,
              marginBottom: 20,
            }}
          >
            Si el email existe, recibirás las instrucciones para restablecer tu contraseña.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={labelStyle}>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ ...inputStyle, marginTop: 8 }}
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              style={{
                ...primaryButton,
                marginTop: 24,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.85 : 1,
              }}
            >
              {loading ? 'Enviando…' : 'Enviar instrucciones'}
            </button>
          </form>
        )}

        <p style={{ marginTop: 24, textAlign: 'center' }}>
          <Link to="/login" style={linkStyle}>
            Volver al login
          </Link>
        </p>
      </div>
    </div>
  );
}
