// Finora tokens, light and dark, from the dashboard brief (docs/FINORA_DASHBOARD_HANDOFF.md, section 2). Every text colour reaches at least 4.5:1 on
// ground and on paper in its own theme. Components never use hex: they read the palette for the current theme with useColors() (theme/theme.tsx).
// The brand blue (accent) is for actions, links and the selected state; charts use the category colours or the navy `bar`.

export interface Palette {
  ground: string; side: string; paper: string; field: string; seg: string;
  ink: string; ink2: string; ink3: string; line: string; line2: string;
  accent: string; onAccent: string; accentInk: string; accentSoft: string;
  hero: string; onHero: string; heroSoft: string; heroChip: string; cta: string; ctaInk: string;
  warnBg: string; warnInk: string; good: string; goodInk: string; goodSoft: string;
  inn: string; out: string; flexC: string; bar: string; track: string; range: string; scrim: string;
  /** negative amounts and errors */
  bad: string; badSoft: string;
  /** older names, kept so screens built before the redesign read the right token */
  brand: string; soft: string; signal: string; signalInk: string; other: string;
}

export const LIGHT: Palette = {
  ground: '#F4F5FA', side: '#FFFFFF', paper: '#FFFFFF', field: '#FFFFFF', seg: '#EEF0F5',
  ink: '#172031', ink2: '#464E5D', ink3: '#5E6676', line: '#E4E7EF', line2: '#CDD3DF',
  accent: '#5264E6', onAccent: '#FFFFFF', accentInk: '#3B4BC8', accentSoft: '#ECEEFD',
  hero: '#5264E6', onHero: '#FFFFFF', heroSoft: '#DCE0FB', heroChip: 'rgba(13,19,32,0.24)', cta: '#172031', ctaInk: '#FFFFFF',
  warnBg: '#FFF1CC', warnInk: '#6B4A00', good: '#1A9C6C', goodInk: '#137A54', goodSoft: '#DDF3EA',
  inn: '#1A9C6C', out: '#E8743B', flexC: '#C9CFDD', bar: '#2E3A5C', track: '#EDF0F5', range: '#C3CAF7', scrim: 'rgba(23,32,49,0.35)',
  bad: '#A3263A', badSoft: '#FBE7EA',
  brand: '#5264E6', soft: '#ECEEFD', signal: '#5264E6', signalInk: '#FFFFFF', other: '#8A93A6',
};

export const DARK: Palette = {
  ground: '#0D1320', side: '#111827', paper: '#151D2D', field: '#1B2538', seg: '#1E2738',
  ink: '#EEF1F7', ink2: '#B8C0CF', ink3: '#97A1B3', line: '#253048', line2: '#3A4762',
  accent: '#8A97FF', onAccent: '#0D1320', accentInk: '#AEB7FF', accentSoft: '#232D52',
  hero: '#4C5BD8', onHero: '#FFFFFF', heroSoft: '#D6DAFA', heroChip: 'rgba(13,19,32,0.24)', cta: '#EEF1F7', ctaInk: '#0D1320',
  warnBg: '#3A2F10', warnInk: '#F5D88A', good: '#4FD1A1', goodInk: '#6FE0B5', goodSoft: '#173A30',
  inn: '#3FBF8C', out: '#F08A55', flexC: '#3B4A6B', bar: '#AAB4CC', track: '#232D42', range: '#4A5BD0', scrim: 'rgba(5,8,15,0.6)',
  bad: '#F2939F', badSoft: '#3A1A22',
  brand: '#8A97FF', soft: '#232D52', signal: '#8A97FF', signalInk: '#0D1320', other: '#6F7A8E',
};

export type Scheme = 'light' | 'dark';
export const PALETTES: Record<Scheme, Palette> = { light: LIGHT, dark: DARK };

/** The six dashboard category groups, in this order everywhere. Each keeps its colour; nothing is ever reassigned. */
export const CATEGORY_GROUPS = ['travel', 'bigbox', 'groceries', 'fuel', 'medical', 'other'] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];
export const CATEGORY_GROUP_LABEL: Record<CategoryGroup, string> = {
  travel: 'Travel', bigbox: 'Big-box stores', groceries: 'Groceries', fuel: 'Fuel', medical: 'Medical', other: 'Everything else',
};
export const CATEGORY_COLORS: Record<Scheme, Record<CategoryGroup, string>> = {
  light: { travel: '#E8743B', bigbox: '#0F8F79', groceries: '#7DB83A', fuel: '#E0A800', medical: '#D9578A', other: '#8A93A6' },
  dark: { travel: '#F08A55', bigbox: '#2BBBA2', groceries: '#93CC52', fuel: '#F2C23A', medical: '#E9779F', other: '#6F7A8E' },
};

/** Shades of the big-box colour, for the stores inside that group (the brief's design). A fourth store and later fold into Everything else. */
export const BIGBOX_SHADES: Record<Scheme, readonly string[]> = {
  light: ['#0F8F79', '#5CC2AE', '#0A5C50'],
  dark: ['#2BBBA2', '#7FD8C6', '#1C6E62'],
};

/** Categorical order for charts that are not split by category (merchants, stores). Never cycled: the 6th and later entities fold into Other. */
export const SERIES_BY_SCHEME: Record<Scheme, readonly string[]> = {
  light: ['#E8743B', '#0F8F79', '#7DB83A', '#E0A800', '#D9578A'],
  dark: ['#F08A55', '#2BBBA2', '#93CC52', '#F2C23A', '#E9779F'],
};

export const F = {
  display: 'Sora_700Bold',
  displayMed: 'Sora_600SemiBold',
  body: 'PlusJakartaSans_400Regular',
  bodyMed: 'PlusJakartaSans_500Medium',
  bodySemi: 'PlusJakartaSans_600SemiBold',
  bodyBold: 'PlusJakartaSans_700Bold',
} as const;

/** Money is always set in tabular figures so columns of amounts line up. */
export const TABULAR = { fontVariant: ['tabular-nums' as const] };

export const R = { sm: 6, md: 12, lg: 16, card: 22, pill: 999 } as const;
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const MIN_TOUCH = 44;
/** At this width and above the app shows the desktop layout: top bar and side bar. */
export const WIDE = 960;
