import type { Post } from '@/core/agent';
import { callFunction, supabase } from './supabase';

/** A poster for the `ask` function, or undefined when no backend is configured (offline planner is used). */
export function makePost(): Post | undefined {
  if (!supabase) return undefined;
  return (body) => callFunction('ask', body);
}
