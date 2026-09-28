import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ createClient: vi.fn(), from: vi.fn(), rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://work-log-test.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_only')
  mock.createClient.mockReturnValue({ from: mock.from, rpc: mock.rpc })
})
afterEach(() => vi.unstubAllEnvs())
function query(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'order', 'update', 'insert', 'delete', 'eq']) chain[method] = vi.fn(() => chain)
  chain.range = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  mock.from.mockReturnValue(chain)
  return chain
}
describe('database boundary', () => {
  it.each(['sb_secret_do_not_ship', 'invalid', `x.${btoa('{"role":"service_role"}')}.x`])('rejects non-public key %s', async key => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', key)
    const { supabase } = await import('./api')
    expect(supabase).toBeNull(); expect(mock.createClient).not.toHaveBeenCalled()
  })
  it('does not treat an update with no matching row as success', async () => {
    const chain = query({ data: null, error: null })
    const { saveTask } = await import('./api')
    const input = { title: '工作', description: '', status: 'planned' as const, priority: 'normal' as const, due_date: null }
    await expect(saveTask(input, { ...input, sort_order: 0, id: 'existing', created_at: 'v1', updated_at: 'v2' })).rejects.toThrow('这项工作已被更新')
    expect(chain.eq).toHaveBeenCalledWith('updated_at', 'v2')
  })
  it('does not claim deletion if RLS or a conflicting update hid the row', async () => {
    query({ data: null, error: null })
    const { removeTask } = await import('./api')
    await expect(removeTask({ id: 'existing', updated_at: 'v2' } as never)).rejects.toThrow('这项工作已发生变化')
  })
  it('propagates a rejected insert instead of inventing a local success', async () => {
    query({ data: null, error: { code: '42501' } })
    const { saveTask } = await import('./api')
    await expect(saveTask({ title: '工作' } as never)).rejects.toEqual({ code: '42501' })
  })
  it('reads records beyond the server page limit', async () => {
    const chain = query({ data: [], error: null })
    chain.range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }).mockResolvedValueOnce({ data: [{ id: 1000 }], error: null })
    const { listTasks } = await import('./api')
    expect(await listTasks()).toHaveLength(1001)
    expect(chain.range).toHaveBeenLastCalledWith(1000, 1999)
  })
  it('requires a confirmed peer set after reordering and sends original timestamps', async () => {
    const { demoTasks } = await import('./demo')
    const { reorderTasks } = await import('./api')
    const peers = [demoTasks[0]]
    mock.rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(reorderTasks(peers, peers)).rejects.toThrow('排序未能确认')
    expect(mock.rpc).toHaveBeenCalledWith('reorder_work_items', {
      p_status: 'planned', p_priority: 'high', p_expected: [{ id: peers[0].id, updated_at: peers[0].updated_at }], p_ids: [peers[0].id],
    })
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001' } })
    await expect(reorderTasks(peers, peers)).rejects.toEqual({ code: '40001' })
  })
})
