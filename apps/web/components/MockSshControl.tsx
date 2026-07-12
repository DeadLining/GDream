'use client';

import {Play, RefreshCw, Square} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {getMockSshHosts, getMockSshStatus, startMockSsh, stopMockSsh} from '../lib/api';
import type {MockSshHost, MockSshState, MockSshStatus} from '../lib/types';

const SAFE_IDENTIFIER = /^[A-Za-z0-9._-]{1,64}$/;
const labels: Record<MockSshState, string> = {stopped: '已停止', starting: '启动中', running: '运行中', stopping: '停止中', failed: '启动失败'};
const emptyStatus: MockSshStatus = {desired_running: false, state: 'stopped', host_id: null, alias: null, port: null, error: null, reused: false};
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

export function MockSshControl() {
  const [hosts, setHosts] = useState<MockSshHost[]>([]);
  const [status, setStatus] = useState<MockSshStatus | null>(null);
  const [hostId, setHostId] = useState('');
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [operation, setOperation] = useState<'start' | 'stop' | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const operationRef = useRef<'start' | 'stop' | null>(null);

  const load = async () => {
    const current = ++generation.current;
    setLoading(true);
    setLoadError('');
    setActionError('');
    const [hostResult, statusResult] = await Promise.allSettled([getMockSshHosts(), getMockSshStatus()]);
    if (!mounted.current || current !== generation.current) return;
    const nextHosts = hostResult.status === 'fulfilled' ? hostResult.value : [];
    const nextStatus = statusResult.status === 'fulfilled' ? statusResult.value : null;
    setHosts(nextHosts);
    if (nextStatus) {
      setStatus(nextStatus);
      setUncertain(false);
      if (nextStatus.host_id) setHostId(nextStatus.host_id);
      if (nextStatus.alias) setAlias(nextStatus.alias);
    } else setUncertain(true);
    if (!nextStatus?.host_id && nextHosts.length) setHostId(nextHosts.some(host => host.id === 'a800_94') ? 'a800_94' : nextHosts[0].id);
    if (!nextStatus?.alias && nextHosts.some(host => host.id === 'a800_94')) setAlias('ai-comic-tts');
    const errors = [
      hostResult.status === 'rejected' ? message(hostResult.reason, 'Mock SSH 主机加载失败') : '',
      statusResult.status === 'rejected' ? message(statusResult.reason, 'Mock SSH 状态加载失败') : '',
    ].filter(Boolean);
    if (!errors.length && !nextHosts.length) errors.push('没有可用的 HostBridge 主机');
    if (nextStatus?.error) errors.push(nextStatus.error);
    setLoadError(errors.join('；'));
    setLoading(false);
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {mounted.current = false; generation.current += 1; operationRef.current = null;};
  }, []);

  const begin = async () => {
    if (operationRef.current || status?.state === 'running' || status?.state === 'starting') return;
    setValidationError(''); setActionError('');
    if (!hostId || !SAFE_IDENTIFIER.test(hostId) || !hosts.some(host => host.id === hostId)) {setValidationError('请选择有效的 HostBridge 主机'); return;}
    if (!SAFE_IDENTIFIER.test(alias)) {setValidationError('Alias 仅允许 1-64 位字母、数字、点、下划线或连字符'); return;}
    const current = ++generation.current;
    const confirmedStatus = status;
    operationRef.current = 'start'; setOperation('start');
    setStatus(previous => ({...(previous ?? emptyStatus), desired_running: true, state: 'starting', host_id: hostId, alias, error: null, reused: false}));
    try {
      const next = await startMockSsh({host_id: hostId, alias});
      if (!mounted.current || current !== generation.current) return;
      setStatus(next); if (next.host_id) setHostId(next.host_id); if (next.alias) setAlias(next.alias);
      try {
        const authoritative = await getMockSshStatus();
        if (!mounted.current || current !== generation.current) return;
        setStatus({...authoritative, reused: next.reused});
        if (authoritative.host_id) setHostId(authoritative.host_id);
        if (authoritative.alias) setAlias(authoritative.alias);
        setActionError(authoritative.error ?? '');
      } catch (error) {
        if (!mounted.current || current !== generation.current) return;
        setActionError(`Mock SSH 已启动，但状态同步失败：${message(error, '无法读取最新状态')}`);
      }
    } catch (error) {
      if (!mounted.current || current !== generation.current) return;
      const detail = message(error, 'Mock SSH 启动失败');
      try {
        const authoritative = await getMockSshStatus();
        if (!mounted.current || current !== generation.current) return;
        setStatus(authoritative);
        if (authoritative.host_id) setHostId(authoritative.host_id);
        if (authoritative.alias) setAlias(authoritative.alias);
        setUncertain(false);
        setActionError(`启动请求未确认，已同步最新状态：${detail}`);
      } catch {
        if (!mounted.current || current !== generation.current) return;
        setStatus(confirmedStatus);
        setUncertain(true);
        setActionError('无法确认 Mock SSH 最新状态，请刷新重试。');
      }
    } finally {
      if (mounted.current && current === generation.current) {operationRef.current = null; setOperation(null);}
    }
  };

  const stop = async () => {
    if (operationRef.current || status?.state !== 'running') return;
    const current = ++generation.current;
    const confirmedStatus = status;
    operationRef.current = 'stop'; setOperation('stop'); setActionError(''); setValidationError('');
    setStatus(previous => ({...(previous ?? emptyStatus), desired_running: false, state: 'stopping', error: null, reused: false}));
    try {
      const next = await stopMockSsh();
      if (!mounted.current || current !== generation.current) return;
      setStatus(next);
      try {
        const authoritative = await getMockSshStatus();
        if (!mounted.current || current !== generation.current) return;
        setStatus(authoritative);
        setActionError(authoritative.error ?? '');
      } catch (error) {
        if (!mounted.current || current !== generation.current) return;
        setActionError(`Mock SSH 已停止，但状态同步失败：${message(error, '无法读取最新状态')}`);
      }
    } catch (error) {
      if (!mounted.current || current !== generation.current) return;
      const detail = message(error, 'Mock SSH 停止失败');
      try {
        const authoritative = await getMockSshStatus();
        if (!mounted.current || current !== generation.current) return;
        setStatus(authoritative);
        setUncertain(false);
        setActionError(`停止请求未确认，已同步最新状态：${detail}`);
      } catch {
        if (!mounted.current || current !== generation.current) return;
        setStatus(confirmedStatus);
        setUncertain(true);
        setActionError('无法确认 Mock SSH 最新状态，请刷新重试。');
      }
    } finally {
      if (mounted.current && current === generation.current) {operationRef.current = null; setOperation(null);}
    }
  };

  const state = status?.state ?? 'stopped';
  const busy = operation !== null || state === 'starting' || state === 'stopping';
  return (
    <section className="mock-ssh-control" aria-labelledby="mock-ssh-heading">
      <div className="mock-ssh-heading">
        <h2 id="mock-ssh-heading">Mock SSH 桥接</h2>
        <button className="icon-button" type="button" title="刷新 Mock SSH 状态" aria-label="刷新 Mock SSH 状态" onClick={() => void load()} disabled={busy}><RefreshCw size={16} aria-hidden="true"/></button>
      </div>
      {loading && !status ? <p className="mock-ssh-loading" role="status">正在加载 Mock SSH 状态</p> : <div className="mock-ssh-body">
        <div className="mock-ssh-fields">
          <label>HostBridge 主机<select value={hostId} onChange={event => {setHostId(event.target.value); setValidationError('');}} disabled={busy || !hosts.length}>
            {!hosts.length && <option value="">无可用主机</option>}
            {hostId && !hosts.some(host => host.id === hostId) && <option value={hostId}>{hostId}</option>}
            {hosts.map(host => <option key={host.id} value={host.id}>{host.name} ({host.id})</option>)}
          </select></label>
          <label>SSH Alias<input value={alias} maxLength={64} autoComplete="off" spellCheck={false} onChange={event => {setAlias(event.target.value); setValidationError('');}} disabled={busy}/></label>
        </div>
        <div className="mock-ssh-status" aria-live="polite"><span className={`mock-ssh-indicator ${uncertain ? 'unknown' : state}`} aria-hidden="true"/><strong>{uncertain ? '状态未知' : labels[state]}</strong>
          {!uncertain && state === 'running' && status?.alias && status.port ? <code>{status.alias} :{status.port}</code> : null}
          {!uncertain && status?.reused && state === 'running' ? <span role="status">已复用现有桥接</span> : null}
        </div>
        <div className="mock-ssh-actions">
          <button className="command-button" type="button" onClick={() => void begin()} disabled={uncertain || (loading && !status) || busy || state === 'running' || !hosts.length} title="启动 Mock SSH"><Play size={15} aria-hidden="true"/>启动 Mock SSH</button>
          <button type="button" onClick={() => void stop()} disabled={uncertain || busy || state !== 'running'} title="停止 Mock SSH"><Square size={14} aria-hidden="true"/>停止 Mock SSH</button>
        </div>
      </div>}
      {(validationError || actionError || loadError) && <p className="mock-ssh-error" role="alert">{validationError || actionError || loadError}</p>}
    </section>
  );
}
