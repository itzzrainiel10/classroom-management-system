import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cacheGet, cacheSet } from '@/lib/offline';
import { useOutbox } from '@/lib/outbox';

type State<T> = { data: T | undefined; loading: boolean; offline: boolean; savedAt: string | null; error: string | null };

/**
 * Server data with an offline copy: shows the phone's saved copy at once, then refreshes from
 * the server. `merge` adds changes still waiting to upload.
 */
export function useRemote<T>(key: string, fetcher: () => Promise<T>, merge?: (data: T) => Promise<T>) {
  const { version } = useOutbox();
  const [state, setState] = useState<State<T>>({ data: undefined, loading: true, offline: false, savedAt: null, error: null });
  const fetchRef = useRef(fetcher);
  const mergeRef = useRef(merge);
  useEffect(() => {
    fetchRef.current = fetcher;
    mergeRef.current = merge;
  });

  const load = useCallback(async () => {
    const m = mergeRef.current ?? (async (d: T) => d);
    const cached = await cacheGet<T>(key);
    if (cached) {
      const data = await m(cached.value);
      setState((s) => ({ ...s, data, savedAt: cached.savedAt }));
    }
    try {
      const fresh = await fetchRef.current();
      await cacheSet(key, fresh);
      const data = await m(fresh);
      setState({ data, loading: false, offline: false, savedAt: null, error: null });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        offline: true,
        error: cached ? null : e instanceof Error ? e.message : 'Could not load',
      }));
    }
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, version]),
  );

  return { ...state, refresh: load };
}
