import { usePathname } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { MIN_TOUCH, R, S } from '@/theme/tokens';
import { T } from '@/theme/ui';
import { Icon } from './icons';
import { LedgerBody } from './ledgerview';
import { TxPanelContext } from './txpanelctx';
import type { LedgerParams, TxPanelApi } from './txpanelctx';
import { TxnBody } from './txnview';

type Entry = { kind: 'list'; params: LedgerParams } | { kind: 'txn'; id: string };

/** Phones get a sheet that rises from the bottom; tablets and desktops get a panel on the right, up to this wide. */
const SIDE_FROM = 600, SIDE_MAX = 560;

/**
 * Transactions, and any one transaction, in a panel over the page the person is on, so the page stays where it was. Every page can open it
 * (useTxPanel). A row in the list opens its transaction in the same panel, with a Back to the list. Going to any other page closes it.
 */
export function TxPanelProvider({ children }: { children: ReactNode }) {
  // the panel belongs to the page it was opened on: on any other page it is closed
  const pathname = usePathname();
  const [open, setOpen] = useState<{ path: string; stack: Entry[] }>({ path: '', stack: [] });
  const stack = open.path === pathname ? open.stack : [];

  const api = useMemo<TxPanelApi>(() => ({
    openList: (params) => setOpen({ path: pathname, stack: [{ kind: 'list', params }] }),
    openTxn: (id) => setOpen((o) => ({ path: pathname, stack: o.path === pathname && o.stack.length ? [...o.stack, { kind: 'txn', id }] : [{ kind: 'txn', id }] })),
    close: () => setOpen({ path: '', stack: [] }),
  }), [pathname]);
  const back = useCallback(() => setOpen((o) => ({ ...o, stack: o.stack.slice(0, -1) })), []);

  return (
    <TxPanelContext.Provider value={api}>
      {children}
      <Panel stack={stack} onBack={back} onClose={api.close} />
    </TxPanelContext.Provider>
  );
}

function Panel({ stack, onBack, onClose }: { stack: Entry[]; onBack: () => void; onClose: () => void }) {
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const side = width >= SIDE_FROM;
  const top = stack[stack.length - 1];
  const nested = stack.length > 1;
  const pad = side ? S.xl : S.lg;
  return (
    <Modal visible={!!top} transparent animationType={side ? 'fade' : 'slide'} onRequestClose={nested ? onBack : onClose}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={{ flex: 1, flexDirection: side ? 'row' : 'column', justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={side ? { width: Math.min(SIDE_MAX, Math.round(width * 0.92)), height: '100%' } : { height: '92%' }}>
          <View accessibilityViewIsModal aria-modal accessibilityLabel={top?.kind === 'txn' ? 'Transaction' : 'Transactions'}
            style={[{ flex: 1, backgroundColor: c.ground, overflow: 'hidden' },
              side ? { borderLeftWidth: 1, borderLeftColor: c.line, paddingTop: insets.top }
                : { borderTopLeftRadius: R.card, borderTopRightRadius: R.card, borderTopWidth: 1, borderColor: c.line }]}>
            {side ? null : <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.line2, marginTop: 8 }} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: S.sm, borderBottomWidth: 1, borderBottomColor: c.line }}>
              {nested ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Back to the list" onPress={onBack}
                  style={{ minHeight: MIN_TOUCH, paddingHorizontal: S.sm, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="back" color={c.ink2} size={18} /><T size={13} tone="ink2" bold>Back</T>
                </Pressable>
              ) : <View />}
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}
                style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: R.md, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" color={c.ink2} size={18} strokeWidth={2.2} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: pad, paddingBottom: pad + insets.bottom + S.xl, gap: S.lg }}>
              {/* the list stays mounted under a transaction, so Back finds the search and filter as they were */}
              {stack.map((e, i) => (
                <View key={i} style={{ display: i === stack.length - 1 ? 'flex' : 'none', gap: S.lg }}>
                  {e.kind === 'list' ? <LedgerBody params={e.params} embedded /> : <TxnBody id={e.id} embedded />}
                </View>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
