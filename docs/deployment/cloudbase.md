# CampusFlow 腾讯云部署步骤

架构为 React 静态前端、Fastify API、CloudBase Auth 与 PostgreSQL。用户已批准使用现有体验环境的共享 PG HTTPS/RPC，API 优先部署 HTTP 云函数；原生 `DATABASE_URL` 和 CloudRun 容器继续保留。当前完成情况见 [环境记录](environment-status.md)，以下步骤不能视为已全部执行。

## 1 确认账号、环境与授权

通过官方浏览器流程登录并查询环境：

```powershell
npx --yes --package @cloudbase/cli@3.8.9 tcb login
npx --yes --package @cloudbase/cli@3.8.9 tcb env list
```

国内站与国际站账号/凭证独立。确认目标环境、地域、PG 类型和授权范围，保留已有资源与数据。当前已核验环境位于上海、使用共享 PG；体验额度不是无限免费承诺。新增收费服务或升级数据库必须先明确规格和费用授权，登录不代表授权任意购买。

## 2 配置变量

本地从 `.env.example` 创建 `.env`；生产通过服务的环境设置或密钥管理注入。以下值来自真实目标环境，示例占位符不能直接上线。

| 变量 | 位置与用途 |
| --- | --- |
| `NODE_ENV=production` | API，启用生产限制 |
| `AUTH_MODE=cloudbase` | API，真实身份验证 |
| `HOST=0.0.0.0`、`PORT` | API；HTTP 函数使用 9000，现有容器使用 3001 |
| `APP_ORIGIN` | API，前端 HTTPS origin；多个来源逗号分隔，不含路径和末尾斜杠 |
| `CORS_MANAGED_BY_GATEWAY=true` | API，通过 CloudBase HTTP 网关时由网关添加 CORS 响应头；API 继续严格验证来源与预检头 |
| `CLOUDBASE_ENV_ID` | API，目标 PG/Auth 环境 |
| `TICKET_SECRET` | API，至少 32 个随机字符，持久保存并限制访问 |
| `DATABASE_MODE=cloudbase-http` | API，选择共享 PG 数据面 |
| `CLOUDBASE_DATABASE_API_KEY` | API，目标环境的服务端数据库凭证，绝不能公开 |
| `DATABASE_URL`、`DATABASE_SSL` | API，原生 PG 备选；使用时不设置共享 HTTP 模式，网络/TLS 按实际实例配置 |
| `MOCK_AI_MODE=true` | API，初次保持明确标识的模板模式 |
| `CLOUDBASE_API_KEY`、`CLOUDBASE_AI_MODEL` | API，仅在模型已获授权并验证后启用真实 AI |
| `VITE_CLOUDBASE_ENV_ID`、`VITE_CLOUDBASE_REGION` | 前端构建期公开配置，与 API 环境一致 |
| `VITE_PUBLISHABLE_KEY` | 前端公开 key，不能使用服务端数据库/AI key 或 SecretKey |
| `VITE_API_BASE_URL` | 前端，跨域时填 API HTTPS origin、不带 `/api`；同源路由可留空 |

不要同时配置两条数据库路径以掩盖错误。密钥不得写进命令参数、源码、ZIP 或浏览器产物。每次部署沿用正确保存的 `TICKET_SECRET`；更换它之前必须处理存量凭证。

## 3 应用数据库迁移

先核对目标环境与已有表，涉及已有业务数据时准备备份和恢复方案。按顺序应用：

1. `20261025000000_schema.sql`：表、索引和约束。
2. `20261025000001_rls.sql`：表权限与 RLS。
3. `20261026000000_rpc.sql`：13 个业务事务操作及服务端角色检查。
4. `20261026000001_query_catalog.sql`：固定语句目录与参数绑定。
5. `20261026000002_rpc_errors.sql`：在网关保留的 MESSAGE 中传递结构化业务错误。

共享 PG 使用授权管理工具的版本迁移流程：预览 SQL，提交迁移，再核对异步任务成功和远端历史版本。仅获得 TaskId 不能证明成功，任务未确定结束前不要重复提交同一版本。当前目标的上述五个版本已实际应用。

共享模式不使用 `npm run db:migrate`，生产 HTTP 适配器会拒绝运行时迁移。该命令保留给本地 PGlite/原生 PG 初始化。生产 API 启动跳过 DDL，结构缺失不会通过自动建表掩盖。修改已部署结构应追加前向版本，不仅修改旧 SQL。

API 映射外部 CloudBase subject 为内部 UUID，Owner/Admin/Staff/Viewer 由组织成员表决定。服务器特权查询依赖 API 鉴权；事务 RPC 对关键角色、状态和容量再次校验。每个特权函数还必须在函数体拒绝非 `service_role`，不能依赖 CloudBase RPC 的 EXECUTE grant。

服务端 key、public key、无凭证与真实用户分别验收。真实数据库复验方法见 [测试报告](../testing.md)，测试合成数据必须清理。不要让浏览器获得查询目录或任意 SQL 的特权访问。

## 4 配置并验证邮箱认证

在 CloudBase 配置邮箱验证码 provider、发件服务和前端安全域名；使用可收信的测试账号完成注册、登录、刷新与退出。不要把“provider 已启用”写成“验证码送达”。

前端使用官方 Web SDK 获取会话，并向 API 发送 Access Token。API 向固定环境 `/auth/v1/user/me` 核验身份，拒绝空数据、匿名和禁用用户。首次用户可在应用内创建组织。使用两个独立组织验证活动、名单、签到、统计和导出均不能越权。

## 5 部署 API

当前优先 HTTP 云函数，先构建只含运行必需文件的 ZIP：

```powershell
node cloudbase/deployment/prepare-http-function.mjs
```

脚本输出 ZIP 与清单，保留 Linux 启动脚本的 LF 和 Unix 执行位。通过授权部署工具将包发布为 `campusflow-api` HTTP 函数，配置 `Nodejs24.11`、`0.0.0.0:9000`、完整环境变量与 HTTPS 路由。详见 [函数说明](http-function.md)。只读检查已有路由后再绑定本应用，不能为一个 API 覆盖整个环境的认证策略。

当前函数已在 2026-10-28 发布成功。MCP COS 三元组路径曾失败，使用官方 Manager SDK 显式 `code.ZipFile` 恢复，详见 [恢复记录](runtime-recovery.md)。代码发布和秘密配置分开，后者仍经过正常 MCP 凭证核对。现有 `/api` 网关使用 `WEB_SCF`、路径透传、安全域名校验；路由自身 `auth=false`，受保护业务由 Fastify 验证用户和组织权限。

部署后读取函数真实状态，访问 `/api/health`，再验证实际业务请求。资源存在、上传完成或返回候选地址均不足以宣布成功。若失败，保留错误码与无秘密日志，修复后重新核验。

CloudRun 备选提供 Dockerfile 与 `prepare-source.mjs`。本机未提供 Docker，不能声称镜像已构建。使用云端源码构建或可验证的镜像时按 [部署前核查](deployment-readiness.md) 检查包内容、服务初始化、端口、实例范围及原生 PG 网络；不要直接上传仓库根目录。

## 6 发布前端

在构建环境设置公开认证变量和实际 API origin，再构建：

```powershell
npm run build
```

本项目首次前端发布使用 CloudBase `manageApps(action="deployApp")`，服务名固定为 `campusflow`；重新发布复用该名称以保留版本历史。先将已构建的 `apps/web/dist` 和最小 `package.json` 复制到白名单暂存目录，不要将含 `.local`、环境文件、Word 或数据库的项目根目录作为 `filePath`。

本次配置为 `framework="static"`、`buildPath="dist"`、`installCmd=""`、`buildCmd=""`，发布已有构建产物。`queryApps` 已确认 `campusflow-001` 状态 `SUCCESS`，真实浏览器已进入首页。发布接口返回地址时仍须继续检查版本状态与浏览器结果，不能只依赖受理信息。

跨域时 API 只允许精确 `APP_ORIGIN`，前端使用 `VITE_API_BASE_URL`；同源时 `/api/*` 路由到 API。通过 CloudBase 网关时启用 `CORS_MANAGED_BY_GATEWAY=true`，防止网关与 API 重复填写来源头。React Router 深层页面应回退 `index.html`，但 API 错误不能变成 HTML。当前静态托管错误文档已设置为 `index.html`，登录页可直达和刷新，但底层 HTTP 状态仍为 404，需要保留这项限制。实际业务还需验证登录查询、CSV 下载与其他深链。

## 7 AI 模式与上线验收

Word 允许在未开通模型时使用明确模板降级。保持 `MOCK_AI_MODE=true`，不要为了声明 AI 完成自动开通付费模型。具备已授权模型能力后再设置真实模型配置，验证策划和基于真实统计的复盘、超时、配额与失败降级。

上线验收至少包含：真实登录/退出；活动创建与合法状态转换；匿名报名与持久化凭证；100 人容量的并发和幂等；手机摄像头及手动签到；跨组织、Staff 范围和 Viewer 权限；CSV、问卷、统计和复盘；HTTPS、CORS、深层链接、日志脱敏与移动端布局。记录实际地址、部署版本、迁移版本、时间和结果，未通过项继续标为未完成。

回退优先恢复已验证的上一代码包/镜像与前端版本。数据库使用兼容的前向迁移；已有新数据后不可直接删表或盲目还原旧库。破坏性恢复先备份并取得相应授权，不能用清理合成测试数据的授权扩大到用户数据。
