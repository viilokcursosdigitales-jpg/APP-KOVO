import { useEffect, useState } from 'react';
import { apiFetch } from '../auth/api';
import { useAuth } from '../auth/AuthContext';

/** Disparar con `window.dispatchEvent` tras guardar / actualizar / desconectar Meta en Conexión con Meta. */
export const KOVO_META_CONNECTION_EVENT = 'kovo-meta-connection-changed';

export function useMetaInsightsReady() {
  const { token, isLoading } = useAuth();
  const [state, setState] = useState<'loading' | 'yes' | 'no'>('loading');

  useEffect(() => {
    if (isLoading) return;

    let cancelled = false;

    async function fetchReady(silent?: boolean) {
      if (!token) {
        if (!cancelled) setState('no');
        return;
      }
      if (!silent && !cancelled) setState('loading');
      try {
        const res = await apiFetch('/api/meta/connections');
        if (cancelled) return;
        if (!res.ok) {
          setState('no');
          return;
        }
        const data = (await res.json()) as {
          connections?: Array<{ status: string; insights_ready?: boolean }>;
        };
        const conn = data.connections?.find((x) => x.status === 'connected');
        if (cancelled) return;
        setState(conn?.insights_ready ? 'yes' : 'no');
      } catch {
        if (!cancelled) setState('no');
      }
    }

    void fetchReady();

    const onMetaChanged = () => {
      void fetchReady(true);
    };
    window.addEventListener(KOVO_META_CONNECTION_EVENT, onMetaChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(KOVO_META_CONNECTION_EVENT, onMetaChanged);
    };
  }, [token, isLoading]);

  return state;
}
