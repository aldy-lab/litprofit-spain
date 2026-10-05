#!/usr/bin/env python3
"""
Writes db/iberia.sql from a schema-only dump of the Lithuanian calculator.

    python3 tools/make-schema.py public.sql > db/iberia.sql

WHERE THE DUMP COMES FROM
-------------------------
The litprofit repo's db/*.sql replayed in order into a scratch Postgres
(with stand-ins for Supabase's auth and storage schemas), then

    pg_dump --schema=public --schema-only --no-owner \\
            --exclude-table=public.profiles

Replayed rather than dumped from the live project, because the live project
has no database password on this machine -- and checked against it: every
function body was hashed on both sides. They differ only in whitespace and
comments (the live copies were pasted through a migration tool that
compacts them), plus one real gap that is the live project's, not this
file's: migrate-documents-4.sql never fully landed there, so live has no
sees_company(). This copy follows the repo, which is what the app expects.

WHAT IT CHANGES, AND NOTHING ELSE
---------------------------------
1. public.  -> iberia.   Every table, view, function and trigger moves to its
   own schema. public.profiles is the one exception: the people are the same
   people, and the identity row is shared, not copied.

2. auth.uid() -> iberia.admin_uid().  This is the whole of "admins only".
   Every function in the schema refuses a caller with no auth.uid() on its
   first line, and every view is gated on it or on a role check that reads
   through it. admin_uid() returns the caller's id ONLY if their profile says
   admin, so anybody else is, as far as this schema can tell, not signed in.
   One function decides who is in; opening it to managers later is one line.

3. The two views that had no gate at all -- projects_v and project_history_v
   handed every signed-in user a redacted row -- get one.

4. Out: handle_new_user and guard_role_change. They belong to profiles,
   which stays in public with its own trigger.

The Iberian payroll (Spain and Portugal instead of Sodra) is not done here.
It is db/iberia-payroll.sql, run after this, so the copy and the change can
be read apart.
"""
import io
import re
import sys

src = io.open(sys.argv[1], encoding="utf-8").read()

# psql meta-commands pg_dump 17+ emits; the SQL editor and the MCP refuse them
src = "\n".join(l for l in src.split("\n") if not l.startswith("\\"))

# Statements that belong to profiles or to public itself
blocks = re.split(r"\n(?=--\n-- Name: )", src)
keep = []
for b in blocks:
    head = b.split("\n", 3)[1] if b.startswith("--\n-- Name:") else ""
    if any(n in head for n in ("handle_new_user", "guard_role_change",
                               "Name: public; Type: SCHEMA",
                               "Name: SCHEMA public")):
        continue
    keep.append(b)
src = "\n".join(keep)
src = re.sub(r"^CREATE SCHEMA public;\n", "", src, flags=re.M)
src = re.sub(r"^COMMENT ON SCHEMA public IS .*\n", "", src, flags=re.M)
src = re.sub(r"^SET [a-z_]+ = .*;\n", "", src, flags=re.M)
src = re.sub(r"^SELECT pg_catalog.set_config\('search_path'.*\n", "", src, flags=re.M)

# grants to whoever ran the replay; the owner on Supabase is postgres and
# holds everything already
src = re.sub(r"^(GRANT|REVOKE) .* (TO|FROM) (aldy|postgres);\n", "", src, flags=re.M)
# Default privileges the harden migration set on public, for the role that
# ran it. They name a role and a schema that are not this one; the grants
# this schema needs are stated outright at the bottom of the file.
src = re.sub(r"^ALTER DEFAULT PRIVILEGES .*\n", "", src, flags=re.M)

src = src.replace("public.profiles", "\x00PROFILES\x00")
src = src.replace("public.", "iberia.")
src = src.replace("\x00PROFILES\x00", "public.profiles")
src = src.replace("Schema: public;", "Schema: iberia;")
src = src.replace("auth.uid()", "iberia.admin_uid()")

# 2b. The SQL-editor escape. create_project and delete_project let a caller
# with NO user through, because auth.uid() is null in the dashboard's SQL
# editor and nobody could otherwise seed the first project. After step 2 a
# signed-in manager or fitter is ALSO "no user" -- so the escape let them
# create and delete Iberian projects. Caught by testing it as a manager.
# The escape keys on the real auth.uid() again: no JWT at all passes (and
# anon cannot reach these over the API -- EXECUTE is not granted to it);
# a real user still needs the money role, which reads through admin_uid().
src, n = re.subn(r"if iberia\.admin_uid\(\) is not null and not iberia\.sees_money\(\) then",
                 "if auth.uid() is not null and not iberia.sees_money() then", src)
assert n == 2, n

# 3. the ungated views
for view, alias in (("projects_v", "p"), ("project_history_v", "h")):
    pat = re.compile(r"(CREATE VIEW iberia\.%s AS\n.*?FROM iberia\.\w+ %s)(;)"
                     % (view, alias), re.S)
    src, n = pat.subn(r"\1\n  WHERE (iberia.admin_uid() IS NOT NULL)\2", src)
    assert n == 1, view

assert src.count("auth.uid()") == 2
assert not re.search(r"\bpublic\.(?!profiles\b)", src), "a public. reference survived"

HEAD = """-- ============================================================
-- LITPROFIT IBERIA -- the whole calculator schema, in `iberia`
-- ============================================================
-- GENERATED by tools/make-schema.py from the Lithuanian calculator's
-- migrations. Edit the generator, not this file, for anything structural;
-- the Iberian differences live in iberia-payroll.sql and iberia-access.sql.
--
-- Same Supabase project as the Lithuanian calculator (the org's two free
-- projects are taken), its own schema, its own tables. Nothing here reads
-- or writes a Lithuanian figure; the only thing shared is public.profiles,
-- because the people signing in are the same people.
--
-- Run ONCE on an empty schema. It is not idempotent the way the Lithuanian
-- migrations are: to start again, `drop schema iberia cascade` first.
-- ============================================================

-- pg_dump writes functions before the tables they read; a SQL function body
-- is checked when it is created unless this is off
set check_function_bodies = false;

create schema if not exists iberia;
grant usage on schema iberia to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- WHO IS ALLOWED IN: admins, for now
-- ------------------------------------------------------------
-- Every auth.uid() in the Lithuanian schema reads this instead. For anybody
-- whose profile is not `admin` it returns null, which every function and view
-- below already treats as "not signed in". To open Iberia to managers later,
-- change the role test here and nowhere else.
create or replace function iberia.admin_uid()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id from public.profiles p
   where p.id = auth.uid() and p.role = 'admin'
$$;
revoke all on function iberia.admin_uid() from public, anon;
grant execute on function iberia.admin_uid() to authenticated, service_role;

"""

TAIL = """

-- ------------------------------------------------------------
-- READ ACCESS TO THE VIEWS: SELECT, and only SELECT
-- ------------------------------------------------------------
-- The Lithuanian views picked up Supabase's default privileges on public,
-- which are ALL -- and a simple view is auto-updatable, so an INSERT or
-- UPDATE through it would skip the save functions and their revision check.
-- A new schema has no default privileges, so this states what the app needs.
grant select on all tables in schema iberia to service_role;
do $$
declare v text;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'iberia' and c.relkind = 'v'
  loop
    execute format('grant select on iberia.%I to authenticated', v);
  end loop;
end $$;
"""

sys.stdout.write(HEAD + src.strip() + TAIL)
