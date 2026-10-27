import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Logo, Wordmark } from '@/components/brand';
import { Icon } from '@/components/icons';
import { useRepo } from '@/data/repo';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R } from '@/theme/tokens';
import { AskField, AvatarButton, IconButton, ThemeToggle } from './parts';

/** Desktop and web at 960px and wider: logo, the Ask field, theme, Inbox, Add (the only Add button on these screens) and the avatar. */
export function TopBar() {
  const { c } = useTheme();
  const { questions } = useRepo();
  return (
    <View accessibilityRole="header" style={{ backgroundColor: c.paper, borderBottomWidth: 1, borderBottomColor: c.line, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 24, rowGap: 12, paddingVertical: 12, paddingHorizontal: 28 }}>
      <Pressable accessibilityRole="link" accessibilityLabel="Finora, go to the dashboard" onPress={() => router.navigate('/')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
        <Logo size={44} />
        <Wordmark width={104} />
      </Pressable>
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 320, maxWidth: 640, marginLeft: 24, marginRight: 'auto' }}>
        <AskField />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ThemeToggle />
        <IconButton icon="inbox" label={questions.length ? `Inbox, ${questions.length} question${questions.length === 1 ? '' : 's'}` : 'Inbox'} badge={questions.length} onPress={() => router.navigate('/inbox')} />
        <Pressable accessibilityRole="button" accessibilityLabel="Add" onPress={() => router.navigate('/add')}
          style={({ pressed }) => ({ minHeight: MIN_TOUCH, paddingLeft: 14, paddingRight: 18, borderRadius: R.md, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.85 : 1 })}>
          <Icon name="add" color={c.onAccent} size={18} strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: c.onAccent }}>Add</Text>
        </Pressable>
        <AvatarButton />
      </View>
    </View>
  );
}
