# 工作记录 · Work Journal

React + TypeScript + Vite 个人工作看板，发布至 GitHub Pages，使用 Supabase Auth 与 Postgres 在线保存数据。公开浏览，只有指定管理员可编辑。

## 本地运行

需要 Node.js 24 和 npm。

```sh
npm ci
npm run dev
```

没有在线配置时，开发服务器显示带有明确提示的只读示例；正式构建不会使用示例数据，也不会伪装保存成功。复制 `.env.example` 为 `.env.local` 后填写公开配置，重启开发服务器：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
VITE_BASE_PATH=/
```

只使用 Publishable key，或旧版 `anon` key。**绝不填 Secret key、service_role key 或管理员密码。** 前端构建中的环境变量均可被访客读取。

## 配置 Supabase

1. 在 Supabase 控制台创建独立项目。数据库密码自行设置，不写入本仓库。
2. 在 SQL Editor 执行 `supabase/migrations/001_work_log.sql`，建立空的工作记录表和权限规则。
3. 在 Authentication → Sign In / Providers 的用户注册设置中关闭 **Allow new users to sign up**，关闭匿名登录；保留 Email 登录。不同控制台版本的菜单位置可能稍有变化。
4. 在 Authentication → Users → Add user → Create new user 创建你的管理员，填写邮箱和密码并确认邮箱。记录该用户 UUID；密码由你直接设置。
5. 在 SQL Editor 执行下面的语句，将示例 UUID 替换为管理员 UUID：

```sql
insert into private.site_admin (singleton, user_id)
values (true, 'YOUR_ADMIN_USER_UUID'::uuid)
on conflict (singleton) do update set user_id = excluded.user_id;
```

6. 在 Authentication → URL Configuration 中将 Site URL 设为 `https://stfbsx44.github.io/work-log/`。本版邮箱密码登录不依赖第三方 OAuth 回调。
7. 从项目的 Connect 或 API Keys 页面取得 Project URL 和 Publishable key，用于本地环境和 GitHub 仓库变量。
8. 打开网页，点击“管理员登录”。只有上面配置的 UUID 通过服务器端身份和权限检查后才会显示管理操作。

本版不提供网页注册或密码找回。需要更改密码时，由项目所有者在 Supabase 的用户管理流程中恢复账号；也可以创建替代账号，并通过上面的 SQL 更新唯一管理员 UUID，旧账号立即失去数据库写权限。

支持页面工具接口的浏览器中，还可读取当前看板或为已登录管理员打开新增表单；打开表单不会自动保存。此接口为渐进增强，不支持它的浏览器使用完整的普通界面。工具流程已通过模拟接口验证，原生浏览器 WebMCP 支持需要在相应环境另行验证。

### 权限设计

- `public.work_items`：允许 anon、authenticated 读取；只有 `private.site_admin` 指定的 `auth.uid()` 可新增、修改、删除。
- 私有管理员表不暴露到网页；浏览器不能指定或修改管理员身份。
- `public.is_admin()` 只向已登录用户返回当前身份是否有权限，不接受用户编号参数。
- 权限同时由数据库授权与 RLS 检查。仅隐藏按钮不是权限措施。
- 时间戳由数据库维护，修改和删除检查原 `updated_at`，避免两台设备的旧内容静默覆盖新记录。
- 记录公开，说明以纯文本渲染。所有工作内容都应该是愿意公开展示的内容。

## 发布 GitHub Pages

1. 在自己的账号下新建公开仓库 `work-log`，将本项目推送到 `main`。首次发布前先完成上面的数据库权限与账号配置。
2. 此仓库的发布流程已经填写你的 Project URL 和 Publishable key，这两项是可公开的网页配置。无需再次填写。如果以后更换项目，可在 Repository Settings → Secrets and variables → Actions → Variables 中覆盖：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
4. Actions 中运行 **Deploy work journal**，或推送 `main` 触发部署。流程先通过只读请求检查真实数据库表和登录设置；没有执行初始化 SQL 或尚未关闭注册时，会明确报错并停止发布。
5. 发布地址：`https://stfbsx44.github.io/work-log/`。工作流根据仓库名设置资源子路径，不使用需要服务器回退的页面路由。

代码修改会重新构建网页；日常工作记录修改直接保存至 Supabase，不提交到 GitHub，不触发网站构建。免费服务的配额和暂停策略以各平台当前设置为准，本项目不自动开通付费服务。

## 验证

```sh
npm test
npm run build
npm run check:backend
npx playwright install chromium
npm run test:e2e
```

浏览器自动化使用隔离的模拟 Supabase 接口，覆盖页面流程和错误处理。单元测试还使用 PGlite 的真实 PostgreSQL 引擎运行迁移和 RLS 权限脚本，但使用简化的身份上下文；这些测试**不能证明线上 Supabase 已正确配置**。连接真实项目后，还必须执行数据库权限验证和双设备验收。

`supabase/tests/permissions.sql` 在事务中创建测试身份和记录，分别以匿名、非管理员和管理员身份验证读取与写入，并在结尾回滚。先在专用测试项目运行；首次上线时可在尚无正式数据的目标项目运行。失败时停止上线并检查权限规则。

真实环境验收：退出登录仍可浏览；非管理员不可写；管理员能新增、编辑、删除并完成全部六种状态转换；网络失败保留输入；两设备在打开、回到前台或 30 秒检查后同步；登录失效或撤销管理员后写入被拒绝。不要把模拟测试结果当作真实环境验证结果。

## 第一版边界

不含多人协作、附件、逐日工作日志、统计图表、消息提醒、自定义域名或离线编辑。截止日期按日期显示，无时区换日；各列按最近更新时间倒序排列，拖拽只改变状态。
