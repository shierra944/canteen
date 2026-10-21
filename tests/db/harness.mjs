// Runs the real Supabase migrations inside PGlite (Postgres compiled to WASM)
// with a minimal stub of Supabase's auth schema and roles, so database rules,
// RLS and RPCs can be tested without Docker or a cloud project.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'supabase', 'migrations');

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    } catch (e) {
      e.message = `${file}: ${e.message}`;
      throw e;
    }
  }
  return new TestDb(db);
}

class TestDb {
  constructor(db) {
    this.db = db;
  }

  /** Run as superuser (setup only). */
  async sql(query, params = []) {
    await this.db.exec('reset role');
    await this.db.query("select set_config('request.jwt.claim.sub', '', false)");
    return (await this.db.query(query, params)).rows;
  }

  /** Create an auth user + profile with a role. */
  async createUser(email, role = 'staff', { active = true, permissions = [] } = {}) {
    const id = randomUUID();
    await this.sql(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      email,
      { full_name: email.split('@')[0], role: 'admin' }, // metadata role must be IGNORED
    ]);
    await this.sql(`update public.profiles set role = $2, is_active = $3 where id = $1`, [id, role, active]);
    for (const p of permissions) {
      await this.sql(`insert into public.user_permissions (user_id, permission) values ($1, $2)`, [id, p]);
    }
    return id;
  }

  /** Run a query as an authenticated user (RLS + permissions apply). */
  async as(userId, query, params = []) {
    await this.db.exec('reset role');
    await this.db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await this.db.exec('set role authenticated');
    try {
      return (await this.db.query(query, params)).rows;
    } finally {
      await this.db.exec('reset role');
    }
  }
}
