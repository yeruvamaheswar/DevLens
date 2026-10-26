-- Apply only to project hivfaqlabtbrhrviwrrm after the evidence migration.
begin;
alter table public.edges add constraint edges_rel_check
 check (rel in ('prompted','called','edited','ran_test','failed','supersedes','verifies','cites'));
commit;
