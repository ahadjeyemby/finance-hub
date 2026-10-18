// Graphite and amber. Values come from the approved palette board (option 3).
export const C = {
  ground: '#E8E6E1',
  paper: '#FCFBF9',
  ink: '#1B1A18',
  ink2: '#4A4843',
  ink3: '#5E5C56',
  line: '#D9D6CF',
  accent: '#2B2D31',
  soft: '#E9E5DB',
  bar: '#3A3D44',
  signal: '#E39A00',
  signalInk: '#1B1A18',
  warnBg: '#FFF1CC',
  warnInk: '#5C3F00',
  good: '#17625A',
  bad: '#8C2634',
  other: '#9AA6B1',
} as const;

/** Categorical order for charts. Never cycled: the 6th and later entities fold into Other. */
export const SERIES = ['#EB6834', '#1BAF7A', '#6250D6', '#EDA100', '#E87BA4'] as const;

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
