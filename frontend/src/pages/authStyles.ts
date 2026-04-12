import type { CSSProperties } from 'react';
import { ds } from '../design-system/ds';

export const SIDEBAR = ds.textPrimary;
export const META_BLUE = ds.brand;
export const SHOPIFY_GREEN = ds.successText;
export const PAGE_BG = ds.bgApp;
export const CARD_BG = ds.bgCard;

export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 12px',
  borderRadius: 8,
  border: `1px solid ${ds.borderCard}`,
  fontSize: 13,
  color: ds.textPrimary,
};

export const labelStyle: CSSProperties = {
  display: 'block',
  fontWeight: 500,
  color: ds.textSecondary,
  marginBottom: 6,
  fontSize: 12,
};

export const primaryButton: CSSProperties = {
  width: '100%',
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  background: ds.brand,
  color: '#ffffff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

export const linkStyle: CSSProperties = {
  color: ds.brand,
  fontWeight: 600,
  textDecoration: 'none',
  fontSize: 13,
};
