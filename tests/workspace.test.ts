import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canManage, extractToken, hasTeam, isContributor, isMemberRole, memberName, memberNotice, pendingInvites, visibilityNotice } from '../src/core/workspace';
import type { Access, Invite, Member } from '../src/core/workspace';

const m = (over: Partial<Member> = {}): Member => ({ member: 'abcdef123456', role: 'member', can_read_ai: false, active: true, email: 'w@x.test', label: null, created_at: '2026-01-01', ...over });

test('a member is shown by the label the admin chose, then the address, then a short id', () => {
  assert.equal(memberName(m({ label: ' Sam ' })), 'Sam');
  assert.equal(memberName(m()), 'w@x.test');
  assert.equal(memberName(m({ email: null })), 'Member abcdef');
  assert.equal(memberName(m({ label: '  ' })), 'w@x.test');
});

test('the invite code is taken from a pasted link or from the code alone', () => {
  const code = 'a'.repeat(64);
  assert.equal(extractToken(code), code);
  assert.equal(extractToken(`  ${code}\n`), code);
  assert.equal(extractToken(`https://audit.example.com/people?token=${code}`), code);
  assert.equal(extractToken(`https://audit.example.com/people?x=1&token=${code}#access_token=zzz`), code);
  assert.equal(extractToken(`https://a.test/people#token=${code}`), code);
  assert.equal(extractToken('hello'), null);
  assert.equal(extractToken(''), null);
  assert.equal(extractToken('has spaces in it and is long enough to be mistaken for a code 123456'), null);
});

test('who can manage a workspace and who belongs to one', () => {
  const a = (role: Access['role']): Access => ({ role, owner: null, can_read_ai: true, active: true });
  assert.ok(canManage(a('admin')) && canManage(a('solo')) && !canManage(a('member')) && !canManage(a('contributor')) && !canManage(null));
  assert.ok(isMemberRole(a('member')) && isMemberRole(a('contributor')) && !isMemberRole(a('admin')) && !isMemberRole(null));
  assert.ok(hasTeam([m()]) && !hasTeam([m({ active: false })]) && !hasTeam([]));
});

test('only invites that are neither accepted nor expired are pending', () => {
  const inv = (over: Partial<Invite>): Invite => ({ id: 'i', email: 'a@x.test', role: 'member', can_read_ai: false, expires_at: '2026-06-10T00:00:00Z', accepted_at: null, created_at: '2026-06-01', ...over });
  const now = new Date('2026-06-05T00:00:00Z');
  assert.deepEqual(pendingInvites([inv({ id: 'ok' }), inv({ id: 'used', accepted_at: '2026-06-02' }), inv({ id: 'old', expires_at: '2026-06-04T00:00:00Z' })], now).map((i) => i.id), ['ok']);
});

test('the notice says what the admin will see and what the member can use', () => {
  assert.match(visibilityNotice('member', false), /see, add, change and delete everything they add/);
  assert.match(visibilityNotice('member', false), /cannot use the AI readers/);
  assert.match(visibilityNotice('contributor', true), /see your spending, refunds and fees/);
  assert.match(visibilityNotice('contributor', true), /never reach them/);
  assert.match(visibilityNotice('contributor', true), /on your credit/);
});

test('what a Contributor reads about themselves speaks only of spending', () => {
  const own = memberNotice('contributor');
  assert.match(own, /spending/);
  for (const word of [/income/i, /earn/i, /salary/i, /pay\b/i, /saving/i, /deposit/i, /balance/i, /transfer/i, /never/i, /hidden/i]) assert.doesNotMatch(own, word);
  assert.match(memberNotice('member'), /only what you add/);
  assert.ok(isContributor({ role: 'contributor', owner: 'o', can_read_ai: false, active: true }) && !isContributor({ role: 'member', owner: 'o', can_read_ai: false, active: true }) && !isContributor(null));
});
