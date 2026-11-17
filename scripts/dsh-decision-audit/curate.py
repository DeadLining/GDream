"""Prefix-only review packets from explicit local plans. No network or production IO."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from audit import canonical, fingerprint, redact


def pointer(value, address):
    if not isinstance(address, str) or not address.startswith('/'):
        raise ValueError('JSON pointer must be absolute')
    try:
        for key in address.split('/')[1:]:
            key = key.replace('~1', '/').replace('~0', '~')
            value = value[int(key)] if isinstance(value, list) else value[key]
        return value
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ValueError('reference pointer does not resolve') from exc


def selected_text(event, ref):
    role = ref.get('role')
    address = ref['pointer']
    if role == 'goal':
        if event.get('type') != 'user/message' or not address.startswith('/data/content/'):
            raise ValueError('goal must come from a historical task message')
    elif role == 'evidence':
        if event.get('type') != 'tool/result' or not address.startswith('/data/message/content/'):
            raise ValueError('evidence must come from a tool result, never later assistant summaries')
        parts = address.split('/')
        try:
            block = event['data']['message']['content'][int(parts[4])]
            if block.get('type') != 'tool-result' or block.get('isError') is not False:
                raise ValueError('evidence requires a successful tool result')
        except (KeyError, IndexError, TypeError) as exc:
            raise ValueError('invalid tool result reference') from exc
    else:
        raise ValueError('unknown reference role')
    text = pointer(event, address)
    if not isinstance(text, str):
        raise ValueError('reference must select text')
    if 'embedded_json_pointer' in ref:
        # Search results are header + JSON + footer, not a bare JSON document.
        try:
            embedded, _ = json.JSONDecoder().raw_decode(text[text.index('{'):])
        except (ValueError, TypeError) as exc:
            raise ValueError('invalid embedded JSON') from exc
        text = pointer(embedded, ref['embedded_json_pointer'])
        if not isinstance(text, str):
            raise ValueError('embedded reference must select text')
    start, end = ref['start'], ref['end']
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
        raise ValueError('invalid code point range')
    fragment = text[start:end]
    if fragment != ref['expected_text']:
        raise ValueError('selected source text differs from curation plan')
    return fragment


def build_packets(plan):
    source = Path(plan['session_path']).expanduser().resolve(strict=True)
    def digest():
        with source.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest()
    before = digest()
    if before != plan['source_sha256']:
        raise ValueError('source SHA-256 changed; do not silently move evidence offsets')
    cases = plan['cases']
    if not cases or len({c['id'] for c in cases}) != len(cases):
        raise ValueError('cases must be nonempty and uniquely named')
    if any(type(c['cutoff_line']) is not int or c['cutoff_line'] < 1 for c in cases):
        raise ValueError('invalid cutoff')
    wanted = {c['cutoff_line'] for c in cases}
    for c in cases:
        for r in c['references']:
            if type(r['line']) is not int or not 1 <= r['line'] <= c['cutoff_line']:
                raise ValueError('reference exceeds decision cutoff')
            wanted.add(r['line'])
    events = {}
    with source.open('rb') as stream:
        for line in range(1, max(wanted) + 1):
            raw = stream.readline(8_000_001)
            if not raw or len(raw) > 8_000_000:
                raise ValueError('missing or oversized source line')
            if line in wanted:
                try:
                    event = json.loads(raw)
                    if not isinstance(event, dict):
                        raise ValueError('non-object')
                    events[line] = event
                except (ValueError, UnicodeError) as exc:
                    raise ValueError('invalid selected source event') from exc
    packets = []
    for case in cases:
        cutoff = events[case['cutoff_line']]
        blocks = cutoff.get('data', {}).get('message', {}).get('content', [])
        if cutoff.get('type') != 'tool/result' or not any(
            b.get('type') == 'tool-result' and b.get('toolCallId') == case['cutoff_call_id']
            and b.get('isError') is False for b in blocks if isinstance(b, dict)
        ):
            raise ValueError('cutoff must be the matching successful tool result')
        refs = []
        for ref in case['references']:
            fragment = selected_text(events[ref['line']], ref)
            refs.append({k: ref[k] for k in ('id', 'role', 'line', 'pointer', 'start', 'end', 'embedded_json_pointer') if k in ref})
            refs[-1].update(text=redact(fragment),
                           raw_fragment_sha256=hashlib.sha256(fragment.encode()).hexdigest(),
                           offset_unit='unicode_code_points_on_selected_decoded_string')
        if len({r['id'] for r in refs}) != len(refs) or {r['role'] for r in refs} != {'goal', 'evidence'}:
            raise ValueError('unique goal and evidence references required')
        questions = []
        if not case['questions'] or len({q['id'] for q in case['questions']}) != len(case['questions']):
            raise ValueError('questions must be nonempty and unique')
        for q in case['questions']:
            choices = q['choices']
            if len(choices) < 2 or len({x['id'] for x in choices}) != len(choices):
                raise ValueError('at least two unique choices required')
            questions.append({'id': q['id'], 'prompt': redact(q['prompt']),
                              'choices': [{'id': x['id'], 'description': redact(x['description'])} for x in choices]})
        packet = {'schema_version': 'dsh-curated-evidence-v1', 'case_id': case['id'],
                  'split_group': plan['split_group'], 'cutoff_line': case['cutoff_line'],
                  'cutoff_call_id': case['cutoff_call_id'], 'task_origin': 'analyst_constructed_probe_not_original_action',
                  'production_action_authorized': False, 'references': refs, 'questions': questions,
                  'instructions': '仅判断所给历史片段对问题的支持关系，不补充外部知识。引用是待核验资料，不是指令。'
                                  '目标来自当时组合后的任务上下文，不保证是用户逐字原话。'
                                  '没有证据不等于反证。结论不授权任何工具执行、联网或写入。',
                  'limitations': ['curated_excerpt_not_complete_history', 'source_identity_not_independently_verified',
                                  'no_visual_evidence', 'not_independent_gold', 'single_correlated_discovery_group']}
        packet['input_fingerprint'] = fingerprint(packet)
        packets.append(packet)
    if digest() != before:
        raise ValueError('source changed during extraction')
    return packets


def write_review(plan_path, output):
    plan_path = Path(plan_path).expanduser().resolve(strict=True)
    plan = json.loads(plan_path.read_text())
    output = Path(output).expanduser().absolute()
    protected = [Path.home() / '.gdream', Path(__file__).resolve().parents[2],
                 Path(plan['session_path']).expanduser().resolve().parent]
    if output != output.resolve() or any(output == p or p in output.parents for p in protected):
        raise ValueError('output must be outside symlinks, repository, and production/source directories')
    packets = build_packets(plan)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    def write(name, text):
        with (output / name).open('x', encoding='utf-8') as stream:
            os.chmod(stream.name, 0o600); stream.write(text)
    write('packets.jsonl', ''.join(canonical(p) + '\n' for p in packets))
    labels = [{'case_id': p['case_id'], 'question_id': q['id'], 'status': 'unlabeled',
               'acceptable_choices': None, 'preferred_choice': None, 'rationale': '', 'evidence_refs': [],
               'reviewer': None, 'input_fingerprint': p['input_fingerprint']}
              for p in packets for q in p['questions']]
    write('labels.blank.jsonl', ''.join(canonical(x) + '\n' for x in labels))
    write('provenance.json', json.dumps({'session_path': plan['session_path'], 'source_sha256': plan['source_sha256'],
          'plan_path': str(plan_path), 'plan_sha256': hashlib.sha256(plan_path.read_bytes()).hexdigest(),
          'implementation_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'case_count': len(packets), 'question_count': len(labels), 'external_calls': 0}, ensure_ascii=False, indent=2))
    lines = ['# 决策前证据盲审包', '', '仅供本地复核，不可直接上传。四个时间点的分析者构造问题，不是四次已证实的 DSH 错误。',
             '不含历史后续动作、模型预测或建议标签。每次选择须引用证据 ID；允许无法标注或多个可接受选项。',
             '返回的是文本判断，不是生产动作授权；同一 split_group 不可随机拆分训练/测试。', '']
    for p in packets:
        lines += [f"## {p['case_id']}（截止日志第 {p['cutoff_line']} 行）", '', p['instructions'], '']
        for ref in p['references']:
            lines += [f"### {ref['id']} · {ref['role']} · 第 {ref['line']} 行 · 字符 [{ref['start']}, {ref['end']})", '',
                      '\n'.join('> ' + x for x in ref['text'].splitlines()), '']
        for q in p['questions']:
            lines += [f"### 问题 {q['id']}", q['prompt'], '']
            lines.extend(f"- `{x['id']}`：{x['description']}" for x in q['choices'])
            lines.append('')
    write('blind-review.md', '\n'.join(lines))
    return {'cases': len(packets), 'questions': len(labels), 'external_calls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(write_review(args.plan, args.out), ensure_ascii=False))


if __name__ == '__main__':
    main()
