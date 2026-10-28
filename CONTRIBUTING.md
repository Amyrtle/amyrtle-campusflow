# 参与开发

先阅读 [AGENTS.md](AGENTS.md) 和 [架构说明](docs/architecture/README.md)。使用 Node.js 22+，运行 `npm install` 和 `npm run dev`。

修改共享接口时同时更新调用端，并保留错误返回格式。新增组织级接口必须校验成员和角色；新增公开接口必须考虑输入长度、访问频率和隐私。

提交前运行 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`。涉及用户流程时运行 `npm run test:e2e`。不得把未运行的检查写成通过。

测试使用虚构信息，禁止提交 `.env`、本地数据库或真实报名数据。PR 说明应包含问题、行为变化、验证结果与已知限制。
