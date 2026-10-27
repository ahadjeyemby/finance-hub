import Svg, { Path } from 'react-native-svg';

// One stroke icon set for the app: 24 by 24, round caps, drawn in the colour it is given.
const PATHS = {
  overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  explore: 'M5 20V10M12 20V4M19 20v-7',
  add: 'M12 5v14M5 12h14',
  inbox: 'M4 13l2-8h12l2 8v6H4zM4 13h5l1 2h4l1-2h5',
  reports: 'M6 3h9l4 4v14H6zM14 3v5h5M9 17v-3M12 17v-6M15 17v-2',
  accounts: 'M3 7h15a3 3 0 0 1 3 3v8H3zM3 7l12-4v4M16 13h2',
  links: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  recurring: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  income: 'M12 20V5M6 11l6-6 6 6',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  tags: 'M3 12V4h8l10 10-8 8zM7.5 8.5v.01',
  views: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v9l6.4 6.4',
  back: 'M15 5l-7 7 7 7',
  home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6',
  brief: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  trend: 'M3 17l6-6 4 4 8-9M15 6h6v6',
  donut: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z',
  ring: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  cart: 'M3 4h2l2.5 11h11L21 7H7M9 20h.01M18 20h.01',
  fuel: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  range: 'M3 12h18M7 8v8M17 8v8M12 6v12',
  line: 'M3 20l6-8 4 4 8-10',
  split: 'M3 8h18v8H3zM10 8v8',
  numbers: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
  water: 'M5 20V8M10 20V12M15 20v-4M20 20V6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v8H3zM3 7l12-4v4M16 13h2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, color, size = 22, strokeWidth = 2 }: { name: IconName; color: string; size?: number; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path d={PATHS[name]} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
