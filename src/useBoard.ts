import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { friendlyError, listTasks, previewMode, removeTask, saveTask, supabase } from './api'
import { demoTasks } from './demo'
import { sortTasks, type Task, type TaskInput } from './model'

export function useBoard() {
  const [tasks, setTasks] = useState<Task[]>(previewMode ? demoTasks : [])
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setAdmin] = useState(false)
  const [loading, setLoading] = useState(!!supabase)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const busyRef = useRef(false)
  const request = useRef(0)
  const authRequest = useRef(0)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    if (!supabase || busyRef.current) return
    const ticket = ++request.current
    try {
      const result = await listTasks()
      if (mounted.current && request.current === ticket) {
        setTasks(sortTasks(result)); setLoadError(''); setLastSync(new Date())
      }
    } catch {
      if (mounted.current && request.current === ticket) setLoadError('暂时无法更新看板，请检查网络后重试。已显示的内容可能不是最新版本。')
    } finally {
      if (mounted.current && request.current === ticket) setLoading(false)
    }
  }, [])

  const verifyAdmin = useCallback(async () => {
    const ticket = ++authRequest.current
    if (!supabase || !sessionRef.current) { setAdmin(false); return false }
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) throw userError
      const { data, error } = await supabase.rpc('is_admin')
      const allowed = !error && data === true
      if (mounted.current && ticket === authRequest.current) setAdmin(allowed)
      return allowed
    } catch {
      if (mounted.current && ticket === authRequest.current) setAdmin(false)
      return false
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    if (!supabase) return () => { mounted.current = false }
    // Auth callbacks must not await other Supabase calls (auth lock).
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      sessionRef.current = next; setSession(next); setAdmin(false); ++authRequest.current
    })
    return () => {
      mounted.current = false; ++request.current; ++authRequest.current
      subscription.subscription.unsubscribe()
    }
  }, [refresh])
  useEffect(() => { void verifyAdmin() }, [session, verifyAdmin])
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') { void refresh(); void verifyAdmin() }
    }
    const timer = window.setInterval(sync, 30000)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(timer); window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [refresh, verifyAdmin])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function mutate(action: () => Promise<void>, message: string) {
    if (busyRef.current) throw new Error('操作正在保存，请稍候。')
    if (!isAdmin) throw new Error('当前没有管理权限，请重新登录。')
    busyRef.current = true; setBusy(true); ++request.current
    try {
      await action(); setNotice(message); setLastSync(new Date()); setLoadError('')
    } catch (error) {
      void verifyAdmin(); throw new Error(friendlyError(error))
    } finally {
      busyRef.current = false; setBusy(false); setLoading(false); void refresh()
    }
  }
  async function save(input: TaskInput, original?: Task) {
    await mutate(async () => {
      const saved = await saveTask(input, original)
      setTasks(current => sortTasks([...current.filter(task => task.id !== saved.id), saved]))
    }, original ? '工作记录已更新' : '工作记录已添加')
  }
  async function remove(task: Task) {
    await mutate(async () => {
      await removeTask(task); setTasks(current => current.filter(item => item.id !== task.id))
    }, '工作记录已删除')
  }
  async function login(email: string, password: string) {
    if (!supabase) throw new Error('在线登录尚未配置。')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(error.status === 400 ? '邮箱或密码不正确，请重新输入。' : '暂时无法登录，请检查网络后重试。')
    const { data, error: roleError } = await supabase.rpc('is_admin')
    if (roleError || data !== true) {
      await supabase.auth.signOut({ scope: 'local' })
      throw new Error(roleError ? '暂时无法验证管理权限，请稍后重试。' : '这个账号没有管理权限，请使用指定的管理员账号。')
    }
    await verifyAdmin(); setNotice('已进入管理模式')
  }
  async function logout() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) { setNotice('退出未成功，请检查网络后重试。'); return }
    setAdmin(false); setNotice('已退出管理模式')
  }
  return { tasks, session, isAdmin, loading, busy, loadError, notice, lastSync, refresh, save, remove, login, logout }
}
