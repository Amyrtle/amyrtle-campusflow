# CampusFlow HTTP 云函数部署

核查日期：2026-10-28。用户已同意使用共享 PostgreSQL 的 HTTP 接口，优先使用现有体验额度。本方案保留 Fastify API，将需要原子性的业务操作集中到数据库 RPC 事务；本地 PGlite 仅用于开发与测试。函数已发布为 `Active`，真实健康接口验证共享数据库可用；完整业务验收边界见 [环境记录](environment-status.md)。

## 已查到的环境状态

对 `secure-dragon-d6g1dce1lb03f43cf` 的只读查询结果：

- 上海地域，CloudBase 体验环境；当前 PostgreSQL 为共享实例。目标访问方式为服务端 HTTP/RPC，不要求 TCP 连接或 VPC。
- `tcbr.DescribeEnvBaseInfo` 返回 `IsExist: false`，云托管尚未初始化。
- `campusflow-api` 当前为 HTTP、`Nodejs24.11`、`Active`，`/api/health` 返回 200；不再沿用初次查询为空或旧 `CreateFailed` 状态。
- 体验环境此前核查的计费周期为 2026-10-25 至 2026-11-25、配额 3,000 资源点。数据库和函数验收会继续使用额度，旧 0.11 点快照不是当前余额。资源点不是长期免费承诺，也不表示数据库升级已经获准。

## 运行方式

HTTP 云函数直接运行现有标准 HTTP 服务器。使用 `Nodejs24.11`，`scf_bootstrap` 通过 `/var/lang/node24/bin/node` 启动 API，监听 `0.0.0.0:9000`。运行时版本和二进制路径已依据官方[运行环境说明](https://docs.cloudbase.net/cloud-function/runtime-support)核验，并已在目标账号实际发布、启动和连接共享 PG。

本方案通过 CloudBase HTTP 网关访问数据库、身份服务以及已配置的模型接口，不配置 VPC，也不读取本机 CLI 凭证作为运行凭证。服务端数据库 API Key 必须由目标环境单独签发并注入函数配置，不能与浏览器公开的 Publishable Key 混用。

HTTP 云函数无需初始化 CloudRun。费用仍按请求和资源使用量计算，由实际环境套餐与计费规则结算；CloudRun 则按实例启动期间的 CPU、内存等资源计量，见[云托管计费说明](https://docs.cloudbase.net/run/faq/fee)。是否需要开通付费数据库、网络资源或升级套餐，应在获知具体规格和报价后单独确认。

## 生成部署包

在仓库根目录执行：

```powershell
node cloudbase/deployment/prepare-http-function.mjs
```

脚本会重新编译 API，在 `.local/http-function` 下新建目录，并输出上传 ZIP 和文件清单。仅包含：

- `services/api/dist/server.js`，保留其目录层级，使 `projectRoot` 在云端解析为 `/var/user`。
- 独立的运行依赖清单与锁文件，版本来自仓库锁文件。
- 使用 Linux/x64 目标参数重新安装的纯 JavaScript 运行依赖，不复制本机开发 `node_modules`。安装时禁用生命周期脚本，扫描并拒绝原生二进制、WASM、符号链接和环境文件；将来增加原生依赖时必须改用 Linux 构建，不能直接放宽扫描。
- LF 换行的 `scf_bootstrap`。ZIP 使用 Unix 文件属性，启动文件权限为 `100755`。

不包含前端、Word、本地数据、PGlite、开发依赖、环境文件或迁移 SQL。迁移应在部署前由独立的授权管理步骤执行；生产 API 不负责建表。

生成的 ZIP 才是待上传对象；不要重新用会丢失 Unix 执行位的 Windows 压缩方式打包。manifest 保存在 ZIP 外，记录每个文件的 SHA-256 与权限。脚本不登录、不读取云凭证、不上传、不创建资源。

## 发布前需要实际完成

1. 在目标共享 PostgreSQL 环境完成五个版本迁移和 RPC。当前目标已经应用，重新部署时仍应核对历史。每个特权 RPC 使用 `SECURITY INVOKER`，并在函数体检查 `auth.role() IS DISTINCT FROM 'service_role'`；不能只依赖 EXECUTE grant。公开 key、无凭证以及真实普通用户 JWT 的特权查询拒绝均已验证。
2. 通过服务环境设置注入 `DATABASE_MODE=cloudbase-http`、`CLOUDBASE_DATABASE_API_KEY`、`AUTH_MODE=cloudbase`、`CLOUDBASE_ENV_ID`、`APP_ORIGIN` 和至少 32 字符且持久保存的 `TICKET_SECRET`。API 网关地址由实际环境 ID 生成。初次保留 `MOCK_AI_MODE=true`。不要把秘密写入 ZIP 或命令参数。
3. 创建独立的 `campusflow-api` HTTP 函数，运行时为 `Nodejs24.11`，按已核验的调用方式配置网关。先检查已有路由，使用 `WEB_SCF` 上游；不要为开放单个 API 而覆盖整个环境的认证策略。
4. API 来源检查由 `APP_ORIGIN` 控制。当前通过 CloudBase HTTP 网关访问，配置 `CORS_MANAGED_BY_GATEWAY=true` 交由网关添加响应头，API 仍检查来源和预检头。实际 OPTIONS 为 204、允许来源唯一、允许携带凭证；认证业务请求仍按各流程单独验收。
5. 实际验证健康检查、真实登录、组织隔离、报名容量、重复报名和签到、CSV、问卷，以及移动端 HTTPS 摄像头能力。检查日志不得包含请求头全集或秘密。

原 CloudRun Dockerfile 和 `prepare-source.mjs` 继续作为备选。若未来恢复 TCP 数据库访问，需要按实际数据库配置 VPC、子网与出网，见[私有网络通信](https://cloud.tencent.com/document/product/583/19703)。ZIP 安装和编译、云端运行、API 业务是不同层次；本次已分别完成包验证、云端健康、网关和真实浏览器 10 阶段业务验证。用户后续确认真实邮箱收信及验证码登录；OTP 模拟检查不代替真实邮件服务边界，合成摄像流测试不代替 iPhone 摄像头。iPhone Safari 核心扫码、重复不增人数及识别后/主动停止/后台切换后的预览关闭另已用户实测通过，清理前云端复查为 1 / 2，专用测试活动及关联记录已精确清理；拒权手动替代、后置镜头和硬件指示灯等真机扩展项与真实 AI 仍未验证，见 [邮箱与真机记录](../testing-email-camera.md)。

## 当前已部署包

2026-10-28 发布 `.local/http-function/campusflow-api-T8jp2S.zip`，SHA-256 为 `69cf869e6f6991f29b104aa60472b12c5da2699c9ffe66bccc4a418ed3794024`。官方 SDK 显式 `code.ZipFile` 解决此前 COS 代码包读取失败，未改动凭证保护机制；服务端秘密随后经用户确认通过 MCP 配置。具体恢复步骤、请求 ID 与边界见 [发布恢复记录](runtime-recovery.md)。

## 本次本地验证

- 脚本语法、ESLint 和 TypeScript 检查通过；API 重新编译成功。
- 初始包安装 91 个运行依赖，包含 3,892 个文件，ZIP 为 5,885,166 字节。业务代码变更后应重新打包，不能沿用此快照作为最终发布包。
- 使用 Python 标准库 `zipfile` 独立检查全部文件 CRC、启动文件 Unix `100755` 权限和 LF 换行；确认无 PGlite、环境文件或本地数据。
- 将 ZIP 解压到仓库外的临时目录，生产 API 在没有开发依赖的情况下启动；使用不可达的测试数据库，健康接口返回 503 和固定错误，不泄露连接细节。此项只验证包可启动及失败处理，不证明真实云 PG 已连通。
- 动态导入改动后，本地 PGlite 内存模式启动成功，健康接口返回 200。
