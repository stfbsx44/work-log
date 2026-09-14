import type { Task } from './model'

// Only displayed by the local development preview without a configured backend.
export const demoTasks: Task[] = [
  { id: 'demo-1', title: '梳理下一阶段工作计划', description: '整理待开展的事项，明确每项工作的目标、优先级与时间安排。', status: 'planned', priority: 'high', due_date: '2026-09-25', created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T08:00:00Z' },
  { id: 'demo-2', title: '整理常用资料与参考文档', description: '将分散的资料归类，建立方便查阅的工作资料目录。', status: 'planned', priority: 'normal', due_date: null, created_at: '2026-09-13T08:00:00Z', updated_at: '2026-09-13T08:00:00Z' },
  { id: 'demo-3', title: '搭建个人工作记录网页', description: '用一个清晰的看板记录计划与进展，让每项工作都有迹可循。', status: 'active', priority: 'high', due_date: '2026-09-20', created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T09:00:00Z' },
  { id: 'demo-4', title: '完善本周项目方案', description: '补充实施步骤，核对需求细节，为下一步执行做好准备。', status: 'active', priority: 'normal', due_date: '2026-09-18', created_at: '2026-09-13T08:00:00Z', updated_at: '2026-09-13T08:00:00Z' },
  { id: 'demo-5', title: '完成工作记录需求梳理', description: '确定三个工作状态、公开浏览与管理员编辑，以及跨设备同步的使用方式。', status: 'completed', priority: 'normal', due_date: null, created_at: '2026-09-12T08:00:00Z', updated_at: '2026-09-14T08:00:00Z' },
]
