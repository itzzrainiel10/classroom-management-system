// CMS design tokens (from the CvSU palette). Screens read colors and sizes from here only.
export const colors = {
  primary: '#075B39', // Deep Green
  primaryDark: '#05452B', // Pressed / deeper surfaces
  onPrimary: '#FFFFFF',
  primarySoft: '#E9F2EC', // Pale Sage Green
  mint: '#DCE7DF', // Pale Mint Green
  gold: '#F4CF3F', // Golden Yellow
  goldSoft: '#FDF6D8',
  text: '#1D2A23', // Near-black with a green cast: crisper than grey on white
  textSoft: '#5F6F66', // Secondary text
  muted: '#8B9A90', // Placeholders, inactive icons
  slate: '#8498AF',
  background: '#F4F6F3', // Warm off-white so white cards stand out
  card: '#FFFFFF',
  line: '#E4EAE5', // Hairlines and outlines
  danger: '#B3261E',
  dangerSoft: '#FBE9E7',
  onPrimarySoft: 'rgba(255,255,255,0.78)',
} as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

/** Soft, layered shadows (CSS syntax; works on iOS, Android and web). */
export const shadow = {
  sm: { boxShadow: '0px 1px 2px rgba(16, 42, 28, 0.06), 0px 2px 8px rgba(16, 42, 28, 0.05)' },
  md: { boxShadow: '0px 2px 4px rgba(16, 42, 28, 0.06), 0px 8px 24px rgba(16, 42, 28, 0.08)' },
  lg: { boxShadow: '0px 4px 8px rgba(16, 42, 28, 0.08), 0px 16px 40px rgba(16, 42, 28, 0.14)' },
  primary: { boxShadow: '0px 4px 14px rgba(7, 91, 57, 0.28)' },
} as const;

export const text = {
  display: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, lineHeight: 34, color: colors.text },
  h1: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3, color: colors.text },
  h2: { fontSize: 16, fontWeight: '700', letterSpacing: -0.1, color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 22 },
  caption: { fontSize: 13, color: colors.textSoft, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', color: colors.muted },
} as const;

export function scoreTone(pct: number, passing = 0.7) {
  return pct >= passing ? { fg: colors.primary, bg: colors.primarySoft } : { fg: colors.danger, bg: colors.dangerSoft };
}
