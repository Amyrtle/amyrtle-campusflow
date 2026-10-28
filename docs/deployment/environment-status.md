# 部署环境核查记录

更新：2026-10-28，北京时间。前端和 API 已部署，基础访问与真实云端 10 阶段业务闭环通过；用户已确认真实邮箱收信及验证码登录。后续 OTP 和摄像头修复已部署，模拟 SDK 与合成摄像流检查通过；iPhone Safari 核心扫码、重复防重及识别后/主动停止/后台切换后的预览关闭已用户实测通过，清理前云端复查为 1 / 2，测试活动已清理；真机扩展项、真实邮件服务边界及真实 AI 尚未验证。此文件区分资源、身份、数据库、自动化模拟和用户操作的实际结果。

| 项目 | 当前已核验结果 |
| --- | --- |
| 本地工具 | Windows、Node.js 24.19.0、npm 11.17.0、Git；CloudBase CLI 3.8.9 可用 |
| CloudBase 授权 | 官方浏览器授权已成功，临时会话续期后 `env list` 查询成功 |
| 目标环境 | 国内站，`secure-dragon-d6g1dce1lb03f43cf`，`ap-shanghai`，体验环境 |
| 数据库 | 共享 PostgreSQL，已验证服务器 HTTPS 数据面；本项目不把内部网关地址拼为 TCP 连接串 |
| MCP | 项目 `.local` 下 CloudBase MCP 2.36.1 与管理辅助程序实际可用，已完成版本迁移和合成数据清理 |
| 数据库迁移 | schema、RLS、业务 RPC、查询目录、RPC 错误格式共 5 个版本已应用并确认 |
| 云数据库测试 | 7/7 通过：容量并发、报名幂等、签到幂等、回滚、权限、字段和问卷；本轮合成数据已清理 |
| 服务器/公开 key | 分别配置；服务器 RPC 成功，公开 key 调用特权 RPC 返回 401/42501；秘密只保存在忽略文件与授权服务配置 |
| 身份认证 | 正式 SDK 合成账号密码登录、真实 userinfo、会话刷新及退出通过；普通用户 JWT 的特权查询被拒绝；用户确认邮箱收信和验证码登录，新增 4 项模拟 OTP 检查通过 |
| 后端函数 | `campusflow-api`，HTTP、`Nodejs24.11`，状态 `Active`；`/api/health` HTTP 200，真实数据库类型为 `cloudbase-http` |
| 服务器凭证配置 | 用户确认后经 MCP 成功写入；不在 ZIP、前端或文档中保存明文 |
| HTTP 网关 | `/api` → `WEB_SCF/campusflow-api`，路径透传与安全域名校验开启；OPTIONS 204、CORS 允许来源唯一、未登录会话请求 401 |
| 前端应用 | 最新 OTP/摄像头修复版本 `campusflow-002` 状态为 `SUCCESS`；首页引用 `assets/index-DlCC1vHh.js` 已 HTTP 核验。真实浏览器首页正常，登录深链底层仍为 HTTP 404，由 index.html 回退渲染 |
| 云端业务闭环 | 10/10 通过，包含活动、匿名报名、签到、统计、CSV、问卷、模板复盘和参与者删除；页面 JavaScript 异常 0 |
| 测试清理 | 自动云业务轮次的合成组织、活动、QA 账号和 profile 已清理，旧 JWT 为 401；后续 iPhone 专用活动及关联报名、签到也已精确清理，三类剩余均为 0，两张票失效；用户组织、账号与审计日志保留 |
| CloudRun | 初次查询未初始化；当前优先 HTTP 云函数，不为此自动开通 CloudRun |
| 真实 AI | 未验证，保留 `MOCK_AI_MODE=true` 明确模板标识 |
| Docker | 本机未发现命令，镜像未构建运行；函数 ZIP 和源码包已做独立安装/启动检查 |
| GitHub/CNB | [GitHub 开源仓库](https://github.com/Amyrtle/amyrtle-campusflow) 采用 MIT License，以 main 分支交付源码，可公开浏览；检查结果见 [Actions](https://github.com/Amyrtle/amyrtle-campusflow/actions/workflows/ci.yml)。CNB 尚未发布 |
| 费用范围 | 使用已授权环境及体验额度；未升级独享 PG、未开通收费 AI。资源使用可能消耗现有额度，不承诺长期免费 |

## 已验证访问入口

[前端测试站点](https://campusflow-secure-dragon-d6g1dce1lb03f43cf.webapps.tcloudbase.com/)已用真实浏览器打开。默认域名首次显示腾讯云测试提醒，倒计时后点击“确定访问”进入；这属于当前体验环境的访问方式。

[API 健康检查](https://secure-dragon-d6g1dce1lb03f43cf-1516697172.ap-shanghai.app.tcloudbase.com/api/health)实际返回 HTTP 200：`status=ok`、`database=cloudbase-http`、`auth_mode=cloudbase`、`ai_mode=mock`。健康检查会读取真实数据库，但不代替完整业务验收。

## 函数恢复与版本

2026-10-26 的 COS 三元组发布曾返回 `InvalidParameterValue.CodeConfig`，代码包处理阶段取临时凭证失败。2026-10-28 改用官方 Manager SDK `code.ZipFile` 完成发布，自动清理本任务的 `CreateFailed` 残留后创建成功；未通过增加权限或购买资源处理。

已部署包为 `.local/http-function/campusflow-api-T8jp2S.zip`，SHA-256 为 `69cf869e6f6991f29b104aa60472b12c5da2699c9ffe66bccc4a418ed3794024`，创建请求 ID 为 `063bd849-3c78-4b27-8ee9-b72929fc6b59`。代码创建完成后，再经用户当前确认通过 MCP 写入服务端配置并完成健康检查。详见 [恢复记录](runtime-recovery.md)。

`.local/api-sdk-code-deploy-result.json` 只记录代码发布阶段；其中 `applicationSecretsConfigured: false` 不代表后续配置仍缺失。不得将该阶段快照替代最新健康与配置结果。旧 `.local/api-deploy-result.json` 保留为故障证据，不是当前状态。

## 已应用迁移

按顺序应用：

1. `20261025000000_schema.sql`
2. `20261025000001_rls.sql`
3. `20261026000000_rpc.sql`
4. `20261026000001_query_catalog.sql`
5. `20261026000002_rpc_errors.sql`

版本迁移任务和远端历史已核验。共享 PG 不通过应用运行时执行 SQL 文件；生产 API 不自动建表。RPC 错误格式前向修复保留结构化业务状态，避免网关省略 PostgreSQL DETAIL 后丢失业务错误。

## 工具与登录复核

使用明确的二进制名，避免 `npx @cloudbase/cli` 无法选择 executable：

```powershell
npx --yes --package @cloudbase/cli@3.8.9 tcb --version
npx --yes --package @cloudbase/cli@3.8.9 tcb env list
```

临时授权失效时再使用官方浏览器登录流程续期，不复用过期设备码，不要求用户把 SecretId、SecretKey 或密码粘贴到聊天。当前项目管理工具已经可用，不应再沿用“必须重启才能使用 MCP”作为阻塞说明。

## 验收边界

真实 PG、API、身份与浏览器结果见 [测试报告](../testing.md) 和 [身份验收](../testing-auth-cloud.md)。部署与核心云端业务闭环已通过，邮箱收信和验证码登录另有用户确认，不能仅依据 SDK 密码登录或模拟 OTP 用例得出该结论。iPhone Safari 核心扫码、重复不增人数及识别后/主动停止/后台切换后的预览关闭已用户实测通过，清理前云端复查为 1 / 2；后置镜头、拒权手动替代、硬件指示灯及其他扩展项仍未单独真机验证。真实邮件服务的重发/错误/过期码、真实账号禁用和全部云端角色组合尚未覆盖。“【验收测试】iPhone Safari 扫码”活动已于 18:17:46（Asia/Shanghai）精确清理，活动、报名和签到均剩余 0；两张虚构票已失效，fixture 原始 token 已移除。安全证据汇总见 `.local/iphone-manual-verification.json`，清理报告见 `.local/iphone-scanner-cleanup.json`。详见 [邮箱与真机记录](../testing-email-camera.md)。
