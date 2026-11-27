// CMS design tokens (from the CvSU palette). Screens read colors and sizes from here only.
//
// Accessibility (Settings → Accessibility): theme (light / dark / device), high contrast and text size.
// `colors` and `text` are swapped in place when a setting changes, styles made with `themed()` rebuild
// themselves, and the root layout re-mounts the app so every screen picks up the new values.
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

const light = {
  primary: '#075B39', // Deep Green
  primaryDark: '#05452B', // Pressed / deeper surfaces
  onPrimary: '#FFFFFF',
  primarySoft: '#E9F2EC', // Pale Sage Green
  mint: '#DCE7DF', // Pale Mint Green
  gold: '#F4CF3F', // Golden Yellow
  goldSoft: '#FDF6D8',
  goldLine: '#F3E3A0',
  goldInk: '#7A5F00', // Gold-toned text on light backgrounds
  partial: '#B98900', // Partly correct answers
  text: '#1D2A23', // Near-black with a green cast: crisper than grey on white
  textSoft: '#5F6F66', // Secondary text
  muted: '#8B9A90', // Placeholders, inactive icons
  slate: '#8498AF',
  background: '#F4F6F3', // Warm off-white so white cards stand out
  card: '#FFFFFF',
  line: '#E4EAE5', // Hairlines and outlines
  track: '#E8EDE9', // Segmented control / progress track
  tableHead: '#EEF2EF',
  tableLine: '#D5DDD7',
  rowAlt: '#F8FAF8',
  unread: '#FFFDF3',
  danger: '#B3261E',
  dangerSoft: '#FBE9E7',
  dangerLine: '#F2D3CF',
  onPrimarySoft: 'rgba(255,255,255,0.78)',
};
export type Palette = { [K in keyof typeof light]: string };

const dark: Palette = {
  // Pure black (true dark) surfaces; CvSU green only for buttons, links and accents.
  primary: '#2F9467',
  primaryDark: '#247552',
  onPrimary: '#FFFFFF',
  primarySoft: '#13241B',
  mint: '#1A2A21',
  gold: '#F4CF3F',
  goldSoft: '#2A230C',
  goldLine: '#5C4A16',
  goldInk: '#F2CF6B',
  partial: '#F0C24E',
  text: '#F2F2F2',
  textSoft: '#B3B3B3',
  muted: '#8A8A8A',
  slate: '#9DB0C4',
  background: '#000000',
  card: '#121212',
  line: '#262626',
  track: '#1C1C1C',
  tableHead: '#181818',
  tableLine: '#2A2A2A',
  rowAlt: '#0A0A0A',
  unread: '#1F1A0A',
  danger: '#FF8A80',
  dangerSoft: '#2E1513',
  dangerLine: '#6B302A',
  onPrimarySoft: 'rgba(255,255,255,0.8)',
};

const lightHigh: Palette = {
  ...light,
  primary: '#04432A',
  primaryDark: '#022E1C',
  primarySoft: '#DDEBE2',
  mint: '#B9CDBF',
  goldInk: '#5C4700',
  partial: '#7A5A00',
  text: '#000000',
  textSoft: '#1F2A24',
  muted: '#3E4A43',
  line: '#7D8C83',
  track: '#D3DDD6',
  tableLine: '#7D8C83',
  goldLine: '#7A5F00',
  danger: '#8C1A13',
  dangerLine: '#8C1A13',
  onPrimarySoft: 'rgba(255,255,255,0.92)',
};

const darkHigh: Palette = {
  ...dark,
  primary: '#5FD39C',
  primaryDark: '#3FB37D',
  onPrimary: '#04140C',
  onPrimarySoft: 'rgba(4,20,12,0.85)',
  primarySoft: '#123325',
  mint: '#1E3A2C',
  goldInk: '#FFD76E',
  partial: '#FFD76E',
  text: '#FFFFFF',
  textSoft: '#E6ECE8',
  muted: '#C2CEC7',
  background: '#000000',
  card: '#0E0F11',
  line: '#6F8A7C',
  track: '#1A2A22',
  tableLine: '#6F8A7C',
  goldLine: '#FFD76E',
  danger: '#FFB0A8',
  dangerLine: '#FFB0A8',
};

export type ThemeChoice = 'light' | 'dark' | 'system';
export type A11yPrefs = { theme: ThemeChoice; contrast: 'normal' | 'high'; scale: number };
/** Text sizes offered in Settings, as a multiple of the normal size. */
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3, 1.5];
const DEFAULTS: A11yPrefs = { theme: 'light', contrast: 'normal', scale: 1 };
const KEY = 'cms.a11y';

function loadPrefs(): A11yPrefs {
  try {
    const raw = JSON.parse(Storage.getItemSync(KEY) ?? 'null') as Partial<A11yPrefs> | null;
    if (!raw) return DEFAULTS;
    return {
      theme: raw.theme === 'dark' || raw.theme === 'system' ? raw.theme : 'light',
      contrast: raw.contrast === 'high' ? 'high' : 'normal',
      scale: TEXT_SCALES.includes(Number(raw.scale)) ? Number(raw.scale) : 1,
    };
  } catch {
    return DEFAULTS;
  }
}

let prefs = loadPrefs();
let version = 0;
const listeners = new Set<() => void>();

export const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && Appearance.getColorScheme() === 'dark');
const palette = (): Palette => (isDark() ? (prefs.contrast === 'high' ? darkHigh : dark) : prefs.contrast === 'high' ? lightHigh : light);

/** Current colors (swapped in place when the theme changes). */
export const colors: Palette = { ...palette() };

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

/** Soft, layered shadows (CSS syntax; works on iOS, Android and web). */
export const shadow = {
  sm: { boxShadow: '0px 1px 2px rgba(16, 42, 28, 0.06), 0px 2px 8px rgba(16, 42, 28, 0.05)' },
  md: { boxShadow: '0px 2px 4px rgba(16, 42, 28, 0.06), 0px 8px 24px rgba(16, 42, 28, 0.08)' },
  lg: { boxShadow: '0px 4px 8px rgba(16, 42, 28, 0.08), 0px 16px 40px rgba(16, 42, 28, 0.14)' },
  primary: { boxShadow: '0px 4px 14px rgba(7, 91, 57, 0.28)' },
} as const;

const makeText = (c: Palette, s: number) =>
  ({
    display: { fontSize: 28 * s, fontWeight: '800', letterSpacing: -0.6, lineHeight: 34 * s, color: c.text },
    h1: { fontSize: 21 * s, fontWeight: '800', letterSpacing: -0.3, color: c.text },
    h2: { fontSize: 16 * s, fontWeight: '700', letterSpacing: -0.1, color: c.text },
    body: { fontSize: 15 * s, color: c.text, lineHeight: 22 * s },
    caption: { fontSize: 13 * s, color: c.textSoft, lineHeight: 18 * s },
    label: { fontSize: 11 * s, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', color: c.muted },
  }) as const;

/** Text styles (swapped in place when the theme or text size changes). */
export const text = makeText(colors, prefs.scale);

function apply() {
  Object.assign(colors, palette());
  Object.assign(text, makeText(colors, prefs.scale));
  version++;
  listeners.forEach((l) => l());
}

Appearance.addChangeListener(() => prefs.theme === 'system' && apply());

/** Multiplies fontSize / lineHeight in every style of a style sheet by the text-size setting. */
function scaleFonts<T extends object>(sheet: T): T {
  if (prefs.scale === 1) return sheet;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sheet)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const st = { ...(v as Record<string, unknown>) };
      if (typeof st.fontSize === 'number') st.fontSize = st.fontSize * prefs.scale;
      if (typeof st.lineHeight === 'number') st.lineHeight = st.lineHeight * prefs.scale;
      out[k] = st;
    } else out[k] = v;
  }
  return out as T;
}

/**
 * Wrap a module-level style sheet (or any object built from `colors`): it is rebuilt with the current
 * colors and text size whenever an accessibility setting changes.
 *   const styles = themed(() => StyleSheet.create({ ... }));
 */
export function themed<T extends object>(factory: () => T): T {
  let cache: { v: number; value: T } | null = null;
  const cur = () => {
    if (!cache || cache.v !== version) cache = { v: version, value: scaleFonts(factory()) };
    return cache.value as Record<PropertyKey, unknown>;
  };
  return new Proxy({} as T, {
    get: (_, k) => cur()[k],
    has: (_, k) => k in cur(),
    ownKeys: () => Reflect.ownKeys(cur()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(cur(), k);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

export function getA11y() {
  return prefs;
}

export function setA11y(patch: Partial<A11yPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    Storage.setItemSync(KEY, JSON.stringify(prefs));
  } catch {
    /* still applies until the app closes */
  }
  apply();
}

export const resetA11y = () => setA11y(DEFAULTS);

/** Changes whenever the theme or text size changes; the root layout re-mounts the app on it. */
export function useThemeVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => version,
  );
}

export function useA11y() {
  useThemeVersion();
  return prefs;
}

export function scoreTone(pct: number, passing = 0.7) {
  return pct >= passing ? { fg: colors.primary, bg: colors.primarySoft } : { fg: colors.danger, bg: colors.dangerSoft };
}
