# HTTP 函数发布恢复记录

核查日期：2026-10-28。恢复方案已实际执行，函数为 `Active`，服务端凭证随后通过正常 MCP 确认配置，真实 `/api/health` 返回 200。本文保留故障依据和恢复过程；完整业务验收见 [测试报告](../testing.md)。

## 已确认的故障边界

`campusflow-api` 是本任务创建的 HTTP 函数，运行时 `Nodejs24.11`。上一次用 MCP `queryFunctions(getFunctionUploadUrl)` 上传 ZIP，再将返回的 COS 三元组交给 `manageFunctions(createFunction)`，函数进入 `CreateFailed`：

```text
InvalidParameterValue.CodeConfig
format code info failed: get baseCodeCosInfo tmp token failed
assume role failed, secretId/secretKey/token is empty
```

这条错误发生在平台读取代码包阶段，尚不足以证明当前用户缺少某项 CAM 权限。不要据此增加账号权限、改套餐或重复同一上传方式。

本次用项目安装的官方 CloudBase MCP 2.36.1 所含 Manager SDK，调用 `functions.getTempCosInfo('campusflow-api')`，只检查返回值是否存在：`Date` 和 `Sign` 均存在，请求 ID 为 `bdcce5ad-03d1-4c33-9af2-d2af9181a86b`。签名未显示、未保存，也未上传代码。这说明另一条临时 COS 通道能够签发凭据；不能据此声称对应存储桶上传已经验证。

## 已执行的恢复方式

使用官方 Manager SDK 的显式 `code: { ZipFile }` 参数，直接提交已审核的 ZIP。当前 MCP 的 `code` 输入只接受 COS 三元组，未暴露 `ZipFile`，因此此处使用官方 SDK 补足工具参数能力。

- [Manager SDK 云函数接口](https://docs.cloudbase.net/api-reference/manager/node/function)明确支持 `code.ZipFile`，且显式 `code` 的优先级高于本地打包参数。
- [SCF Code 数据结构](https://cloud.tencent.com/document/api/583/17244)规定 ZIP 包上限为 50 MB，内容须转为 Base64。当前约 5.9 MB 的包处于此上限内。
- 当前 SDK 的 `base64Code` 和 `deployMode: 'zip'` 自动打包路径另有 1.5 MB 校验。它们与上述显式 `code` 参数不同，不应把当前包传给这两个路径。
- 当前 SDK 源码的 `createFunction` 在同名冲突时查询状态；仅对 `CreateFailed` 残留自动删除并重新创建。`updateFunctionCode` 会先等待函数可用，因而不能恢复这个残留状态。

恢复脚本为忽略目录中的 `.local/deploy-api-sdk-code.mjs`。脚本通过 `node --check` 后，使用最终包 `campusflow-api-T8jp2S.zip` 执行只读预检与发布，创建请求 ID 为 `063bd849-3c78-4b27-8ee9-b72929fc6b59`。最终 ZIP SHA-256 为 `69cf869e6f6991f29b104aa60472b12c5da2699c9ffe66bccc4a418ed3794024`。

```powershell
node .local/deploy-api-sdk-code.mjs .local/http-function/campusflow-api-T8jp2S.zip --check
node .local/deploy-api-sdk-code.mjs .local/http-function/campusflow-api-T8jp2S.zip --apply
```

以上为已执行命令记录，不是当前重复发布步骤。第一条只做文件和云端状态预检，第二条才执行创建。脚本固定目标环境 `secure-dragon-d6g1dce1lb03f43cf`、上海地域与函数名；若已有函数状态不是 `CreateFailed`，或者类型/运行时不同，立即停止，避免覆盖可用函数。恢复调用使用 `force: false`，由官方 SDK 处理已确认的失败残留。当前函数已经 `Active`，不要再次运行这个专用恢复脚本；后续代码发布应走经过检查的更新流程。

配置为 HTTP、`Nodejs24.11`、超时 30 秒、`installDependency: false`。包内已有运行依赖，不能开启 HTTP 函数不支持的云端依赖安装，也不发送曾导致错误的动态并发配置。

## 凭证与后续验收

脚本只提交非秘密环境变量，包括 `APP_ORIGIN` 和 `CORS_MANAGED_BY_GATEWAY=true`。它不读取数据库 key 或票据秘密，也不设置或跳过 MCP 的凭证保护。即使控制面状态变成 `Active`，应用仍需要通过正常 MCP 人工确认流程注入服务端秘密，才可能启动成功。

代码执行结果的安全摘要保存为 `.local/api-sdk-code-deploy-result.json`。其 `applicationSecretsConfigured: false` 只描述代码创建当时的状态；后续用户确认的 MCP 配置已成功，不能把该字段读作当前仍缺凭证。后续分层验证结果为：

1. 函数状态 `Active`，真实健康接口返回 200，证明应用已启动并读取共享 PG。
2. 服务端凭证经用户当前确认后由正常 MCP 流程写入成功；未放入代码包。
3. `/api` 路由为 `WEB_SCF/campusflow-api`，开启路径透传和安全域名校验，网关 `auth=false`；API 继续负责业务身份与组织权限。
4. OPTIONS `/api/auth/session` 返回 204，允许来源唯一、允许携带凭证；未登录会话请求返回 401。真实 SDK 密码会话已验证，用户后续另确认收到真实邮箱验证码并成功登录。
5. 真实云端 10 阶段业务闭环通过，包含非成员拒绝、报名、签到、统计、CSV、问卷、模板复盘生成/保存/刷新和参与者删除，页面 JavaScript 异常为 0。该轮合成业务记录、QA 身份及 profile 已精确清理，旧会话已失效；该轮脚本不包含邮箱收信、真机摄像头或真实 AI 验收。后续 OTP/摄像头修复已发布为 `campusflow-002`（`SUCCESS`）并通过模拟测试，用户另已确认 iPhone Safari 核心扫码成功、重复扫码仍为 1 / 2，以及识别后/主动停止/后台切换后的预览关闭，云端复查计数一致。该轮手机测试活动及关联记录已精确清理，两张票失效；拒权手动替代、后置镜头与硬件指示灯等扩展项仍未单独真机验证，详见 [邮箱与真机记录](../testing-email-camera.md)。

只读诊断脚本 `.local/diagnose-temp-cos.mjs` 仅打印成功标志和请求 ID。使用官方包的 `dist/index.cjs`；`dist/index.js` 在当前独立安装方式下缺少 `@cloudbase/cals` 依赖，不能直接导入。

同一台 Windows 主机上的 CloudBase CLI/MCP 认证缓存刷新应串行执行。并发进程可能同时重命名 `~auth.json` 到 `auth.json`，出现 `EPERM`；这类本地文件竞争不代表云端权限被拒绝。
