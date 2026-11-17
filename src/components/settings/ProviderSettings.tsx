import { Fragment, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Pencil,
  XCircle,
  Zap,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveDshProviderRouting } from '@/lib/agent/dsh';
import { resolveApiKey } from '@/lib/credentials';
import {
  bootstrapProviders,
  getProvider,
  GLMProvider,
  DeepSeekProvider,
  KimiProvider,
  AnthropicCompatibleProvider,
  CustomOpenAIProvider,
  ANTHROPIC_PRESETS,
  getAnthropicPreset,
} from '@/lib/agent/providers';
import {
  CHAT_MODELS,
  CHAT_PROVIDER_LABELS,
  decodeChatModel,
  encodeChatModel,
  getDefaultModelId,
} from '@/lib/agent/modelCatalog';
import { moveProviderToIndex, orderedProviderIds } from '@/lib/agent/providers/providerPriority';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';
type ProviderSettingsMode = 'providers' | 'routing';

interface ProviderMeta {
  id: string;
  displayName: string;
  shortName: string;
  docUrl?: string;
  placeholder?: string;
  defaultBaseUrl: string;
  models: string[];
}

const KNOWN_PROVIDERS: ProviderMeta[] = [
  {
    id: 'custom',
    displayName: '自定义 OpenAI 兼容接口',
    shortName: '自定义',
    placeholder: '本地服务可填写任意占位 Key，例如 local-key',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    models: ['local-model'],
  },
  {
    id: 'glm',
    displayName: '智谱 GLM',
    shortName: 'GLM',
    docUrl: 'https://open.bigmodel.cn/',
    placeholder: '粘贴 GLM API Key',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: ['glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-4.6'],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    shortName: 'DS',
    docUrl: 'https://platform.deepseek.com/',
    placeholder: '粘贴 DeepSeek API Key (sk-...)',
    defaultBaseUrl: 'https://api.deepseek.com/anthropic',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4', 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'kimi',
    displayName: 'Kimi',
    shortName: 'K3',
    docUrl: 'https://www.kimi.com/code/console',
    placeholder: '粘贴 Kimi Code API Key',
    defaultBaseUrl: 'https://api.kimi.com/coding/',
    models: ['k3[1m]', 'k3'],
  },
  // 通用 Anthropic 兼容渠道（MiniMax / Qwen / 豆包），元数据与
  // providers/anthropic.ts 的 ANTHROPIC_PRESETS 保持同源。
  ...ANTHROPIC_PRESETS.map((preset) => ({
    id: preset.id,
    displayName: preset.displayName,
    shortName: preset.shortName,
    docUrl: preset.docUrl,
    placeholder: preset.keyPlaceholder,
    defaultBaseUrl: preset.defaultBaseUrl,
    models: preset.models.map((model) => model.id),
  })),
];

function instantiate(meta: ProviderMeta, apiKey: string, baseUrl?: string, modelId?: string) {
  switch (meta.id) {
    case 'glm':
      return new GLMProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
    case 'deepseek':
      return new DeepSeekProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
    case 'kimi':
      return new KimiProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
    default: {
      if (meta.id === 'custom') return new CustomOpenAIProvider({ apiKey, baseUrl, modelId });
      const preset = getAnthropicPreset(meta.id);
      return preset
        ? new AnthropicCompatibleProvider(preset, { apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined })
        : null;
    }
  }
}

function StatusIcon({ state }: { state: TestState }) {
  if (state === 'testing') return <Loader2 size={14} className="animate-spin" />;
  if (state === 'ok') return <CheckCircle2 size={14} className="text-emerald-600" />;
  if (state === 'fail') return <XCircle size={14} className="text-zinc-500" />;
  return <Zap size={14} />;
}

export default function ProviderSettings({ mode = 'providers' }: { mode?: ProviderSettingsMode }) {
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const setProviderApiKey = useSettingsStore((s) => s.setProviderApiKey);
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  // 读时经凭证注册表解析（优先 credentialId 引用，回退旧 providerApiKeys 字段）
  const resolveProviderKey = (id: string): string =>
    resolveApiKey({ credentials, credentialRefs }, `provider:${id}`, providerApiKeys[id] ?? '');
  const providerBaseUrls = useSettingsStore((s) => s.providerBaseUrls);
  const setProviderBaseUrl = useSettingsStore((s) => s.setProviderBaseUrl);
  const providerModels = useSettingsStore((s) => s.providerModels);
  const setProviderModel = useSettingsStore((s) => s.setProviderModel);
  const providerDefault = useSettingsStore((s) => s.providerDefault);
  const setProviderDefault = useSettingsStore((s) => s.setProviderDefault);
  const providerFallbackChain = useSettingsStore((s) => s.providerFallbackChain);
  const setProviderFallbackChain = useSettingsStore((s) => s.setProviderFallbackChain);

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<Record<string, TestState>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const reBootstrap = (
    keys: Record<string, string>,
    baseUrls: Record<string, string>,
    models: Record<string, string>,
  ) => {
    const anthropicEntries: Record<string, { apiKey?: string; baseUrl?: string; model?: string }> = {};
    for (const preset of ANTHROPIC_PRESETS) {
      anthropicEntries[preset.id] = {
        apiKey: keys[preset.id],
        baseUrl: baseUrls[preset.id],
        model: models[preset.id],
      };
    }
    bootstrapProviders({
      glmApiKey: keys.glm,
      glmBaseUrl: baseUrls.glm,
      glmModel: models.glm,
      deepseekApiKey: keys.deepseek,
      deepseekBaseUrl: baseUrls.deepseek,
      deepseekModel: models.deepseek,
      kimiApiKey: keys.kimi,
      kimiBaseUrl: baseUrls.kimi,
      kimiModel: models.kimi,
      anthropic: anthropicEntries,
      custom: {
        apiKey: keys.custom,
        baseUrl: baseUrls.custom,
        model: models.custom,
      },
    });
  };

  const handleKeyChange = (id: string, key: string) => {
    setProviderApiKey(id, key);
    reBootstrap({ ...providerApiKeys, [id]: key }, providerBaseUrls, providerModels);
    setTestState((prev) => ({ ...prev, [id]: 'idle' }));
  };

  const handleBaseUrlChange = (id: string, url: string) => {
    setProviderBaseUrl(id, url);
    reBootstrap(providerApiKeys, { ...providerBaseUrls, [id]: url }, providerModels);
    setTestState((prev) => ({ ...prev, [id]: 'idle' }));
  };

  const handleModelChange = (id: string, model: string) => {
    setProviderModel(id, model);
    reBootstrap(providerApiKeys, providerBaseUrls, { ...providerModels, [id]: model });
    setTestState((prev) => ({ ...prev, [id]: 'idle' }));
  };

  const handleTest = async (meta: ProviderMeta) => {
    const key = resolveProviderKey(meta.id);
    if (!key) {
      setTestState((prev) => ({ ...prev, [meta.id]: 'fail' }));
      return;
    }
    setTestState((prev) => ({ ...prev, [meta.id]: 'testing' }));
    try {
      // Always build the probe client from the values currently displayed in
      // the form. The registry may still contain the previous key/base URL
      // while a debounced settings write or provider bootstrap is in flight.
      const p = instantiate(
        meta,
        key,
        providerBaseUrls[meta.id],
        providerModels[meta.id],
      ) ?? getProvider(meta.id);
      const ok = p?.healthCheck ? await p.healthCheck() : true;
      setTestState((prev) => ({ ...prev, [meta.id]: ok ? 'ok' : 'fail' }));
    } catch {
      setTestState((prev) => ({ ...prev, [meta.id]: 'fail' }));
    }
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = [...providerFallbackChain];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setProviderFallbackChain(next);
    setDragId(null);
  };

  const toggleInChain = (id: string) => {
    setProviderFallbackChain(
      providerFallbackChain.includes(id)
        ? providerFallbackChain.filter((item) => item !== id)
        : [...providerFallbackChain, id],
    );
  };

  const handlePriorityDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    if (!resolveProviderKey(dragId).trim()) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const order = orderedProviderIds(
      providerDefault,
      providerFallbackChain,
      KNOWN_PROVIDERS.map((provider) => provider.id),
    ).filter((id) => resolveProviderKey(id).trim());
    if (!order.includes(targetId)) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const next = moveProviderToIndex(order, dragId, targetId);
    if (next.length === 0) return;
    setProviderDefault(next[0]);
    setProviderFallbackChain(next.slice(1));
    setDragId(null);
    setDragOverId(null);
  };

  if (mode === 'routing') {
    const globalModel = providerModels[providerDefault] || getDefaultModelId(providerDefault);
    const globalSelection = encodeChatModel(providerDefault, globalModel);
    const orderedProviders = [
      ...providerFallbackChain
        .map((id) => KNOWN_PROVIDERS.find((provider) => provider.id === id))
        .filter((provider): provider is ProviderMeta => Boolean(provider)),
      ...KNOWN_PROVIDERS.filter((provider) => !providerFallbackChain.includes(provider.id)),
    ];

    return (
      <div className="space-y-8">
        <section>
          <div className="mb-2.5">
            <h3 className="text-[13px] font-semibold text-zinc-900">默认语言模型</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">普通对话、画布、工坊和剪辑默认继承这里；各工作区可单独覆盖。</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3.5">
            <select
              value={globalSelection}
              onChange={(event) => {
                const selected = decodeChatModel(event.target.value);
                if (!selected) return;
                setProviderDefault(selected.providerId);
                handleModelChange(selected.providerId, selected.modelId);
              }}
              className="min-w-[280px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            >
              {Object.entries(CHAT_MODELS).map(([providerId, models]) => (
                <optgroup key={providerId} label={CHAT_PROVIDER_LABELS[providerId] || providerId}>
                  {models.map((model) => (
                    <option
                      key={encodeChatModel(providerId, model.value)}
                      value={encodeChatModel(providerId, model.value)}
                      disabled={!resolveProviderKey(providerId).trim()}
                    >
                      {model.label}{resolveProviderKey(providerId).trim() ? '' : '（未配置）'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </section>

        <section>
          <div className="mb-2.5">
            <h3 className="text-[13px] font-semibold text-zinc-900">语言模型降级链</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">拖动已启用的服务调整顺序；关闭后不会参与自动切换。</p>
          </div>
          <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {orderedProviders.map((meta) => {
              const enabled = providerFallbackChain.includes(meta.id);
              const position = providerFallbackChain.indexOf(meta.id);
              const configured = Boolean(resolveProviderKey(meta.id).trim());
              return (
                <div
                  key={meta.id}
                  draggable={enabled}
                  onDragStart={() => setDragId(meta.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDrop(meta.id)}
                  className={`flex min-h-[68px] items-center gap-3 px-4 py-3 transition-colors ${enabled ? 'bg-white' : 'bg-zinc-50/60'}`}
                >
                  <GripVertical size={15} className={enabled ? 'cursor-grab text-zinc-400' : 'text-zinc-300'} />
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-700">
                    {meta.shortName}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-zinc-900">{meta.displayName}</span>
                      {enabled && <span className="text-[10px] tabular-nums text-zinc-400">顺序 {position + 1}</span>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {configured ? '已配置密钥' : '未配置密钥，启用后也无法调用'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => toggleInChain(meta.id)}
                    className={`relative h-[22px] w-10 rounded-full transition-colors ${enabled ? 'bg-zinc-900' : 'bg-zinc-200'}`}
                    title={enabled ? '从降级链移除' : '加入降级链'}
                  >
                    <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  const selectedMeta = KNOWN_PROVIDERS.find((provider) => provider.id === selectedProviderId);
  // Harness runs any provider mapped to a pi-ai protocol; a provider without
  // one has no engine choice to offer.
  const selectedHarnessRouting = selectedMeta
    ? resolveDshProviderRouting({
      providerId: selectedMeta.id,
      baseUrl: providerBaseUrls[selectedMeta.id],
    })
    : undefined;
  if (selectedMeta) {
    const key = resolveProviderKey(selectedMeta.id);
    const baseUrl = providerBaseUrls[selectedMeta.id] ?? '';
    const model = providerModels[selectedMeta.id] ?? '';
    const shown = showKey[selectedMeta.id] ?? false;
    const state = testState[selectedMeta.id] ?? 'idle';

    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setSelectedProviderId(null)}
          className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-950"
        >
          <ArrowLeft size={14} />
          返回服务列表
        </button>

        <div className="flex items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-800">
              {selectedMeta.shortName}
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-zinc-950">{selectedMeta.displayName}</h3>
              <p className="mt-0.5 text-xs text-zinc-500">配置密钥、请求地址与默认模型，修改后自动保存。</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleTest(selectedMeta)}
            disabled={!key || state === 'testing'}
            className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
          >
            <StatusIcon state={state} />
            {state === 'ok' ? '连接正常' : state === 'fail' ? '连接失败' : '测试连接'}
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[13px] font-medium text-zinc-900">API Key</label>
              {selectedMeta.docUrl && (
                <a href={selectedMeta.docUrl} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-zinc-900 hover:underline">
                  获取 API Key
                </a>
              )}
            </div>
            <div className="relative">
              <input
                type={shown ? 'text' : 'password'}
                value={key}
                onChange={(event) => handleKeyChange(selectedMeta.id, event.target.value)}
                placeholder={selectedMeta.placeholder}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 pr-10 font-mono text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => ({ ...prev, [selectedMeta.id]: !prev[selectedMeta.id] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700"
                title={shown ? '隐藏密钥' : '显示密钥'}
              >
                {shown ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="border-b border-zinc-100 px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">请求地址</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(event) => handleBaseUrlChange(selectedMeta.id, event.target.value)}
              placeholder={selectedMeta.defaultBaseUrl}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            />
            <p className="mt-2 text-[11px] text-zinc-500">
              {selectedMeta.id === 'custom'
                ? '填写 API 根地址，例如 http://192.0.2.10:14000 或 /v1；不要填写 /responses、/models 等具体接口路径，程序会自动补齐。'
                : '留空时使用内置官方地址。'}
            </p>
          </div>

          <div className="border-b border-zinc-100 px-5 py-4 text-xs text-zinc-500">
            <strong className="text-zinc-900">DSH 执行引擎</strong>
            <p>{selectedHarnessRouting ? '所有助手任务统一使用 DSH；可自由选择本渠道模型。' : '本渠道尚未接通 DSH 协议，暂不能执行助手任务。'}</p>
          </div>

          <div className="px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">默认模型</label>
            <div className="flex gap-2">
              <select
                value={model && selectedMeta.models.includes(model) ? model : '__custom__'}
                onChange={(event) => {
                  if (event.target.value !== '__custom__') handleModelChange(selectedMeta.id, event.target.value);
                }}
                className="min-w-[210px] rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
              >
                {selectedMeta.models.map((item) => <option key={item} value={item}>{item}</option>)}
                <option value="__custom__">自定义模型</option>
              </select>
              <input
                type="text"
                value={model}
                onChange={(event) => handleModelChange(selectedMeta.id, event.target.value)}
                placeholder={selectedMeta.models[0]}
                className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const priorityOrder = orderedProviderIds(
    providerDefault,
    providerFallbackChain,
    KNOWN_PROVIDERS.map((provider) => provider.id),
  ).filter((id) => resolveProviderKey(id).trim());
  const prioritySet = new Set(priorityOrder);
  const configuredProviders = priorityOrder
    .map((id) => KNOWN_PROVIDERS.find((provider) => provider.id === id))
    .filter((meta): meta is ProviderMeta => Boolean(meta));
  const unconfiguredProviders = KNOWN_PROVIDERS.filter((provider) => !prioritySet.has(provider.id));
  const providerRows = [
    ...configuredProviders.map((meta) => ({ meta, configured: true })),
    ...unconfiguredProviders.map((meta) => ({ meta, configured: false })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-5">
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-900">语言模型服务</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">拖动已配置服务的左侧手柄调整优先级；第一位作为默认，其余依次作为备用。</p>
        </div>
        <span className="text-[11px] text-zinc-400">{configuredProviders.length} / {KNOWN_PROVIDERS.length} 已配置</span>
      </div>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {providerRows.map(({ meta, configured }, rowIndex) => {
          const state = testState[meta.id] ?? 'idle';
          const model = providerModels[meta.id] || meta.models[0];
          const baseUrl = providerBaseUrls[meta.id] || meta.defaultBaseUrl;
          const configuredIndex = configured ? priorityOrder.indexOf(meta.id) : -1;
          const startsUnconfiguredGroup = !configured && providerRows[rowIndex - 1]?.configured;
          const isDropTarget = configured && dragOverId === meta.id && dragId !== meta.id;
          return (
            <Fragment key={meta.id}>
              {startsUnconfiguredGroup && (
                <div className="bg-zinc-50/80 px-4 py-2 text-[10px] font-medium tracking-wide text-zinc-400">
                  未配置服务
                </div>
              )}
              <div
                onDragOver={(event) => {
                  if (!configured || !dragId || dragId === meta.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragOverId(meta.id);
                }}
                onDragLeave={() => setDragOverId((current) => current === meta.id ? null : current)}
                onDrop={(event) => {
                  if (!configured) return;
                  event.preventDefault();
                  handlePriorityDrop(meta.id);
                }}
                className={`group flex min-h-[88px] items-center gap-3 px-4 py-3.5 transition-colors ${isDropTarget ? 'bg-zinc-100 ring-1 ring-inset ring-zinc-300' : 'hover:bg-zinc-50/70'}`}
              >
                <div
                  role="button"
                  tabIndex={configured ? 0 : -1}
                  draggable={configured}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', meta.id);
                    setDragId(meta.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  className={`flex h-8 w-5 shrink-0 items-center justify-center rounded ${configured ? 'cursor-grab text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 active:cursor-grabbing' : 'cursor-not-allowed text-zinc-200'}`}
                  title={configured ? `拖动调整 ${meta.displayName} 的优先级` : '配置密钥后可调整优先级'}
                  aria-label={configured ? `拖动调整 ${meta.displayName} 的优先级` : `${meta.displayName} 尚未配置，不能调整优先级`}
                >
                  <GripVertical size={15} />
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700">
                  {meta.shortName}
                </div>
                <button type="button" onClick={() => setSelectedProviderId(meta.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-zinc-900">{meta.displayName}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${configured ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                      {configured ? '已配置' : '未配置'}
                    </span>
                    {configuredIndex === 0 && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">默认</span>}
                    {configuredIndex > 0 && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-600">优先 {configuredIndex + 1}</span>}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
                    <span className="shrink-0 font-mono">{model}</span>
                    <span className="text-zinc-300">·</span>
                    <span className="truncate font-mono">{baseUrl}</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleTest(meta)}
                  disabled={!configured || state === 'testing'}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white hover:text-zinc-800 disabled:opacity-30"
                  title="测试连接"
                >
                  <StatusIcon state={state} />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProviderId(meta.id)}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                >
                  <Pencil size={13} />
                  编辑
                </button>
                <ChevronRight size={15} className="text-zinc-300 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export const PROVIDER_OPTIONS = KNOWN_PROVIDERS.map((provider) => ({
  id: provider.id,
  displayName: provider.displayName,
}));
