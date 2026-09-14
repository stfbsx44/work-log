import { useState, type FormEvent, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CalendarDays, Check, Circle, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { blankTask, dateLabel, priorityLabels, statuses, statusLabels, type Status, type Task, type TaskInput } from './model'

export function Modal({ title, description, children, onClose, busy = false }: { title: string; description: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose() }}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className="modal-content" onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault() }}>
    <Dialog.Title className="modal-title">{title}</Dialog.Title><Dialog.Description className="modal-description">{description}</Dialog.Description>
    <Dialog.Close className="icon-button modal-close" aria-label="关闭对话框" disabled={busy}><X size={19} /></Dialog.Close>{children}
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
export function Login({ onClose, onLogin }: { onClose: () => void; onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await onLogin(email, password); onClose() } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <Modal title="管理员登录" description="登录后可管理工作记录。浏览看板无需登录。" onClose={onClose} busy={busy}><form onSubmit={submit} className="form"><fieldset disabled={busy}>
    <label>邮箱<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="请输入管理员邮箱" autoFocus /></label>
    <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" /></label>
    </fieldset>{error && <p role="alert" className="form-error">{error}</p>}<button className="button primary full-width" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录'}</button></form></Modal>
}
export function Editor({ original, initialStatus, onClose, onSave, busy, isAdmin, onReauthenticate }: { original?: Task; initialStatus: Status; onClose: () => void; onSave: (input: TaskInput, original?: Task) => Promise<void>; busy: boolean; isAdmin: boolean; onReauthenticate: () => void }) {
  const [input, setInput] = useState<TaskInput>(original ? { title: original.title, description: original.description, status: original.status, priority: original.priority, due_date: original.due_date } : { ...blankTask(), status: initialStatus })
  const [error, setError] = useState(''), [confirmDiscard, setConfirmDiscard] = useState(false), [dirty, setDirty] = useState(false)
  function change(patch: Partial<TaskInput>) { setInput(current => ({ ...current, ...patch })); setDirty(true) }
  function close() { if (dirty) setConfirmDiscard(true); else onClose() }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!input.title.trim()) { setError('请填写工作标题。'); return }
    try { await onSave(input, original); onClose() } catch (error) { setError((error as Error).message) }
  }
  return <Modal title={original ? '编辑工作' : '新增工作'} description="保存后，工作内容将公开展示在看板中。" onClose={close} busy={busy}>
    <form onSubmit={submit} className="form"><fieldset disabled={busy || !isAdmin}>
    <label>工作标题 <span className="required">*</span><input required maxLength={200} value={input.title} onChange={e => change({ title: e.target.value })} placeholder="这项工作要做什么？" autoFocus /></label>
    <label>详细说明<textarea rows={5} maxLength={10000} value={input.description} onChange={e => change({ description: e.target.value })} placeholder="补充目标、步骤或其他需要记录的内容…" /></label>
    <div className="form-row"><label>当前状态<select value={input.status} onChange={e => change({ status: e.target.value as Status })}>{statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
    <label>优先级<select value={input.priority} onChange={e => change({ priority: e.target.value as TaskInput['priority'] })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <label>截止日期 <span className="optional">选填</span><input type="date" value={input.due_date || ''} onChange={e => change({ due_date: e.target.value || null })} /></label></fieldset>
    {!isAdmin && <div role="alert" className="form-error">管理权限已失效，输入仍然保留。<button type="button" className="text-button" onClick={onReauthenticate}>重新登录</button></div>}{error && <p role="alert" className="form-error">{error}</p>}
    {confirmDiscard ? <div className="discard-note"><p>有尚未保存的内容，确定放弃吗？</p><div className="form-actions"><button type="button" className="button secondary" onClick={() => setConfirmDiscard(false)}>继续编辑</button><button type="button" className="button danger" onClick={onClose}>放弃修改</button></div></div> : <div className="form-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>取消</button><button type="submit" className="button primary" disabled={busy || !isAdmin}>{busy ? '正在保存…' : '保存工作'}</button></div>}
    </form></Modal>
}
export function DeleteDialog({ task, onClose, onDelete, busy, isAdmin }: { task: Task; onClose: () => void; onDelete: (task: Task) => Promise<void>; busy: boolean; isAdmin: boolean }) {
  const [error, setError] = useState('')
  async function confirm() { try { await onDelete(task); onClose() } catch (error) { setError((error as Error).message) } }
  return <Modal title="删除这项工作？" description={`“${task.title}”将从看板中删除，此操作无法撤销。`} onClose={onClose} busy={busy}>
    {error && <p role="alert" className="form-error">{error}</p>}{!isAdmin && <p role="alert" className="form-error">管理权限已失效，请重新登录。</p>}
    <div className="form-actions"><button className="button secondary" onClick={onClose} disabled={busy}>取消</button><button className="button danger" onClick={() => void confirm()} disabled={busy || !isAdmin}>{busy ? '正在删除…' : '确认删除'}</button></div></Modal>
}
export function Card({ task, isAdmin, busy, onEdit, onDelete, onMove }: { task: Task; isAdmin: boolean; busy: boolean; onEdit: () => void; onDelete: () => void; onMove: (status: Status) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !isAdmin || busy })
  return <article ref={setNodeRef} className={`task-card ${isDragging ? 'dragging' : ''}`} style={transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` } : undefined} aria-label={task.title}>
    <div className="card-top"><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>{isAdmin ? <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="icon-button drag-handle" aria-label={`拖动 ${task.title}`} disabled={busy}><GripVertical size={17} /></button> : task.status === 'completed' && <Check size={16} className="complete-mark" />}</div>
    <h4>{task.title}</h4>{task.description && <p className="card-description">{task.description}</p>}<div className="card-meta"><CalendarDays size={14} />{task.due_date ? <time dateTime={task.due_date}>{dateLabel(task.due_date)}</time> : '未设置截止日期'}</div>
    {isAdmin && <div className="card-actions"><select aria-label={`修改状态：${task.title}`} value={task.status} disabled={busy} onChange={e => onMove(e.target.value as Status)}>{statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select><div><button className="icon-button" aria-label={`编辑 ${task.title}`} onClick={onEdit} disabled={busy}><Pencil size={15} /></button><button className="icon-button delete-button" aria-label={`删除 ${task.title}`} onClick={onDelete} disabled={busy}><Trash2 size={15} /></button></div></div>}
  </article>
}
export function Column({ status, index, count, isAdmin, busy, selected, onAdd, children }: { status: Status; index: number; count: number; isAdmin: boolean; busy: boolean; selected: boolean; onAdd: () => void; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !isAdmin || busy })
  return <section ref={setNodeRef} className={`column column-${status} ${selected ? 'mobile-selected' : ''} ${isOver ? 'drop-target' : ''}`} aria-label={statusLabels[status]}>
    <header className="column-header"><div><span className="status-icon">{status === 'completed' ? <Check size={16} /> : <Circle size={14} />}</span><h3>{statusLabels[status]}</h3><span className="count">{count}</span></div><span className="column-number">0{index + 1}</span></header>
    <p className="column-description">{['为接下来的工作留一个位置', '专注当下，让计划逐步落地', '每一次完成，都值得记录'][index]}</p><div className="card-list">{children}</div>
    {isAdmin && <button className="column-add" onClick={onAdd} disabled={busy}><Plus size={16} />添加工作</button>}</section>
}
