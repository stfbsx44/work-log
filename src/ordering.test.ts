import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { dropOrder, peersFor, sortTasks, type Task } from './model'
import { demoTasks } from './demo'

const bootstrap = `create role anon; create role authenticated;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');`
let db: PGlite, migration: string, baseline: Task[]
async function rows() {
  const result = await db.query<{ task: Task }>('select row_to_json(w) as task from public.work_items w order by sort_order, id desc')
  return result.rows.map(row => row.task)
}
async function admin() {
  await db.exec("set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001'")
}
async function reorder(expected: Task[], ids = expected.map(task => task.id).reverse()) {
  return db.query<{ result: Task[] }>('select public.reorder_work_items($1,$2,$3::jsonb,$4::uuid[]) as result',
    [expected[0].status, expected[0].priority, JSON.stringify(expected.map(({ id, updated_at }) => ({ id, updated_at }))), ids])
}
async function rejected(action: () => Promise<unknown>, code: string) {
  await db.exec('savepoint rejected_operation')
  await expect(action()).rejects.toMatchObject({ code })
  await db.exec('rollback to rejected_operation; release rejected_operation')
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(bootstrap)
  await db.exec(await readFile(new URL('../supabase/migrations/001_work_log.sql', import.meta.url), 'utf8'))
  await db.exec(`insert into private.site_admin(user_id) values ('00000000-0000-4000-8000-000000000001');
    insert into public.work_items(title) values ('旧记录一'), ('旧记录二');`)
  baseline = await rowsWithoutOrder()
  migration = await readFile(new URL('../supabase/migrations/002_manual_order.sql', import.meta.url), 'utf8')
  await db.exec(migration)
}, 30000)
async function rowsWithoutOrder() {
  return (await db.query<{ task: Task }>('select row_to_json(w) as task from public.work_items w order by updated_at desc, id desc')).rows.map(row => row.task)
}
beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })
afterAll(async () => { await db?.close() })

it('backfills existing peer order without altering record contents or timestamps', async () => {
  const after = await rows()
  expect(after.map(({ sort_order: _, ...task }) => task)).toEqual(baseline)
  expect(after.map(task => task.sort_order)).toEqual([1, 2])
})

it('sorts by priority then manual position, independent of edit time; clamps cross-priority drops', () => {
  const a = { ...demoTasks[0], id: 'a', sort_order: 5 }, b = { ...a, id: 'b', sort_order: 8 }
  const normal = { ...a, id: 'normal', priority: 'normal' as const, sort_order: -100 }
  const low = { ...a, id: 'low', priority: 'low' as const, sort_order: -200 }
  const tasks = [low, b, normal, a]
  expect(sortTasks(tasks).map(task => task.id)).toEqual(['a', 'b', 'normal', 'low'])
  expect(dropOrder(tasks, a, normal).map(task => task.id)).toEqual(['b', 'a'])
  expect(dropOrder(tasks, b, a).map(task => task.id)).toEqual(['b', 'a'])
  expect(peersFor(tasks, a)).toHaveLength(2)
})

it('denies anonymous and non-admin reorder and preserves all rows', async () => {
  const before = await rows()
  await db.exec('set local role anon')
  await rejected(() => reorder(before), '42501')
  await db.exec("set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'")
  await rejected(() => reorder(before), '42501')
  expect(await rows()).toEqual(before)
})

it('atomically reorders peers and rejects stale snapshots, duplicates, and foreign-group IDs', async () => {
  await admin()
  const before = await rows()
  const result = (await reorder(before)).rows[0].result
  expect(result.map(task => task.id)).toEqual(before.map(task => task.id).reverse())
  expect(result.map(task => task.title)).toEqual(before.map(task => task.title).reverse())
  await rejected(() => reorder(before), '40001')
  const current = await rows()
  await rejected(() => reorder(current, [current[0].id, current[0].id]), '40001')
  await db.query("insert into public.work_items (title,priority) values ('高优先级','high')")
  const other = (await rows()).find(task => task.priority === 'high')!
  await rejected(() => reorder(current, [current[0].id, other.id]), '40001')
  expect((await rows()).filter(task => task.priority === 'normal')).toEqual(current)
  await db.query("insert into public.work_items (title) values ('新同级记录')")
  await rejected(() => reorder(current), '40001')
})

it('inserts and moves to the front of the target peer group; content edits keep position', async () => {
  await admin()
  await db.query("insert into public.work_items (title) values ('新增')")
  const inserted = (await rows())[0]
  expect(inserted.title).toBe('新增')
  await db.query("update public.work_items set description='补充说明' where id=$1", [inserted.id])
  expect((await rows())[0].sort_order).toBe(inserted.sort_order)
  await db.query("insert into public.work_items (title,status) values ('进行中','active')")
  await db.query("update public.work_items set status='active' where id=$1", [inserted.id])
  expect((await rows()).filter(task => task.status === 'active')[0].id).toBe(inserted.id)
  await db.query("insert into public.work_items (title,status,priority) values ('高优先级','active','high')")
  await db.query("update public.work_items set priority='high' where id=$1", [inserted.id])
  expect((await rows()).filter(task => task.status === 'active' && task.priority === 'high')[0].id).toBe(inserted.id)
})

it('rerunning the migration preserves an existing manual order and timestamps', async () => {
  // Migration owns its transaction; finish the test transaction before applying.
  await admin()
  await reorder(await rows())
  const before = await rows()
  await db.exec('commit; reset role')
  await db.exec(migration)
  expect(await rows()).toEqual(before)
  await db.exec('begin')
})
