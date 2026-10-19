// Which models a request may ask for. Pure TypeScript with no Deno or Node APIs, so it is unit tested (tests/readers.test.ts).
// `get` reads one secret: in the edge functions it is Deno.env.get.

export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

/** The readers a request may choose: the models set by secret, plus OPENROUTER_MODEL_CHOICES (comma-separated, optional). `current` is the one used when nothing is chosen. */
export function readerChoices(get: (key: string) => string | undefined): { models: string[]; current: string } {
  const env = (k: string) => get(k)?.trim() || '';
  const current = env('OPENROUTER_VISION_MODEL') || env('OPENROUTER_MODEL') || DEFAULT_MODEL;
  const listed = env('OPENROUTER_MODEL_CHOICES').split(',').map((m) => m.trim()).filter(Boolean);
  const models = [...new Set([current, env('OPENROUTER_VERIFY_MODEL'), env('OPENROUTER_MODEL'), DEFAULT_MODEL, ...listed].filter(Boolean))];
  return { models, current };
}

export const isReaderAllowed = (get: (key: string) => string | undefined, m: unknown): m is string => typeof m === 'string' && readerChoices(get).models.includes(m);
