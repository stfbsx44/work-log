import { useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core'
import { LayoutDashboard, LockKeyhole, LogOut, NotebookPen, Plus, RefreshCw } from 'lucide-react'
import { previewMode, supabase } from './api'
import { Card, Column, DeleteDialog, Editor, Login } from './components'
import { dropOrder, peersFor, priorityLabels, statuses, statusLabels, type Status, type Task } from './model'
import { useBoard } from './useBoard'
import { usePageTools } from './usePageTools'

export default function App() {
  const board = useBoard()
  const [mobileStatus, setMobileStatus] = useState<Status>('active')
  const [loginOpen, setLoginOpen] = useState(false)
  const [editor, setEditor] = useState<{ original?: Task; status: Status } | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [actionError, setActionError] = useState('')
  const [drag, setDrag] = useState<{ task: Task; snapshot: Task[] } | null>(null)
  usePageTools({ tasks: board.tasks, isAdmin: board.isAdmin, loading: board.loading, preview: previewMode, openEditor: status => {
    if (editor || deleting || loginOpen || board.busy) throw new Error('Finish the current form or save before opening another form.')
    setEditor({ status })
  } })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }))
  async function move(task: Task, status: Status) {
    if (task.status === status || board.busy) return
    setActionError('')
    try {
      await board.save({ title: task.title, description: task.description, priority: task.priority, due_date: task.due_date, status }, task)
      setMobileStatus(status)
    } catch (error) { setActionError((error as Error).message) }
  }
  async function reorder(original: Task[], ordered: Task[]) {
    if (!board.isAdmin || board.busy) return
    setActionError('')
    try { await board.reorder(original, ordered) } catch (error) { setActionError((error as Error).message) }
  }
  function shift(task: Task, direction: -1 | 1) {
    const peers = peersFor(board.tasks, task), target = peers[peers.findIndex(item => item.id === task.id) + direction]
    if (target) void reorder(peers, dropOrder(board.tasks, task, target))
  }
  const collision: CollisionDetection = args => {
    const hits = pointerWithin(args)
    // Nested card targets win over their enclosing column, but only within its
    // visible scroll area (offscreen card rectangles can extend behind headers).
    const cardHits = hits.filter(hit => {
      if (statuses.includes(hit.id as Status)) return false
      const node = args.droppableContainers.find(item => item.id === hit.id)?.node.current
      const rect = node?.closest('.column-scroll')?.getBoundingClientRect()
      const point = args.pointerCoordinates
      return rect && point && point.y >= rect.top && point.y <= rect.bottom
    })
    return cardHits.length ? cardHits : hits.filter(hit => statuses.includes(hit.id as Status))
  }
  function dragEnd(event: DragEndEvent) {
    const currentDrag = drag
    setDrag(null)
    if (!board.isAdmin || board.busy || !event.over || !currentDrag) return
    const { task, snapshot } = currentDrag
    const target = snapshot.find(item => item.id === event.over!.id)
    const status = target?.status ?? event.over.id as Status
    if (!statuses.includes(status)) return
    if (status !== task.status) { void move(task, status); return }
    void reorder(peersFor(snapshot, task), dropOrder(snapshot, task, target))
  }
  return <div className="app-shell">
    <header className="site-header"><div className="header-inner"><a className="brand" href="./" aria-label="工作记录首页"><span className="brand-icon"><NotebookPen size={21} /></span><span>工作记录<span className="brand-caption">WORK JOURNAL</span></span></a>
      <div className="header-actions">{board.isAdmin && <span className="admin-badge">管理模式</span>}{board.session ? <button className="button secondary" onClick={() => void board.logout()} disabled={board.busy}><LogOut size={15} />退出登录</button> : <button className="button secondary" onClick={() => setLoginOpen(true)} disabled={!supabase}><LockKeyhole size={15} />管理员登录</button>}</div>
    </div></header>
    <main>
      {previewMode && <div className="preview-note">页面预览 · 以下为示例记录，尚未连接在线数据。</div>}
      {!supabase && !previewMode && <div role="alert" className="error-banner">看板尚未连接在线数据，请网站管理员完成配置后重新发布。</div>}
      {board.loadError && <div role="alert" className="error-banner">{board.loadError}<button onClick={() => void board.refresh()} className="text-button">重试</button></div>}
      {actionError && <div role="alert" className="error-banner">{actionError}<button onClick={() => setActionError('')} className="text-button">关闭</button></div>}
      <div className="board-toolbar"><div className="board-title"><LayoutDashboard size={18} /><h1>工作看板</h1><span>{board.tasks.length} 项工作</span></div><span className="ordering-hint">高优先级在前{board.isAdmin ? ' · 同级可拖动排序' : ''}</span><div className="toolbar-actions">
        {supabase && <button className="icon-button refresh-button" onClick={() => void board.refresh()} disabled={board.busy || board.loading} aria-label="刷新看板"><RefreshCw size={16} /></button>}
        {board.isAdmin ? <button className="button primary" onClick={() => setEditor({ status: 'planned' })} disabled={board.busy}><Plus size={16} />新增工作</button> : <span className="toolbar-note">计划清晰，进展可见</span>}
      </div></div>
      <nav className="mobile-tabs" aria-label="工作状态">{statuses.map(status => <button key={status} aria-pressed={mobileStatus === status} className={mobileStatus === status ? 'selected' : ''} onClick={() => setMobileStatus(status)}>{statusLabels[status]}<span>{board.tasks.filter(task => task.status === status).length}</span></button>)}</nav>
      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={({ active }) => { const task = board.tasks.find(item => item.id === active.id); if (task) setDrag({ task, snapshot: board.tasks }) }} onDragCancel={() => setDrag(null)} onDragEnd={dragEnd} accessibility={{ screenReaderInstructions: { draggable: '拖动可调整同优先级顺序或移到另一列。键盘用户可使用同级上移、同级下移按钮和修改状态菜单。' }, announcements: { onDragStart: () => '已开始拖动工作', onDragOver: ({ over }) => over ? `目标：${statusLabels[over.id as Status] || board.tasks.find(task => task.id === over.id)?.title || '工作看板'}，优先级保持不变` : '请移动到目标状态列', onDragEnd: () => '拖动结束，等待保存结果', onDragCancel: () => '已取消拖动' } }}><div className="board" aria-busy={board.loading || board.busy}>
        {statuses.map((status, index) => {
          const items = board.tasks.filter(task => task.status === status)
          return <Column key={status} status={status} index={index} count={items.length} isAdmin={board.isAdmin} busy={board.busy} selected={mobileStatus === status} onAdd={() => setEditor({ status })}>
            {board.loading ? <div className="loading-cards" role="status" aria-label="正在加载工作记录"><div /><div /></div> : items.length ? items.map(task => {
              const peers = peersFor(items, task), position = peers.findIndex(item => item.id === task.id)
              return <Card key={task.id} task={task} isAdmin={board.isAdmin} busy={board.busy} canMoveUp={position > 0} canMoveDown={position < peers.length - 1} onReorder={direction => shift(task, direction)} onEdit={() => setEditor({ original: task, status: task.status })} onDelete={() => setDeleting(task)} onMove={status => void move(task, status)} />
            }) : <div className="empty-state"><span className="empty-lines" aria-hidden="true"><i /><i /><i /></span><p>{board.loadError || !supabase ? '暂无可显示的记录' : ['还没有计划开展的工作', '还没有正在进行的工作', '完成的工作会留在这里'][index]}</p></div>}
          </Column>
        })}
      </div><DragOverlay dropAnimation={null}>{drag && <div className="drag-preview"><span className={`priority priority-${drag.task.priority}`}>{priorityLabels[drag.task.priority]}</span><strong>{drag.task.title}</strong><span>同级排序 · 跨列移动</span></div>}</DragOverlay></DndContext>
      <footer className="page-footer"><span role="status">{board.busy ? '正在保存…' : board.lastSync ? `最近同步 ${board.lastSync.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '保持专注，让每一项工作都有着落。'}</span><span>WORK JOURNAL <span className="footer-slash">/</span> 工作记录</span></footer>
    </main>
    <div className={`toast ${board.notice ? 'visible' : ''}`} role="status" aria-live="polite">{board.notice}</div>
    {editor && <Editor original={editor.original} initialStatus={editor.status} onClose={() => setEditor(null)} onSave={board.save} busy={board.busy} isAdmin={board.isAdmin} onReauthenticate={() => setLoginOpen(true)} />}
    {deleting && <DeleteDialog task={deleting} onClose={() => setDeleting(null)} onDelete={board.remove} busy={board.busy} isAdmin={board.isAdmin} />}
    {loginOpen && <Login onClose={() => setLoginOpen(false)} onLogin={board.login} />}
  </div>
}

