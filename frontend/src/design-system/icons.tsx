import type { CSSProperties, ReactNode } from 'react';

const iconBase: CSSProperties = {
  width: 15,
  height: 15,
  flexShrink: 0,
};

function strokeSvg(children: ReactNode, size = 15) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ ...iconBase, width: size, height: size }}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconLayout() {
  return strokeSvg(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>,
  );
}

export function IconCart() {
  return strokeSvg(
    <>
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M3 4h2l2 12h11l2-8H7" />
    </>,
  );
}

export function IconPackage() {
  return strokeSvg(
    <>
      <path d="M12 3l8 4v10l-8 4-8-4V7l8-4z" />
      <path d="M12 12l8-4" />
      <path d="M12 12v10" />
      <path d="M12 12L4 8" />
    </>,
  );
}

/** Analisis de producto */
export function IconProduct() {
  return strokeSvg(
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" />
      <path d="M4 15h16" />
      <path d="M6 19h2M11 19h2M16 19h2" />
    </>,
  );
}

/** Envío / mensajería (p. ej. Motico) */
export function IconTruck() {
  return strokeSvg(
    <>
      <path d="M14 18V6a2 2 0 00-2-2H4v14" />
      <path d="M14 9h4l3 3v5h-6" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>,
  );
}

export function IconMegaphone() {
  return strokeSvg(
    <>
      <path d="M3 11v4a2 2 0 002 2h1l4 3V6L6 9H5a2 2 0 00-2 2z" />
      <path d="M16 8a5 5 0 010 8" />
      <path d="M19 5a9 9 0 010 14" />
    </>,
  );
}

/** Objetivos / indicadores de marketing */
/** Embudo de ads / conversión */
export function IconFunnel() {
  return strokeSvg(
    <>
      <path d="M4 3h16l-2 6H6L4 3z" />
      <path d="M6 9h12l-2 6H8L6 9z" />
      <path d="M8 15h8l-2 7h-4l-2-7z" />
    </>,
  );
}

export function IconTarget() {
  return strokeSvg(
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>,
  );
}

/** Ganancia / tendencia diaria */
export function IconTrendingUp() {
  return strokeSvg(
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </>,
  );
}

export function IconShare() {
  return strokeSvg(
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.5 10.5l7-3" />
      <path d="M8.5 13.5l7 3" />
    </>,
  );
}

export function IconSettings() {
  return strokeSvg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>,
  );
}

export function IconUser() {
  return strokeSvg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 6-6 8-6s6.5 2 8 6" />
    </>,
  );
}

export function IconRefresh({ size = 13 }: { size?: number }) {
  return strokeSvg(
    <>
      <path d="M21 12a9 9 0 11-3-7" />
      <path d="M21 3v6h-6" />
    </>,
    size,
  );
}

export function IconPencil({ size = 16 }: { size?: number }) {
  return strokeSvg(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>,
    size,
  );
}

/** Calculadora COD / rentabilidad */
export function IconCalculadora() {
  return strokeSvg(
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h5M9 16h7" />
    </>,
  );
}

export function IconEmpty({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-hint)"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6M9 13h4" />
    </svg>
  );
}
