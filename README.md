# LITPROFIT Iberia — project calculator

The LITPROFIT project calculator, copied for the Spanish and Portuguese work.
Same app, same features (projects, enquiries, acts with signatures, documents,
company payroll and fixed costs, reports, AI advice), with three differences:

1. **Its own data.** Everything lives in an `iberia` schema inside the
   Lithuanian calculator's Supabase project (`uiuzbhekmroosmemwhdr`). Nothing
   here reads or writes a Lithuanian figure. Only `public.profiles` is shared,
   because the people signing in are the same people.
2. **Its own user list, admins only for now.** `iberia.members` holds who may
   open Iberia and their Iberian role — independent of the Lithuanian role, so
   being an admin there grants nothing here. Enforced in the database: every
   `auth.uid()` in the Lithuanian schema reads `iberia.admin_uid()` here, which
   returns nobody who is not a member with role `admin`. Anyone else is told
   why and signed out — and if they went round the page, every view answers
   with no rows and every write is refused (`db/test-access.sql`). To open it
   to managers later, change the role test in `admin_uid()`.

   Managing the list (SQL editor):

   ```sql
   -- add
   insert into iberia.members (user_id, role)
   select id, 'admin' from auth.users where email = 'name@litprofit.com'
   on conflict (user_id) do update set role = excluded.role;
   -- remove
   delete from iberia.members
    where user_id = (select id from auth.users where email = 'name@litprofit.com');
   -- see who is on it
   select * from iberia.members_v;
   ```
3. **Spanish and Portuguese payroll** instead of Sodra/GPM/NPD.

Languages are the same as the Lithuanian copy: EN, LT, RU.

**Live:** https://aldy-lab.github.io/litprofit-spain/

## Setting it up (once)

1. Supabase → *LitProfit calculator* → SQL editor → paste **`db/install.sql`** → Run.
   It ends with the notice `iberia payroll OK`. It also adds `iberia` to the
   schemas the API serves (`public, graphql_public, iberia`); if the dashboard
   still shows only `public` under *Project Settings → Data API → Exposed
   schemas*, add `iberia` there.
2. The advice function `supabase/functions/advice-iberia` (the Lithuanian
   `advice`, pointed at the `iberia` schema) is deployed — 8 Oct 2026. It uses
   the project's existing `ANTHROPIC_API_KEY` secret. The file is kept byte for
   byte what is deployed.

   ⚠️ The litprofit repo's `supabase/functions/advice/index.ts` does NOT match
   the live Lithuanian function: it lacks the `\`` escapes inside the prompt,
   so as committed it does not even compile. Live is the newer copy.
3. Sign in with an admin account from the Lithuanian calculator.

## Build

```
python3 tools/build.py          # tools/calc/app.html -> index.html
bash tools/test-db.sh           # schema + access test in a throwaway local Postgres
python3 tools/make-schema.py <dump> > db/iberia.sql   # regenerate the copy (see its header)
bash tools/make-install.sh      # db/install.sql from the three db files
```

`index.html` is committed; GitHub Pages serves the repository root.

## Payroll — what the numbers are

Gross is **monthly with the two extra payments prorated** (annual ÷ 12). Both
countries pay 14 times a year, and that is the base Spain contributes on.

| | Employer on top of gross (2026) |
|---|---|
| Spain, indefinite | 30.65 % — CC 23.60, desempleo 5.50, FOGASA 0.20, FP 0.60, MEI 0.75 |
| Spain, fixed-term | 31.85 % — desempleo 6.70 |
| Spain, above €5,101.20/month | base capped; solidaridad 0.96 / 1.04 / 1.22 % by band |
| Portugal | 23.75 % TSU, either contract, no cap |
| Both | + accident cover, **typed per person** (AT/EP tariff in Spain, insurance premium in Portugal) |

Sources: Orden PJC/297/2026 (BOE-A-2026-7296); Segurança Social TSU tables.
One function in the database (`iberia.employer_cost`, `db/iberia-payroll.sql`)
and its mirror in the app (`employerCost()`), tested against each other by
arithmetic. When the law changes, change both and re-run the payroll file.

The salary calculator shows the employee side too (Spain 6.50 / 6.55 %,
Portugal 11 %), but **does not estimate income tax**: IRPF and IRS withholding
depend on the person, so it stops at "net before income tax" until a
withholding % from the payslip is typed in.

## Still to come from the client

- **Which legal entity does the Iberian work.** `COMPANY` at the top of the
  acts code in `tools/calc/app.html` (legal name, address, email, phone) is
  blank on purpose — an act names its executor, and printing UAB "Litprofit"
  there would be a claim about who is liable. Blank values drop their line.
- **Acts print EN + LT.** Spanish may suit Iberian customers better.
- **The per-job burden setting** defaults to the Lithuanian 35 %. In Iberia
  the statutory share alone is 24–32 %, so it needs a real figure; the help
  text says so.
- **The BITZER/DANFOSS partner line** was left out of the advice prompt — the
  agreement is regional and may not cover Iberia.

## Fixed here, still open in the Lithuanian copy

- `CLOUD.people()` is defined twice; the second (payroll) wins, so "last saved
  by" and the conflict dialog's "who holds it" are blank. Renamed
  `profileNames()` here.
- Staff CSV import reads *Neterminuota* and *Бессрочный* as fixed-term.
- The people register pushes a phone page 750px sideways.
- The service worker deletes every cache on its origin, not just its own.
- Live views carry Supabase's default ALL grants (auto-updatable views skip the
  save functions); here they are SELECT only.
- Live is missing part of `migrate-documents-4.sql` (`sees_company()`).
