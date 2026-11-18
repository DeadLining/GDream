# GDream

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm_Noncommercial-blue.svg)](LICENSE)

本地运行的 AIGC 创作工作台，提供 AI 对话、剧本拆解、画布、流水线工坊与剪辑功能。

GDream 基于 React + TypeScript、Tauri / Rust 和固定版本的 DeepSeek Harness。项目与媒体主要保存在本机，外部模型服务由用户自行配置。

**当前为 Tauri 桌面应用，主要面向 macOS Apple Silicon；Web 与多租户版本尚未实现。**

## 核心功能

| 模块 | 用途 |
| --- | --- |
| AI 对话 | 通过 DeepSeek Harness 调用模型与创作工具，支持多个模型渠道及自定义兼容接口 |
| 画布 | 排布素材，进行扩图、局部重绘、抠图、三视图生成和提示词反推 |
| 风格库 | 选择内置视觉风格，为图片、分镜和动画提供风格参考 |
| 流水线工坊 | 拆解剧本，管理角色与场景资产，编辑镜头、提示词和生成结果 |
| 故事板与审核 | 规划镜头、生成故事板，审核首尾帧和视频候选，再由创作者采用 |
| 剪辑与配音 | 通过对话辅助剪辑、配音和音画匹配 |
| MG 动画与写作 | 制作页面动效与动画，辅助编剧、写作和文本审阅 |

## 快速开始

当前仓库尚未发布 Release 安装包，请先从源码启动。需要 macOS、Node.js 24+ 和 Rust 工具链；完整准备与打包说明见[开发指南](docs/development.md)。

在项目根目录执行：

```bash
npm install
npm ci --prefix dsh-runtime
npm run setup:dsh-node
npm run tauri:dev
```

首次启动后：

1. 按引导配置对话模型的 API Key、渠道和模型。
2. 根据创作需要，分别配置图片、视频或语音服务。
3. 从一段剧本或参考素材开始，在对话、画布或工坊中创建任务，检查生成结果后再采用。

设置入口、自定义 API 和工坊流程见[使用指南](docs/usage.md)。

## 适用范围与当前限制

- 适合愿意配置模型服务、调试创作流程的创作者和开发者；使用与改造须遵守本仓库许可。
- 项目、素材与配置主要保存在本机，当前不提供 Web 多人协作或多租户隔离。
- 部分任务查询、结果下载和流程推进依赖客户端运行；关闭应用后不等于服务端会自动完成全部流程。
- Windows 移植尚未完成；精细剪辑和最终成片可能仍需配合专业剪辑工具。
- AI 分析与质量审核用于辅助复核，最终创作判断由使用者负责。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/usage.md) | 首次配置、模型渠道、自定义 API、H3 与工坊生产流程 |
| [开发指南](docs/development.md) | 环境准备、源码运行、打包、测试和贡献要求 |
| [当前架构](docs/architecture.md) | 前端、Rust 与 DSH 的职责，数据保存、任务执行及 Web 迁移边界 |

## 贡献与安全

欢迎 Issue 和 PR，提交要求见[开发指南](docs/development.md#参与贡献)，AI 编码约定见 [AGENTS.md](AGENTS.md)。问题反馈会尽力处理，暂不承诺响应时限。

请勿提交 API Key、Cookie、会话记录或私有配置；安全漏洞请通过私密渠道报告，不在公开 Issue 中披露凭证或可利用细节。具体说明见[开发指南](docs/development.md#安全与隐私)。

## 许可与第三方声明

本仓库新增及有权许可的内容采用 [PolyForm Noncommercial 1.0.0](LICENSE)，仅限许可允许的非商业用途，商业使用需另行授权。原有 MIT 代码和第三方组件的许可与例外见 [LICENSING.md](LICENSING.md) 和 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
