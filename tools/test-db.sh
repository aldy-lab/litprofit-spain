#!/usr/bin/env bash
# Builds the iberia schema in a throwaway local Postgres and runs the access
# test against it.
#
#     bash tools/test-db.sh
#
# Local, never the live project: the test creates users. Supabase's auth and
# storage schemas are stood in for by the few objects the schema touches.
# Needs Homebrew postgresql@18 (the default install's data directory on this
# Mac is owned by another account, so this makes its own in a temp dir).
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=/opt/homebrew/opt/postgresql@18/bin
TMP=$(mktemp -d /tmp/ibdb.XXXX)
PORT=5441
trap '"$BIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

"$BIN/initdb" -D "$TMP/data" -U postgres --auth=trust -E UTF8 >/dev/null
# no unix socket: a temp path can exceed the 103-byte socket name limit
"$BIN/pg_ctl" -D "$TMP/data" -l "$TMP/log" -o "-p $PORT -k ''" -w start >/dev/null
q(){ "$BIN/psql" -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 "$@"; }

q -d postgres <<'SQL'
create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls; create role authenticator noinherit login;
create schema auth; create schema storage; create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text,
  last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text, name text);
alter table storage.objects enable row level security;
create table public.profiles (id uuid primary key references auth.users(id),
  name text, email text, role text not null default 'staff');
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select on public.profiles to authenticated;
-- live has admins before iberia-members.sql runs; so does this
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'existing-admin@test');
insert into public.profiles (id, email, role) values ('00000000-0000-0000-0000-000000000001', 'existing-admin@test', 'admin');
SQL

for f in iberia iberia-access iberia-payroll iberia-members; do
  echo "== db/$f.sql"
  q -d postgres -1 -f "db/$f.sql" 2>&1 | { grep -v 'skipping' || true; }
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "FAILED in db/$f.sql"; exit 1; }
done
echo "== db/test-access.sql"
q -d postgres -f db/test-access.sql
