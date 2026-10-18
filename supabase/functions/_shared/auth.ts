import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

/** Only a signed-in user may spend the OpenRouter credit. ALLOWED_EMAIL (optional) narrows it to one person. */
export async function requireUser(req: Request): Promise<Response | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'sign in required' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return json({ error: 'invalid session' }, 401);
  const allowed = Deno.env.get('ALLOWED_EMAIL');
  if (allowed && data.user.email?.toLowerCase() !== allowed.toLowerCase()) return json({ error: 'not allowed' }, 403);
  return null;
}
