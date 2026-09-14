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
}
export type TaskInput = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date'>
export const statusLabels: Record<Status, string> = { planned: '计划开展', active: '正在进行', completed: '已完成' }
export const priorityLabels: Record<Priority, string> = { low: '低优先级', normal: '普通优先级', high: '高优先级' }
export const blankTask = (): TaskInput => ({ title: '', description: '', status: 'planned', priority: 'normal', due_date: null })
export function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id))
}
export function dateLabel(value: string) {
  const [year, month, day] = value.split('-')
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`
}
