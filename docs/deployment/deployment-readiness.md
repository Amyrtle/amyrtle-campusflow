# CampusFlow 部署前核查

更新：2026-10-28。本文描述部署约束和可复用检查；当前前端与 HTTP API 已部署，具体结果见 [环境记录](environment-status.md)。用户已批准采用共享 PG HTTP/RPC，保留原生 PostgreSQL 连接方式。

## 两种数据库接入方式

| 条件 | 共享 PG HTTPS/RPC（当前方案） | 原生 PostgreSQL TCP（保留方案） |
| --- | --- | --- |
| 选择变量 | `DATABASE_MODE=cloudbase-http` | 不设置该模式，配置 `DATABASE_URL` |
| 凭证 | 服务端 `CLOUDBASE_DATABASE_API_KEY` | 专用数据库角色及连接凭证 |
| 事务 | 单次 `campusflow_mutate` 在数据库内完成整个业务事务 | `pg` 事务中调用相同业务函数 |
| 查询 | 固定 `campusflow_query` 语句目录与绑定参数 | 参数化 SQL |
| 网络 | 目标环境 HTTPS 数据面，不需要 TCP/VPC | 按实际实例配置可达网络、VPC/子网和 TLS |
| 迁移 | CloudBase 管理工具版本化迁移，应用禁止执行 DDL | 独立迁移身份执行版本文件；显式本地脚本可用于初始化 |
| 本次验证 | 五个迁移、7 项真实云数据库检查通过 | 保留代码与本地检查，未验证云端 TCP 部署 |

共享实例不能因为存在 PostgreSQL 名称就当作普通 TCP 实例。已核验的目标实例没有可供本应用直连的 TCP 地址。不得把环境 ID 或内部数据网关主机拼成 `DATABASE_URL`，不得为此自动升级套餐。未来若选择独享或外部 PG，另行核验规格、费用、网络和用户授权。

## 权限与事务

- API 验证真实身份、组织成员和角色；共享查询目录不是授权系统，不能绕过 API 后直接开放给浏览器。
- 每个特权 RPC 使用 `SECURITY INVOKER`，并在函数体检查 `auth.role() IS DISTINCT FROM 'service_role'`。CloudBase RPC 不能只依赖 EXECUTE grant；入口和辅助函数都必须检查。
- 报名锁定活动后检查幂等、状态、时间窗、字段和容量，计数、报名与审计同事务完成。签到和问卷保留唯一约束与业务校验。
- 目录只允许已登记语句和参数，不提供任意 SQL 接口；管理 SQL 仅用于授权的迁移、诊断和明确限定范围的数据维护。
- 服务端 key 与浏览器 publishable key 分离；浏览器配置仅使用 `VITE_PUBLISHABLE_KEY`。不要把数据库/AI key 放进 `VITE_*`。
- API 生产启动要求真实数据库配置、CloudBase 认证、可信来源与持久化签到密钥，拒绝静默回落到本地 PGlite。

## API 打包与发布

当前优先 [HTTP 云函数](http-function.md)，运行时 `Nodejs24.11`，监听 `0.0.0.0:9000`。`prepare-http-function.mjs` 生成白名单 ZIP；应用运行凭证通过服务环境配置注入，不放入代码包。部署受理、函数资源存在和函数健康是三种不同状态，最后须访问 `/api/health` 并执行业务请求。

CloudRun 继续作为备选，源码包通过以下脚本生成：

```powershell
node cloudbase/deployment/prepare-source.mjs
```

脚本每次创建新的上传目录与 SHA-256 manifest，只收集构建必需文件。不要把仓库根目录直接交给 CLI `--source`：已核查版本的 ZIP 逻辑不会完整使用 `.gitignore`/`.dockerignore`，可能上传环境文件、数据库或 Word。Docker 忽略规则只约束后续镜像构建，不能阻止源码包先上传。

CloudRun 首次开通需核验云托管环境，容器监听 `0.0.0.0:3001`，按授权配置实例上下限和访问入口；原生 PG 还需配置实际 VPC/子网。CLI `--env-params` 会全量替换变量，不应使用部分值覆盖既有环境，也不得把秘密放入命令历史。当前共享方案无需为数据库连通性创建 VPC。

## 认证、前端与验收

邮箱登录需要 provider、发件能力、安全域名、真实公开 key 和实际收件验证。官方 SDK 配置成功不等于邮件已送达。浏览器获取的 token 由 API 向固定环境 userinfo 接口核验，拒绝空身份、匿名和禁用用户；不能只解码 JWT。

`VITE_*` 是构建期公开配置，环境 ID、地域、publishable key 与 API 地址必须对应同一部署。`VITE_API_BASE_URL` 只填 HTTPS origin，不带 `/api`；API 的 `APP_ORIGIN` 精确匹配前端 origin。变更前端变量后需重建。当前通过 CloudBase HTTP 网关设置 `CORS_MANAGED_BY_GATEWAY=true`，由网关添加 CORS 头，API 仍校验来源与预检允许头；真实 OPTIONS 204、唯一允许来源及云端 CSV 下载已验证。

16 张业务表已配置 RLS 与角色权限，但服务器特权角色不是自动的租户隔离。公钥、无凭证 RPC 拒绝已实测；真实普通用户 JWT 调用特权查询也已返回 403/42501。云 API 非成员访问为 403、无身份受保护请求为 401，真实浏览器核心业务闭环 10/10 通过；这些结果不代替全部云端角色组合的权限矩阵验证。

生产保持 `MOCK_AI_MODE=true`，直到模型访问和费用范围实际核验。部署日志不得包含密钥、Authorization、数据库连接串或参与者数据。发布前运行项目规定检查，发布后再执行真实健康、认证、业务、权限和移动端检查；两者不能相互替代。
