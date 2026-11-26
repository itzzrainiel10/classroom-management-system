import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { cacheGet, cacheSet } from '@/lib/offline';
import { useOutbox } from '@/lib/outbox';

type State<T> = { data: T | undefined; loading: boolean; offline: boolean; savedAt: string | null; error: string | null };

/** How often an open screen re-checks the server in the background. */
const AUTO_REFRESH_MS = 30_000;

/**
 * Server data with an offline copy: shows the phone's saved copy at once, then refreshes from
 * the server. `merge` adds changes still waiting to upload.
 *
 * Auto refresh: while the screen is open it quietly re-checks the server every 30 s and whenever the
 * app comes back to the foreground. Quiet refreshes don't show loading, and if nothing changed the
 * previous object is kept, so forms on the screen are not reset.
 */
export function useRemote<T>(key: string, fetcher: () => Promise<T>, merge?: (data: T) => Promise<T>) {
  const { version } = useOutbox();
  const [state, setState] = useState<State<T>>({ data: undefined, loading: true, offline: false, savedAt: null, error: null });
  const fetchRef = useRef(fetcher);
  const mergeRef = useRef(merge);
  const lastJson = useRef<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    fetchRef.current = fetcher;
    mergeRef.current = merge;
  });

  /** Keep the same object when the content is unchanged (avoids resetting screens built from it). */
  const same = (data: T) => {
    try {
      const json = JSON.stringify(data);
      if (json === lastJson.current) return true;
      lastJson.current = json;
    } catch {
      lastJson.current = null;
    }
    return false;
  };

  const load = useCallback(async () => {
    const m = mergeRef.current ?? (async (d: T) => d);
    const cached = await cacheGet<T>(key);
    if (cached) {
      const data = await m(cached.value);
      if (!same(data)) setState((s) => ({ ...s, data, savedAt: cached.savedAt }));
    }
    try {
      const fresh = await fetchRef.current();
      await cacheSet(key, fresh);
      const data = await m(fresh);
      if (same(data)) setState((s) => ({ ...s, loading: false, offline: false, savedAt: null, error: null }));
      else setState({ data, loading: false, offline: false, savedAt: null, error: null });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        offline: true,
        error: cached ? null : e instanceof Error ? e.message : 'Could not load',
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Background check: server only (no cache flash), silent on failure. */
  const quiet = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const m = mergeRef.current ?? (async (d: T) => d);
      const fresh = await fetchRef.current();
      await cacheSet(key, fresh);
      const data = await m(fresh);
      if (!same(data)) setState({ data, loading: false, offline: false, savedAt: null, error: null });
      else setState((s) => (s.offline ? { ...s, offline: false, savedAt: null } : s));
    } catch {
      /* offline: keep the saved copy; the next tick tries again */
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      load();
      // While this screen is focused: re-check every 30 s and when the app returns to the foreground.
      const t = setInterval(() => void quiet(), AUTO_REFRESH_MS);
      const sub = AppState.addEventListener('change', (s) => s === 'active' && void quiet());
      return () => {
        clearInterval(t);
        sub.remove();
      };
    }, [load, quiet, version]),
  );

  return { ...state, refresh: load };
}
