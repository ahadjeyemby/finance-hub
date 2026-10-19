import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isReaderAllowed, readerChoices } from '../supabase/functions/_shared/readers';

const env = (e: Record<string, string>) => (k: string) => e[k];

test('with nothing set, the default reader is the only choice', () => {
  assert.deepEqual(readerChoices(env({})).models, ['anthropic/claude-haiku-5.5']);
  assert.ok(isReaderAllowed(env({}), 'anthropic/claude-haiku-5.5'));
});

test('the models set by secret are offered, once each, with the current reader named', () => {
  const c = readerChoices(env({ OPENROUTER_VISION_MODEL: 'anthropic/claude-haiku-5.5', OPENROUTER_VERIFY_MODEL: 'google/gemini-3.8-flash' }));
  assert.deepEqual(c.models, ['anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash']);
  assert.equal(c.current, 'anthropic/claude-haiku-5.5');
});

test('OPENROUTER_MODEL_CHOICES adds more, and a model that is not listed is refused', () => {
  const e = env({ OPENROUTER_VERIFY_MODEL: 'google/gemini-3.8-flash', OPENROUTER_MODEL_CHOICES: ' anthropic/claude-sonnet-5.5 , ,google/gemini-3.8-flash' });
  assert.deepEqual(readerChoices(e).models, ['anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash', 'anthropic/claude-sonnet-5.5']);
  assert.ok(isReaderAllowed(e, 'anthropic/claude-sonnet-5.5'));
  assert.ok(!isReaderAllowed(e, 'openai/some-expensive-model'));
  assert.ok(!isReaderAllowed(e, undefined));
  assert.ok(!isReaderAllowed(e, ''));
});
