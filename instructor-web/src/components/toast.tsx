import { useEffect, useState } from 'react';

import { Icon, type IconName } from './icons';

/**
 * Small toast notifications. Call `toast.success('Saved', 'details…')` from anywhere;
 * <Toaster /> (mounted once in main.tsx) shows them bottom-right and hides them after a few seconds.
 */
type Kind = 'success' | 'error' | 'warning' | 'info';
type Item = { id: number; kind: Kind; title: string; body?: string; leaving?: boolean };

let items: Item[] = [];
let nextId = 1;
const listeners = new Set<(l: Item[]) => void>();
const emit = () => listeners.forEach((fn) => fn([...items]));

function dismiss(id: number) {
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 200);
}

function push(kind: Kind, title: string, body?: string) {
  const id = nextId++;
  items = [...items.slice(-3), { id, kind, title, body }];
  emit();
  setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500);
}

export const toast = {
  success: (title: string, body?: string) => push('success', title, body),
  error: (title: string, body?: string) => push('error', title, body),
  warning: (title: string, body?: string) => push('warning', title, body),
  info: (title: string, body?: string) => push('info', title, body),
};

const ICON: Record<Kind, IconName> = { success: 'checkCircle', error: 'alert', warning: 'alert', info: 'info' };

export function Toaster() {
  const [list, setList] = useState<Item[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}${t.leaving ? ' leaving' : ''}`}>
          <span className="t-ic">
            <Icon name={ICON[t.kind]} size={18} />
          </span>
          <div>
            <b>{t.title}</b>
            {t.body ? <p>{t.body}</p> : null}
          </div>
          <button className="t-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
