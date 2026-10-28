# 部署与环境核验

- [腾讯云部署步骤](cloudbase.md)：认证、PG 迁移、API、前端与上线验收。
- [环境核查记录](environment-status.md)：已实际检查的工具、认证和部署状态。
- [部署前核查](deployment-readiness.md)：共享 HTTP 与原生 TCP 两种数据库方式、权限和发布条件。
- [HTTP 云函数](http-function.md)：当前优先部署路径、白名单打包与运行环境。
- [函数发布恢复](runtime-recovery.md)：已解决的 COS 代码包故障、官方 SDK 发布路径及证据。
- [CNB 持续集成](cnb.md)：流水线结构与检查命令。

2026-10-28 已完成前端与 HTTP API 部署，函数为 `Active`，共享 PostgreSQL 健康检查、网关 CORS、正式 SDK 密码会话与真实浏览器 10 阶段业务闭环全部通过。五个数据库迁移和 7 项真实数据库验收已完成，该轮合成业务数据、QA 账号及 profile 已精确清理。用户另已确认收到真实邮箱验证码并成功登录；后续 OTP 和摄像头生命周期修复已发布为 `campusflow-002`（`SUCCESS`），首页引用 `assets/index-DlCC1vHh.js` 已 HTTP 核验。62 项集成及 10 项本地浏览器测试通过，其中 OTP 使用模拟 SDK、扫码使用合成摄像流。用户已完成 iPhone Safari 核心实测：首次扫码、重复不增人数，以及识别后/主动停止/后台切换后的预览关闭；清理前云端复查计数为 1 / 2。手机测试活动及关联报名、签到已精确清理，两张测试票已失效，用户组织、账号与审计日志保留。拒权手动替代和硬件指示灯等真机扩展项、真实邮件服务边界及真实 AI 尚未验证。用户已同意优先使用现有体验额度和共享 PG HTTP/RPC，未授权自动升级套餐。

[CampusFlow 测试入口](https://campusflow-secure-dragon-d6g1dce1lb03f43cf.webapps.tcloudbase.com/)首次访问会显示腾讯云默认域名提醒，点击“确定访问”后进入。详细验证范围见 [测试报告](../testing.md)。
