-- ============================================================
-- IBERIA PAYROLL: Spain and Portugal instead of Sodra
-- ============================================================
-- Run after iberia.sql. SAFE TO RUN MORE THAN ONCE.
--
-- The Lithuanian schema computes a person's cost as gross x (1 + Sodra),
-- 1.77 % or 2.49 % by contract. Here each person is employed in Spain or in
-- Portugal and the employer's share is that country's. Same shape as before:
-- the gross salary is typed, the employer's share and the full cost are
-- derived, and stored costs are recomputed whenever this file runs -- so
-- when the rates change, edit employer_cost() and re-run.
--
-- ------------------------------------------------------------
-- THE RATES (2026), AND WHERE THEY CAME FROM
-- ------------------------------------------------------------
-- SPAIN -- Orden PJC/297/2026 (BOE-A-2026-7296), Régimen General.
-- Employer's share, on the contribution base:
--
--                                  indefinido   duración determinada
--   contingencias comunes             23.60          23.60
--   desempleo                          5.50           6.70
--   FOGASA                             0.20           0.20
--   formación profesional              0.60           0.60
--   MEI (0.90 total)                   0.75           0.75
--                                     -----          -----
--                                     30.65 %        31.85 %
--
-- The base is capped at 5,101.20 EUR a month. Above the cap the cotización
-- de solidaridad applies instead, in three bands, employer's share:
--   cap to +10 %      0.96 %   (1.15 total)
--   +10 % to +50 %    1.04 %   (1.25 total)
--   above +50 %       1.22 %   (1.46 total)
--
-- PORTUGAL -- Taxa Social Única, general regime: 23.75 % employer, the same
-- on a fixed-term contract, no ceiling. (The extra contribution for
-- "rotatividade excessiva" is assessed per company per year and is not a
-- per-person rate, so it is not modelled.)
--
-- ACCIDENT COVER, BOTH COUNTRIES -- deliberately a typed field per person,
-- not a constant. Spain's AT/EP is a tariff by activity (CNAE) and
-- occupation; Portugal's is a private insurance premium. Neither has one
-- right number for a ship-repair fitter that could be written here without
-- guessing. It defaults to 0 and the screen says when it is.
--
-- WHAT "GROSS" MEANS HERE. Both countries pay fourteen times a year. The
-- figure typed is the monthly gross WITH the two extra payments prorated --
-- annual gross / 12 -- because that is the base the Spanish ceiling and
-- contributions are calculated on, and it is what a month actually costs.
-- ============================================================


alter table iberia.people add column if not exists country text not null default 'ES';
alter table iberia.people add column if not exists accident_rate numeric(6,4) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'iberia_people_country_chk') then
    alter table iberia.people add constraint iberia_people_country_chk
      check (country in ('ES', 'PT'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'iberia_people_accident_chk') then
    alter table iberia.people add constraint iberia_people_accident_chk
      check (accident_rate >= 0 and accident_rate < 0.2);
  end if;
end $$;


-- The employer's monthly cost on top of gross. One function, so the view,
-- both writes and the backfill below cannot disagree.
create or replace function iberia.employer_cost(
  p_gross numeric, p_country text, p_contract text, p_accident numeric)
returns numeric
language plpgsql immutable set search_path = ''
as $$
declare
  g     numeric := greatest(coalesce(p_gross, 0), 0);
  acc   numeric := coalesce(p_accident, 0);
  cap   constant numeric := 5101.20;
  base  numeric;
  rate  numeric;
  soli  numeric := 0;
begin
  if p_country = 'PT' then
    return round(g * (0.2375 + acc), 2);
  end if;

  rate := case when p_contract = 'fixed' then 0.3185 else 0.3065 end;
  base := least(g, cap);
  if g > cap then
    soli := least(g, cap * 1.10) - cap;
    soli := soli * 0.0096;
    if g > cap * 1.10 then
      soli := soli + (least(g, cap * 1.50) - cap * 1.10) * 0.0104;
    end if;
    if g > cap * 1.50 then
      soli := soli + (g - cap * 1.50) * 0.0122;
    end if;
  end if;
  -- AT/EP is on the same capped base as everything else
  return round(base * (rate + acc) + soli, 2);
end $$;

-- the Lithuanian one goes: a call that still reaches it is a bug to surface
drop function if exists iberia.save_person(uuid, bigint, jsonb);
drop function if exists iberia.create_person(jsonb);
drop view if exists iberia.people_v;
drop function if exists iberia.employer_rate(text);

update iberia.people
   set monthly_cost = coalesce(gross_salary, 0)
                    + iberia.employer_cost(gross_salary, country, contract, accident_rate);


create view iberia.people_v as
select
  p.id, p.name, p.job_title, p.department,
  p.country,
  p.contract,
  p.accident_rate,
  p.gross_salary,
  iberia.employer_cost(p.gross_salary, p.country, p.contract, p.accident_rate) as employer_cost,
  p.monthly_cost,
  p.hours_month,
  case when p.hours_month > 0
       then round(p.monthly_cost / p.hours_month, 2) end as hour_cost,
  p.start_date, p.end_date,
  (p.end_date is null or p.end_date >= current_date) as active,
  p.note, p.rev, p.created_at, p.updated_at, p.updated_by
from iberia.people p
where iberia.sees_payroll();

grant select on iberia.people_v to authenticated;


create or replace function iberia.save_person(p_id uuid, p_rev bigint, p_row jsonb)
returns setof iberia.people_v
language plpgsql security definer set search_path = ''
as $$
declare
  cur iberia.people%rowtype;
  g   numeric;
  c   text;
  k   text;
  a   numeric;
begin
  if not iberia.sees_payroll() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into cur from iberia.people where id = p_id;
  if not found then return; end if;
  if p_rev is not null and cur.rev <> p_rev then return; end if;

  g := coalesce((p_row->>'gross_salary')::numeric, 0);
  c := case when p_row->>'contract' = 'fixed' then 'fixed' else 'permanent' end;
  k := case when p_row->>'country' = 'PT' then 'PT' else 'ES' end;
  a := coalesce(nullif(p_row->>'accident_rate', '')::numeric, 0);

  update iberia.people set
    name          = coalesce(p_row->>'name', name),
    job_title     = coalesce(p_row->>'job_title', ''),
    department    = coalesce(p_row->>'department', ''),
    country       = k,
    contract      = c,
    accident_rate = a,
    gross_salary  = g,
    monthly_cost  = g + iberia.employer_cost(g, k, c, a),
    hours_month   = coalesce((p_row->>'hours_month')::numeric, 130),
    start_date    = nullif(p_row->>'start_date', '')::date,
    end_date      = nullif(p_row->>'end_date', '')::date,
    note          = p_row->>'note',
    rev = rev + 1, updated_at = now(), updated_by = iberia.admin_uid()
  where id = p_id;

  return query select * from iberia.people_v where id = p_id;
end $$;

create or replace function iberia.create_person(p_row jsonb)
returns setof iberia.people_v
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
  g numeric;
  c text;
  k text;
  a numeric;
begin
  if not iberia.sees_payroll() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  g := coalesce((p_row->>'gross_salary')::numeric, 0);
  c := case when p_row->>'contract' = 'fixed' then 'fixed' else 'permanent' end;
  k := case when p_row->>'country' = 'PT' then 'PT' else 'ES' end;
  a := coalesce(nullif(p_row->>'accident_rate', '')::numeric, 0);

  insert into iberia.people (name, job_title, department, country, contract,
                             accident_rate, gross_salary, monthly_cost,
                             hours_month, start_date, end_date, note)
  values (coalesce(p_row->>'name', ''), coalesce(p_row->>'job_title', ''),
          coalesce(p_row->>'department', ''), k, c, a, g,
          g + iberia.employer_cost(g, k, c, a),
          coalesce((p_row->>'hours_month')::numeric, 130),
          nullif(p_row->>'start_date', '')::date,
          nullif(p_row->>'end_date', '')::date,
          p_row->>'note')
  returning id into new_id;
  return query select * from iberia.people_v where id = new_id;
end $$;

-- the same allow-list the Lithuanian harden migration keeps: the app calls
-- these two, nobody unauthenticated calls anything
revoke all on function iberia.save_person(uuid, bigint, jsonb) from public, anon;
revoke all on function iberia.create_person(jsonb) from public, anon;
revoke all on function iberia.employer_cost(numeric, text, text, numeric) from public, anon;
grant execute on function iberia.save_person(uuid, bigint, jsonb) to authenticated;
grant execute on function iberia.create_person(jsonb) to authenticated;
grant execute on function iberia.employer_cost(numeric, text, text, numeric) to authenticated;


-- The audit trail follows the new fields: moving someone from a Spanish to
-- a Portuguese contract changes the cost without touching the salary.
create or replace function iberia.company_track()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  ent text := case tg_table_name when 'people' then 'person' else 'overhead' end;
  lbl text := coalesce(new.name, old.name);
  f   text;
  a   text;
  b   text;
begin
  if tg_op = 'INSERT' then
    insert into iberia.company_history (entity, row_id, label, field, was, now)
    values (ent, new.id, lbl, 'created', null, lbl);
    return new;
  end if;

  foreach f in array (case when ent = 'person'
    then array['name','job_title','department','country','contract','accident_rate',
               'gross_salary','monthly_cost','hours_month','start_date','end_date']
    else array['name','category','amount_month','start_date','end_date'] end)
  loop
    a := to_jsonb(old) ->> f;
    b := to_jsonb(new) ->> f;
    if a is distinct from b then
      insert into iberia.company_history (entity, row_id, label, field, was, now)
      values (ent, new.id, lbl, f, a, b);
    end if;
  end loop;
  return new;
end $$;


-- ------------------------------------------------------------
-- CHECK IT LANDED -- the arithmetic, by hand
-- ------------------------------------------------------------
do $$
begin
  -- Spain, indefinido, 2,000: 2000 x 30.65 % = 613.00
  if iberia.employer_cost(2000, 'ES', 'permanent', 0) <> 613.00 then
    raise exception 'ES permanent is wrong: %', iberia.employer_cost(2000, 'ES', 'permanent', 0);
  end if;
  -- Spain, temporal, 2,000: 2000 x 31.85 % = 637.00
  if iberia.employer_cost(2000, 'ES', 'fixed', 0) <> 637.00 then
    raise exception 'ES fixed-term is wrong';
  end if;
  -- Spain, AT/EP 1.5 % on 2,000: 2000 x 32.15 % = 643.00
  if iberia.employer_cost(2000, 'ES', 'permanent', 0.015) <> 643.00 then
    raise exception 'ES accident cover is wrong';
  end if;
  -- Spain above the cap, 6,000: 5101.20 x 30.65 % = 1563.5178
  --   + (5611.32 - 5101.20) x 0.96 % = 4.8972
  --   + (6000 - 5611.32) x 1.04 % = 4.0423  -> 1572.46
  if iberia.employer_cost(6000, 'ES', 'permanent', 0) <> 1572.46 then
    raise exception 'ES above the ceiling is wrong: %', iberia.employer_cost(6000, 'ES', 'permanent', 0);
  end if;
  -- Portugal, 2,000: 2000 x 23.75 % = 475.00, either contract
  if iberia.employer_cost(2000, 'PT', 'fixed', 0) <> 475.00 then
    raise exception 'PT is wrong';
  end if;
  raise notice 'iberia payroll OK';
end $$;
