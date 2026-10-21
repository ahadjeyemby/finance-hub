import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { decide, type Access, type Need } from './access.ts';

export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

export interface Caller { userId: string; email: string | undefined; access: Access | null; /** a client that acts as the caller: row level security applies to everything it does */ client: SupabaseClient }

/**
 * Sign-in is required, and then the workspace rules (see access.ts): a member needs an active membership and, for the readers, can_read_ai; an
 * admin or someone working alone is decided by ALLOWED_EMAIL when it is set. `need` is 'reader' for functions that spend model credit and
 * 'admin' for managing a workspace.
 */
export async function authorize(req: Request, need: Need = 'reader'): Promise<{ denied: Response } | Caller> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { denied: json({ error: 'sign in required' }, 401) };
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { denied: json({ error: 'invalid session' }, 401) };
  const r = await client.rpc('my_access');
  let access: Access | null = null;
  if (r.error) {
    // only "the function does not exist" (the workspace migration has not been run) falls back to the old behaviour; any other failure refuses
    if (!/PGRST202|42883|could not find the function/i.test(`${r.error.code ?? ''} ${r.error.message ?? ''}`)) return { denied: json({ error: 'Could not check your access. Try again.' }, 503) };
  } else access = r.data as Access;
  const d = decide(access, data.user.email ?? undefined, Deno.env.get('ALLOWED_EMAIL'), need);
  if (!d.ok) return { denied: json({ error: d.error }, d.status) };
  return { userId: data.user.id, email: data.user.email ?? undefined, access, client };
}

/** For the functions that only need a yes or no. */
export async function requireUser(req: Request, need: Need = 'reader'): Promise<Response | null> {
  const r = await authorize(req, need);
  return 'denied' in r ? r.denied : null;
}
