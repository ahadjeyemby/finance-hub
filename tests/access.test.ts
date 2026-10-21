import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allowedEmails, decide } from '../supabase/functions/_shared/access';
import type { Access } from '../supabase/functions/_shared/access';

const acc = (over: Partial<Access>): Access => ({ role: 'solo', owner: null, can_read_ai: true, active: true, ...over });
const member = (over: Partial<Access> = {}) => acc({ role: 'member', owner: 'o', can_read_ai: false, ...over });
const ok = { ok: true };

test('someone working alone, or an admin, is allowed unless ALLOWED_EMAIL names other people', () => {
  assert.deepEqual(decide(acc({}), 'me@x.test', undefined, 'reader'), ok);
  assert.deepEqual(decide(acc({ role: 'admin' }), 'me@x.test', '', 'admin'), ok);
  assert.deepEqual(decide(acc({}), 'me@x.test', 'ME@x.test', 'reader'), ok, 'case does not matter');
  assert.deepEqual(decide(acc({}), 'stranger@x.test', 'me@x.test', 'reader'), { ok: false, status: 403, error: 'not allowed' });
  assert.deepEqual(decide(acc({ role: 'admin' }), undefined, 'me@x.test', 'reader'), { ok: false, status: 403, error: 'not allowed' }, 'no address is no match');
  assert.deepEqual(decide(acc({}), 'b@x.test', ' a@x.test , B@x.test ', 'reader'), ok, 'several addresses may be listed');
});

test('a member needs an active membership and, for the readers, can_read_ai; ALLOWED_EMAIL does not apply to them', () => {
  assert.deepEqual(decide(member({ can_read_ai: true }), 'wife@x.test', 'me@x.test', 'reader'), ok);
  const off = decide(member(), 'wife@x.test', undefined, 'reader');
  assert.ok(!off.ok && off.status === 403 && /switched off/.test(off.error));
  const paused = decide(member({ can_read_ai: true, active: false }), 'wife@x.test', undefined, 'reader');
  assert.ok(!paused.ok && /paused/.test(paused.error));
  assert.deepEqual(decide(acc({ role: 'contributor', owner: 'o', can_read_ai: true }), 'p@x.test', 'me@x.test', 'reader'), ok);
});

test('a member can never manage a workspace, whatever else they may do', () => {
  for (const role of ['member', 'contributor'] as const) {
    const d = decide(acc({ role, owner: 'o', can_read_ai: true }), 'x@x.test', undefined, 'admin');
    assert.ok(!d.ok && d.status === 403 && /manages this workspace/.test(d.error));
  }
});

test('without the workspace migration the old rule stands: ALLOWED_EMAIL alone decides', () => {
  assert.deepEqual(decide(null, 'me@x.test', 'me@x.test', 'reader'), ok);
  assert.deepEqual(decide(null, 'anyone@x.test', undefined, 'reader'), ok);
  assert.deepEqual(decide(null, 'other@x.test', 'me@x.test', 'reader'), { ok: false, status: 403, error: 'not allowed' });
});

test('the allowed list is split, trimmed and lower cased', () => {
  assert.deepEqual(allowedEmails(' A@x.test,, b@X.test '), ['a@x.test', 'b@x.test']);
  assert.deepEqual(allowedEmails(undefined), []);
});
