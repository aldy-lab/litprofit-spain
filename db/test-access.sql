-- ============================================================
-- The admins-only rule, tested as each kind of caller.
-- Local only: it creates users. Run by tools/test-db.sh.
-- Every check RAISES on failure, so a clean run is the pass.
-- ============================================================
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@test'),
  ('22222222-2222-2222-2222-222222222222', 'manager@test'),
  ('33333333-3333-3333-3333-333333333333', 'staff@test');
insert into public.profiles (id, email, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin@test',   'admin'),
  ('22222222-2222-2222-2222-222222222222', 'manager@test', 'manager'),
  ('33333333-3333-3333-3333-333333333333', 'staff@test',   'staff');

-- ---- the admin can do everything ----
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare n int; pid uuid; r record;
begin
  select id into pid from iberia.create_project(
    '{"card":{"projectId":"IB-001","client":"Vigo yard","currency":"EUR","contract":5000},
      "revenue":[{"plan":1000,"actual":900}]}'::jsonb);
  if pid is null then raise exception 'admin could not create a project'; end if;

  select * into r from iberia.projects_v where id = pid;
  if not r.money then raise exception 'admin was not given the money columns'; end if;
  if r.data -> 'revenue' is null then raise exception 'admin got a redacted project'; end if;

  select * into r from iberia.create_person(
    '{"name":"Ana","gross_salary":2000,"country":"ES","contract":"permanent","accident_rate":0.015}');
  if r.employer_cost <> 643.00 or r.monthly_cost <> 2643.00 then
    raise exception 'ES person cost wrong: % / %', r.employer_cost, r.monthly_cost;
  end if;
  select * into r from iberia.create_person('{"name":"Rui","gross_salary":1500,"country":"PT"}');
  if r.employer_cost <> 356.25 then raise exception 'PT person cost wrong: %', r.employer_cost; end if;

  select count(*) into n from iberia.company_burn();
  if n <> 1 then raise exception 'admin got no burn row'; end if;

  select count(*) into n from iberia.create_signature('Admin', 'data:image/png;base64,' || repeat('A', 200));
  if n <> 1 then raise exception 'admin could not keep a signature'; end if;
  raise notice 'admin: creates, reads money, payroll and signatures';
end $$;
commit;

-- ---- everyone else: nothing, and no way to write ----
create or replace function pg_temp.shut_out(who text) returns void language plpgsql as $$
declare n int; v text;
begin
  foreach v in array array['projects_v','project_history_v','people_v','overheads_v',
                           'acts_v','act_fields_v','documents_v','enquiries_v',
                           'enquiry_history_v','company_history_v','signatures_v'] loop
    execute format('select count(*) from iberia.%I', v) into n;
    if n <> 0 then raise exception '% sees % row(s) in %', who, n, v; end if;
  end loop;

  select count(*) into n from iberia.company_burn();
  if n <> 0 then raise exception '% got a burn figure', who; end if;

  begin
    perform iberia.create_project('{"card":{"projectId":"X"}}'::jsonb);
    raise exception '% created a project', who;
  exception when insufficient_privilege then null; end;

  begin
    perform iberia.delete_project((select id from iberia.projects limit 1));
    raise exception '% reached the projects table', who;
  exception when insufficient_privilege then null; end;

  begin
    perform iberia.create_person('{"name":"X","gross_salary":1}');
    raise exception '% created a person', who;
  exception when insufficient_privilege then null; end;

  begin
    perform iberia.create_signature('X', 'data:image/png;base64,' || repeat('A', 200));
    raise exception '% kept a signature', who;
  exception when insufficient_privilege then null; end;

  begin
    perform 1 from iberia.projects;
    raise exception '% read the projects table', who;
  exception when insufficient_privilege then null; end;
  raise notice '%: shut out', who;
end $$;

-- delete_project has to be tried on a real id, which only the owner can see
create temp table target as select id from iberia.projects limit 1;
grant select on target to authenticated;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  begin
    perform iberia.delete_project((select id from target));
    raise exception 'manager deleted a project';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.shut_out('manager');
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  begin
    perform iberia.delete_project((select id from target));
    raise exception 'staff deleted a project';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.shut_out('staff');
rollback;

-- and the row is still there
do $$ begin
  if (select count(*) from iberia.projects) <> 1 then
    raise exception 'the project did not survive';
  end if;
  raise notice 'ALL ACCESS CHECKS PASSED';
end $$;
