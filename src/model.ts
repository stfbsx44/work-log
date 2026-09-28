export const statuses = ['planned', 'active', 'completed'] as const
export type Status = typeof statuses[number]
export type Priority = 'low' | 'normal' | 'high'
export interface Task {
  id: string
  title: string
  description: string
  status: Status
  priority: Priority
  due_date: string | null
  created_at: string
  updated_at: string
  sort_order: number
}
export type TaskInput = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date'>
export const statusLabels: Record<Status, string> = { planned: '计划开展', active: '正在进行', completed: '已完成' }
export const priorityLabels: Record<Priority, string> = { low: '低优先级', normal: '普通优先级', high: '高优先级' }
export const blankTask = (): TaskInput => ({ title: '', description: '', status: 'planned', priority: 'normal', due_date: null })
export const priorityRank: Record<Priority, number> = { high: 0, normal: 1, low: 2 }
export function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]
    || a.sort_order - b.sort_order || b.id.localeCompare(a.id))
}
export function peersFor(tasks: Task[], task: Task) {
  return sortTasks(tasks.filter(item => item.status === task.status && item.priority === task.priority))
}
// Other priority groups act as boundaries, never as an implicit priority change.
export function dropOrder(tasks: Task[], task: Task, target: Task | undefined): Task[] {
  const peers = peersFor(tasks, task)
  const from = peers.findIndex(item => item.id === task.id)
  if (from < 0 || task.id === target?.id) return peers
  const to = !target ? peers.length - 1 : target.priority === task.priority
    ? peers.findIndex(item => item.id === target.id)
    : priorityRank[target.priority] < priorityRank[task.priority] ? 0 : peers.length - 1
  if (to < 0) return peers
  peers.splice(from, 1); peers.splice(to, 0, task)
  return peers
}
export function dateLabel(value: string) {
  const [year, month, day] = value.split('-')
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`
}
