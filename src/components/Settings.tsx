import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Key, Eye, EyeOff, Boxes, RotateCcw, ArrowLeft,
  ScrollText, Settings2, Download, Upload, Image as ImageIcon,
  Film, Route, Cloud, Database, ChevronDown, ChevronRight, Gauge,
  RefreshCw, Loader2,
} from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog, save as saveDialog, message as tauriMessage } from '@tauri-apps/api/dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/api/fs';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { SkillLibrary } from './skills';
import LogPanel from './LogPanel';
import ProviderSettings from './settings/ProviderSettings';
import ImageApiSettings from './settings/ImageApiSettings';
import CredentialSettings from './settings/CredentialSettings';
import { credentialIdFor, normalizeBaseUrl, planCredentialClear, resolveApiKey, resolveCosSecrets } from '@/lib/credentials';
import { sanitizeSettingsExportPayload, sanitizeSettingsImportPayload } from '@/lib/settingsTransfer';
import { syncArkModels } from '@/lib/channels/arkSync';
import { mergeArkModels } from '@/lib/channels/arkModels';
import ImageRoutePanel from './settings/ImageRoutePanel';
import UsageSettings from './settings/UsageSettings';
import { qualityReviewEndpoint } from '@/lib/workshop/qualityReview';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId =
  | 'general'
  | 'models'
  | 'credentials'
  | 'images'
  | 'videos'
  | 'usage'
  | 'integrations'
  | 'routes'
  | 'data'
  | 'skills'
  | 'logs';

const SETTINGS_TABS: Array<{
  id: TabId;
  group: '偏好设置' | 'AI 服务' | '扩展与诊断';
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { id: 'general', group: '偏好设置', label: '通用', description: '外观、提醒与 Agent 行为', icon: <Settings2 size={16} /> },
  { id: 'models', group: 'AI 服务', label: '语言模型', description: '管理对话与 Agent 使用的模型服务', icon: <Key size={16} /> },
  { id: 'credentials', group: 'AI 服务', label: 'API 凭证', description: '密钥的单一事实源，各能力统一引用', icon: <Database size={16} /> },
  { id: 'images', group: 'AI 服务', label: '图片模型', description: '管理生图服务槽位与图片相关密钥', icon: <ImageIcon size={16} /> },
  { id: 'videos', group: 'AI 服务', label: '视频与语音', description: 'Seedance、MiniMax H3、Omni MG 与豆包语音的统一管理', icon: <Film size={16} /> },
  { id: 'usage', group: 'AI 服务', label: '用量与余额', description: '查看媒体生成服务的剩余额度', icon: <Gauge size={16} /> },
  { id: 'routes', group: 'AI 服务', label: '智能路由', description: '配置模型降级链与生图通道顺序', icon: <Route size={16} /> },
  { id: 'integrations', group: 'AI 服务', label: '存储与集成', description: 'Kimi 剪辑 Agent 与腾讯云 COS', icon: <Cloud size={16} /> },
  { id: 'data', group: '偏好设置', label: '数据与备份', description: '导入或导出 GDream 设置', icon: <Database size={16} /> },
  { id: 'skills', group: '扩展与诊断', label: '技能库', description: '查看 GDream 当前可用技能', icon: <Boxes size={16} /> },
  { id: 'logs', group: '扩展与诊断', label: '运行日志', description: '诊断 Agent 与接口问题', icon: <ScrollText size={16} /> },
];

const SETTINGS_GROUPS = ['偏好设置', 'AI 服务', '扩展与诊断'] as const;

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const setupComplete = useSettingsStore((s) => s.setupComplete);
  const setupSkipped = useSettingsStore((s) => s.setupSkipped);
  const setWizardOpen = useSettingsStore((s) => s.setWizardOpen);
  // 跳过初始引导后的非阻断横幅：随时可重新打开向导补配
  const showSetupBanner = !setupComplete && setupSkipped;

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  const activeMeta = SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            role="region"
            aria-label="GDream 设置"
            className="fixed inset-0 z-50 flex overflow-hidden bg-white text-zinc-900"
          >
            <aside className="flex w-[252px] shrink-0 flex-col border-r border-zinc-200 bg-[#f4f4f5] px-3 pb-3 pt-4">
              <div className="px-1 pb-5">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-950"
                >
                  <ArrowLeft size={15} />
                  返回应用
                </button>
              </div>

              <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="设置分类">
                {SETTINGS_GROUPS.map((group) => (
                  <div key={group} className="mb-5 last:mb-0">
                    <div className="mb-1.5 px-2 text-[11px] font-medium text-zinc-400">{group}</div>
                    <div className="space-y-0.5">
                      {SETTINGS_TABS.filter((tab) => tab.group === group).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                            activeTab === tab.id
                              ? 'bg-zinc-200/80 text-zinc-950'
                              : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950'
                          }`}
                        >
                          <span className={activeTab === tab.id ? 'text-zinc-900' : 'text-zinc-500'}>{tab.icon}</span>
                          <span className="font-medium">{tab.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>

              <div className="mt-auto border-t border-zinc-200 px-2 pt-3 text-[11px] leading-relaxed text-zinc-400">
                设置会自动保存在本机
              </div>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col bg-white">
              <header className="flex h-[88px] shrink-0 items-center justify-between border-b border-zinc-100 px-10">
                <div className="min-w-0">
                  <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-zinc-950">{activeMeta.label}</h2>
                  <p className="mt-1 truncate text-[13px] text-zinc-500">{activeMeta.description}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
                  title="关闭设置"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
                <div className="mx-auto w-full max-w-[980px] pb-12">
                  {showSetupBanner && (
                    <div className="mb-6 flex min-w-0 items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-[#f4f4f5] px-4 py-3">
                      <p className="min-w-0 break-words text-[13px] text-zinc-600">
                        你还未完成初始配置，部分能力（聊天、生图、生视频）可能不可用。
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setWizardOpen(true);
                          onClose();
                        }}
                        className="shrink-0 rounded-md bg-primary-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600"
                      >
                        完成初始配置
                      </button>
                    </div>
                  )}
                  {activeTab === 'general' && <GeneralTab />}
                  {activeTab === 'models' && <ProviderSettings mode="providers" />}
                  {activeTab === 'credentials' && <CredentialSettings />}
                  {activeTab === 'images' && <ApiKeysTab section="images" />}
                  {activeTab === 'videos' && <ApiKeysTab section="videos" />}
                  {activeTab === 'usage' && <UsageSettings />}
                  {activeTab === 'integrations' && <ApiKeysTab section="integrations" />}
                  {activeTab === 'routes' && (
                    <div className="space-y-8">
                      <ProviderSettings mode="routing" />
                      <SettingsGroup title="生图通道" description="根据价格、速度和成功率调整生图路由顺序。">
                        <div className="p-4"><ImageRoutePanel /></div>
                      </SettingsGroup>
                    </div>
                  )}
                  {activeTab === 'data' && <ApiKeysTab section="data" />}
                  {activeTab === 'skills' && <SkillLibrary />}
                  {activeTab === 'logs' && <LogPanel />}
                </div>
              </div>
            </section>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Collapsible Section helper ───────────────────────────────────────────────

function CollapsibleSection({
  title,
  description,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-zinc-50"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-zinc-900">{title}</div>
          {description && <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{description}</div>}
        </div>
        {open ? <ChevronDown size={15} className="text-zinc-400" /> : <ChevronRight size={15} className="text-zinc-400" />}
      </button>
      {open && <div className="border-t border-zinc-100 px-4 py-4">{children}</div>}
    </section>
  );
}

function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 px-0.5">
        <h4 className="text-[13px] font-semibold text-zinc-900">{title}</h4>
        {description && <p className="mt-0.5 text-[11px] text-zinc-500">{description}</p>}
      </div>
      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
  align = 'center',
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div className={`flex min-h-[62px] gap-8 px-4 py-3.5 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-zinc-900">{title}</div>
        {description && <div className="mt-1 max-w-[430px] text-[11px] leading-relaxed text-zinc-500">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── General Tab ──────────────────────────────────────────────────────────────

function GeneralTab() {
  const {
    theme, setTheme,
    defaultCwd, setDefaultCwd,
    setSetupComplete,
    notificationsEnabled, setNotificationsEnabled,
  } = useSettingsStore();

  const [configInfo, setConfigInfo] = useState('');

  useEffect(() => {
    invoke<string>('get_home_dir')
      .then((home) => setConfigInfo(`${home}/.gdream/settings.json`))
      .catch(() => setConfigInfo('~/.gdream/settings.json'));
  }, []);

  return (
    <div className="space-y-8">
      <SettingsGroup title="外观与回答" description="控制 GDream 的显示方式和默认回复风格。">
        <SettingRow title="主题" description="在浅色和深色界面之间切换。">
          <div className="flex rounded-md bg-zinc-100 p-0.5">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`min-w-[70px] rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors ${
                  theme === t ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200/80' : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {t === 'light' ? '浅色' : '深色'}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow title="输出风格" description="决定普通对话默认采用的表达密度。">
          <OutputStyleSection />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="提醒" description="控制任务完成后的系统提示。">
        <SettingRow title="系统通知" description="窗口未聚焦且任务耗时超过 5 秒时推送。">
          <ToggleSwitch enabled={notificationsEnabled} onChange={setNotificationsEnabled} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Agent" description="设置 Agent 运行任务时使用的默认环境。">
        <SettingRow title="默认工作目录" description="留空时使用当前用户的 HOME 目录。">
          <input
            type="text"
            value={defaultCwd}
            onChange={(e) => setDefaultCwd(e.target.value)}
            className="w-[330px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            placeholder="留空使用 $HOME"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="应用信息">
        <SettingRow title="重新运行配置向导" description="重新选择基础服务配置，不会清除已有项目。">
          <button
            type="button"
            onClick={() => setSetupComplete(false)}
            className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <RotateCcw size={14} />
            重新配置
          </button>
        </SettingRow>
        <SettingRow title="版本"><span className="text-xs text-zinc-500">2.5.0</span></SettingRow>
        <SettingRow title="配置文件">
          <span className="block max-w-[360px] truncate font-mono text-[11px] text-zinc-500" title={configInfo}>{configInfo}</span>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

// ── API Keys Tab ─────────────────────────────────────────────────────────────

type ApiSettingsSection = 'images' | 'videos' | 'integrations' | 'data';

function ApiKeysTab({ section }: { section: ApiSettingsSection }) {
  const {
    geminiApiKey, setGeminiApiKey,
    dmxApiKey, setDmxApiKey,
    bananaProApiKey, setBananaProApiKey,
    credentials, credentialRefs, imageApiSlots, upsertCredential, removeCredential, setCredentialRef,
    arkApiKey, setArkApiKey,
    arkModelsCache, setArkModelsCache,
    happyHorseBaseUrl, setHappyHorseBaseUrl,
    happyHorseApiKey, setHappyHorseApiKey,
    runninghubApiKey, setRunninghubApiKey,
    kuaiziApiKey, setKuaiziApiKey,
    seedanceEngine, setSeedanceEngine,
    customVideoBaseUrl, setCustomVideoBaseUrl,
    customVideoApiKey, setCustomVideoApiKey,
    customVideoModel, setCustomVideoModel,
    customVideoCreatePath, setCustomVideoCreatePath,
    customVideoStatusPath, setCustomVideoStatusPath,
    customVideoProvider, setCustomVideoProvider,
    customVideoApiBaseUrl, setCustomVideoApiBaseUrl,
    customVideoNativeApiKey, setCustomVideoNativeApiKey,
    customVideoApiModel, setCustomVideoApiModel,
    customVideoGenericBaseUrl, setCustomVideoGenericBaseUrl,
    customVideoGenericApiKey, setCustomVideoGenericApiKey,
    customVideoGenericCreatePath, setCustomVideoGenericCreatePath,
    customVideoGenericStatusPath, setCustomVideoGenericStatusPath,
    customVideoGenericProtocol, setCustomVideoGenericProtocol,
    customVideoGenericModel, setCustomVideoGenericModel,
    customVideoGenericH3Task, setCustomVideoGenericH3Task,
    customVideoGenericH3ShortEdge, setCustomVideoGenericH3ShortEdge,
    customVideoGenericH3AspectRatio, setCustomVideoGenericH3AspectRatio,
    customVideoGenericH3Quality, setCustomVideoGenericH3Quality,
    customVideoGenericH3NumOutputs, setCustomVideoGenericH3NumOutputs,
    customVideoGenericH3InferenceSteps, setCustomVideoGenericH3InferenceSteps,
    customVideoGenericH3FlowShift, setCustomVideoGenericH3FlowShift,
    customVideoGenericH3AudioFlowShift, setCustomVideoGenericH3AudioFlowShift,
    customVideoGenericH3Seed, setCustomVideoGenericH3Seed,
    qualityReviewEnabled, setQualityReviewEnabled,
    qualityReviewBaseUrl, setQualityReviewBaseUrl,
    qualityReviewModel, setQualityReviewModel,
    qualityReviewMaxFrameAttempts, setQualityReviewMaxFrameAttempts,
    minimaxH3Channel, setMinimaxH3Channel,
    wan3Channel, setWan3Channel,
    kimiEditModel, setKimiEditModel,
    kimiEditUseCos, setKimiEditUseCos,
    qwen3TtsBaseUrl, setQwen3TtsBaseUrl,
    doubaoSpeechApiKey, setDoubaoSpeechApiKey,
    speechKuaiziFirst, setSpeechKuaiziFirst,
    omniApiKey, setOmniApiKey,
    omniZeroFallApiKey, setOmniZeroFallApiKey,
    omniApimartApiKey, setOmniApimartApiKey,
    cosBucket, setCosBucket,
    cosRegion, setCosRegion,
    cosSecretId, setCosSecretId,
    cosSecretKey, setCosSecretKey,
    cosTransitEndpoint, setCosTransitEndpoint,
  } = useSettingsStore();

  const [showKeys, setShowKeys] = useState<Set<string>>(new Set());
  const toggleShow = (id: string) => {
    const next = new Set(showKeys);
    next.has(id) ? next.delete(id) : next.add(id);
    setShowKeys(next);
  };

  // Ark「同步模型列表」：拉取方舟实时目录写入本地缓存；失败回退静态注册表并提示。
  const [arkSyncing, setArkSyncing] = useState(false);
  const [arkSyncError, setArkSyncError] = useState('');
  const handleSyncArkModels = async () => {
    setArkSyncing(true);
    setArkSyncError('');
    try {
      setArkModelsCache(await syncArkModels());
    } catch (err) {
      setArkSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setArkSyncing(false);
    }
  };
  const arkModelOptions = mergeArkModels(arkModelsCache);

  const [h3Checking, setH3Checking] = useState(false);
  const [h3CheckMessage, setH3CheckMessage] = useState('');
  const handleCheckH3Connection = async () => {
    if (customVideoGenericProtocol !== 'sglang-h3') return;
    const baseUrl = customVideoGenericBaseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      setH3CheckMessage('请先填写 H3 Base URL');
      return;
    }
    setH3Checking(true);
    setH3CheckMessage('正在检查健康状态和模型目录…');
    try {
      const resolvedH3ApiKey = resolveApiKey({ credentials, credentialRefs }, 'customVideoGeneric', customVideoGenericApiKey).trim();
      const headers = resolvedH3ApiKey
        ? { Authorization: `Bearer ${resolvedH3ApiKey}` }
        : undefined;
      const health = await tauriFetch(`${baseUrl}/health`, { method: 'GET', headers, responseType: ResponseType.JSON });
      if (!health.ok) throw new Error(`/health 返回 HTTP ${health.status}`);
      const models = await tauriFetch(`${baseUrl}/v1/models`, { method: 'GET', headers, responseType: ResponseType.JSON });
      if (!models.ok) throw new Error(`/v1/models 返回 HTTP ${models.status}`);
      const entries = Array.isArray((models.data as { data?: unknown[] })?.data)
        ? (models.data as { data: Array<{ id?: unknown }> }).data
        : [];
      const modelNames = entries.map((entry) => String(entry.id ?? '')).filter(Boolean);
      setH3CheckMessage(modelNames.length > 0 ? `连接正常 · 已发现 ${modelNames.join('、')}` : '连接正常 · 未返回模型目录');
    } catch (err) {
      setH3CheckMessage(`连接失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setH3Checking(false);
    }
  };

  const [qualityReviewChecking, setQualityReviewChecking] = useState(false);
  const [qualityReviewCheckMessage, setQualityReviewCheckMessage] = useState('');
  const selectedQualityReviewCredential = credentials.find((credential) => credential.id === credentialRefs.qualityReview);
  const [qualityReviewApiKeyDraft, setQualityReviewApiKeyDraft] = useState(selectedQualityReviewCredential?.apiKey ?? '');
  useEffect(() => {
    setQualityReviewApiKeyDraft(selectedQualityReviewCredential?.apiKey ?? '');
  }, [selectedQualityReviewCredential?.id, selectedQualityReviewCredential?.apiKey]);
  const handleSaveQualityReviewApiKey = () => {
    const apiKey = qualityReviewApiKeyDraft.trim();
    if (!apiKey) {
      setQualityReviewCheckMessage('请先输入多模态审核 API Key');
      return;
    }
    const baseUrl = normalizeBaseUrl(qualityReviewBaseUrl);
    const id = credentialIdFor(baseUrl, apiKey);
    if (!credentials.some((credential) => credential.id === id)) {
      upsertCredential({ id, label: '多模态质量审核', baseUrl, apiKey, createdAt: Date.now() });
    }
    setCredentialRef('qualityReview', id);
    setQualityReviewCheckMessage('API Key 已安全保存到凭证注册表');
  };
  const handleClearQualityReviewApiKey = () => {
    const credentialId = credentialRefs.qualityReview;
    const clearPlan = planCredentialClear({ credentialRefs, imageApiSlots }, 'qualityReview');
    setCredentialRef('qualityReview', null);
    setQualityReviewApiKeyDraft('');
    if (clearPlan === 'nothing-to-clear' || !credentialId) {
      setQualityReviewCheckMessage('审核 API Key 输入已清空');
      return;
    }
    if (clearPlan === 'unlink-only') {
      setQualityReviewCheckMessage('审核凭证已解绑；该凭证仍被其他能力使用，因此未从注册表删除');
      return;
    }
    removeCredential(credentialId);
    setQualityReviewCheckMessage('审核 API Key 已从凭证注册表清除');
  };
  const handleCheckQualityReview = async () => {
    const baseUrl = qualityReviewBaseUrl.trim();
    if (!baseUrl) {
      setQualityReviewCheckMessage('请先填写审核服务 Base URL');
      return;
    }
    setQualityReviewChecking(true);
    setQualityReviewCheckMessage('正在检查审核服务模型目录…');
    try {
      const apiKey = resolveApiKey({ credentials, credentialRefs }, 'qualityReview', '').trim();
      const response = await tauriFetch(qualityReviewEndpoint(baseUrl, 'models'), {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        responseType: ResponseType.JSON,
        timeout: 15,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const entries = Array.isArray((response.data as { data?: unknown[] })?.data)
        ? (response.data as { data: Array<{ id?: unknown }> }).data
        : [];
      const models = entries.map((entry) => String(entry.id ?? '')).filter(Boolean);
      setQualityReviewCheckMessage(models.includes(qualityReviewModel)
        ? `连接正常 · 已发现 ${qualityReviewModel}`
        : models.length > 0 ? `连接正常 · 服务返回 ${models.join('、')}` : '连接正常 · 未返回模型目录');
    } catch (error) {
      setQualityReviewCheckMessage(`连接失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setQualityReviewChecking(false);
    }
  };

  const inputCls =
    'w-full bg-white border border-zinc-200 rounded-md px-3 py-2 outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 text-sm';

  // 读时经凭证注册表解析：输入框显示的是当前生效的 key（凭证优先，旧字段回退）；
  // 写入仍走旧 setter，setter 会把新值镜像写回被引用的凭证。
  const rk = (cap: string, legacy: string) => resolveApiKey({ credentials, credentialRefs }, cap, legacy);
  const cosResolved = resolveCosSecrets({ credentials, credentialRefs }, cosSecretId, cosSecretKey);

  const exportSettings = async () => {
    try {
      const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
      const settings = sanitizeSettingsExportPayload(state);
      const path = await saveDialog({
        defaultPath: `gdream-settings-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      await writeTextFile(path, JSON.stringify({ kind: 'gdream-settings', version: 1, exportedAt: new Date().toISOString(), settings }, null, 2));
      await tauriMessage(`设置已导出（不含 API 密钥）：\n${path}`, { title: '导出成功' });
    } catch (err) {
      await tauriMessage(`导出失败：${err instanceof Error ? err.message : String(err)}`, { title: '导出失败' });
    }
  };

  const importSettings = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const raw = await readTextFile(selected);
      const parsed = JSON.parse(raw);
      const currentState = useSettingsStore.getState() as unknown as Record<string, unknown>;
      const allowedKeys = new Set(
        Object.entries(currentState)
          .filter(([, value]) => typeof value !== 'function')
          .map(([key]) => key),
      );
      const settings = sanitizeSettingsImportPayload(parsed?.settings ?? parsed, allowedKeys);
      useSettingsStore.setState(settings, false);
      await tauriMessage('设置已导入并保存。部分网络连接会在下次调用时生效。', { title: '导入成功' });
    } catch (err) {
      await tauriMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`, { title: '导入失败' });
    }
  };

  return (
    <div className="space-y-4">
      {section === 'data' && <SettingsGroup title="设置备份" description="导出偏好设置，不导出任何 API 密钥。">
      <div className="flex items-center justify-between gap-6 p-4">
        <div>
          <div className="text-[13px] font-medium text-zinc-900">设置备份</div>
          <div className="mt-1 text-[11px] text-zinc-500">导出文件始终排除凭证注册表、凭证引用、旧平铺密钥和带内联密钥的生图槽位；旧设置备份仍可导入。</div>
        </div>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void exportSettings()}
          className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <Download size={13} />
          导出设置
        </button>
        <button
          type="button"
          onClick={() => void importSettings()}
          className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <Upload size={13} />
          导入设置
        </button>
        </div>
      </div>
      </SettingsGroup>}

      {section === 'images' && <>
      <ImageApiSettings />
      <CollapsibleSection title="技能模板图像 Key" description="Gemini / DMXAPI / Banana Pro，供图像等能力使用；联网搜索请在 API 凭证中配置 Tavily；DMXAPI 留空时自动取首个 DMXAPI 槽位" defaultOpen={false}>
        <div className="space-y-3">
          <KeyInputRow
            label="Gemini API Key"
            hint="供识图等内置工具使用"
            value={rk('gemini', geminiApiKey)}
            onChange={setGeminiApiKey}
            show={showKeys.has('gemini')}
            onToggleShow={() => toggleShow('gemini')}
            placeholder="输入 Gemini API Key..."
          />
          <KeyInputRow
            label="DMXAPI Key"
            hint="同时用于联网搜索/识图等内置工具"
            value={rk('dmx', dmxApiKey)}
            onChange={setDmxApiKey}
            show={showKeys.has('dmx')}
            onToggleShow={() => toggleShow('dmx')}
            placeholder="输入 DMXAPI Key..."
          />
          <KeyInputRow
            label="Banana Pro API Key"
            hint="供图像生成等内置工具使用"
            value={rk('bananaPro', bananaProApiKey)}
            onChange={setBananaProApiKey}
            show={showKeys.has('bananaPro')}
            onToggleShow={() => toggleShow('bananaPro')}
            placeholder="输入 Banana Pro API Key..."
          />
        </div>
      </CollapsibleSection>
      </>}

      {/* 视频生成 */}
      {section === 'videos' && <>
      <CollapsibleSection title="视频引擎" description="Seedance 2.0 与 MiniMax H3 的通道选择；画布、工坊、剪辑与普通对话共用" defaultOpen>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Seedance 2.0 通道</label>
            <div className="flex rounded-md bg-zinc-100 p-0.5">
              {([
                { id: 'kuaizi', label: '筷子丽帧（默认）', hint: '默认通道；失败按内置容灾链处理' },
                { id: 'runninghub', label: 'RunningHub', hint: '改走 RHTV 标准模型端点' },
                { id: 'ark', label: '火山方舟', hint: '火山引擎方舟官方通道（doubao-seedance-2-0 系列）' },
                { id: 'custom', label: '自定义接口', hint: '本地或私有部署的视频 API；使用下方自定义端点配置' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSeedanceEngine(opt.id)}
                  title={opt.hint}
                  className={`min-w-[58px] rounded-[5px] px-2.5 py-1.5 text-center text-xs font-medium transition-colors ${
                    seedanceEngine === opt.id
                      ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200/80'
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
              默认启用筷子丽帧（用下方「筷子丽帧」的 Key）；RunningHub 用下方「RunningHub」的 Key；火山方舟用下方「火山方舟 Seedance」的 Key（官方通道，按 token 计费，参考视频/音频需公网 URL）。Seedance 2.5 走即梦本地 CLI（免 Key）与筷子丽帧自动容灾，无需选择。
            </p>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">MiniMax H3 渠道</label>
            <div className="flex rounded-md bg-zinc-100 p-0.5">
              {([
                { id: 'auto', label: '自动容灾（推荐）', hint: '按近期成功率与延迟自动选路' },
                { id: 'runninghub', label: 'RunningHub 优先', hint: '优先 RunningHub，失败自动容灾其余渠道' },
                { id: 'apimart', label: 'APIMart 优先', hint: '优先 APIMart，失败自动容灾其余渠道' },
                { id: 'kuaizi', label: '筷子丽帧优先', hint: '优先筷子丽帧，失败自动容灾其余渠道' },
                { id: 'custom', label: '自定义接口优先', hint: '优先使用下方配置的 SGLang MiniMax-H3 接口' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMinimaxH3Channel(opt.id)}
                  title={opt.hint}
                  className={`min-w-[58px] rounded-[5px] px-2.5 py-1.5 text-center text-xs font-medium transition-colors ${
                    minimaxH3Channel === opt.id
                      ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200/80'
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
              H3 会在 RunningHub、APIMart、筷子丽帧和已配置的自定义 SGLang 接口间容灾；选择“自定义接口优先”时自动使用通用 JSON Provider（当前服务为 `127.0.0.1:7863`）。积分不足/认证失败等明确未扣费错误才会自动切换渠道。
            </p>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">万相 3.0 渠道</label>
            <div className="flex rounded-md bg-zinc-100 p-0.5">
              {([
                { id: 'auto', label: '筷子主渠道（推荐）', hint: '默认筷子丽帧，失败按 RunningHub → APIMart 顺序容灾' },
                { id: 'custom', label: '自定义接口优先', hint: '优先使用下方自定义视频 API，失败后自动容灾其他万相渠道' },
                { id: 'kuaizi', label: '筷子丽帧优先', hint: '同默认；失败自动容灾其余渠道' },
                { id: 'runninghub', label: 'RunningHub 优先', hint: '优先 RunningHub，失败自动容灾其余渠道' },
                { id: 'apimart', label: 'APIMart 优先', hint: '优先 APIMart，失败自动容灾其余渠道' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setWan3Channel(opt.id)}
                  title={opt.hint}
                  className={`min-w-[58px] rounded-[5px] px-2.5 py-1.5 text-center text-xs font-medium transition-colors ${
                    wan3Channel === opt.id
                      ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200/80'
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
              万相 3.0（wan3.0-video）是阿里全能参考视频模型，支持图/视频/音频/文档/网页链接参考。默认筷子丽帧为主渠道，失败自动容灾 RunningHub、APIMart 与自定义接口；选择“自定义接口优先”后会优先使用下方自定义视频 API。参考图最多 10 张、参考视频/音频各最多 5 段，文档与网页链接互斥。
            </p>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="筷子丽帧" description="Seedance 2.0 默认视频通道" defaultOpen={false}>
            <KeyInputRow
              label="API Key"
              hint="筷子丽帧 Seedance 2.0 / 2.5 视频生成（Seedance 2.0 默认通道）；同时是万相 3.0 主渠道与 MiniMax H3 容灾渠道"
              value={rk('kuaizi', kuaiziApiKey)}
              onChange={setKuaiziApiKey}
              show={showKeys.has('kuaizi')}
              onToggleShow={() => toggleShow('kuaizi')}
              placeholder="输入筷子丽帧 API Key..."
            />
      </CollapsibleSection>

      <CollapsibleSection title="自定义视频 API" description="用于本地或私有部署的异步视频接口" defaultOpen={seedanceEngine === 'custom'}>
        <div className="space-y-3">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
            {([
              ['vllm-omni', '自定义（vLLM-Omni）'],
              ['minimax-api', '自定义（API）'],
              ['generic-api', '自定义（通用 API）'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setCustomVideoProvider(value)} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${customVideoProvider === value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>
                {label}
              </button>
            ))}
          </div>
          {customVideoProvider === 'minimax-api' ? (
            <>
              <KeyInputRow
                label="MiniMax API Key"
                hint="仅用于请求 MiniMax 原生视频接口；请在此处自行填写"
                value={rk('customVideoApi', customVideoNativeApiKey)}
                onChange={setCustomVideoNativeApiKey}
                show={showKeys.has('customVideoApi')}
                onToggleShow={() => toggleShow('customVideoApi')}
                placeholder="请输入 MiniMax API Key"
              />
              <label className="block text-xs text-zinc-500">Base URL<input value={customVideoApiBaseUrl} onChange={(e) => setCustomVideoApiBaseUrl(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="请填写 MiniMax API Base URL" /></label>
              <label className="block text-xs text-zinc-500">模型<input value={customVideoApiModel} onChange={(e) => setCustomVideoApiModel(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="请填写模型名称" /></label>
              <p className="text-[11px] leading-relaxed text-zinc-400">使用 MiniMax 原生 JSON 接口：创建任务后轮询 task_id，成功后下载 content.url。参考图需要是公网 HTTPS URL。</p>
            </>
          ) : customVideoProvider === 'generic-api' ? (
            <>
              <KeyInputRow
                label="API Key"
                hint="仅用于通用 JSON 视频接口请求；服务不鉴权时可留空"
                value={rk('customVideoGeneric', customVideoGenericApiKey)}
                onChange={setCustomVideoGenericApiKey}
                show={showKeys.has('customVideoGeneric')}
                onToggleShow={() => toggleShow('customVideoGeneric')}
                placeholder="可留空"
              />
              <label className="block text-xs text-zinc-500">Base URL<input value={customVideoGenericBaseUrl} onChange={(e) => { setCustomVideoGenericBaseUrl(e.target.value); setH3CheckMessage(''); }} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="http://127.0.0.1:7863" /></label>
              {customVideoGenericProtocol === 'sglang-h3' && <div className="flex items-center gap-2">
                <button type="button" onClick={() => void handleCheckH3Connection()} disabled={h3Checking} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                  {h3Checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {h3Checking ? '检查中…' : '测试 H3 连接'}
                </button>
                {h3CheckMessage && <span className={`min-w-0 text-[11px] ${h3CheckMessage.startsWith('连接正常') ? 'text-emerald-600' : h3CheckMessage.startsWith('正在') ? 'text-zinc-500' : 'text-red-500'}`}>{h3CheckMessage}</span>}
              </div>}
              <label className="block text-xs text-zinc-500">协议<select value={customVideoGenericProtocol} onChange={(e) => {
                const protocol = e.target.value as 'ltx-json' | 'sglang-h3';
                setCustomVideoGenericProtocol(protocol);
                setCustomVideoGenericCreatePath(protocol === 'sglang-h3' ? '/v1/videos' : '/v1/generations');
                setCustomVideoGenericStatusPath(protocol === 'sglang-h3' ? '/v1/videos/{id}' : '/v1/generations/{id}');
                setH3CheckMessage('');
              }} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono"><option value="ltx-json">通用 JSON / LTX</option><option value="sglang-h3">SGLang MiniMax-H3</option></select></label>
              {customVideoGenericProtocol === 'sglang-h3' && <>
                <label className="block text-xs text-zinc-500">模型<input value={customVideoGenericModel} onChange={(e) => setCustomVideoGenericModel(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="MiniMaxAI/MiniMax-H3" /><span className="mt-1 block text-[10px] text-zinc-400">填写 MiniMax-H3 时会自动规范为 MiniMaxAI/MiniMax-H3。</span></label>
                <label className="block text-xs text-zinc-500">任务类型<select value={customVideoGenericH3Task} onChange={(e) => setCustomVideoGenericH3Task(e.target.value as 'i2va' | 'fl2va' | 'ref2va' | 't2va')} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono">
                  <option value="i2va">i2va · 首帧 + 提示词</option>
                  <option value="fl2va">fl2va · 首尾帧生成视频</option>
                  <option value="ref2va">ref2va · 参考素材生成视频</option>
                  <option value="t2va">t2va · 纯文本生成视频</option>
                </select><span className="mt-1 block text-[10px] text-zinc-400">i2va/fl2va 使用边界帧条件（i2va 为首帧，fl2va 为首尾帧）；ref2va 直接提交场景、角色、道具、音频或视频参考素材，不提交首尾帧；t2va 不提交 conditions。</span></label>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block text-xs text-zinc-500">短边<input value={customVideoGenericH3ShortEdge} onChange={(e) => setCustomVideoGenericH3ShortEdge(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" /></label>
                  <label className="block text-xs text-zinc-500">目标画幅<input value={customVideoGenericH3AspectRatio} onChange={(e) => setCustomVideoGenericH3AspectRatio(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" /></label>
                  <label className="block text-xs text-zinc-500">质量<input value={customVideoGenericH3Quality} onChange={(e) => setCustomVideoGenericH3Quality(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" /></label>
                  <label className="block text-xs text-zinc-500">输出数量<input value={customVideoGenericH3NumOutputs} onChange={(e) => setCustomVideoGenericH3NumOutputs(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" /></label>
                  <label className="block text-xs text-zinc-500">推理步数<input value={customVideoGenericH3InferenceSteps} onChange={(e) => setCustomVideoGenericH3InferenceSteps(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" /></label>
                  <label className="block text-xs text-zinc-500">Seed<input value={customVideoGenericH3Seed} onChange={(e) => setCustomVideoGenericH3Seed(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" /></label>
                  <label className="block text-xs text-zinc-500">Flow shift<input value={customVideoGenericH3FlowShift} onChange={(e) => setCustomVideoGenericH3FlowShift(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" /></label>
                  <label className="block text-xs text-zinc-500">Audio flow shift<input value={customVideoGenericH3AudioFlowShift} onChange={(e) => setCustomVideoGenericH3AudioFlowShift(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" /></label>
                </div>
              </>}
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-zinc-500">创建路径<input value={customVideoGenericCreatePath} onChange={(e) => setCustomVideoGenericCreatePath(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder={customVideoGenericProtocol === 'sglang-h3' ? '/v1/videos' : '/v1/generations'} /></label>
                <label className="block text-xs text-zinc-500">查询路径<input value={customVideoGenericStatusPath} onChange={(e) => setCustomVideoGenericStatusPath(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder={customVideoGenericProtocol === 'sglang-h3' ? '/v1/videos/{id}' : '/v1/generations/{id}'} /></label>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400">{customVideoGenericProtocol === 'sglang-h3' ? 'SGLang MiniMax-H3：原生 /v1/videos JSON 协议。' : '通用 JSON 异步协议：提交 prompt、quality、duration_seconds、fps、width、height 等参数；创建返回 job_id，完成后从查询路径加 /content 下载。'}</p>
            </>
          ) : (
          <>
          <KeyInputRow
            label="API Key"
            hint="可留空；服务启用鉴权时才填写 Bearer Token"
            value={rk('customVideo', customVideoApiKey)}
            onChange={setCustomVideoApiKey}
            show={showKeys.has('customVideo')}
            onToggleShow={() => toggleShow('customVideo')}
            placeholder="可留空"
          />
          <label className="block text-xs text-zinc-500">Base URL<input value={customVideoBaseUrl} onChange={(e) => setCustomVideoBaseUrl(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="http://127.0.0.1:8000" /></label>
          <label className="block text-xs text-zinc-500">模型（可选）<input value={customVideoModel} onChange={(e) => setCustomVideoModel(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="留空则使用 vLLM-Omni 启动时的模型" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-zinc-500">创建路径<input value={customVideoCreatePath} onChange={(e) => setCustomVideoCreatePath(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="/v1/videos" /></label>
            <label className="block text-xs text-zinc-500">查询路径<input value={customVideoStatusPath} onChange={(e) => setCustomVideoStatusPath(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="/v1/videos/{id}" /></label>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-400">当前按 vLLM-Omni 协议：创建返回 <code>id</code>，查询到 <code>completed</code> 后从 <code>/v1/videos/{'{id}'}/content</code> 下载视频。</p>
          </>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="RunningHub" description="RunningHub 多媒体生成（MiniMax H3 渠道、视频/图片/音频/3D/AI应用）" defaultOpen={false}>
        <KeyInputRow
          label="RunningHub API Key"
          hint="runninghub.cn 企业 API Key；MiniMax H3 的渠道之一"
          value={rk('runninghub', runninghubApiKey)}
          onChange={setRunninghubApiKey}
          show={showKeys.has('runninghub')}
          onToggleShow={() => toggleShow('runninghub')}
          placeholder="输入 RunningHub API Key..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="火山方舟 Seedance" description="Seedance 视频生成服务（含 Seedance 2.5 / Seedream 5.0 模型目录）" defaultOpen={false}>
          <KeyInputRow
            label="火山方舟 API Key"
            hint="Seedance 视频生成 (ark.cn-beijing.volces.com)"
            value={rk('ark', arkApiKey)}
            onChange={setArkApiKey}
            show={showKeys.has('ark')}
            onToggleShow={() => toggleShow('ark')}
            placeholder="输入火山方舟 API Key..."
          />
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-zinc-900">Ark 模型目录</div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {arkModelsCache
                    ? `最后同步于 ${new Date(arkModelsCache.syncedAt).toLocaleString()}`
                    : '未同步过，当前使用内置模型目录（列表可能不是最新）'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSyncArkModels()}
                disabled={arkSyncing}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                {arkSyncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                同步模型列表
              </button>
            </div>
            {arkSyncError && (
              <p className="mt-2 text-[11px] text-zinc-500">同步失败：{arkSyncError}；已回退内置模型目录。</p>
            )}
            <select
              aria-label="Ark 可用模型列表"
              className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            >
              {arkModelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.id}
                  {m.status === 'retiring' ? '（即将下线）' : ''}
                  {m.source === 'cache' ? '' : '（内置）'}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-400">
              缓存（账号实测可用）在前，内置注册表在后；也可直接填用户自建接入点 ep-xxx。
            </p>
          </div>
      </CollapsibleSection>

      <CollapsibleSection title="Qwen3-TTS 角色音色" description="工坊「AI 生成音色」默认服务 · 95 本地模型" defaultOpen={false}>
        <label className="block text-xs text-zinc-500">服务地址
          <input value={qwen3TtsBaseUrl} onChange={(e) => setQwen3TtsBaseUrl(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs font-mono" placeholder="http://127.0.0.1:8815" />
        </label>
        <p className="mt-2 text-[11px] text-zinc-400">CustomVoice 使用预设音色并接受风格指令，不是 VoiceDesign。无需豆包 API Key；失败不会自动转到付费服务。不改变下方镜头配音与 ASR 通道。</p>
      </CollapsibleSection>

      <CollapsibleSection title="豆包语音" description="镜头配音与录音识别 ASR（不含角色音色生成）" defaultOpen={false}>
            <KeyInputRow
              label="豆包语音 API Key"
              hint="配音 + 录音识别 ASR (openspeech.bytedance.com)；ASR 需配合下方 COS"
              value={rk('doubaoSpeech', doubaoSpeechApiKey)}
              onChange={setDoubaoSpeechApiKey}
              show={showKeys.has('doubao-speech')}
              onToggleShow={() => toggleShow('doubao-speech')}
              placeholder="输入豆包语音 API Key..."
            />
            <div className="mt-2">
              <label className="block text-xs text-zinc-500 mb-1">配音通道</label>
              <div className="flex rounded-md bg-zinc-100 p-0.5">
                {([
                  { id: true, label: '筷子丽帧（推荐）', hint: 'seed_audio 配音，失败自动回退豆包官方' },
                  { id: false, label: '豆包官方', hint: '直连 openspeech.bytedance.com' },
                ] as const).map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSpeechKuaiziFirst(opt.id)}
                    title={opt.hint}
                    className={`min-w-[58px] rounded-[5px] px-2.5 py-1.5 text-center text-xs font-medium transition-colors ${
                      speechKuaiziFirst === opt.id
                        ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200/80'
                        : 'text-zinc-500 hover:text-zinc-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                默认走筷子丽帧 seed_audio 配音（用「筷子丽帧」区的 API Key），失败自动回退豆包官方；筷子通道使用本地参考音色需先在「存储与集成」配置腾讯云 COS。
              </p>
            </div>
      </CollapsibleSection>

      <CollapsibleSection title="HappyHorse" description="HappyHorse 视频生成服务" defaultOpen={false}>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Base URL</label>
                <input
                  type="text"
                  value={happyHorseBaseUrl}
                  onChange={(e) => setHappyHorseBaseUrl(e.target.value)}
                  className={inputCls}
                  placeholder="https://your-proxy.com"
                />
              </div>
              <KeyInputRow
                label="API Key"
                hint="HappyHorse 视频生成"
                value={rk('happyHorse', happyHorseApiKey)}
                onChange={setHappyHorseApiKey}
                show={showKeys.has('happyhorse')}
                onToggleShow={() => toggleShow('happyhorse')}
                placeholder="输入 HappyHorse API Key..."
              />
            </div>
      </CollapsibleSection>

      {/* Omni MG 渠道（并入视频与语音统一管理） */}
      <CollapsibleSection title="Omni MG 渠道" description="MG 动画与视频包装，默认按 ZexAPI → ZeroFall → APIMart 依次容灾（10s / 720p）" defaultOpen={false}>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] leading-relaxed text-zinc-600">
            这里仅配置密钥，调用顺序由内置智能路由管理。
          </div>
          <div className="mt-3 space-y-3">
            <KeyInputRow
              label="ZexAPI / Omni API Key"
              hint="ZexAPI 低价 10s 第一通道。"
              value={rk('omni', omniApiKey)}
              onChange={setOmniApiKey}
              show={showKeys.has('omni')}
              onToggleShow={() => toggleShow('omni')}
              placeholder="输入 ZexAPI / Omni API Key..."
            />
            <KeyInputRow
              label="ZeroFall Omni API Key"
              hint="第二路由：文生/图生用 omni-flash，视频编辑用 omni-flash-vref，10s / 720p。若出现 400，通常是 Google 因违规、版权或真人内容拒绝提示词。"
              value={rk('omniZeroFall', omniZeroFallApiKey)}
              onChange={setOmniZeroFallApiKey}
              show={showKeys.has('omni-zerofall')}
              onToggleShow={() => toggleShow('omni-zerofall')}
              placeholder="输入 ZeroFall Omni API Key..."
            />
            <KeyInputRow
              label="APIMart API Key"
              hint="同一密钥用于 Omni、Seedream 5 Pro、MiniMax H3 和 Midjourney。画布、工坊、剪辑与普通对话共用内置容灾路由。"
              value={rk('omniApimart', omniApimartApiKey)}
              onChange={setOmniApimartApiKey}
              show={showKeys.has('omni-apimart')}
              onToggleShow={() => toggleShow('omni-apimart')}
              placeholder="输入 APIMart API Key..."
            />
          </div>
      </CollapsibleSection>
      </>}

      {/* RunningHub */}
      {section === 'integrations' && <>

      {false && <CollapsibleSection title="多模态质量审核" description="多模态质量审核已停用，候选视频改为人工评审" defaultOpen>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3">
            <span>
              <span className="block text-sm text-zinc-700">启用生产质量门禁</span>
              <span className="mt-0.5 block text-[10px] text-zinc-500">首尾帧审核通过后才提交视频；审核失败最多按缺陷重绘三次。</span>
            </span>
            <ToggleSwitch enabled={qualityReviewEnabled} onChange={setQualityReviewEnabled} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-zinc-500">Base URL
              <input value={qualityReviewBaseUrl} onChange={(event) => setQualityReviewBaseUrl(event.target.value)} className={`${inputCls} mt-1 font-mono`} placeholder="http://127.0.0.1:30377" />
            </label>
            <label className="block text-xs text-zinc-500">模型
              <input value={qualityReviewModel} onChange={(event) => setQualityReviewModel(event.target.value)} className={`${inputCls} mt-1 font-mono`} placeholder="qwen3.8-27b" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-zinc-500">审核凭证
              <select
                value={credentialRefs.qualityReview ?? ''}
                onChange={(event) => setCredentialRef('qualityReview', event.target.value || null)}
                className={`${inputCls} mt-1`}
              >
                <option value="">不鉴权 / 尚未绑定</option>
                {credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-zinc-500">首尾帧最大尝试次数
              <select
                value={qualityReviewMaxFrameAttempts}
                onChange={(event) => setQualityReviewMaxFrameAttempts(Number(event.target.value))}
                className={`${inputCls} mt-1`}
              >
                <option value={1}>1 次</option>
                <option value={2}>2 次</option>
                <option value={3}>3 次</option>
              </select>
            </label>
          </div>
          <div>
            <label className="block text-xs text-zinc-500">多模态审核 API Key</label>
            <div className="mt-1 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  type={showKeys.has('quality-review') ? 'text' : 'password'}
                  value={qualityReviewApiKeyDraft}
                  onChange={(event) => setQualityReviewApiKeyDraft(event.target.value)}
                  className={`${inputCls} pr-9 font-mono`}
                  placeholder="输入审核服务 API Key…"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => toggleShow('quality-review')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-700"
                  aria-label={showKeys.has('quality-review') ? '隐藏 API Key' : '显示 API Key'}
                >
                  {showKeys.has('quality-review') ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleSaveQualityReviewApiKey}
                className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                保存并绑定
              </button>
              <button
                type="button"
                onClick={handleClearQualityReviewApiKey}
                className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-[11px] font-medium text-zinc-500 hover:border-red-200 hover:text-red-600"
              >
                清除
              </button>
            </div>
            <p className="mt-1 text-[10px] text-zinc-400">输入值只写入 API 凭证注册表；不会写入日志、项目文件或设置导出。</p>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-400">密钥只保存在“API 凭证”注册表中。审核服务按 OpenAI 兼容的 <span className="font-mono">/v1/chat/completions</span> 多模态协议调用。</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCheckQualityReview()}
              disabled={qualityReviewChecking}
              className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {qualityReviewChecking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              检查连接
            </button>
            {qualityReviewCheckMessage && <span className="text-[11px] text-zinc-500">{qualityReviewCheckMessage}</span>}
          </div>
        </div>
      </CollapsibleSection>}

      {/* Kimi 剪辑 Agent */}
      <CollapsibleSection title="Kimi 剪辑 Agent" description="参考视频拉片、剪辑计划与成片复盘" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">DMX Kimi 模型</label>
            <input
              type="text"
              value={kimiEditModel}
              onChange={(e) => setKimiEditModel(e.target.value)}
              className={inputCls}
              placeholder="kimi-k2.7-code-cc"
            />
            <p className="text-[10px] text-zinc-500 mt-0.5">留空默认使用 kimi-k2.7-code-cc，优先走 Anthropic /v1/messages 协议。</p>
          </div>
          <label className="flex items-center justify-between gap-3 p-3 bg-white border border-zinc-200/80 rounded-lg">
            <span>
              <span className="block text-sm text-zinc-700">优先让 Kimi 直接观看视频</span>
              <span className="block text-[10px] text-zinc-500 mt-0.5">视频先上传到 Kimi 文件服务；失败后自动使用密集关键帧和完整转写。</span>
            </span>
            <input
              type="checkbox"
              checked={kimiEditUseCos}
              onChange={(e) => setKimiEditUseCos(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-sky-500 focus:ring-sky-200"
            />
          </label>
        </div>
      </CollapsibleSection>

      {/* 腾讯云 COS */}
      <CollapsibleSection title="腾讯云 COS" description="素材上传到对象存储" defaultOpen={false}>
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Bucket</label>
            <input type="text" value={cosBucket} onChange={(e) => setCosBucket(e.target.value)} className={inputCls} placeholder="my-bucket-125000000" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Region</label>
            <input type="text" value={cosRegion} onChange={(e) => setCosRegion(e.target.value)} className={inputCls} placeholder="ap-guangzhou" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">SecretId</label>
            <input type="text" value={cosResolved.secretId} onChange={(e) => setCosSecretId(e.target.value)} className={inputCls} placeholder="AKID..." />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">SecretKey</label>
            <div className="relative">
              <input
                type={showKeys.has('cos') ? 'text' : 'password'}
                value={cosResolved.secretKey}
                onChange={(e) => setCosSecretKey(e.target.value)}
                className={inputCls + ' pr-9'}
                placeholder="输入 SecretKey..."
              />
              <button
                onClick={() => toggleShow('cos')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-700 transition-colors"
              >
                {showKeys.has('cos') ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">下载中转 Endpoint（SCF 云函数 URL）</label>
            <input type="text" value={cosTransitEndpoint} onChange={(e) => setCosTransitEndpoint(e.target.value)} className={inputCls} placeholder="https://xxx.tencentscf.com" />
            <p className="text-[10px] text-zinc-500 mt-0.5">视频下载通过云函数中转加速，留空则直连下载</p>
          </div>
        </div>
      </CollapsibleSection>
      </>}
    </div>
  );
}

// ── Reusable key input row ───────────────────────────────────────────────────

function KeyInputRow({
  label, hint, value, onChange, show, onToggleShow, placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 pr-9 text-sm outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
          placeholder={placeholder}
        />
        <button
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {hint && <p className="text-[11px] text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}

// ── Toggle switch ────────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        enabled ? 'bg-zinc-900' : 'bg-zinc-200'
      }`}
    >
      <motion.div
        className="absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white shadow-sm"
        animate={{ left: enabled ? 19 : 3 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  );
}

// ── Output Style (inline in General tab) ─────────────────────────────────────

function OutputStyleSection() {
  const outputStyle = useSettingsStore((s) => s.outputStyle);
  const setOutputStyle = useSettingsStore((s) => s.setOutputStyle);
  const styles: Array<{ id: typeof outputStyle; label: string; hint: string }> = [
    { id: 'default', label: '默认', hint: '平衡简洁' },
    { id: 'concise', label: '极简', hint: '一句话回答' },
    { id: 'verbose', label: '详尽', hint: '展示思考' },
    { id: 'coding', label: '编码', hint: '只输出代码' },
  ];
  return (
      <div className="flex rounded-md bg-zinc-100 p-0.5">
        {styles.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOutputStyle(s.id)}
            title={s.hint}
            className={`min-w-[58px] rounded-[5px] px-2.5 py-1.5 text-center text-xs font-medium transition-colors ${
              outputStyle === s.id
                ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200/80'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
  );
}
