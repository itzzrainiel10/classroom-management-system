import { useCallback, useEffect, useRef, useState } from 'react';

/** How often open pages re-check the server in the background. */
const AUTO_REFRESH_MS = 30_000;

/**
 * Loads data with `load`, re-running when `deps` change. Returns { data, error, loading, refresh }.
 * Auto refresh: quietly re-loads every 30 s while the tab is visible and as soon as the tab is shown again.
 * Background refreshes never show a loading state, and if nothing changed the previous object is kept,
 * so forms and screens built from the data are not reset.
 */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastJson = useRef<string | null>(null);
  const busy = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  const apply = useCallback((next: T) => {
    let json: string | null = null;
    try {
      json = JSON.stringify(next);
    } catch {
      json = null; // not serialisable: always update
    }
    if (json !== null && json === lastJson.current) return; // unchanged → keep the same object
    lastJson.current = json;
    setData(next);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      apply(await run());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [run, apply]);

  const quietRefresh = useCallback(async () => {
    if (busy.current || document.visibilityState !== 'visible') return;
    busy.current = true;
    try {
      apply(await run());
      setError(null);
    } catch {
      /* keep showing the last data; the next tick tries again */
    } finally {
      busy.current = false;
    }
  }, [run, apply]);

  useEffect(() => {
    lastJson.current = null;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => void quietRefresh(), AUTO_REFRESH_MS);
    const onShow = () => document.visibilityState === 'visible' && void quietRefresh();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [quietRefresh]);

  return { data, error, loading, refresh };
}
