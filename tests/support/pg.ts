// A real Postgres (PGlite, in memory) with just enough of Supabase around it to run the project's migrations and test row level security:
// the auth schema (users and auth.uid()), the authenticated role, and storage buckets and objects. Used by tests that log in as several users
// and check what each can read and write. Nothing here talks to the network.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

const SUPABASE_STUBS = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub', nullif(current_setting('request.jwt.claim.sub', true), ''), 'email', nullif(current_setting('request.jwt.claim.email', true), '')) $$;
  create role authenticated nologin;
  create role anon nologin;
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
  grant usage on schema public, storage, auth to authenticated, anon;
  alter default privileges in schema public grant all on tables to authenticated;
  alter default privileges in schema public grant all on functions to authenticated;
  grant all on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  grant select on auth.users to authenticated;
`;

export interface Db {
  db: PGlite;
  /** make a user (a row in auth.users) and return its id */
  addUser(email: string): Promise<string>;
  /** run a query as this user, with row level security applied. Errors are thrown. */
  as<T = Record<string, unknown>>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** run a query as this user and return the error message instead of throwing (null when it succeeded) */
  asFails(userId: string | null, sql: string, params?: unknown[]): Promise<string | null>;
  /** run a query as the database owner, bypassing row level security (setting up data, and checking what really is stored) */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** A fresh database with every migration in supabase/migrations applied, in order. */
export async function freshDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  // one connection serves every test user, and a query runs under whoever is logged in at that moment: so queries run one at a time, never overlapping
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => { const run = queue.then(fn, fn); queue = run.catch(() => undefined); return run; };
  const as = <T,>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> => exclusive(async () => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false), set_config('request.jwt.claim.email', '${userId ? (await db.query<{ email: string }>('select email from auth.users where id = $1', [userId])).rows[0]?.email ?? '' : ''}', false)`);
    try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
  });
  return {
    db, as,
    addUser: (email) => exclusive(async () => (await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id),
    asFails: async (userId, sql, params) => { try { await as(userId, sql, params); return null; } catch (e) { return (e as Error).message; } },
    admin: <T,>(sql: string, params: unknown[] = []) => exclusive(async () => (await db.query<T>(sql, params)).rows),
  };
}
