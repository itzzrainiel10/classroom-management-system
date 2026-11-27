import { useSyncExternalStore } from 'react';

/**
 * Accessibility settings: text size, contrast and theme. Saved in this browser only
 * (localStorage), applied to <html> as data-theme / data-contrast and the --text-scale variable.
 */
export type Theme = 'light' | 'dark' | 'system';
export type Contrast = 'normal' | 'high';
export type Prefs = { theme: Theme; contrast: Contrast; scale: number };

/** Text sizes offered, as a multiple of the normal size. */
export const SCALES = [0.9, 1, 1.125, 1.25, 1.375, 1.5];

const KEY = 'cvsu-cms-a11y';
const DEFAULTS: Prefs = { theme: 'light', contrast: 'normal', scale: 1 };
const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) {
      // First visit: follow the device's "increase contrast" setting.
      const more = window.matchMedia('(prefers-contrast: more)').matches;
      return { ...DEFAULTS, contrast: more ? 'high' : 'normal' };
    }
    return {
      theme: raw.theme === 'dark' || raw.theme === 'system' ? raw.theme : 'light',
      contrast: raw.contrast === 'high' ? 'high' : 'normal',
      scale: SCALES.includes(Number(raw.scale)) ? Number(raw.scale) : 1,
    };
  } catch {
    return DEFAULTS;
  }
}

let prefs: Prefs = load();
const listeners = new Set<() => void>();

function apply() {
  const root = document.documentElement;
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && !!darkQuery?.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  if (prefs.contrast === 'high') root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  root.style.setProperty('--text-scale', String(prefs.scale));
}

/** Call once before the app renders, so the page never flashes the wrong theme. */
export function initPrefs() {
  apply();
  darkQuery?.addEventListener('change', () => prefs.theme === 'system' && apply());
  // Keep other open tabs of this website in step.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    prefs = load();
    apply();
    listeners.forEach((l) => l());
  });
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: still applies for this visit */
  }
  apply();
  listeners.forEach((l) => l());
}

export function resetPrefs() {
  setPrefs(DEFAULTS);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => prefs,
  );
}
