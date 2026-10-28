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

创建远程仓库前，确认仓库归属、名称、可见性与写入权限。GitHub 身份连接成功不代表 CNB 已授权。将锁文件、源代码和 CI 配置提交后，确认 CNB 的默认分支确实为 `main`，再查看实际流水线结果。

当前没有可提供的 GitHub/CNB 仓库地址或 CI 运行链接。配置文件存在不代表平台已经执行通过；完成推送后，应保存真实运行地址、commit SHA 和失败日志。

## 部署扩展

生产部署尚未加入流水线。以后增加时应拆分开发与生产环境，使用平台密钥管理和受保护的发布步骤，先完成测试和环境验收。不要将 `.env`、数据库连接串或 API Key 写入 `.cnb.yml`，不要在 PR 流水线里授予生产写入能力。

语法依据：[CNB Grammar Manual](https://docs.cnb.cool/en/build/grammar.html)；事件依据：[Trigger Rules](https://docs.cnb.cool/en/build/trigger-rule.html)。
