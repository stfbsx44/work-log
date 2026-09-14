import { test, expect, type Page } from '@playwright/test'
import { demoTasks } from '../src/demo'
import type { Task } from '../src/model'

async function backend(page: Page, options: { admin?: boolean; empty?: boolean } = {}) {
  let tasks: Task[] = options.empty ? [] : structuredClone(demoTasks)
  let failWrite = false, failRead = false, revoked = false
  let sequence = 0
  const user = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'admin@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`
  await page.route('https://work-log-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } })
    if (url.pathname === '/auth/v1/token') {
      if (request.postDataJSON()?.password !== 'test-password') return json({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400)
      return json({ access_token: token, refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, user })
    }
    if (url.pathname === '/auth/v1/user') return revoked ? json({ msg: 'expired' }, 401) : json(user)
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
    if (url.pathname === '/rest/v1/rpc/is_admin') return json(options.admin !== false && !revoked)
    if (url.pathname === '/rest/v1/work_items') {
      if (method === 'GET') return failRead ? json({ message: 'offline' }, 503) : json(tasks)
      if (failWrite) return route.abort('failed')
      if (revoked || options.admin === false || request.headers().authorization !== `Bearer ${token}`) return json({ code: '42501', message: 'denied' }, 403)
      const stamp = new Date(Date.now() + ++sequence * 1000).toISOString()
      if (method === 'POST') {
        const task = { ...request.postDataJSON(), id: `new-${sequence}`, created_at: stamp, updated_at: stamp }
        tasks.push(task); return json([task], 201)
      }
      const id = url.searchParams.get('id')?.slice(3), updated = url.searchParams.get('updated_at')?.slice(3)
      const original = tasks.find(task => task.id === id && task.updated_at === updated)
      if (!original) return json([])
      if (method === 'PATCH') { Object.assign(original, request.postDataJSON(), { updated_at: stamp }); return json([original]) }
      if (method === 'DELETE') { tasks = tasks.filter(task => task.id !== id); return json([{ id }]) }
    }
    return json({ message: `Unmocked request: ${method} ${url.pathname}` }, 500)
  })
  return { failWrites: () => { failWrite = true }, failReads: () => { failRead = true }, revoke: () => { revoked = true }, restore: () => { revoked = false }, tasks: () => tasks,
    remoteUpdate: () => { tasks[0].title = '另一台设备更新的记录'; tasks[0].updated_at = new Date().toISOString() } }
}
async function login(page: Page) {
  await page.getByRole('button', { name: '管理员登录', exact: true }).click()
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '新增工作', exact: true })).toBeVisible()
}

test('public board loads without sign-in and has no editing controls', async ({ page }, info) => {
  await backend(page); await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(5)
  await expect(page.getByRole('button', { name: '新增工作', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^拖动 / })).toHaveCount(0)
  await expect(page.getByText('页面预览', { exact: false })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true })
})

test('administrator can create, edit, move in all directions, reload, delete and log out', async ({ page }, info) => {
  await backend(page, { empty: true }); await page.goto('/'); await login(page)
  await page.getByRole('button', { name: '新增工作', exact: true }).click()
  await page.getByLabel('工作标题').fill('验收工作')
  await page.getByLabel('详细说明').fill('这是一项测试工作\n第二行说明')
  await page.getByRole('button', { name: '保存工作', exact: true }).click()
  await expect(page.getByRole('article', { name: '验收工作', exact: true })).toBeVisible()
  // planned→active→completed→planned→completed→active→planned = all 6 edges.
  for (const status of ['active', 'completed', 'planned', 'completed', 'active', 'planned']) {
    await page.getByRole('combobox', { name: '修改状态：验收工作' }).selectOption(status)
    await expect(page.getByRole('combobox', { name: '修改状态：验收工作' })).toHaveValue(status)
    await expect(page.getByRole('combobox', { name: '修改状态：验收工作' })).toBeEnabled()
  }
  await page.getByRole('button', { name: '编辑 验收工作', exact: true }).click()
  await page.getByLabel('工作标题').fill('修改后的工作')
  await page.getByRole('button', { name: '保存工作', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('article', { name: '修改后的工作', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '新增工作', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('administrator.png'), fullPage: true })
  await page.getByRole('button', { name: '删除 修改后的工作', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('button', { name: '删除 修改后的工作', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '管理员登录', exact: true })).toBeVisible()
})

test('dragging changes status only after server confirmation', async ({ page }) => {
  const state = await backend(page); await page.goto('/'); await login(page)
  const title = demoTasks[0].title
  const handle = page.getByRole('button', { name: `拖动 ${title}`, exact: true })
  const source = await handle.boundingBox(), target = await page.getByRole('region', { name: '已完成', exact: true }).boundingBox()
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2)
  await page.mouse.down(); await page.mouse.move(target!.x + target!.width / 2, target!.y + 60, { steps: 15 }); await page.mouse.up()
  await expect(page.getByRole('region', { name: '已完成', exact: true }).getByRole('article', { name: title, exact: true })).toBeVisible()
  expect(state.tasks()[0].status).toBe('completed')
})

test('non-admin account cannot enter management', async ({ page }) => {
  await backend(page, { admin: false }); await page.goto('/')
  await page.getByRole('button', { name: '管理员登录', exact: true }).click()
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('reader@example.com')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('没有管理权限')
  await expect(page.getByRole('button', { name: '新增工作', exact: true })).toHaveCount(0)
})

test('failed write retains input and does not show success', async ({ page }) => {
  const state = await backend(page); await page.goto('/'); await login(page)
  await page.getByRole('button', { name: '新增工作', exact: true }).click()
  await page.getByLabel('工作标题').fill('未保存的内容')
  state.failWrites()
  await page.getByRole('button', { name: '保存工作', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('操作未成功')
  await expect(page.getByLabel('工作标题')).toHaveValue('未保存的内容')
  await expect(page.getByRole('article', { name: '未保存的内容', exact: true })).toHaveCount(0)
})

test('background refresh keeps drafts and rejects stale edits', async ({ page }) => {
  const state = await backend(page); await page.goto('/'); await login(page)
  await page.getByRole('button', { name: `编辑 ${demoTasks[0].title}`, exact: true }).click()
  await page.getByLabel('详细说明').fill('我的草稿不应被覆盖')
  state.remoteUpdate()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('article', { name: '另一台设备更新的记录', exact: true, includeHidden: true })).toBeAttached()
  await expect(page.getByLabel('详细说明')).toHaveValue('我的草稿不应被覆盖')
  await page.getByRole('button', { name: '保存工作', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('已被更新')
})

test('revoked session removes editing permission', async ({ page }) => {
  const state = await backend(page); await page.goto('/'); await login(page)
  state.revoke(); await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: '新增工作', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox')).toHaveCount(0)
})

test('mobile tabs display one column without horizontal overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await backend(page); await page.goto('/')
  await expect(page.getByRole('region', { name: '正在进行', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '计划开展', exact: true })).toBeHidden()
  await page.getByRole('button', { name: '计划开展2' }).click()
  await expect(page.getByRole('region', { name: '计划开展', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true })
})

test('invalid password shows an error without granting access', async ({ page }) => {
  await backend(page); await page.goto('/')
  await page.getByRole('button', { name: '管理员登录', exact: true }).click()
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('邮箱或密码不正确')
  await expect(page.getByRole('button', { name: '新增工作', exact: true })).toHaveCount(0)
})

test('30-second polling loads remote updates', async ({ page }) => {
  const state = await backend(page); await page.clock.install(); await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(5)
  state.remoteUpdate(); await page.clock.fastForward(30000)
  await expect(page.getByRole('article', { name: '另一台设备更新的记录', exact: true })).toBeVisible()
})

test('read failure preserves last known records and offers retry', async ({ page }) => {
  const state = await backend(page); await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(5)
  state.failReads(); await page.getByRole('button', { name: '刷新看板', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('暂时无法更新看板')
  await expect(page.getByRole('article')).toHaveCount(5)
})

test('draft survives session expiry and reauthentication', async ({ page }) => {
  const state = await backend(page); await page.goto('/'); await login(page)
  await page.getByRole('button', { name: '新增工作', exact: true }).click()
  await page.getByLabel('工作标题').fill('登录过期前的草稿')
  state.revoke(); await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: '保存工作', exact: true })).toBeDisabled()
  state.restore(); await page.getByRole('button', { name: '重新登录', exact: true }).click()
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('工作标题')).toHaveValue('登录过期前的草稿')
  await page.getByRole('button', { name: '保存工作', exact: true }).click()
  await expect(page.getByRole('article', { name: '登录过期前的草稿', exact: true })).toBeVisible()
})

test('page tools read visible data, enforce admin access and stage a form without saving', async ({ page }) => {
  await page.addInitScript(() => {
    type RegisteredTool = { execute: (input: unknown) => unknown }
    const tools = new Map<string, RegisteredTool>()
    Object.defineProperty(window, 'testPageTools', { value: tools })
    Object.defineProperty(document, 'modelContext', { value: {
      registerTool(tool: RegisteredTool & { name: string }, options: { signal: AbortSignal }) {
        tools.set(tool.name, tool)
        options.signal.addEventListener('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name) })
      },
    } })
  })
  await backend(page); await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(5)
  const run = (name: string, input: unknown) => page.evaluate(({ name, input }) => {
    const scope = window as unknown as { testPageTools: Map<string, { execute: (input: unknown) => unknown }> }
    try { return { result: scope.testPageTools.get(name)!.execute(input), error: null } }
    catch (error) { return { result: null, error: (error as Error).message } }
  }, { name, input })
  expect((await run('read_work_board', {})).result).toMatchObject({ loading: false, preview: false })
  expect((await run('start_work_record_creation', {})).error).toContain('Administrator')
  await login(page)
  expect((await run('start_work_record_creation', { status: 'invented' })).error).toContain('Invalid')
  expect((await run('start_work_record_creation', { status: 'active' })).result).toMatchObject({ opened: true, saved: false })
  await expect(page.getByLabel('当前状态')).toHaveValue('active')
  expect((await run('read_work_board', {})).result).toHaveProperty('records.length', 5)
})
