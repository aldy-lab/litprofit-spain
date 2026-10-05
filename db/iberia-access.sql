-- ============================================================
-- IBERIA: the file store, and the API seeing the schema at all
-- ============================================================
-- Run after iberia.sql. SAFE TO RUN MORE THAN ONCE.
-- ============================================================


-- ------------------------------------------------------------
-- 1. ITS OWN BUCKET
-- ------------------------------------------------------------
-- Storage is per project, not per schema, so a shared bucket would put the
-- Iberian invoices in the same place as the Lithuanian ones, guarded by the
-- Lithuanian rules. Its own bucket, its own four policies, each asking the
-- iberia functions -- which answer no to anybody who is not an admin.
--
-- 25 MB a file and private, the same as the Lithuanian store.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('iberia-documents', 'iberia-documents', false, 26214400, null)
on conflict (id) do update
  set public = false, file_size_limit = 26214400;

drop policy if exists iberia_documents_read   on storage.objects;
drop policy if exists iberia_documents_insert on storage.objects;
drop policy if exists iberia_documents_update on storage.objects;
drop policy if exists iberia_documents_delete on storage.objects;

-- The same lines the Lithuanian bucket draws (migrate-documents-4.sql): money
-- to touch the store at all; a company file (no project) only for an admin.
-- While admins are the only people let in, every test below is true for
-- them and false for everyone else -- which is the point of keeping them:
-- opening Iberia to managers later needs no change here.
create policy iberia_documents_read on storage.objects for select
  using (bucket_id = 'iberia-documents' and iberia.sees_money()
         and (iberia.my_role() = 'admin' or iberia.doc_is_project_file(name)));

create policy iberia_documents_insert on storage.objects for insert
  with check (bucket_id = 'iberia-documents' and iberia.sees_money());

create policy iberia_documents_update on storage.objects for update
  using (bucket_id = 'iberia-documents' and iberia.sees_money());

create policy iberia_documents_delete on storage.objects for delete
  using (bucket_id = 'iberia-documents' and iberia.sees_money()
         and (iberia.my_role() = 'admin' or iberia.doc_is_project_file(name)));


-- ------------------------------------------------------------
-- 2. THE API HAS TO BE TOLD THE SCHEMA EXISTS
-- ------------------------------------------------------------
-- PostgREST serves only the schemas it is configured with, and a schema it
-- does not serve answers every request with a 406 that names the ones it
-- does. The dashboard setting is Project Settings -> Data API -> Exposed
-- schemas; this is the same setting held on the role PostgREST connects as.
--
-- public and graphql_public are the two that were already exposed. Leaving
-- either out of this list takes the Lithuanian calculator off the air.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, iberia';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
