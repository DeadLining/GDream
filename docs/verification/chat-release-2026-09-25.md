# Chat 整改版打包替换 — 2026-09-25

- 构建：`npm run tauri:build` 成功，版本沿用 2.9.8，Apple Silicon arm64。
- 原安装包的应用资源签名检查未通过。对构建副本执行本地 ad-hoc 签名，重新生成 DMG 并替换本轮初始产物；没有禁用 Gatekeeper 或修改系统安全设置。
- 重新生成的 DMG 经 `hdiutil verify` 校验通过；挂载后的应用与最终已安装应用均通过 `codesign --verify --deep --strict`。
- DSH 保持 0.1.0-rc.6。
- 在 UI 确认旧任务已结束、且无 DSH 子进程后，通过正常退出替换 `/Applications/GDream.app`。旧版保留在 `~/Library/Application Support/GDream-backups/20260925-chat-rendering/GDream.app`。
- 新程序进程已启动，恢复原项目。启动时默认选中了一个空会话，手动切回原广告任务后，原历史及最终回复仍在，新版制作步骤卡片已显示在最终回复之前。
- 实际安装版已写入 3 个运行归档文件，观察到权限均为 0600；没有读取/输出业务正文或凭证。
- 未触发模型、生成或付费任务，没有回放旧授权，没有清理项目或配置。
- 挂载卷及本轮临时安装目录已清理。

## 校验值

- 安装后主程序 SHA-256：`a62983bc89ca3e12341f505e844c335e47baa33fd584ea45ba45d5e067f9eeee`
- DMG SHA-256：`a8599bbf59c6533358b30d7c664c8b7344716db3aff6673370659112fa2287a3`
- DMG：`src-tauri/target/release/bundle/dmg/GDream_2.9.8_aarch64.dmg`

这是本机个人构建包，不是 Developer ID 签名或 Apple 公证发布包。此次验证覆盖构建、替换、启动、历史恢复及真实归档权限，不等于重新完成真实付费生成端到端验收。
