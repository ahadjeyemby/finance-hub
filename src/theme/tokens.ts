// Finora: navy, charcoal and indigo, from the brand assets (assets/brand/SOURCE_README.md). Every text colour below reaches at least 4.5:1 on the
// ground and on paper; the brand indigo #5264E6 itself is for fills and charts, and the slightly deeper `accent` is used where it is text or a border.
export const C = {
  ground: '#F4F6FA',
  paper: '#FFFFFF',
  ink: '#172031',
  ink2: '#444851',
  ink3: '#5B6477',
  line: '#DDE1EA',
  accent: '#4356D4',
  /** the brand indigo, for fills, bars and the logo; not for small text */
  brand: '#5264E6',
  soft: '#E8EBF4',
  bar: '#5264E6',
  signal: '#5264E6',
  signalInk: '#FFFFFF',
  warnBg: '#FFF1CC',
  warnInk: '#5C3F00',
  good: '#17625A',
  bad: '#8C2634',
  other: '#9AA6B1',
} as const;

/** Categorical order for charts. Never cycled: the 6th and later entities fold into Other. */
export const SERIES = ['#5264E6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4'] as const;

export const F = {
  display: 'BricolageGrotesque_700Bold',
  displayMed: 'BricolageGrotesque_600SemiBold',
  body: 'HankenGrotesk_400Regular',
  bodyMed: 'HankenGrotesk_500Medium',
  bodyBold: 'HankenGrotesk_700Bold',
} as const;

export const R = { sm: 6, md: 12, lg: 16, pill: 999 } as const;
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const MIN_TOUCH = 44;
export const WIDE = 900;
