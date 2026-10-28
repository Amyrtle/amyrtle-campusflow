# GitHub 代码交付

仓库：[Amyrtle/amyrtle-campusflow](https://github.com/Amyrtle/amyrtle-campusflow)。仓库归属为 Amyrtle，采用私有可见性，默认交付分支为 `main`。访问者需使用已获授权的 GitHub 账号；给 TDP 工作人员分享仓库时，也需要为其配置相应访问权限。

线上网站继续运行在 [腾讯云 CloudBase](https://campusflow-secure-dragon-d6g1dce1lb03f43cf.webapps.tcloudbase.com/)。GitHub 保存项目源码、迁移、文档、合成测试截图及持续集成配置。

## 获取和运行

```sh
git clone https://github.com/Amyrtle/amyrtle-campusflow.git
cd amyrtle-campusflow
npm ci
npm run dev
```

本地启动使用持久化 PGlite 与明确标识的开发身份和 AI 模板模式。生产配置需要按 [部署说明](README.md) 单独注入。

## 自动检查

[GitHub Actions CI](https://github.com/Amyrtle/amyrtle-campusflow/actions/workflows/ci.yml) 在推送和 PR 时运行依赖安装、lint、类型检查、集成测试、生产构建和 Playwright 浏览器测试。CI 使用本地合成数据，不需要腾讯云密钥。当前工作流执行检查和构建；腾讯云发布按现有部署流程操作。

每次交付应核对远程 `main` 与本地提交 SHA，并查看对应 Actions 运行的最终结论。配置文件、提交请求或排队状态均不能代替实际检查通过。

## 提交范围

`.gitignore` 排除 `.env` 实值、`.local`、`.cloudbase`、`.data`、依赖、构建产物和原始 Word 文档。原 Word 保留在本地 `source-documents`。`.env.example` 仅提供配置模板。

密钥、浏览器会话、真实参与者数据和仍有效的签到凭证不得进入仓库。`.dockerignore` 同时排除 `.local` 和 `.cloudbase`，避免未来本机构建发送这些私密目录。
