# CloudBase 真实身份验收

自动验收时间：2026-10-28 17:28（Asia/Shanghai）。使用已有的独立合成测试账号，通过正式 CloudBase Web SDK 和真实身份接口验证；脚本没有发送验证码邮件，没有创建新账号。

后续用户于 2026-10-28 明确确认已用自己的邮箱收到验证码并成功登录，邮箱收信及验证码登录记为用户实测通过。未收集用户验证码或会话。其后的前端健壮性更新通过 4 项模拟 SDK 浏览器检查，覆盖冷却、邮箱变更、错误重试与会话边界；真实邮件服务的重发、错误码与过期码尚未单独实测，详见 [邮箱与真机验收记录](testing-email-camera.md)。

## 实测结果

| 检查 | 结果 |
| --- | --- |
| 登录配置 | 用户名密码与邮箱登录启用；匿名与手机登录关闭 |
| 仅配置 Publishable Key | `getSession()` 不返回用户会话 |
| `signInWithPassword` | 成功，返回真实用户与会话 |
| `/auth/v1/user/me` | HTTP 200；用户标识与已创建测试账号一致；邮箱存在且匹配；`type=external`、`status=ACTIVE` |
| 普通用户访问特权数据库 RPC | `campusflow_query` 返回 HTTP 403、`DATABASE_42501`，拒绝访问 |
| 刷新后的会话 | 仍为已登录、非匿名会话 |
| SDK 退出 | `signOut()` 后 `getSession()` 不再返回会话 |
| 登录页直达和刷新 | `/login` 均显示正常登录表单，无页面 JavaScript 异常；HTTP 状态仍为 404 |

首次使用默认测试域名时，腾讯云显示访问提醒；等待按钮倒计时后点击“确定访问”可进入页面。前端地址为 [CampusFlow 测试站点](https://campusflow-secure-dragon-d6g1dce1lb03f43cf.webapps.tcloudbase.com/)。

## 验证边界

本轮自动化密码登录通过测试脚本调用正式 SDK 完成，不能单独证明验证码邮件收发；邮箱收信和验证码登录的通过结论来自后续用户确认。新增 OTP 自动化检查拦截 SDK、不发送邮件，不能把真实服务的所有注册分支、重发/错误/过期处理列为通过。登录页回退能够呈现页面，但 404 响应仍是需要优化的部署行为。真实手机摄像头和真实 AI 不在本次结果范围内；后续线上业务闭环结果另见 [云业务验收](testing-cloud-business.md)。

官方身份接口的用户状态枚举为 `DEFAULT`、`ACTIVE`、`PENDING`、`BLOCKED`；后端应识别 `BLOCKED` 禁用状态，不能只判断 `DISABLED`。

可复查的安全结果保存于 `.local/cloud-auth-verification.json`。测试脚本为 `.local/auth-cloud-verification.mjs`。2026-10-28 17:42 完成业务验收后的最终清理：已删除该合成身份与精确匹配的应用资料，复查资料为 0 行，旧会话调用身份接口返回 401。临时账号密码、会话和浏览器存储文件已从本机忽略目录删除；安全摘要见 `.local/qa-cleanup-summary.json`。没有清理其他用户的数据。
