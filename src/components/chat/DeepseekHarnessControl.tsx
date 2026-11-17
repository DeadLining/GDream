import { Activity } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDeepseekHarnessStore } from '@/stores/deepseekHarnessStore';
import { resolveDshProviderRouting } from '@/lib/agent/dsh';
interface Props {
  providerId: string;
  variant?: 'dark' | 'light';
  disabled?: boolean;
  compact?: boolean;
}
/** Status only: DSH is the only execution engine, never a mode toggle. */
export default function DeepseekHarnessControl({ providerId, variant = 'light' }: Props) {
  const baseUrl = useSettingsStore(s => s.providerBaseUrls[providerId]);
  const running = useDeepseekHarnessStore(s => Object.keys(s.runs).length > 0);
  const supported = !!resolveDshProviderRouting({ providerId, baseUrl });
  const label = !supported ? 'DSH 未适配' : running ? 'DSH 运行中' : 'DSH';
  return <span role="status" title={supported ? '任务统一由 DSH 执行，模型可单独选择' : '所选渠道尚未接通 DSH 协议'}
    className="flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[10.5px]"
    style={{ color: variant === 'dark' ? 'var(--canvas-text-2)' : 'rgb(var(--c-text-muted))', borderColor: 'rgba(128,128,128,0.2)' }}>
    <Activity size={11} className={running ? 'animate-pulse' : ''} />{label}
  </span>;
}
