import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import EditorView from './components/editor/EditorView';
import WorkshopView from './components/workshop/WorkshopView';
import ProjectTopBar from './components/projects/ProjectTopBar';
import CanvasView from './components/canvas/CanvasView';
import ProjectListView from './components/projects/ProjectListView';
import ArtifactLibrary from './components/library/ArtifactLibrary';
import BackgroundTaskToast from './components/BackgroundTaskToast';
import { ToolConfirmDialog } from './components/ToolConfirmDialog';
import { SetupWizard } from './components/wizard';
import { SkillWizardPanel } from './components/wizard/skill-wizard';
import { useAgent } from './hooks/useAgent';
import { useBackgroundPoller } from './hooks/useBackgroundPoller';
import { useWorkshopCanvasSync } from './hooks/useWorkshopCanvasSync';
import { useCanvasTaskRecovery } from './hooks/useCanvasTaskRecovery';
import { useCronScheduler } from './hooks/useCronScheduler';
import { useSessions } from './hooks';
import { useChatStore as _useChatStore, useSettingsStore, useSkillStore, useAigcProjectStore } from './stores';
import { useProjectStore } from './stores/projectStore';
import { useUnifiedProjectStore } from './stores/unifiedProjectStore';
import { useWizardStore } from './stores/wizardStore';
import { bootstrapProviders, ANTHROPIC_PRESETS } from './lib/agent/providers';
import { resolveApiKey } from './lib/credentials';
import { preconnectAll } from './lib/apiPreconnect';
import { runCleanupFunctions } from './lib/cleanupRegistry';
import { runHousekeeping } from './lib/housekeeping';
import { migrateLocalStorageToFiles, cleanupLegacySessionMedia } from './lib/historyPersistence';
import { appWindow } from '@tauri-apps/api/window';
import { hasSettingsPersistenceError, SETTINGS_PERSISTENCE_ERROR } from './stores/settingsStore';

function App() {
  const { isReady, sendMessage, abort } = useAgent();
  const { loadAgents, loadSessions, loadSession } = useSessions();
  useBackgroundPoller();
  useCanvasTaskRecovery();
  useWorkshopCanvasSync();
  useCronScheduler(isReady, sendMessage);
  const { theme, setupComplete, setupSkipped, wizardOpen, glmApiKey } = useSettingsStore();
  // 引导浮层：首次启动（未完成且未跳过）自动出现；也可由设置页横幅重新打开。
  const showWizard = wizardOpen || (!setupComplete && !setupSkipped);
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const providerBaseUrls = useSettingsStore((s) => s.providerBaseUrls);
  const providerModels = useSettingsStore((s) => s.providerModels);
  // String signatures: the objects above get new references on every
  // keystroke in Settings, which made bootstrap/preconnect re-run per key.
  // credentials/credentialRefs 也在签名里：凭证注册表改动要让 provider 立即重挂。
  const providerSettingsSig = useSettingsStore(
    (s) => JSON.stringify([s.providerApiKeys, s.providerBaseUrls, s.providerModels, s.credentials, s.credentialRefs]),
  );
  const loadAllSkills = useSkillStore((s) => s.loadAllSkills);
  const wizardPanelOpen = useWizardStore((s) => s.isPanelOpen);
  const wizardProject = useWizardStore((s) => s.project);
  const activeView = _useChatStore((s) => s.activeView);
  const unifiedActiveId = useUnifiedProjectStore((s) => s.activeId);
  const recoverUnified = useUnifiedProjectStore((s) => s.recoverUnified);
  const canvasProjects = useProjectStore((s) => s.projects);
  const activeCanvasProjectId = useProjectStore((s) => s.activeProjectId);

  // main.tsx only mounts App after successful disk hydration; never time out
  // into a writable default state when credentials could not be recovered.
  const settingsReady = useSettingsStore.persist.hasHydrated();
  const [settingsSaveFailed, setSettingsSaveFailed] = useState(hasSettingsPersistenceError);
  useEffect(() => {
    const onError = () => setSettingsSaveFailed(true);
    window.addEventListener(SETTINGS_PERSISTENCE_ERROR, onError);
    return () => window.removeEventListener(SETTINGS_PERSISTENCE_ERROR, onError);
  }, []);

  // Apply dark/light mode class to <html>
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Tier 2.5: run cleanup functions when the window is about to close.
  // Rust side separately aborts active streams via RunEvent::ExitRequested.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow
      .onCloseRequested(async () => {
        await runCleanupFunctions();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* non-fatal; only affects graceful shutdown */
      });
    return () => unlisten?.();
  }, []);

  // Register providers + warm TCP/TLS once settings are available.
  // Re-runs when user pastes/changes a key in ProviderSettings.
  useEffect(() => {
    if (!settingsReady) return;
    const settingsNow = useSettingsStore.getState();
    const glmKey = resolveApiKey(settingsNow, 'provider:glm', providerApiKeys.glm ?? glmApiKey);
    const deepseekKey = resolveApiKey(settingsNow, 'provider:deepseek', providerApiKeys.deepseek ?? '');
    const kimiKey = resolveApiKey(settingsNow, 'provider:kimi', providerApiKeys.kimi ?? '');
    const anthropicEntries: Record<string, { apiKey?: string; baseUrl?: string; model?: string }> = {};
    for (const preset of ANTHROPIC_PRESETS) {
      anthropicEntries[preset.id] = {
        apiKey: resolveApiKey(settingsNow, `provider:${preset.id}`, providerApiKeys[preset.id] ?? ''),
        baseUrl: providerBaseUrls[preset.id],
        model: providerModels[preset.id],
      };
    }
    const customKey = resolveApiKey(settingsNow, 'provider:custom', providerApiKeys.custom ?? '');
    bootstrapProviders({
      glmApiKey: glmKey,
      glmBaseUrl: providerBaseUrls.glm,
      glmModel: providerModels.glm,
      deepseekApiKey: deepseekKey,
      deepseekBaseUrl: providerBaseUrls.deepseek,
      deepseekModel: providerModels.deepseek,
      kimiApiKey: kimiKey,
      kimiBaseUrl: providerBaseUrls.kimi,
      kimiModel: providerModels.kimi,
      anthropic: anthropicEntries,
      custom: { apiKey: customKey, baseUrl: providerBaseUrls.custom, model: providerModels.custom },
    });

    const urls: string[] = [];
    if (glmKey) urls.push(providerBaseUrls.glm || 'https://open.bigmodel.cn');
    if (deepseekKey) urls.push(providerBaseUrls.deepseek || 'https://api.deepseek.com/anthropic');
    if (kimiKey) urls.push(providerBaseUrls.kimi || 'https://api.kimi.com/coding/');
    for (const preset of ANTHROPIC_PRESETS) {
      if (anthropicEntries[preset.id]?.apiKey) {
        urls.push(providerBaseUrls[preset.id] || preset.defaultBaseUrl);
      }
    }
    if (customKey) urls.push(providerBaseUrls.custom || 'http://127.0.0.1:8000');
    if (urls.length > 0) void preconnectAll(urls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, providerSettingsSig, glmApiKey]);

  // Load skills on mount
  useEffect(() => {
    if (settingsReady) {
      loadAllSkills();
    }
  }, [settingsReady, loadAllSkills]);

  // Load agents and sessions when ready
  useEffect(() => {
    if (settingsReady) {
      void migrateLocalStorageToFiles().finally(() => {
        loadAgents();
        loadSessions();
      });
      // Eagerly load AIGC projects so the system-prompt injection in
      // useAgent sees `currentProject` even before MemoryPanel is opened.
      void useAigcProjectStore.getState().loadProjects();
      // Initialize the project console: first run migrates the legacy global
      // canvas into 默认项目; later runs load the active project's canvas file.
      void useProjectStore.getState().initialize();
    }
  }, [settingsReady, loadAgents, loadSessions]);

  // Unified project self-heal: if the user is inside 工坊/画布/剪辑 but the
  // cross-module link was lost after reload or a state race, restore it from
  // the persisted activeId, or from the active canvas' AIGC association.
  useEffect(() => {
    if (!settingsReady) return;
    if (activeView !== 'workshop' && activeView !== 'canvas' && activeView !== 'editor') return;
    let targetId = unifiedActiveId;
    if (!targetId && (activeView === 'canvas' || activeView === 'editor')) {
      targetId = canvasProjects.find((p) => p.id === activeCanvasProjectId)?.aigcProjectId ?? null;
    }
    if (!targetId) return;
    void recoverUnified(targetId);
  }, [
    settingsReady,
    activeView,
    unifiedActiveId,
    activeCanvasProjectId,
    canvasProjects,
    recoverUnified,
  ]);

  // Tier 4: auto-resume the most recent session for the current agent on
  // first ready. Runs once. If no sessions exist, no-op (welcome screen
  // shows). If user already navigated, also no-op.
  const [autoResumed, setAutoResumed] = useState(false);
  useEffect(() => {
    if (autoResumed || !settingsReady || !isReady) return;
    const state = _useChatStore.getState();
    // Project mode owns its session. Never let the global "most recent chat"
    // restore race with project opening and select another project's chat.
    if (unifiedActiveId) {
      setAutoResumed(true);
      return;
    }
    if (state.currentSessionId || state.sessions.length === 0) {
      setAutoResumed(true);
      return;
    }
    const agentId = state.currentAgent?.id || 'main';
    const candidates = state.sessions
      .filter((s) => {
        const parts = s.id.split(':');
        const sAgentId = parts.length >= 3 && parts[0] === 'agent' ? parts[1] : 'main';
        return sAgentId === agentId;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (candidates.length > 0) {
      void loadSession(candidates[0].id);
    }
    setAutoResumed(true);
  }, [autoResumed, settingsReady, isReady, unifiedActiveId, loadSession]);

  // Tier 4: nightly housekeeping of orphaned message blobs in localStorage.
  // Delayed 30s after settings ready so loadSessions + file hydration complete
  // first. Otherwise housekeeping may garbage-collect message bodies before
  // their sessions are reloaded from disk.
  useEffect(() => {
    if (!settingsReady) return;
    const timer = setTimeout(() => runHousekeeping(), 30_000);
    return () => clearTimeout(timer);
  }, [settingsReady]);

  // One-time cleanup: strip base64 media embedded in legacy session files
  // (pre-fix image/video tool results could pin ~5MB each into a session
  // file). Delayed like housekeeping so first paint + session hydration are
  // never blocked; a localStorage marker inside makes it run only once.
  useEffect(() => {
    if (!settingsReady) return;
    const timer = setTimeout(() => void cleanupLegacySessionMedia(), 15_000);
    return () => clearTimeout(timer);
  }, [settingsReady]);

  // Show loading while settings hydrate
  if (!settingsReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-dark-bg text-gray-400 text-sm">
        正在加载设置...
      </div>
    );
  }

  // 主界面始终挂载；初始配置向导以 modal 浮层呈现，关闭 = 跳过（见 SetupWizard）。

  return (
    <div className="h-screen flex bg-dark-bg overflow-hidden">
      {settingsSaveFailed && <div role="alert" className="fixed top-0 left-0 right-0 z-[9999] bg-red-950 px-4 py-3 text-sm text-white">
        设置未保存：文件写入失败或已被另一实例修改。已停止覆写以保护凭证；请关闭其他 GDream 并重启后重新配置。本次更改尚未落盘。
      </div>}
      {/* 左侧栏已整体移除：品牌、视图切换、设置都收在 ProjectTopBar 里，
          不再留一条 280px 的全局导航占位。 */}

      {/* Main Content Area */}
      <motion.div
        className="flex-1 flex flex-col min-w-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <ProjectTopBar />
        {activeView === 'canvas' ? (
          <CanvasView onSendMessage={sendMessage} onAbort={abort} />
        ) : activeView === 'projects' ? (
          <ProjectListView />
        ) : activeView === 'library' ? (
          <ArtifactLibrary />
        ) : activeView === 'workshop' ? (
          <WorkshopView onSendMessage={sendMessage} onAbort={abort} />
        ) : (
          <EditorView onSendMessage={sendMessage} onAbort={abort} />
        )}
      </motion.div>

      {/* Skill Wizard Panel */}
      <AnimatePresence>
        {wizardPanelOpen && wizardProject && (
          <SkillWizardPanel width={400} />
        )}
      </AnimatePresence>

      {/* Background task notifications */}
      <BackgroundTaskToast />

      {/* Tool confirmation dialog (global so it works in all views) */}
      <ToolConfirmDialog />

      {/* 新手引导浮层：首次启动自动出现；完成/跳过后由设置页横幅可重新打开 */}
      <AnimatePresence>
        {showWizard && <SetupWizard />}
      </AnimatePresence>
    </div>
  );
}

export default App;
