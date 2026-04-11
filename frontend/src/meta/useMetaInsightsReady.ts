import { useEffect, useState } from 'react';
import { apiFetch } from '../auth/api';

export function useMetaInsightsReady() {
  const [state, setState] = useState<'loading' | 'yes' | 'no'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/meta/connections');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          connections?: Array<{ status: string; insights_ready?: boolean }>;
        };
        const conn = data.connections?.find((x) => x.status === 'connected');
        if (cancelled) return;
        setState(conn?.insights_ready ? 'yes' : 'no');
      } catch {
        if (!cancelled) setState('no');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
