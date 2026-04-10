import type { CSSProperties } from 'react';

/** Paleta alineada con el panel KOVO */
export const SIDEBAR = '#1a1a2e';
export const META_BLUE = '#1877f2';
export const SHOPIFY_GREEN = '#96bf48';
export const PAGE_BG = '#f4f5f7';
export const CARD_BG = '#ffffff';

export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid #d1d5db',
  fontSize: 15,
};

export const labelStyle: CSSProperties = {
  display: 'block',
  fontWeight: 600,
  color: '#374151',
  marginBottom: 8,
  fontSize: 14,
};

export const primaryButton: CSSProperties = {
  width: '100%',
  padding: '14px 20px',
  borderRadius: 10,
  border: 'none',
  background: META_BLUE,
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

export const linkStyle: CSSProperties = {
  color: META_BLUE,
  fontWeight: 600,
  textDecoration: 'none',
  fontSize: 14,
};
