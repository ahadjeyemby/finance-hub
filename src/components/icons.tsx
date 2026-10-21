import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName = 'overview' | 'explore' | 'add' | 'inbox' | 'reports' | 'accounts' | 'links' | 'views' | 'tags' | 'back';

export function Icon({ name, color, size = 22 }: { name: IconName; color: string; size?: number }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {name === 'overview' ? <><Rect x={3.5} y={3.5} width={7} height={7} rx={1.5} {...p} /><Rect x={13.5} y={3.5} width={7} height={7} rx={1.5} {...p} /><Rect x={3.5} y={13.5} width={7} height={7} rx={1.5} {...p} /><Rect x={13.5} y={13.5} width={7} height={7} rx={1.5} {...p} /></> : null}
      {name === 'explore' ? <><Circle cx={6} cy={12} r={2.5} {...p} /><Circle cx={18} cy={6} r={2.5} {...p} /><Circle cx={18} cy={18} r={2.5} {...p} /><Path d="M8.3 11l7.4-4M8.3 13l7.4 4" {...p} /></> : null}
      {name === 'add' ? <Path d="M12 5v14M5 12h14" {...p} /> : null}
      {name === 'inbox' ? <Path d="M4 13l2.5-7h11L20 13v5.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V13zM4 13h4.5a3.5 3.5 0 0 0 7 0H20" {...p} /> : null}
      {name === 'reports' ? <Path d="M5 20V10M12 20V4M19 20v-7" {...p} /> : null}
      {name === 'accounts' ? <><Rect x={3} y={6} width={18} height={12} rx={2} {...p} /><Path d="M3 10.5h18M6.5 15h4" {...p} /></> : null}
      {name === 'links' ? <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...p} /> : null}
      {name === 'views' ? <><Circle cx={12} cy={12} r={8} {...p} /><Path d="M12 4v8l5.5 5.5" {...p} /></> : null}
      {name === 'tags' ? <><Path d="M3.5 12.5V4.5h8l8 8-8 8-8-8z" {...p} /><Circle cx={8} cy={9} r={1.2} {...p} /></> : null}
      {name === 'back' ? <Path d="M15 5l-7 7 7 7" {...p} /> : null}
    </Svg>
  );
}
