/**
 * Cuenta las cookies legibles desde document.cookie en este origen.
 * No incluye cookies HttpOnly ni las de otros sitios.
 */
export const getBrowserCookieCount = (): number => {
  const cookies = document.cookie
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
  return cookies.length;
};
