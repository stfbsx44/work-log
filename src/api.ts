import { createClient } from '@supabase/supabase-js'
import type { Task, TaskInput } from './model'
import { isProjectUrl, isPublicKey } from './publicConfig'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const supabase = isProjectUrl(url) && isPublicKey(key) ? createClient(url!, key!) : null
export const previewMode = import.meta.env.DEV && !supabase
const fields = 'id,title,description,status,priority,due_date,created_at,updated_at,sort_order'
function client() {
  if (!supabase) throw new Error('在线数据尚未配置。')
  return supabase
}
export async function listTasks(): Promise<Task[]> {
  const rows: Task[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await client().from('work_items').select(fields)
      .order('updated_at', { ascending: false }).order('id', { ascending: false }).range(start, start + 999)
    if (error) throw error
    rows.push(...data as Task[])
    if (data.length < 1000) return rows
  }
}
export async function saveTask(input: TaskInput, original?: Task): Promise<Task> {
  const cleaned = { ...input, title: input.title.trim() }
  const query = original
    ? client().from('work_items').update(cleaned).eq('id', original.id).eq('updated_at', original.updated_at)
    : client().from('work_items').insert(cleaned)
  const { data, error } = await query.select(fields).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('这项工作已被更新、删除，或你的管理权限已失效。请刷新看板后重试。')
  return data as Task
}
export async function removeTask(task: Task) {
  const { data, error } = await client().from('work_items').delete().eq('id', task.id)
    .eq('updated_at', task.updated_at).select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('这项工作已发生变化，或你的管理权限已失效。请刷新看板后重试。')
}
export async function reorderTasks(original: Task[], ordered: Task[]): Promise<Task[]> {
  if (!original.length) throw new Error('这项工作已发生变化，请刷新看板后重试。')
  const { data, error } = await client().rpc('reorder_work_items', {
    p_status: original[0].status,
    p_priority: original[0].priority,
    p_expected: original.map(({ id, updated_at }) => ({ id, updated_at })),
    p_ids: ordered.map(task => task.id),
  })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== original.length) throw new Error('这项工作的排序未能确认，请刷新看板后重试。')
  return data as Task[]
}
export function friendlyError(error: unknown) {
  if (error instanceof Error && error.message.startsWith('这项工作')) return error.message
  const code = (error as { code?: string })?.code
  if (code === '40001') return '这项工作或同级顺序已被更新，请刷新看板后重试。'
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303') return '当前没有修改权限，请重新登录管理员账号。'
  if (code === '23514') return '内容不符合要求，请检查标题、说明和选项。'
  return '操作未成功，请检查网络连接后重试。填写的内容仍然保留。'
}
