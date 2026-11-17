# Brief persistence release — 2026-09-25

- Built current source with `npm run tauri:build`, version 2.9.8 arm64.
- Prepared ad-hoc signed app; strict deep signature verification passed before and after installation.
- Rebuilt DMG from signed app; hdiutil verification passed.
- Confirmed idle chat and no GDream child process; quit normally, backed up and replaced /Applications/GDream.app.
- Relaunched installed application and observed original project, product settings, and script revision restored.
- Existing lost brief was empty before and after installation; no recovery claimed.
- Draft persistence regression, 470 harness tests and TypeScript check passed before packaging. Installed real-project inputs were not modified to test persistence; no model or paid calls.
- Backup: /Users/example/Library/Application Support/GDream-backups/20260925-brief-persistence/
- Installed executable SHA256: 5bd496fea6cc269b01ec9cfab88a7c88d101701bf1998fc97784e386ff0af6af
