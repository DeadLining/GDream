# 开发指南

[返回项目首页](../README.md) · [使用指南](usage.md) · [当前架构](architecture.md)

## 环境准备与启动

当前开发与打包主要面向 macOS Apple Silicon。准备：

- Node.js 24+ 和 npm。
- Rust 工具链（rustup）。
- macOS 开发工具；Tauri 编译需要系统编译器及相关 SDK。

在项目根目录执行：

```bash
npm install
npm ci --prefix dsh-runtime
npm run setup:dsh-node
npm run tauri:dev
```

`setup:dsh-node` 下载应用使用的内嵌 Node 运行时，首次构建需要执行；该运行时不提交到 Git。

## 构建与打包

```bash
# 前端构建与类型检查
npm run build

# 桌面应用打包
npm run tauri:build
```

打包入口为 `scripts/tauri-build.mjs`。没有私有默认配置时使用纯净公开构建，禁止把个人资源或凭证放入发布包。

当前仓库尚未提供 Release 安装包。后续分发未签名应用时，macOS 可能要求在 Finder 右键选择“打开”，或在“系统设置 → 隐私与安全性”中确认。仅对自己构建或已核实来源的应用进行放行。

## 按改动范围验证

从下表选用与改动相关的检查，完整脚本见 [package.json](../package.json)。模型或付费生成相关的实测应单独说明实际调用范围，不能把离线测试当成生成质量验收。

| 改动范围 | 命令 |
| --- | --- |
| TypeScript 类型 | `npx tsc --noEmit` |
| Agent、凭证、渠道与业务契约 | `npm run test:harness` |
| DSH 运行时桥接与生命周期 | `npm run test:dsh-runtime` |
| 多模态与上下文 | `npm run test:omni`、`npm run test:context` |
| H3 适配与端口迁移 | `npm run test:minimax-h3` |
| 设置持久化 | `npm run test:settings-persistence` |
| 工坊状态分页 | `npm run test:state-paging` |
| Rust 编译检查 | `cargo check --manifest-path src-tauri/Cargo.toml` |
| 设置文件锁与原子写入 | `cargo test --manifest-path src-tauri/Cargo.toml settings_storage` |

H3 设置迁移会将旧版 `30010` 和 `7861` 端口切换至 `7863`。修改该逻辑时，需要同时验证请求契约、提交时端点的保存和任务恢复行为。

## 必须保留的执行约定

- DeepSeek Harness 锁定 `0.1.0-rc.6`；不直接修改 `dsh-runtime/node_modules` 上游源码。升级必须通过 Harness、dsh-runtime 全量回归和真实 ACP 冒烟。
- DSH 是唯一用户任务执行引擎。协议、凭证或模型配置缺失时明确阻断，禁止回退旧执行循环。
- 付费工具执行后不得整轮重放，避免重复计费。恢复查询应使用已提交任务的标识和原始端点。
- 凭证只经凭证注册表和私有写盘路径保存，不进入日志、错误消息、进程参数、对话历史或配置导出。

更多代码约定见 [AGENTS.md](../AGENTS.md)，执行链路与读取契约见[当前架构](architecture.md)。

## 参与贡献

欢迎 Issue 和 PR。请从 `main` 创建功能分支，每个 PR 聚焦一个问题，并说明：

- 解决的问题与改动原因。
- 相关 Issue、行为变化与兼容性影响。
- 实际执行的验证、结果，以及未验证的范围。

提交前运行相关检查并审阅暂存内容，遵守[许可范围](../LICENSING.md)。仓库中的技能、资源与第三方依赖可能分别适用不同许可。

## 安全与隐私

请勿提交 API Key、Cookie、会话记录、个人记忆、私有默认配置、内网部署地址，或包含真实项目与会话信息的截图。`.gitignore` 和 Gitleaks 扫描用于辅助检查，不能代替人工审阅。

安全漏洞应通过仓库提供的私密报告渠道联系维护者，附受影响版本、复现步骤和潜在影响；不要在公开 Issue 中披露凭证或可利用细节。维护者会尽力回应，安全修复主要面向最新版本，暂不承诺响应时限。

## 文档维护

`docs/` 保留与当前实现一致的使用、开发和架构说明。功能变更时同步更新相关说明；开发日志、阶段总结、实验对比、临时方案和真实用户数据留在仓库外。
