import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  // Minimal Supabase auth context; grants and RLS use real PostgreSQL semantics.
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/001_work_log.sql', import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })

it('enforces public read and administrator-only CRUD; rejects self-promotion', async () => {
  await db.exec(await readFile(new URL('../supabase/tests/permissions.sql', import.meta.url), 'utf8'))
  const result = await db.query('select * from public.work_items')
  expect(result.rows).toEqual([]) // Test fixtures must have been rolled back.
}, 30000)

it('keeps timestamps server-owned and rejects invalid data at the database boundary', async () => {
  const result = await db.query<{ id: string; created_at: Date; updated_at: Date }>(
    "insert into public.work_items (title, created_at, updated_at) values ('工作', '2000-01-01', '2000-01-01') returning *",
  )
  const row = result.rows[0]
  expect(new Date(row.created_at).getFullYear()).toBeGreaterThan(2000)
  const updated = await db.query<{ created_at: Date; updated_at: Date }>(
    "update public.work_items set title = '更新', created_at = '2000-01-01', updated_at = '2000-01-01' where id = $1 returning *", [row.id],
  )
  expect(updated.rows[0].created_at).toEqual(row.created_at)
  expect(new Date(updated.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(row.updated_at).getTime())
  await expect(db.query("insert into public.work_items (title) values ('   ')")).rejects.toThrow()
  await expect(db.query("insert into public.work_items (title, status) values ('工作', 'invented')")).rejects.toThrow()
  await db.query('delete from public.work_items where id = $1', [row.id])
})
