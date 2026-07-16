# Worktree Consolidation - 2026-07-16

本次按各分支最后提交时间盘点并收敛项目 worktree。最终只保留项目根目录的 `main`。

## 执行结果

| 最后提交时间 | 原 Worktree | 原分支 | 处理结果 |
|---|---|---|---|
| 2026-07-16 11:04:37 | 项目根目录 | `main` | 保留，接收全部功能 |
| 2026-07-16 11:04:17 | `.worktrees/v0.7-full-episode-loop` | `feat/v0.7-full-episode-loop` | 合并到 `main` 后删除 |
| 2026-07-15 14:54:06 | `.worktrees/review-publish-completion` | `feat/review-publish-completion` | 已在 `main`，删除 |
| 2026-07-15 14:12:07 | `.worktrees/review-layout-fix` | `fix/review-layout-overflow` | 已在 `main`，删除 |
| 2026-07-15 12:10:09 | `.worktrees/real-theme-video-e2e` | `test/real-theme-video-e2e` | 数据库归档后删除 |
| 2026-07-12 12:55:43 | `.worktrees/3d-director` | `feat/3d-director` | 数据库归档后删除 |

v0.7 与 `main` 原先分别有 56 和 76 个独有提交。合并时人工整合了审阅时间线、导演台状态和导演台测试，并修复了 Alembic 分支迁移冲突。

合并提交：`ab2f754 merge: integrate v0.7 full episode loop into main`

## 数据归档

归档根目录：

`/Users/shengzhoukong/Documents/AI漫剧/ai-comic-studio-worktree-archive`

| 来源 | 归档路径 | SHA-256 |
|---|---|---|
| `real-theme-video-e2e/data/studio.db` | `2026-07-15_121009-real-theme-video-e2e/studio.db` | `55a86dfd38dffb65167ae6eaad794a51d192a43e453752ac353f1b4eea10d0d0` |
| `3d-director/data/studio.db` | `2026-07-12_125543-3d-director/studio.db` | `fb0566b7ded970edca6e340df9044fd8dfcceab5e47452fbf6c950e6afda991c` |
| `3d-director/data/mock-ssh.json` | `2026-07-12_125543-3d-director/mock-ssh.json` | `3cf245cd8d16ad292a9b60b2224caedbc4de067360b0015363ecc947f6410601` |

源文件与归档文件的 SHA-256 已逐一核对一致。

v0.7 worktree 中由 Next dev 自动生成的 `next-env.d.ts` 差异已保存为：

`2026-07-16_110417-v0.7-full-episode-loop/next-env.d.ts.patch`

## 最终状态

- 只剩一个 worktree：项目根目录 `main`。
- 所有旧 worktree 分支均已删除。
- `feat/v0.7-full-episode-loop` 的提交历史可从 `main` 到达。
- 原 3000 端口 Next dev 进程已停止。
- Alembic 迁移已收敛为单一 head：`20260725_33`。
