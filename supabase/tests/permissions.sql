-- Run after migration, preferably in a dedicated test project.
-- All fixtures and the temporary administrator assignment roll back.
begin;

insert into auth.users (id, email) values
('10000000-0000-4000-8000-000000000001', 'work-log-admin-test@example.invalid'),
('10000000-0000-4000-8000-000000000002', 'work-log-reader-test@example.invalid');
insert into private.site_admin (singleton, user_id)
values (true, '10000000-0000-4000-8000-000000000001')
on conflict (singleton) do update set user_id = excluded.user_id;
insert into public.work_items (id, title) values
('20000000-0000-4000-8000-000000000001', 'Temporary permission fixture');

set local role anon;
do $$
begin
  if not exists(select 1 from public.work_items where id = '20000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: anonymous public read';
  end if;
  begin
    insert into public.work_items(title) values ('anonymous forbidden');
    raise exception 'FAIL: anonymous insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.work_items set title = 'anonymous forbidden' where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: anonymous update allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.work_items where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: anonymous delete allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if public.is_admin() then raise exception 'FAIL: reader is administrator'; end if;
  if not exists(select 1 from public.work_items where id = '20000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: reader cannot read';
  end if;
  begin
    insert into public.work_items(title) values ('reader forbidden');
    raise exception 'FAIL: reader insert allowed';
  exception when insufficient_privilege then null; end;
  update public.work_items set title = 'reader forbidden' where id = '20000000-0000-4000-8000-000000000001';
  if found then raise exception 'FAIL: reader update allowed'; end if;
  delete from public.work_items where id = '20000000-0000-4000-8000-000000000001';
  if found then raise exception 'FAIL: reader delete allowed'; end if;
  begin
    update private.site_admin set user_id = '10000000-0000-4000-8000-000000000002';
    raise exception 'FAIL: reader self promotion allowed';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare fixture uuid;
begin
  if not public.is_admin() then raise exception 'FAIL: administrator check'; end if;
  insert into public.work_items(title) values ('admin allowed') returning id into fixture;
  update public.work_items set status = 'active' where id = fixture;
  if not found then raise exception 'FAIL: administrator update rejected'; end if;
  update public.work_items set status = 'completed' where id = fixture;
  if not found then raise exception 'FAIL: completion rejected'; end if;
  delete from public.work_items where id = fixture;
  if not found then raise exception 'FAIL: administrator delete rejected'; end if;
end $$;
reset role;

rollback;
