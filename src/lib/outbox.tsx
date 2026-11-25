import * as Network from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import { useAuth } from './auth';
import { enqueue, flushOutbox, listOutbox, type OutboxOp } from './offline';

type OutboxValue = {
  pending: number;
  flushing: boolean;
  /** Bumps whenever uploads finish, so screens reload fresh data. */
  version: number;
  flush: () => Promise<void>;
  /** Save a change on the phone, then try to upload it right away. */
  save: (op: OutboxOp, label: string) => Promise<void>;
};

const OutboxContext = createContext<OutboxValue | null>(null);

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [pending, setPending] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const [version, setVersion] = useState(0);
  const running = useRef(false);

  const refresh = useCallback(async () => setPending((await listOutbox()).length), []);

  const flush = useCallback(async () => {
    if (status !== 'signed-in' || running.current) return;
    running.current = true;
    setFlushing(true);
    try {
      const r = await flushOutbox();
      if (r.rejected.length) Alert.alert('Some changes were not saved', r.rejected.join('\n'));
      if (r.sent || r.rejected.length) setVersion((v) => v + 1);
    } finally {
      running.current = false;
      setFlushing(false);
      await refresh();
    }
  }, [status, refresh]);

  const save = useCallback(
    async (op: OutboxOp, label: string) => {
      await enqueue(op, label);
      await refresh();
      setVersion((v) => v + 1);
      await flush();
    },
    [flush, refresh],
  );

  useEffect(() => {
    refresh();
    if (status === 'signed-in') flush();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') flush();
    });
    const net = Network.addNetworkStateListener((s) => {
      if (s.isConnected) flush();
    });
    return () => {
      app.remove();
      net.remove();
    };
  }, [status, flush, refresh]);

  return <OutboxContext.Provider value={{ pending, flushing, version, flush, save }}>{children}</OutboxContext.Provider>;
}

export function useOutbox() {
  const ctx = useContext(OutboxContext);
  if (!ctx) throw new Error('useOutbox must be used inside OutboxProvider');
  return ctx;
}
