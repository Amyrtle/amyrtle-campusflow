# 官方技术依据

核验日期：2026 年 10 月 25 日。本文记录实现及部署决策的官方来源；具体账号能力、模型可用性和资源费用仍需在用户环境验证。

| 决策 | 官方来源 | 本项目采用方式 |
| --- | --- | --- |
| CloudBase 工具接入 | [Setup Skill](https://docs.cloudbase.net/skill.md)、[Codex 配置指南](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/ide-setup/codex) | 官方插件安装，当前会话以显式 `tcb` CLI 检查登录状态 |
| PG 模式 | [PG 模式概述](https://docs.cloudbase.net/quick-start/pg-overview) | 独立新建 PG 开发环境；不假设传统模式可以升级 |
| 后端数据库连接 | [连接 PostgreSQL](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql) | Fastify 服务使用 `pg` 和环境变量中的连接串；本地使用持久化 PGlite |
| PG 账号及 RLS | [PG 身份认证](https://docs.cloudbase.net/authentication-v2/auth/auth-pg) | CloudBase 用户标识按字符串保存；应用组织角色由本项目数据库管理 |
| 邮箱验证码 | [邮箱登录](https://docs.cloudbase.net/authentication-v2/method/email-login)、[用户注册](https://docs.cloudbase.net/authentication-v2/method/signup) | Web SDK 获取验证码，验证后登录或注册，Access Token 发送给 API |
| 服务端身份验证 | [当前用户信息](https://docs.cloudbase.net/http-api/auth/user-me)、[Token 验证](https://docs.cloudbase.net/http-api/auth/auth-token-introspect) | 服务端通过固定环境的官方认证端点验证，不信任前端 UID 或未验证 JWT |
| AI 服务端调用 | [Node SDK](https://docs.cloudbase.net/ai/model/nodejs-access)、[HTTP API](https://docs.cloudbase.net/ai/model/curl-access) | 服务端调用 CloudBase 模型，限制输入、Token 与超时，校验结构化输出 |
| 静态托管 | [CLI hosting](https://docs.cloudbase.net/cli-v1/hosting) | 构建产物从 `apps/web/dist` 发布，SPA fallback 指向 `index.html` |
| 云托管 | [Node 容器快速开始](https://docs.cloudbase.net/run/quick-start/dockerize-node)、[CLI 部署](https://docs.cloudbase.net/run/deploy/deploy/deploying-cli) | API 作为容器服务运行；镜像和网络设置需要云环境验收 |
| CNB | [语法](https://docs.cnb.cool/en/build/grammar.html)、[触发规则](https://docs.cnb.cool/en/build/trigger-rule.html) | `main` 分支 push/PR 执行检查和构建，不自动上线 |

## 已确认的接口细节

- Web SDK 邮箱验证码使用 `auth.getVerification({ email })`；官方注册流程使用 `auth.verify({ verification_id, verification_code })`，之后 `auth.signUp` 或 `auth.signIn`。应按实际安装的 SDK 类型检查参数。
- 独立 Node 服务验证 Bearer token 可调用 `GET https://<envId>.api.tcloudbasegateway.com/auth/v1/user/me`。成功响应的身份字段为 `sub`；不能仅凭 HTTP 200 接受空对象或匿名身份。
- `GET /auth/v1/token/introspect` 的无效 token 响应可能为空对象，必须检查有效 `sub`。
- 官方 PG 文档说明 `auth.users.id` 为 `varchar(64)`，不应要求所有 CloudBase 用户标识均为 UUID。
- CloudBase AI 专用 HTTP 文档使用 `/v1/ai/cloudbase/chat/completions`，请求含 `model`、`messages`、`stream`，支持 `max_tokens`。部分快速开始页出现单数 `completion`，本项目依据专用 API 页使用复数。
- `@cloudbase/node-sdk` 的 `auth.getUserInfo()` 读取平台注入上下文，不适合在普通 Fastify 服务中代替任意 Bearer token 校验。官方 Node Auth 参考未列出的辅助方法不作为实现依据。
- 数据库服务直连不会自动获得 PostgREST 注入的用户 JWT。必须在应用服务中校验身份和组织权限，并让数据库采用明确的最小权限及 RLS 策略；不要把 service_role 密钥放到客户端。

## 核验限制

这些文档和 CLI 帮助已经读取；云账号未登录，所以未验证真实邮箱发送、CloudBase PG 迁移、AI 模型开通或线上容器运行。模型示例名称不是对用户环境可用模型的承诺。
