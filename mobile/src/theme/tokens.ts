// Design tokens ported from "ChaseMapper Flight Deck" mockup (Claude Design project
// 2d94b1c3-d551-4a86-ae08-68ffc3f59478). Keep in sync with that source of truth.

export const colors = {
  bg: '#0a0d16',
  bgElevated: '#121728',
  bgCard: 'rgba(10,13,22,0.85)',
  bgCardStrong: 'rgba(10,13,22,0.92)',
  bgSheet: '#141a2c',
  border: 'rgba(255,255,255,0.1)',
  borderSubtle: 'rgba(255,255,255,0.08)',
  borderAccent: 'rgba(255,203,5,0.3)',

  accent: '#FFCB05', // maize — active tab, primary CTA, own-balloon/target highlight
  accentDim: 'rgba(255,203,5,0.16)',
  accentText: '#0a0d16', // text color placed on top of accent-filled surfaces

  telemetryBlue: '#8fb6e6', // ETA / secondary numeric readouts
  trackBlue: '#6f9fd8', // flight-path polyline / live indicator dot / own car marker
  chaserOther: '#7ee787', // other connected chasers' car markers, distinct from own car
  landing: '#e6eef6', // predicted-landing marker

  text: '#e6eef6',
  textMuted: 'rgba(230,238,246,0.5)',
  textFaint: 'rgba(230,238,246,0.35)',

  danger: '#e05a5a',
  dangerText: '#e77',
  warn: '#ffce6b',
  error: '#ff8a8a',
  success: '#8fb6e6',

  white: '#ffffff',
} as const;

export const fonts = {
  heading: 'SpaceGrotesk_700Bold',
  headingMedium: 'SpaceGrotesk_500Medium',
  mono: 'IBMPlexMono_600SemiBold',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radii = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 16,
  xxl: 18,
  pill: 999,
} as const;

export const layout = {
  tabBarHeight: 66,
} as const;
