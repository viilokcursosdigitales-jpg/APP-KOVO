/** Clasifica respuestas de Graph API (texto libre) para mensajes de UI. */

export type MetaDataIssueType = 'token_expired' | 'permissions' | 'other';

export type MetaDataIssue =
  | { type: 'token_expired'; sampleMessage?: string }
  | { type: 'permissions'; sampleMessage?: string }
  | { type: 'other'; partialErrors: { adAccountId: string; error: string }[] };

const TOKEN_RE =
  /session has expired|access token.*expir|error validating access token|\(190\)|\bcode\s*190\b|token is invalid|invalid.?oauth|session.?invalid/i;

const PERM_RE = /permission|ads_read|grant|OAuthException|missing permission|403/i;

export function resolveMetaDataIssue(
  partialErrors: { adAccountId: string; error: string }[],
  fetchError: string | null,
  fetchCode: string | null,
): MetaDataIssue | null {
  if (fetchCode === 'token_expired') {
    return { type: 'token_expired', sampleMessage: fetchError ?? undefined };
  }

  const blob = [fetchError ?? '', ...partialErrors.map((e) => e.error)].join('\n');

  if (TOKEN_RE.test(blob)) {
    const first = partialErrors.find((e) => TOKEN_RE.test(e.error));
    return { type: 'token_expired', sampleMessage: first?.error ?? fetchError ?? undefined };
  }

  if (partialErrors.length === 0 && !fetchError) return null;

  if (PERM_RE.test(blob) && partialErrors.length > 0) {
    const first = partialErrors.find((e) => PERM_RE.test(e.error));
    if (first) return { type: 'permissions', sampleMessage: first.error };
  }

  if (partialErrors.length > 0) {
    return { type: 'other', partialErrors };
  }

  return null;
}

export const META_CONEXION_TAB_PATH = '/conexion-meta';
