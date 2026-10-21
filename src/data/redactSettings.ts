import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

const KEY = 'audit.redact.v1';

/**
 * The redaction settings shared by every screen that redacts a document: whether it is on (on by default where it can run) and the words to
 * always hide. Kept on this device only. The refs always hold the newest values, for work that started on an older render.
 */
export function useRedactSettings() {
  const [on, setOn] = useState(true);
  const [words, setWords] = useState('');
  const onRef = useRef(true);
  const wordsRef = useRef('');
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((raw) => {
      if (!raw) return;
      try {
        const v = JSON.parse(raw) as { on?: boolean; words?: string };
        if (typeof v.on === 'boolean') { setOn(v.on); onRef.current = v.on; }
        if (typeof v.words === 'string') { setWords(v.words); wordsRef.current = v.words; }
      } catch { /* unreadable settings: keep the defaults */ }
    }).catch(() => {});
  }, []);
  const save = (nextOn: boolean, nextWords: string) => {
    setOn(nextOn); setWords(nextWords); onRef.current = nextOn; wordsRef.current = nextWords;
    AsyncStorage.setItem(KEY, JSON.stringify({ on: nextOn, words: nextWords })).catch(() => {});
  };
  return { on, words, onRef, wordsRef, save };
}
