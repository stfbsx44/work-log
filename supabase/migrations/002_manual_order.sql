begin;

-- Additive and rerunnable: preserve records, content timestamps and manual order.
alter table public.work_items add column if not exists sort_order integer;
alter table public.work_items disable trigger stamp_work_item;
with ranked as (
  select id, row_number() over (
    partition by status, priority order by updated_at desc, id desc
  )::integer as position from public.work_items
)
update public.work_items w set sort_order = ranked.position
from ranked where w.id = ranked.id and w.sort_order is null;
alter table public.work_items enable trigger stamp_work_item;
alter table public.work_items alter column sort_order set not null;
alter table public.work_items alter column sort_order set default 0;
create index if not exists work_items_group_order_idx
  on public.work_items (status, priority, sort_order, id);

-- Every writer (including old clients) takes the same transaction lock BEFORE
-- acquiring row locks. Readers are not blocked. The RPC uses the same lock.
create or replace function private.lock_work_board()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(714209, 1);
  return null;
end;
$$;
revoke all on function private.lock_work_board() from public, anon, authenticated;
drop trigger if exists lock_work_board on public.work_items;
create trigger lock_work_board before insert or update or delete on public.work_items
for each statement execute function private.lock_work_board();

create or replace function private.stamp_work_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    NEW.created_at := clock_timestamp();
  else
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
  end if;
  if TG_OP = 'INSERT' or NEW.status is distinct from OLD.status
    or NEW.priority is distinct from OLD.priority then
    select coalesce(min(w.sort_order), 1) - 1 into NEW.sort_order
      from public.work_items w
      where w.status = NEW.status and w.priority = NEW.priority and w.id <> NEW.id;
  end if;
  NEW.updated_at := clock_timestamp();
  return NEW;
end;
$$;

-- Invoker rights retain RLS; no function can confer administrator privileges.
-- The entire peer snapshot must match, including additions/removals and edits.
create or replace function public.reorder_work_items(
  p_status text, p_priority text, p_expected jsonb, p_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  group_size integer;
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(714209, 1);
  select count(*) into group_size from public.work_items
    where status = p_status and priority = p_priority;
  if group_size = 0 or p_expected is null or jsonb_typeof(p_expected) <> 'array'
    or p_ids is null then
    raise exception 'Invalid ordering group' using errcode = '23514';
  end if;
  if cardinality(p_ids) <> group_size
    or (select count(distinct id) from unnest(p_ids) ids(id)) <> group_size
    or jsonb_array_length(p_expected) <> group_size
    or (select count(distinct id) from jsonb_to_recordset(p_expected) as e(id uuid, updated_at timestamptz)) <> group_size
    or exists (
      select 1 from public.work_items w
      where w.status = p_status and w.priority = p_priority and (
        not (w.id = any(p_ids)) or not exists (
          select 1 from jsonb_to_recordset(p_expected) as e(id uuid, updated_at timestamptz)
          where e.id = w.id and e.updated_at = w.updated_at
        )
      )
    ) then
    raise exception 'Ordering snapshot has changed' using errcode = '40001';
  end if;
  update public.work_items w set sort_order = ordered.position::integer
    from unnest(p_ids) with ordinality as ordered(id, position)
    where w.id = ordered.id;
  select jsonb_agg(to_jsonb(w) order by w.sort_order, w.id desc) into result
    from public.work_items w where w.status = p_status and w.priority = p_priority;
  return result;
end;
$$;
revoke all on function public.reorder_work_items(text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.reorder_work_items(text, text, jsonb, uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
