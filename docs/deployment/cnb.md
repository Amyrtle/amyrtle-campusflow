# GitHub 和 CNB 持续集成

仓库根目录 `.cnb.yml` 为 `main` 分支的 `push` 和 `pull_request` 事件配置了检查流水线。使用 Node 24，按锁文件安装依赖，然后依次执行类型检查、ESLint、业务测试、生产构建和 Playwright 浏览器测试。

CI 使用本地测试数据库和明确的 AI 模板模式，不需要腾讯云密钥，不创建云资源，也不自动部署。首次浏览器安装需要网络；Runner 必须允许拉取 `node:24-bookworm`、npm 依赖和 Playwright Chromium。

## 本地对应命令

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Linux CI 使用 `--with-deps` 安装浏览器系统依赖。Windows 开发机可执行 `npx playwright install chromium`。

## 推送和验证

GitHub 开源仓库为 [Amyrtle/amyrtle-campusflow](https://github.com/Amyrtle/amyrtle-campusflow)，采用 MIT License，使用 `main` 分支，可公开浏览和克隆。仓库所有者拥有管理权限，写入权限由维护者分配。GitHub 身份连接成功不代表 CNB 已授权。

GitHub 的运行入口为 [CI 工作流](https://github.com/Amyrtle/amyrtle-campusflow/actions/workflows/ci.yml)，每次推送和 PR 触发检查。实际提交 SHA、运行日志与结论以该页面为准。CNB 仓库尚未创建或推送，远程 CI 未执行；后续接入时应确认其默认分支为 `main`，再核验真实运行结果。

## 部署扩展

生产部署尚未加入流水线。以后增加时应拆分开发与生产环境，使用平台密钥管理和受保护的发布步骤，先完成测试和环境验收。不要将 `.env`、数据库连接串或 API Key 写入 `.cnb.yml`，不要在 PR 流水线里授予生产写入能力。

语法依据：[CNB Grammar Manual](https://docs.cnb.cool/en/build/grammar.html)；事件依据：[Trigger Rules](https://docs.cnb.cool/en/build/trigger-rule.html)。
