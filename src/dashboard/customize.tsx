import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R } from '@/theme/tokens';
import { useWide } from '@/theme/ui';
import { ReadinessBadge } from './badge';
import { CATALOG, GROUPS } from './catalog';
import type { Readiness, WidgetId } from './catalog';
import { VIEWS } from './views';
import type { ViewId } from './views';

interface Props {
  visible: boolean;
  view: ViewId;
  on: Set<WidgetId>;
  readiness: Partial<Record<WidgetId, Readiness>>;
  onToggle: (id: WidgetId, on: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}

/** A 44 by 26 switch, inside a 52 by 44 touch target. */
function Switch({ value, label, onChange }: { value: boolean; label: string; onChange: (v: boolean) => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="switch" aria-checked={value} accessibilityLabel={label} onPress={() => onChange(!value)}
      style={{ width: 52, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: value ? c.accent : c.line2 }}>
        <View style={{ position: 'absolute', top: 3, left: value ? 21 : 3, width: 20, height: 20, borderRadius: 10, backgroundColor: c.onHero, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 }} />
      </View>
    </Pressable>
  );
}

function Contents({ view, on, readiness, onToggle, onReset, onClose, footerPad }: Omit<Props, 'visible'> & { footerPad: number }) {
  const { c } = useTheme();
  return (
    <>
      <View style={{ paddingTop: 24, paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: c.line, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontFamily: F.display, fontSize: 22, color: c.ink }}>Customize {VIEWS[view].label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}
            style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: R.md, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" color={c.ink2} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        <Text style={{ fontFamily: F.body, fontSize: 14, lineHeight: 20, color: c.ink2 }}>Turn widgets on or off for this view. Each view keeps its own set. {on.size} of {CATALOG.length} on.</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 18 }}>
        {GROUPS.map((g) => (
          <View key={g}>
            <Text accessibilityRole="header" style={{ fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: c.ink3, paddingTop: 14, paddingBottom: 6 }}>{g}</Text>
            {CATALOG.filter((w) => w.group === g).map((w) => (
              <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderTopWidth: 1, borderTopColor: c.line }}>
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.seg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={w.icon} color={c.ink2} size={18} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1, minWidth: 0, paddingVertical: 8 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }}>{w.name}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <Text style={{ fontFamily: F.body, fontSize: 12, color: c.ink3 }}>{w.chartKind}</Text>
                    {readiness[w.id] ? <ReadinessBadge value={readiness[w.id]!} /> : null}
                  </View>
                </View>
                <Switch value={on.has(w.id)} label={w.name} onChange={(v) => onToggle(w.id, v)} />
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={{ paddingTop: 16, paddingHorizontal: 24, paddingBottom: 16 + footerPad, borderTopWidth: 1, borderTopColor: c.line, flexDirection: 'row', gap: 10 }}>
        <FooterButton label="Reset to default" onPress={onReset} />
        <FooterButton label="Done" solid onPress={onClose} />
      </View>
    </>
  );
}

function FooterButton({ label, solid, onPress }: { label: string; solid?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: R.md, borderWidth: solid ? 0 : 1, borderColor: c.line2, backgroundColor: solid ? c.accent : c.paper, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: solid ? c.onAccent : c.ink }}>{label}</Text>
    </Pressable>
  );
}

/** The Customize panel: a 440px drawer from the right on wide screens, a bottom sheet on phones, both over the scrim. */
export function CustomizePanel(p: Props) {
  const { c } = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={p.visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={p.onClose}>
      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="Close the Customize panel" onPress={p.onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }} />
        <View accessibilityViewIsModal aria-modal accessibilityLabel="Customize widgets"
          style={wide
            ? { width: 440, maxWidth: '100%', height: '100%', backgroundColor: c.paper, borderLeftWidth: 1, borderLeftColor: c.line, paddingTop: insets.top, shadowColor: '#0D1320', shadowOpacity: 0.18, shadowRadius: 40, shadowOffset: { width: -12, height: 0 } }
            : { maxHeight: '88%', height: '88%', backgroundColor: c.paper, borderTopLeftRadius: R.card, borderTopRightRadius: R.card, borderTopWidth: 1, borderColor: c.line }}>
          {wide ? null : <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.line2, marginTop: 8 }} />}
          <Contents {...p} footerPad={insets.bottom} />
        </View>
      </View>
    </Modal>
  );
}
