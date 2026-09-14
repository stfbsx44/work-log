begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Only SQL administrators can manage this single allowed identity.
create table if not exists private.site_admin (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
revoke all on private.site_admin from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from private.site_admin where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  status text not null default 'planned' check (status in ('planned', 'active', 'completed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_items_updated_idx on public.work_items (updated_at desc, id desc);

create or replace function private.stamp_work_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    NEW.created_at := clock_timestamp();
  else
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
  end if;
  NEW.updated_at := clock_timestamp();
  return NEW;
end;
$$;
drop trigger if exists stamp_work_item on public.work_items;
create trigger stamp_work_item before insert or update on public.work_items
for each row execute function private.stamp_work_item();

alter table public.work_items enable row level security;
revoke all on public.work_items from public, anon, authenticated;
grant select on public.work_items to anon, authenticated;
grant insert, update, delete on public.work_items to authenticated;

drop policy if exists public_read on public.work_items;
create policy public_read on public.work_items for select to anon, authenticated using (true);
drop policy if exists admin_insert on public.work_items;
create policy admin_insert on public.work_items for insert to authenticated
with check ((select public.is_admin()));
drop policy if exists admin_update on public.work_items;
create policy admin_update on public.work_items for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists admin_delete on public.work_items;
create policy admin_delete on public.work_items for delete to authenticated
using ((select public.is_admin()));

commit;
