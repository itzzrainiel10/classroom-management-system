import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';

import { supabase } from './supabase';

/**
 * Offline layer on Expo SQLite:
 * - `cache`: last server copy of every screen's data, so screens open without signal.
 * - `outbox`: changes made on this phone, uploaded in order when back online.
 */

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let scope: string | null = null;

export function setCacheScope(userId: string | null) {
  scope = userId;
}

function db() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('cms.db').then(async (d) => {
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, saved_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          op TEXT NOT NULL,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      return d;
    });
  }
  return dbPromise;
}

const scoped = (key: string) => `${scope ?? 'anon'}:${key}`;

export async function cacheGet<T>(key: string): Promise<{ value: T; savedAt: string } | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string; saved_at: string }>('SELECT value, saved_at FROM cache WHERE key = ?', scoped(key));
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, savedAt: row.saved_at };
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown) {
  const d = await db();
  await d.runAsync(
    'INSERT INTO cache (key, value, saved_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, saved_at = excluded.saved_at',
    scoped(key),
    JSON.stringify(value),
    new Date().toISOString(),
  );
}

export type OutboxOp =
  | { kind: 'insert'; table: string; row: Record<string, unknown> }
  | { kind: 'update'; table: string; id: string; patch: Record<string, unknown> }
  | { kind: 'delete'; table: string; id: string }
  | { kind: 'rpc'; fn: string; args: Record<string, unknown>; table?: string; preview?: Record<string, unknown> };

export type OutboxItem = { id: number; op: OutboxOp; label: string; created_at: string };

export async function enqueue(op: OutboxOp, label: string) {
  const d = await db();
  await d.runAsync(
    'INSERT INTO outbox (user_id, op, label, created_at) VALUES (?, ?, ?, ?)',
    scope ?? 'anon',
    JSON.stringify(op),
    label,
    new Date().toISOString(),
  );
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ id: number; op: string; label: string; created_at: string }>(
    'SELECT id, op, label, created_at FROM outbox WHERE user_id = ? ORDER BY id',
    scope ?? 'anon',
  );
  return rows.map((r) => ({ id: r.id, op: JSON.parse(r.op) as OutboxOp, label: r.label, created_at: r.created_at }));
}

/** Rows waiting to upload for one table, so lists can show them right away. */
export async function pendingRows<T>(table: string): Promise<(T & { _pending: true })[]> {
  const items = await listOutbox();
  const out: (T & { _pending: true })[] = [];
  for (const { op } of items) {
    if (op.kind === 'insert' && op.table === table) out.push({ ...(op.row as T), _pending: true });
    if (op.kind === 'rpc' && op.table === table && op.preview) out.push({ ...(op.preview as T), _pending: true });
  }
  return out;
}

export async function pendingDeletes(table: string): Promise<Set<string>> {
  const items = await listOutbox();
  return new Set(items.flatMap(({ op }) => (op.kind === 'delete' && op.table === table ? [op.id] : [])));
}

export async function isOnline() {
  try {
    const s = await Network.getNetworkStateAsync();
    return s.isConnected !== false && s.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/** Server-side refusals have an error code; network failures do not. */
function isPermanent(error: { code?: string } | null) {
  return Boolean(error?.code);
}

export type FlushResult = { sent: number; rejected: string[]; offline: boolean };

export async function flushOutbox(): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: [], offline: false };
  const client = supabase;
  if (!client || !scope) return result;
  if (!(await isOnline())) return { ...result, offline: true };
  const d = await db();
  for (const item of await listOutbox()) {
    const { op } = item;
    let error: { code?: string; message: string } | null = null;
    try {
      if (op.kind === 'insert') {
        ({ error } = await client.from(op.table).upsert(op.row, { onConflict: 'id', ignoreDuplicates: true }));
      } else if (op.kind === 'update') {
        ({ error } = await client.from(op.table).update(op.patch).eq('id', op.id));
      } else if (op.kind === 'delete') {
        ({ error } = await client.from(op.table).delete().eq('id', op.id));
      } else {
        ({ error } = await client.rpc(op.fn, op.args));
      }
    } catch (e) {
      error = { message: e instanceof Error ? e.message : 'Network error' };
    }
    if (error && !isPermanent(error)) {
      result.offline = true;
      break; // keep order: try again later
    }
    if (error) result.rejected.push(`${item.label}: ${error.message}`);
    else result.sent += 1;
    await d.runAsync('DELETE FROM outbox WHERE id = ?', item.id);
  }
  return result;
}
