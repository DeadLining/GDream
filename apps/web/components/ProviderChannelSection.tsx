'use client';

import type {ProviderChannelKind, ProviderChannelTestResult, ProviderChannelUpdate} from '../lib/types';

export type ProviderChannelDraft = ProviderChannelUpdate & {
  api_key_configured: boolean;
  api_key_masked: string;
};

type Props = {
  kind: ProviderChannelKind;
  label: string;
  draft: ProviderChannelDraft;
  testing: boolean;
  disabled: boolean;
  testResult: ProviderChannelTestResult | null;
  testError: string;
  validationError: string;
  onChange: (draft: ProviderChannelDraft) => void;
  onTest: () => void;
};

export function ProviderChannelSection({kind, label, draft, testing, disabled, testResult, testError, validationError, onChange, onTest}: Props) {
  const update = <Key extends keyof ProviderChannelDraft>(key: Key, value: ProviderChannelDraft[Key]) =>
    onChange({...draft, [key]: value});
  const statusId = `provider-${kind}-status`;
  const resultState = testError || testResult?.status === 'failed' ? 'failure' : testResult?.status === 'ok' ? 'success' : '';

  return (
    <form className="provider-channel-section" aria-label={`${label}渠道`} onSubmit={event => {event.preventDefault(); onTest();}}>
      <fieldset disabled={disabled}>
      <div className="provider-section-heading">
        <h2>{label}</h2>
        <label className="provider-enabled">
          <input type="checkbox" checked={draft.enabled} onChange={event => update('enabled', event.target.checked)}/>
          <span>启用{label}渠道</span>
        </label>
      </div>
      <label>{label}渠道名称<input value={draft.name} onChange={event => update('name', event.target.value)} autoComplete="off"/></label>
      <label>{label} Base URL<input type="url" value={draft.base_url} onChange={event => update('base_url', event.target.value)} autoComplete="url"/></label>
      <label>{label}模型<input value={draft.model} onChange={event => update('model', event.target.value)} autoComplete="off"/></label>
      {kind === 'tts' && <label>{label} SSH Host<input value={draft.ssh_host} onChange={event => update('ssh_host', event.target.value)} autoComplete="off"/></label>}
      <div className="provider-key-control">
        <label>{draft.api_key_configured && !draft.clear_api_key ? `${label} API Key（当前 ${draft.api_key_masked}）` : `${label} API Key（未配置）`}
          <input
            type="password"
            aria-label={`替换${label} API Key`}
            value={draft.api_key}
            onChange={event => onChange({...draft, api_key: event.target.value, clear_api_key: false})}
            autoComplete="new-password"
          />
        </label>
        <button type="button" onClick={() => onChange({...draft, api_key: '', clear_api_key: !draft.clear_api_key})} aria-pressed={draft.clear_api_key}>
          {draft.clear_api_key ? `保留${label} API Key` : `清除${label} API Key`}
        </button>
      </div>
      {validationError && <p className="form-error" role="alert">{validationError}</p>}
      <div className="provider-test-row">
        <button type="submit" disabled={testing || disabled} aria-describedby={statusId}>{testing ? '正在测试' : `测试${label}连接`}</button>
        <p id={statusId} className={`provider-test-result${resultState ? ` ${resultState}` : ''}`} role={resultState === 'failure' ? 'alert' : 'status'} aria-live={resultState === 'failure' ? 'assertive' : 'polite'}>
          {testResult?.status === 'ok' && `连接成功，${testResult.host}，${testResult.elapsed_ms} ms`}
          {testResult?.status === 'failed' && (testResult.error || '连接失败')}
          {testError}
        </p>
      </div>
      </fieldset>
    </form>
  );
}
