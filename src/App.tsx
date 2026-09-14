import { useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ArrowUpRight, LayoutDashboard, LockKeyhole, LogOut, NotebookPen, Plus, RefreshCw } from 'lucide-react'
import { previewMode, supabase } from './api'
import { Card, Column, DeleteDialog, Editor, Login } from './components'
import { statuses, statusLabels, type Status, type Task } from './model'
import { useBoard } from './useBoard'
import { usePageTools } from './usePageTools'

export default function App() {
  const board = useBoard()
  const [mobileStatus, setMobileStatus] = useState<Status>('active')
  const [loginOpen, setLoginOpen] = useState(false)
  const [editor, setEditor] = useState<{ original?: Task; status: Status } | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [actionError, setActionError] = useState('')
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
  function dragEnd(event: DragEndEvent) {
    if (!board.isAdmin || !event.over || !statuses.includes(event.over.id as Status)) return
    const task = board.tasks.find(item => item.id === event.active.id)
    if (task) void move(task, event.over.id as Status)
  }
  return <div className="app-shell">
    <header className="site-header"><div className="header-inner"><a className="brand" href="./" aria-label="工作记录首页"><span className="brand-icon"><NotebookPen size={21} /></span><span>工作记录<span className="brand-caption">WORK JOURNAL</span></span></a>
      <div className="header-actions">{board.isAdmin && <span className="admin-badge">管理模式</span>}{board.session ? <button className="button secondary" onClick={() => void board.logout()} disabled={board.busy}><LogOut size={15} />退出登录</button> : <button className="button secondary" onClick={() => setLoginOpen(true)} disabled={!supabase}><LockKeyhole size={15} />管理员登录</button>}</div>
    </div></header>
    <main><section className="page-heading"><div><div className="eyebrow">MY WORKSPACE</div><h1>把工作，一步步推进<span className="title-period">。</span></h1><p>从计划到完成，记录每一步进展。</p></div><div className="public-label"><ArrowUpRight size={15} />公开看板</div></section>
      {previewMode && <div className="preview-note">页面预览 · 以下为示例记录，尚未连接在线数据。</div>}
      {!supabase && !previewMode && <div role="alert" className="error-banner">看板尚未连接在线数据，请网站管理员完成配置后重新发布。</div>}
      {board.loadError && <div role="alert" className="error-banner">{board.loadError}<button onClick={() => void board.refresh()} className="text-button">重试</button></div>}
      {actionError && <div role="alert" className="error-banner">{actionError}<button onClick={() => setActionError('')} className="text-button">关闭</button></div>}
      <div className="board-toolbar"><div className="board-title"><LayoutDashboard size={18} /><h2>工作看板</h2><span>{board.tasks.length} 项工作</span></div><div className="toolbar-actions">
        {supabase && <button className="icon-button refresh-button" onClick={() => void board.refresh()} disabled={board.busy || board.loading} aria-label="刷新看板"><RefreshCw size={16} /></button>}
        {board.isAdmin ? <button className="button primary" onClick={() => setEditor({ status: 'planned' })} disabled={board.busy}><Plus size={16} />新增工作</button> : <span className="toolbar-note">计划清晰，进展可见</span>}
      </div></div>
      <nav className="mobile-tabs" aria-label="工作状态">{statuses.map(status => <button key={status} aria-pressed={mobileStatus === status} className={mobileStatus === status ? 'selected' : ''} onClick={() => setMobileStatus(status)}>{statusLabels[status]}<span>{board.tasks.filter(task => task.status === status).length}</span></button>)}</nav>
      <DndContext sensors={sensors} onDragEnd={dragEnd} accessibility={{ screenReaderInstructions: { draggable: '使用卡片上的修改状态菜单切换工作状态。鼠标也可以拖动此按钮，将工作移到另一列。' }, announcements: { onDragStart: () => '已开始拖动工作', onDragOver: ({ over }) => over ? `目标：${statusLabels[over.id as Status] || '工作看板'}` : '请移动到目标状态列', onDragEnd: () => '拖动结束，等待保存结果', onDragCancel: () => '已取消拖动' } }}><div className="board" aria-busy={board.loading || board.busy}>
        {statuses.map((status, index) => {
          const items = board.tasks.filter(task => task.status === status)
          return <Column key={status} status={status} index={index} count={items.length} isAdmin={board.isAdmin} busy={board.busy} selected={mobileStatus === status} onAdd={() => setEditor({ status })}>
            {board.loading ? <div className="loading-cards" role="status" aria-label="正在加载工作记录"><div /><div /></div> : items.length ? items.map(task => <Card key={task.id} task={task} isAdmin={board.isAdmin} busy={board.busy} onEdit={() => setEditor({ original: task, status: task.status })} onDelete={() => setDeleting(task)} onMove={status => void move(task, status)} />) : <div className="empty-state"><span className="empty-lines" aria-hidden="true"><i /><i /><i /></span><p>{board.loadError || !supabase ? '暂无可显示的记录' : ['还没有计划开展的工作', '还没有正在进行的工作', '完成的工作会留在这里'][index]}</p></div>}
          </Column>
        })}
      </div></DndContext>
      <footer className="page-footer"><span>{board.lastSync ? `最近同步 ${board.lastSync.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '保持专注，让每一项工作都有着落。'}</span><span>WORK JOURNAL <span className="footer-slash">/</span> 工作记录</span></footer>
    </main>
    <div className={`toast ${board.notice ? 'visible' : ''}`} role="status" aria-live="polite">{board.notice}</div>
    {editor && <Editor original={editor.original} initialStatus={editor.status} onClose={() => setEditor(null)} onSave={board.save} busy={board.busy} isAdmin={board.isAdmin} onReauthenticate={() => setLoginOpen(true)} />}
    {deleting && <DeleteDialog task={deleting} onClose={() => setDeleting(null)} onDelete={board.remove} busy={board.busy} isAdmin={board.isAdmin} />}
    {loginOpen && <Login onClose={() => setLoginOpen(false)} onLogin={board.login} />}
  </div>
}

