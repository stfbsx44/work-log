import { test, expect, type Page } from '@playwright/test'
import { demoTasks } from '../src/demo'
import type { Task } from '../src/model'

async function backend(page: Page, options: { admin?: boolean; empty?: boolean; tasks?: Task[] } = {}) {
  let tasks: Task[] = options.empty ? [] : structuredClone(options.tasks ?? demoTasks)
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
    if (url.pathname === '/rest/v1/rpc/reorder_work_items') {
      if (failWrite) return route.abort('failed')
      if (revoked || options.admin === false || request.headers().authorization !== `Bearer ${token}`) return json({ code: '42501' }, 403)
      const { p_status, p_priority, p_expected, p_ids } = request.postDataJSON()
      const peers = tasks.filter(task => task.status === p_status && task.priority === p_priority)
      if (peers.length !== p_expected.length || peers.some(task => !p_expected.some((item: Task) => item.id === task.id && item.updated_at === task.updated_at))) return json({ code: '40001' }, 409)
      const stamp = new Date(Date.now() + ++sequence * 1000).toISOString()
      for (const task of peers) Object.assign(task, { sort_order: p_ids.indexOf(task.id) + 1, updated_at: stamp })
      return json(peers)
    }
    if (url.pathname === '/rest/v1/work_items') {
      if (method === 'GET') return failRead ? json({ message: 'offline' }, 503) : json(tasks)
      if (failWrite) return route.abort('failed')
      if (revoked || options.admin === false || request.headers().authorization !== `Bearer ${token}`) return json({ code: '42501', message: 'denied' }, 403)
      const stamp = new Date(Date.now() + ++sequence * 1000).toISOString()
      if (method === 'POST') {
        const input = request.postDataJSON()
        const sort_order = Math.min(1, ...tasks.filter(task => task.status === input.status && task.priority === input.priority).map(task => task.sort_order)) - 1
        const task = { ...input, sort_order, id: `new-${sequence}`, created_at: stamp, updated_at: stamp }
        tasks.push(task); return json([task], 201)
      }
      const id = url.searchParams.get('id')?.slice(3), updated = url.searchParams.get('updated_at')?.slice(3)
      const original = tasks.find(task => task.id === id && task.updated_at === updated)
      if (!original) return json([])
      if (method === 'PATCH') {
        const input = request.postDataJSON()
        if (input.status !== original.status || input.priority !== original.priority) original.sort_order = Math.min(1, ...tasks.filter(task => task.status === input.status && task.priority === input.priority).map(task => task.sort_order)) - 1
        Object.assign(original, input, { updated_at: stamp }); return json([original])
      }
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

const orderedFixtures: Task[] = [
  { ...demoTasks[0], id: 'a', title: '高优先级一', sort_order: 1 },
  { ...demoTasks[0], id: 'b', title: '高优先级二', sort_order: 2 },
  { ...demoTasks[0], id: 'c', title: '高优先级三', sort_order: 3 },
  { ...demoTasks[1], id: 'd', title: '普通工作', sort_order: -20 },
  { ...demoTasks[1], id: 'e', title: '低优先级工作', priority: 'low', sort_order: -30 },
]
const plannedTitles = (page: Page) => page.getByRole('region', { name: '计划开展', exact: true }).locator('h4')
async function dragTo(page: Page, title: string, targetTitle: string) {
  const handle = page.getByRole('button', { name: '拖动 ' + title, exact: true })
  const target = page.getByRole('article', { name: targetTitle, exact: true })
  await target.scrollIntoViewIfNeeded()
  const a = await handle.boundingBox(), b = await target.boundingBox()
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2)
  await page.mouse.down()
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 20 })
  await page.mouse.up()
}

test('same-priority buttons persist order, respect priority boundaries and work with keyboard', async ({ page }) => {
  await backend(page, { tasks: orderedFixtures }); await page.goto('/'); await login(page)
  await expect(plannedTitles(page)).toHaveText(['高优先级一','高优先级二','高优先级三','普通工作','低优先级工作'])
  await expect(page.getByRole('button', { name: '同级上移 高优先级一', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '同级下移 普通工作', exact: true })).toBeDisabled()
  const up = page.getByRole('button', { name: '同级上移 高优先级二', exact: true })
  await up.focus(); await page.keyboard.press('Enter')
  await expect(plannedTitles(page)).toHaveText(['高优先级二','高优先级一','高优先级三','普通工作','低优先级工作'])
  await expect(page.getByText('同级顺序已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(plannedTitles(page)).toHaveText(['高优先级二','高优先级一','高优先级三','普通工作','低优先级工作'])
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: /^同级/ })).toHaveCount(0)
  await expect(plannedTitles(page)).toHaveText(['高优先级二','高优先级一','高优先级三','普通工作','低优先级工作'])
})

test('drag reorders peers, clamps other priority targets, and can drop onto a card in another column', async ({ page }) => {
  const state = await backend(page, { tasks: [...orderedFixtures, { ...demoTasks[2], title: '目标进行中' }] })
  await page.goto('/'); await login(page)
  await dragTo(page, '高优先级一', '高优先级三')
  await expect(plannedTitles(page)).toHaveText(['高优先级二','高优先级三','高优先级一','普通工作','低优先级工作'])
  await expect(page.getByRole('button', { name: '拖动 高优先级二', exact: true })).toBeEnabled()
  await dragTo(page, '高优先级二', '低优先级工作')
  await expect(plannedTitles(page)).toHaveText(['高优先级三','高优先级一','高优先级二','普通工作','低优先级工作'])
  expect(state.tasks().find(task => task.id === 'b')?.priority).toBe('high')
  await expect(page.getByRole('button', { name: '拖动 高优先级二', exact: true })).toBeEnabled()
  await dragTo(page, '高优先级二', '目标进行中')
  await expect(page.getByRole('region', { name: '正在进行', exact: true }).locator('h4')).toHaveText(['高优先级二','目标进行中'])
})

test('failed and stale reorder never display a successful new order', async ({ page }) => {
  const state = await backend(page, { tasks: orderedFixtures }); await page.goto('/'); await login(page)
  state.remoteUpdate()
  await page.getByRole('button', { name: '同级下移 高优先级一', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('同级顺序已被更新')
  await expect(plannedTitles(page)).toHaveText(['另一台设备更新的记录','高优先级二','高优先级三','普通工作','低优先级工作'])
  state.failWrites()
  await page.getByRole('button', { name: '同级下移 高优先级二', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('操作未成功')
  await expect(plannedTitles(page)).toHaveText(['另一台设备更新的记录','高优先级二','高优先级三','普通工作','低优先级工作'])
  await expect(page.getByText('同级顺序已保存', { exact: true })).toHaveCount(0)
})

test('new and reprioritized tasks enter peer front while text edits stay in place', async ({ page }) => {
  await backend(page, { tasks: orderedFixtures }); await page.goto('/'); await login(page)
  await page.getByRole('button', { name: '编辑 高优先级二', exact: true }).click()
  await page.getByLabel('详细说明').fill('修改说明不会改变位置')
  await page.getByRole('button', { name: '保存工作', exact: true }).click()
  await expect(plannedTitles(page)).toHaveText(['高优先级一','高优先级二','高优先级三','普通工作','低优先级工作'])
  await page.getByRole('button', { name: '新增工作', exact: true }).click()
  await page.getByLabel('工作标题').fill('新增高优先级')
  await page.getByRole('combobox', { name: '优先级', exact: true }).selectOption('high')
  await page.getByRole('button', { name: '保存工作', exact: true }).click()
  await expect(plannedTitles(page).first()).toHaveText('新增高优先级')
  await page.getByRole('button', { name: '编辑 普通工作', exact: true }).click()
  await page.getByRole('combobox', { name: '优先级', exact: true }).selectOption('high')
  await page.getByRole('button', { name: '保存工作', exact: true }).click()
  await expect(plannedTitles(page).first()).toHaveText('普通工作')
})

test('desktop columns scroll independently with fixed headings and unabridged long descriptions', async ({ page }, info) => {
  const longText = Array.from({ length: 25 }, (_, i) => '工作详细说明第' + (i + 1) + '行').join('\n')
  await page.setViewportSize({ width: 1440, height: 900 })
  await backend(page, { tasks: [...orderedFixtures, { ...demoTasks[2], description: longText }] }); await page.goto('/'); await login(page)
  const board = await page.locator('.board').boundingBox()
  expect(board!.y).toBeLessThan(145)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
  const planned = page.getByRole('region', { name: '计划开展', exact: true })
  const active = page.getByRole('region', { name: '正在进行', exact: true })
  await expect(active.locator('.card-description')).toHaveText(longText)
  const before = await planned.getByRole('heading', { name: '计划开展', exact: true }).boundingBox()
  await planned.locator('.column-scroll').evaluate(el => { el.scrollTop = 300 })
  expect(await planned.locator('.column-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  expect(await active.locator('.column-scroll').evaluate(el => el.scrollTop)).toBe(0)
  expect((await planned.getByRole('heading', { name: '计划开展', exact: true }).boundingBox())!.y).toBe(before!.y)
  await planned.locator('.column-scroll').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: info.outputPath('compact-desktop.png'), fullPage: true })
})

test('mobile can reorder with buttons, shows full text and uses page scrolling', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await backend(page, { tasks: orderedFixtures }); await page.goto('/'); await login(page)
  await page.getByRole('button', { name: '计划开展5', exact: true }).click()
  await page.getByRole('button', { name: '同级上移 高优先级二', exact: true }).click()
  await expect(plannedTitles(page).first()).toHaveText('高优先级二')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.mobile-selected .column-scroll').evaluate(el => getComputedStyle(el).overflowY)).toBe('visible')
  await page.screenshot({ path: info.outputPath('compact-mobile.png'), fullPage: true })
})
