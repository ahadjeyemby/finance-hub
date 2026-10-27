import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { BIGBOX_SHADES, CATEGORY_COLORS, PALETTES, SERIES_BY_SCHEME } from './tokens';
import type { CategoryGroup, Palette, Scheme } from './tokens';

/** What the person chose: follow the system, or always light or dark. */
export type ThemeMode = 'system' | Scheme;

export interface Theme {
  scheme: Scheme;
  mode: ThemeMode;
  c: Palette;
  cat: Record<CategoryGroup, string>;
  series: readonly string[];
  bigbox: readonly string[];
  setMode: (m: ThemeMode) => void;
  /** flip between light and dark; the choice is kept on this device */
  toggle: () => void;
}

const KEY = 'finora.theme';

const themeFor = (scheme: Scheme, mode: ThemeMode, setMode: (m: ThemeMode) => void): Theme => ({
  scheme, mode, c: PALETTES[scheme], cat: CATEGORY_COLORS[scheme], series: SERIES_BY_SCHEME[scheme], bigbox: BIGBOX_SHADES[scheme],
  setMode, toggle: () => setMode(scheme === 'dark' ? 'light' : 'dark'),
});

const Ctx = createContext<Theme>(themeFor('light', 'system', () => {}));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => { if (v === 'light' || v === 'dark' || v === 'system') setModeState(v); }).catch(() => {});
  }, []);
  const setMode = (m: ThemeMode) => { setModeState(m); AsyncStorage.setItem(KEY, m).catch(() => {}); };
  const scheme: Scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const theme = themeFor(scheme, mode, setMode);
  // the window behind the app (seen while a screen slides, or past the page on web) follows the theme too
  useEffect(() => { SystemUI.setBackgroundColorAsync(theme.c.ground).catch(() => {}); }, [theme.c.ground]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
/** The palette for the current theme. Components call it once and read tokens from it: `const C = useColors();` */
export const useColors = () => useContext(Ctx).c;
