// Invite someone to your workspace. Only the person who manages a workspace (or someone working alone) may call it, never a member.
//
// The invite itself is made by the database as the caller (create_invite, migration 0006): it checks the address and the role, caps how many are
// waiting, and stores only a hash of the token. This function then asks Supabase to email the person a link that carries the token, when APP_URL is set.
// The token alone gets nobody in: accepting also needs a sign-in with the email address the invite was made for, and the invite is single use and expires.
//
// This is the only place the service role key is used. It is never sent to the app, and it is used for one thing: sending the invite email.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { authorize, cors, json } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const who = await authorize(req, 'admin');
  if ('denied' in who) return who.denied;

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const role = body.role === 'contributor' ? 'contributor' : 'member';
  const canReadAi = body.can_read_ai === true;
  if (!email || email.length > 254) return json({ error: 'Enter the email address of the person to invite.' }, 400);

  // made as the caller, so the database's own checks and row level security apply
  const made = await who.client.rpc('create_invite', { p_email: email, p_role: role, p_can_read_ai: canReadAi });
  if (made.error) return json({ error: made.error.message }, 400);
  const token = made.data as string;

  // the link goes in the email; without APP_URL the admin passes the code on themselves
  const appUrl = Deno.env.get('APP_URL')?.trim().replace(/\/+$/, '');
  const link = appUrl ? `${appUrl}/people?token=${token}` : null;
  let emailed = false;
  let note = link ? '' : 'APP_URL is not set on the backend, so no email was sent. Give the person the code, and they enter it under People after signing in.';
  if (link) {
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const sent = await service.auth.admin.inviteUserByEmail(email, { redirectTo: link });
    if (!sent.error) emailed = true;
    else if (/already|registered|exists/i.test(`${sent.error.code ?? ''} ${sent.error.message}`)) note = 'That person already has an account, so no email was sent. Send them the link below, or the code. They sign in with that address and open it.';
    else note = `The email could not be sent (${sent.error.message}). Send the link below yourself.`;
  }
  return json({ token, link, emailed, note });
});
