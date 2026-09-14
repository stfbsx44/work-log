// Read-only preflight. It never creates users, records, or database objects.
import { isProjectUrl, isPublicKey } from '../src/publicConfig.ts'

const url = process.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

async function read(path) {
  const response = await fetch(`${url}/${path}`, {
    headers: { apikey: key }, signal: AbortSignal.timeout(20000),
  })
  const result = await response.json()
  if (!response.ok) {
    if (result.code === 'PGRST205') throw new Error('尚未初始化数据库：请在 Supabase SQL Editor 执行 supabase/migrations/001_work_log.sql。')
    throw new Error(`Supabase 检查失败 (${response.status})：${result.code || '请核对项目地址、公开密钥和数据库设置。'}`)
  }
  return result
}

try {
  if (!isProjectUrl(url) || !isPublicKey(key)) throw new Error('请配置正确的项目根地址和 Publishable/anon key；不要使用高权限密钥。')
  await read('rest/v1/work_items?select=id,title,description,status,priority,due_date,created_at,updated_at&limit=0')
  const auth = await read('auth/v1/settings')
  if (!auth.disable_signup) throw new Error('请先在 Authentication 设置中关闭 Allow new users to sign up。')
  if (!auth.external?.email || auth.external?.anonymous_users) throw new Error('请启用邮箱登录并关闭匿名登录。')
  console.log('在线表结构与登录设置检查通过。管理员身份和写权限还需单独进行真实账号验收。')
} catch (error) {
  console.error(error instanceof Error ? error.message : '在线配置检查失败。')
  process.exitCode = 1
}
