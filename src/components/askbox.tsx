import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { F, R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Button, Chip, T } from '@/theme/ui';

export function AskBox({ placeholder, cta, suggestions, busy, onSubmit }: { placeholder: string; cta: string; suggestions: string[]; busy?: boolean; onSubmit: (text: string) => void }) {
  const C = useColors();
  const [text, setText] = useState('');
  const go = (t: string) => { if (t.trim() && !busy) onSubmit(t.trim()); };
  return (
    <View style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <TextInput value={text} onChangeText={setText} onSubmitEditing={() => go(text)} returnKeyType="send" placeholder={placeholder} placeholderTextColor={C.ink3} accessibilityLabel={placeholder}
          style={{ flex: 1, minHeight: 48, borderRadius: R.md, backgroundColor: C.paper, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 15, color: C.ink }} />
        <Button label={busy ? 'Working' : cta} disabled={busy} onPress={() => go(text)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {suggestions.map((s) => <Chip key={s} label={s} onPress={() => { setText(s); go(s); }} />)}
      </View>
      <T size={11} tone="ink3">Answers come from your own ledger. Nothing is guessed.</T>
    </View>
  );
}
