-- ============================================================
-- IBERIA MEMBERS: who may open the Iberian calculator
-- ============================================================
-- Run after iberia.sql. SAFE TO RUN MORE THAN ONCE.
--
-- Until now the door was public.profiles.role = 'admin' -- the Lithuanian
-- calculator's role. So making somebody an admin THERE let them into Iberia
-- as a side effect, and there was no way to keep one admin out of Iberia
-- without demoting them in Lithuania too.
--
-- Iberia now has its own list, with its own role per person. Being an admin
-- in Lithuania no longer means anything here; being on this list does.
--
-- ADMINS ONLY, STILL. admin_uid() lets in a member whose Iberian role is
-- 'admin'. A member with any other role is told so and gets nothing, the same
-- as before. Opening Iberia to managers later is one line in admin_uid() --
-- my_role() already reads the Iberian role, so a manager would then see
-- exactly what a manager sees in Lithuania.
--
-- MANAGING THE LIST, in the SQL editor:
--
--   add:     insert into iberia.members (user_id, role)
--            select id, 'admin' from auth.users where email = 'name@litprofit.com'
--            on conflict (user_id) do update set role = excluded.role;
--   remove:  delete from iberia.members
--             where user_id = (select id from auth.users where email = 'name@litprofit.com');
--   list:    select * from iberia.members_v;
--
-- The person has to have an account already (the same login as the
-- Lithuanian calculator). Removing them here does not touch that account.
-- ============================================================

create table if not exists iberia.members (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  role     text not null default 'admin'
           check (role in ('admin', 'manager', 'staff')),
  added_at timestamptz not null default now(),
  note     text
);
-- Deny-all, like every other table here: nothing reads it over the API.
-- The functions below are SECURITY DEFINER and read it on the caller's behalf.
alter table iberia.members enable row level security;
revoke all on iberia.members from anon, authenticated;

-- First run only: the people who could get in yesterday can get in today.
-- `on conflict do nothing`, so a re-run never re-adds someone removed since.
insert into iberia.members (user_id, role, note)
select p.id, 'admin', 'carried over: admin in the Lithuanian calculator on 2026-10-08'
  from public.profiles p
 where p.role = 'admin'
   and not exists (select 1 from iberia.members)
on conflict (user_id) do nothing;


-- ------------------------------------------------------------
-- THE DOOR
-- ------------------------------------------------------------
-- Same contract as before -- the caller's id, or null -- so the fifty-odd
-- places that read it do not change. What changed is the question it asks.
create or replace function iberia.admin_uid()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id from iberia.members m
   where m.user_id = auth.uid() and m.role = 'admin'
$$;

-- The Iberian role, for sees_money() and sees_payroll(). Read through
-- admin_uid() as before, so while the door admits admins only, everyone
-- else is still 'staff' here and sees nothing.
create or replace function iberia.my_role()
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select m.role from iberia.members m
                    where m.user_id = iberia.admin_uid()), 'staff')
$$;

-- What the app asks on sign-in, so it can say WHY somebody is turned away:
-- null = not on the list at all, otherwise their Iberian role. Reads the
-- real auth.uid() on purpose -- a member who is not an admin must be told
-- "admins only", not "you are not on the list".
create or replace function iberia.my_access()
returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from iberia.members m where m.user_id = auth.uid()
$$;

revoke all on function iberia.my_access() from public, anon;
grant execute on function iberia.my_access() to authenticated;


-- For reading the list in the SQL editor. Not granted to the app.
create or replace view iberia.members_v as
select u.email, coalesce(nullif(p.name, ''), u.email) as name,
       m.role as iberia_role, p.role as lithuania_role,
       m.added_at, u.last_sign_in_at, m.note
  from iberia.members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
 order by m.added_at;
revoke all on iberia.members_v from anon, authenticated;


-- ------------------------------------------------------------
-- CHECK IT LANDED
-- ------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from iberia.members where role = 'admin';
  if n = 0 then
    raise exception 'nobody is an Iberian admin -- nobody could sign in';
  end if;
  raise notice 'iberia members OK: % admin(s) on the list', n;
end $$;
