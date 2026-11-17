"""Read-only offline DSH trace/decision triage; stdlib only, no network or executor.

Only formal tool/call and tool/result events count. Physical order is retained:
late events are linked for trace accounting but never backfilled into snapshots.
Draft candidate actions are NOT verified permissions, predictions, or gold labels.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter
from pathlib import Path

VERSION = 'dsh-decision-audit-v1'
EVIDENCE_TOOLS = {'web_search', 'web_fetch', 'workshop_read_source'}
STATE_TOOLS = {'workshop_get_state', 'project_get_paths'}
SECRET_KEY = r'(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie)'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def redact(text):
    """Best-effort defense, NOT certification that arbitrary prose is public-safe."""
    text = str(text)
    text = re.sub(r'(?im)\b(?:authorization|cookie)\s*:\s*[^\r\n]+', '[REDACTED_HEADER]', text)
    text = re.sub(r'(?i)(["\']?' + SECRET_KEY + r'["\']?\s*[:=]\s*)(?:"[^"\n]*"|\'[^\'\n]*\'|[^\s,;}]+)',
                  r'\1[REDACTED]', text)
    text = re.sub(r'(?i)\bBearer\s+\S+', 'Bearer [REDACTED]', text)
    text = re.sub(r'\b(?:sk-|sk_|AKIA)[A-Za-z0-9_-]{12,}', '[REDACTED_KEY]', text)
    text = re.sub(r'https?://[^\s<>"\']+', '[URL_OMITTED]', text)
    text = re.sub(r'(?:/Users/|/home/|/gpu\d+/)[^\s<>"\']+', '[LOCAL_PATH]', text)
    return text


def project_id(value):
    if not isinstance(value, dict):
        return None
    nested = value.get('project')
    current = value.get('current')
    candidates = [value.get('projectId'), value.get('project_id'),
                  nested.get('id') if isinstance(nested, dict) else None,
                  current.get('aigc_project_id') if isinstance(current, dict) else None]
    return next((v for v in candidates if isinstance(v, str) and v.startswith('proj-')), None)


def state_from_text(text):
    """Recognize the actual paging envelope; only offset=0 carries identity.

    Never scrape a project ID from arbitrary prose or a later fragment. A partial
    first page may contain a complete project object even though its body is cut.
    """
    decoder = json.JSONDecoder()
    try:
        value, _ = decoder.raw_decode(text.lstrip())
        if not isinstance(value, dict):
            return {}
        if 'output_id' not in value:
            return value
        if value.get('offset') != 0:
            return {'_paged': True}
        parts = text.split('\n', 2)
        if len(parts) != 3 or not parts[1].startswith('[状态快照分页'):
            return {'_paged': True}
        body = parts[2].lstrip()
        prefix = re.match(r'^\{\s*"open"\s*:\s*true\s*,\s*"project"\s*:\s*', body)
        if not prefix:
            return {'_paged': True}
        project, _ = decoder.raw_decode(body[prefix.end():])
        return {'project': project, '_paged': True}
    except (ValueError, TypeError):
        return {}


def action(identifier):
    descriptions = {
        'refresh_state_before_retry': '先读取当前状态与版本；不执行重试或写入',
        'repair_current_payload_before_retry': '交给规划器修正当前参数；不自动提交',
        'stop_without_retry': '停止自动尝试并核对阻塞原因',
        'inspect_source': '检查现有来源是否支持当前事实需求',
        'search_missing_fact': '在明确缺失事实后规划补查；不自动联网',
        'inspect_visual_evidence': '交给具有图像输入能力的审核环节',
        'escalate_to_planner': '证据不足或候选不适用，交回规划器',
        'observe_only': '仅记录既有回执，不据此授权推进',
    }
    return {'id': identifier, 'description': descriptions[identifier],
            'executable': False, 'permission': 'not_evaluated'}


def triage(name, text, status, repeated=False):
    """Transparent lexical triage; never a semantic model or full GDream baseline."""
    category, reason, selected = 'insufficient_evidence', 'no_narrow_semantic_question', 'escalate_to_planner'
    candidates = [selected]
    if status == 'error':
        if repeated:
            category, reason, selected = 'deterministic', 'repeated_identical_failure', 'stop_without_retry'
        elif re.search(r'workUnitId|revision|快照.*过期|正文已变化', text, re.I):
            category, reason, selected = 'deterministic', 'stale_state', 'refresh_state_before_retry'
        elif re.search(r'缺少结构化字段|必填|缺少.*参数|invalid.*parameter|schema', text, re.I):
            category, reason, selected = 'deterministic', 'invalid_payload', 'repair_current_payload_before_retry'
        elif re.search(r'尚未导入剧本源文件|用户拒绝|用户取消|被禁止|提交结果未知|可能.*扣费', text):
            category, reason, selected = 'deterministic', 'gate_or_authorization', 'stop_without_retry'
        else:
            category, reason = 'complex_planning', 'unclassified_failure_needs_inspection'
        candidates = [selected]
    elif status == 'unknown':
        reason = 'missing_result_status'
    elif name in {'read_image', 'workshop_get_production_audit'}:
        category, reason, selected = 'visual' if name == 'read_image' else 'insufficient_evidence', 'text_is_not_quality_review', 'escalate_to_planner'
        candidates = [selected]
    elif name == 'workshop_read_source' and state_from_text(text).get('files') == []:
        category, reason, selected = 'deterministic', 'empty_source_list', 'observe_only'
        candidates = [selected]
    elif name in EVIDENCE_TOOLS:
        category, reason, selected = 'semantic', 'evidence_sufficiency_or_support_hypothesis', 'inspect_source'
        candidates = ['inspect_source', 'search_missing_fact', 'escalate_to_planner']
    elif name.startswith('workshop_') or name in STATE_TOOLS:
        category, reason, selected = 'deterministic', 'receipt_only_no_model_needed', 'observe_only'
        candidates = [selected]
    return ({'category': category, 'reason': reason, 'method': 'lexical_triage_not_gold'},
            [action(x) for x in candidates],
            {'name': 'conservative_offline_rules_v1', 'action': selected, 'call_model': False,
             'reason': reason, 'is_full_gdream_baseline': False})


def extract_session(path, target_project=None, max_line_bytes=8_000_000):
    path = Path(path)
    calls, results, decisions, diagnostics = {}, {}, [], []
    counts = Counter()
    active_project = None
    scope_epoch = 0
    last_seq = None
    incomplete = False
    uncertain_order = False
    session_id = path.parent.name
    failures = Counter()
    history = []
    result_ids = set()

    def diagnose(kind, line):
        diagnostics.append({'kind': kind, 'line': line})

    def check_sequence(seq, line):
        nonlocal last_seq, uncertain_order
        if isinstance(seq, int):
            if last_seq is not None and seq < last_seq:
                uncertain_order = True
                diagnose('out_of_order_sequence', line)
            last_seq = max(last_seq if last_seq is not None else seq, seq)


    with path.open('rb') as stream:
        line_no = 0
        while raw := stream.readline(max_line_bytes + 1):
            line_no += 1
            if len(raw) > max_line_bytes:
                while raw and not raw.endswith(b'\n'):
                    raw = stream.readline(max_line_bytes + 1)
                counts['oversized_lines'] += 1
                diagnose('oversized_line', line_no)
                incomplete, active_project = True, None
                scope_epoch += 1
                continue
            try:
                event = json.loads(raw)
                if not isinstance(event, dict):
                    raise ValueError('non-object')
            except (ValueError, UnicodeError):
                counts['malformed_lines'] += 1
                diagnose('malformed_line', line_no)
                incomplete, active_project = True, None
                scope_epoch += 1
                continue
            kind = event.get('type')
            data = event.get('data', {})
            if kind == 'session':
                if calls:
                    diagnose('session_boundary_in_file', line_no)
                    incomplete, active_project = True, None
                    scope_epoch += 1
                elif isinstance(event.get('id'), str):
                    session_id = event['id']
                continue
            if kind not in {'tool/call', 'tool/result'}:
                continue
            if not isinstance(data, dict):
                diagnose('invalid_event_shape', line_no)
                incomplete = True
                continue
            seq = event.get('seq')
            if kind == 'tool/call':
                cid, name = data.get('callId'), data.get('name')
                if not isinstance(cid, str) or not isinstance(name, str):
                    diagnose('invalid_call', line_no)
                    incomplete = True
                    continue
                signature = fingerprint(data)
                if cid in calls:
                    counts['duplicate_calls'] += 1
                    if calls[cid]['signature'] != signature:
                        diagnose('conflicting_duplicate', line_no)
                    continue
                check_sequence(seq, line_no)
                args, invalid = data.get('arguments', {}), False
                try:
                    args = json.loads(args) if isinstance(args, str) else args
                    if not isinstance(args, dict):
                        raise ValueError('non-object arguments')
                except (ValueError, TypeError):
                    args, invalid = {}, True
                explicit = project_id(args)
                calls[cid] = {'call_id': cid, 'tool': name.removeprefix('mcp__gdream__'),
                              'call_line': line_no, 'call_seq': seq, 'time': event.get('time'),
                              'turn': data.get('turn'), 'step': data.get('step'),
                              'project_id': explicit or active_project,
                              'attribution': 'explicit_argument' if explicit else 'observed_scope' if active_project else 'unknown',
                              'scope_epoch': scope_epoch, 'argument_fields': sorted(redact(k)[:80] for k in args),
                              'invalid_arguments': invalid, 'signature': signature}
                continue
            message = data.get('message', {})
            blocks = message.get('content', []) if isinstance(message, dict) else []
            if not isinstance(blocks, list):
                blocks = []
            if not any(isinstance(b, dict) and b.get('type') == 'tool-result' for b in blocks):
                diagnose('invalid_result', line_no)
                incomplete = True
            for block in blocks:
                if not isinstance(block, dict) or block.get('type') != 'tool-result':
                    continue
                cid = block.get('toolCallId')
                if not isinstance(cid, str):
                    diagnose('invalid_result', line_no)
                    incomplete = True
                    continue
                signature = fingerprint(block)
                if cid in results:
                    counts['duplicate_results'] += 1
                    if results[cid]['signature'] != signature:
                        diagnose('conflicting_duplicate', line_no)
                    continue
                check_sequence(seq, line_no)
                content = block.get('content', [])
                text = '\n'.join(x['text'] for x in content if isinstance(x, dict)
                                 and x.get('type') == 'text' and isinstance(x.get('text'), str)) if isinstance(content, list) else ''
                status = 'error' if block.get('isError') is True else 'success' if block.get('isError') is False else 'unknown'
                results[cid] = {'result_line': line_no, 'result_seq': seq, 'status': status, 'signature': signature}
                if cid not in calls:
                    diagnose('orphan_result_no_snapshot', line_no)
                    continue
                c = calls[cid]
                name = c['tool']
                observed = {}
                if status == 'success' and name in STATE_TOOLS:
                    observed = state_from_text(text)
                    pid = project_id(observed)
                    if pid and c['scope_epoch'] == scope_epoch:
                        if active_project != pid:
                            scope_epoch += 1
                        active_project = pid
                        c['project_id'], c['attribution'], c['scope_epoch'] = pid, 'structured_state_result', scope_epoch
                    elif observed.get('open') is False:
                        active_project = None
                        scope_epoch += 1
                pid = c['project_id']
                key = (pid, name, text.strip())
                if status == 'error':
                    failures[key] += 1
                elif status == 'success':
                    for old in list(failures):
                        if old[:2] == (pid, name):
                            del failures[old]
                classification, candidates, baseline = triage(name, text, status, failures[key] >= 2)
                unknowns = ['goal_not_reconstructed', 'permissions_not_reconstructed', 'historical_revision_not_reconstructed']
                if observed.get('_paged'):
                    unknowns.append('state_body_not_reconstructed')
                if pid is None:
                    unknowns.append('project_unknown')
                if incomplete:
                    unknowns.append('incomplete_history')
                if uncertain_order:
                    unknowns.append('ordering_uncertain')
                if c['invalid_arguments']:
                    unknowns.append('invalid_arguments')
                if c['scope_epoch'] != scope_epoch:
                    unknowns.append('project_changed_while_in_flight')
                pending = [x for x in calls if x != cid and x not in results]
                if pending:
                    unknowns.append('parallel_calls_in_flight')
                excerpt = redact(text)[:900] if name in EVIDENCE_TOOLS or status == 'error' else '[ordinary result omitted; inspect source locally]'
                inputs = {'schema_version': VERSION, 'decision_point': 'after_tool_result',
                          'source': {'session_id': session_id, 'call_id': cid, 'call_line': c['call_line'],
                                     'result_line': line_no, 'seq': seq, 'turn': c['turn'], 'step': c['step']},
                          'project_id': pid, 'attribution': c['attribution'],
                          'observation': {'tool': name, 'status': status, 'excerpt': excerpt,
                                          'text_truncated': len(redact(text)) > 900},
                          'prior_observations': [h for h in history if h['project_id'] == pid][-6:],
                          'in_flight_call_ids': pending, 'unknowns': unknowns,
                          'candidate_actions': candidates, 'candidate_set_verified': False}
                decision = {'decision_id': fingerprint([session_id, cid, line_no])[:24],
                            'input': inputs, 'context_fingerprint': fingerprint(inputs),
                            'triage': classification, 'baseline': baseline}
                if target_project is None or pid == target_project:
                    decisions.append(decision)
                history.append({'call_id': cid, 'tool': name, 'status': status, 'result_line': line_no, 'project_id': pid})
                result_ids.add(cid)
    trace = []
    for cid, c in calls.items():
        row = {k: v for k, v in c.items() if k not in {'signature', 'scope_epoch', 'invalid_arguments'}}
        r = results.get(cid)
        row.update({k: v for k, v in r.items() if k != 'signature'} if r else {'status': 'missing_result'})
        row['snapshot_available'] = cid in result_ids
        trace.append(row)
    outcomes = []
    for d in decisions:
        current_line = d['input']['source']['result_line']
        # Observed temporal successor is NOT a causal action or ground truth.
        future = next((c for c in calls.values() if c['call_line'] > current_line), None)
        outcomes.append({'decision_id': d['decision_id'], 'relation': 'next_observed_call_not_causal',
                         'next_call': {k: future[k] for k in ['call_id', 'tool', 'call_line', 'project_id']} if future else None})
    stats = {k: counts[k] for k in ['duplicate_calls', 'duplicate_results', 'malformed_lines', 'oversized_lines']}
    stats.update({'calls': len(calls), 'results': len(results), 'decisions': len(decisions),
                  'errors': sum(r['status'] == 'error' for r in results.values()),
                  'missing_results': sum(cid not in results for cid in calls),
                  'orphan_results': sum(cid not in calls for cid in results)})
    return {'session_id': session_id, 'trace': trace, 'decisions': decisions, 'outcomes': outcomes,
            'diagnostics': diagnostics, 'stats': stats,
            'evaluation_ready': False,  # requires independently reviewed snapshots, candidates AND labels
            'integrity_ok': not diagnostics}


def run_audit(paths, output, target_project=None):
    output = Path(output).expanduser().absolute()
    resolved = [Path(p).expanduser().resolve(strict=True) for p in paths]
    if len(resolved) != len(set(resolved)):
        raise ValueError('duplicate input paths')
    # Never write into a source directory, nor below symlinked ancestors.
    if output != output.resolve():
        raise ValueError('output must not traverse symlinks')
    protected = [Path.home() / '.gdream', Path(__file__).resolve().parents[2]]
    if any(output == p or p in output.parents for p in protected):
        raise ValueError('output must be outside production data and the GDream repository')
    for p in resolved:
        if output == p.parent or p.parent in output.parents:
            raise ValueError('output must be outside source session directories')
    records = []
    manifest = []
    for p in resolved:
        def digest():
            with p.open('rb') as f:
                return hashlib.file_digest(f, 'sha256').hexdigest()
        before = digest()
        record = extract_session(p, target_project)
        if digest() != before:
            raise RuntimeError('input changed during extraction; use a quiescent session')
        records.append(record)
        manifest.append({'session_id': record['session_id'], 'source_path': str(p), 'sha256': before,
                         'stats': record['stats'], 'diagnostics': record['diagnostics']})
    output.mkdir(mode=0o700, parents=True, exist_ok=False)

    def write(name, text):
        with (output / name).open('x', encoding='utf-8') as f:
            os.chmod(f.name, 0o600)
            f.write(text)

    def jsonl(name, rows):
        write(name, ''.join(canonical(row) + '\n' for row in rows))

    decisions = [d for r in records for d in r['decisions']]
    jsonl('decisions.jsonl', decisions)
    jsonl('trace.jsonl', ({'session_id': r['session_id'], **t} for r in records for t in r['trace']))
    jsonl('outcomes.jsonl', (o for r in records for o in r['outcomes']))
    jsonl('labels.jsonl', ({'decision_id': d['decision_id'], 'status': 'unlabeled', 'acceptable_actions': None,
                          'preferred_action': None, 'forbidden_actions': None, 'evidence': []} for d in decisions))
    jsonl('predictions.jsonl', ())
    write('sources.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    categories = Counter(d['triage']['category'] for d in decisions)
    reasons = Counter(d['triage']['reason'] for d in decisions)
    summary = {'schema_version': VERSION,
               'implementation_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'target_project': target_project, 'sessions': len(records),
               'decisions': len(decisions), 'categories': dict(categories), 'reasons': dict(reasons),
               'live_model_calls': 0, 'production_calls': 0, 'labeled_samples': 0,
               'verified_candidate_sets': 0, 'evaluation_ready': False,
               'integrity_ok': all(r['integrity_ok'] for r in records)}
    write('summary.json', json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    lines = ['# DSH 离线决策初筛', '', '**本地产物，未经人工隐私复核，不可上传。**', '',
             '只读历史日志；未调用 Jev、未执行生产工具、未读取当前项目状态填充历史。',
             '分类由透明词法规则产生，不是人工真值；候选是未验证的研究草案，不是授权。',
             '规则基线不是完整线上 DSH；没有标注，不能计算模型准确率、增益或成本节省。', '',
             '## 会话统计', '', '| session | 调用 | 结果 | 错误 | 缺失结果 | 目标样本 |',
             '|---|---:|---:|---:|---:|---:|']
    for r in records:
        s = r['stats']
        lines.append(f"| {r['session_id']} | {s['calls']} | {s['results']} | {s['errors']} | {s['missing_results']} | {s['decisions']} |")
    lines.extend(['', '## 决策初筛', '', '| 分类 | 数量 |', '|---|---:|'])
    lines.extend(f'| {k} | {v} |' for k, v in sorted(categories.items()))
    lines.extend(['', '## 错误证据索引', '', '| session | 调用→结果行 | 工具 | 初筛规则 |', '|---|---|---|---|'])
    for d in decisions:
        inp, src = d['input'], d['input']['source']
        if inp['observation']['status'] == 'error':
            lines.append(f"| {src['session_id']} | {src['call_line']} → {src['result_line']} | {inp['observation']['tool']} | {d['triage']['reason']} |")
    lines.extend(['', '## 语义候选（待人工复核）', '', '| session | 结果行 | 工具 |', '|---|---:|---|'])
    for d in decisions:
        if d['triage']['category'] == 'semantic':
            src = d['input']['source']
            lines.append(f"| {src['session_id']} | {src['result_line']} | {d['input']['observation']['tool']} |")
    lines.extend(['', '## 限制与下一步', '',
                  '- 决策输入仅有当时已观察到的信息；历史后续调用单独写入 outcomes，不作为标签。',
                  '- 主模型原始目标、完整来源、历史 revision、权限未重建；所有样本暂不可作正式模型评估。',
                  '- 并发、乱序、损坏、项目归属不确定均保留诊断；不得把时间上下一次调用认定为恢复因果。',
                  '- 先人工复核语义候选，补充带行号的决策前证据和目标，确认同层级候选，再独立标注。',
                  '- 当前重复失败规则可提供比较线索，但离线停止建议不证明减少了实际调用。',
                  '- 同一会话/重试组应作为整体划分；只有一个项目的发现集不能支持跨项目结论。',
                  '- predictions 为空；labels 全部 unlabeled；未进行 API 评测或在线 shadow。', ''])
    write('report.md', '\n'.join(lines))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--session', type=Path, action='append', required=True, help='explicit session.jsonl; repeatable')
    parser.add_argument('--project', help='exact project ID; unknown/other scopes excluded from decisions, retained in local trace')
    parser.add_argument('--out', type=Path, required=True, help='new private output directory outside source sessions')
    args = parser.parse_args()
    print(json.dumps(run_audit(args.session, args.out, args.project), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
