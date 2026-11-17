import json
import tempfile
import unittest
from pathlib import Path
from audit import extract_session, redact, run_audit


def call(cid, name='web_search', args=None, seq=1):
    return {'type': 'tool/call', 'seq': seq, 'time': '2026-09-25T00:00:00Z',
            'data': {'turn': 1, 'step': seq, 'callId': cid, 'name': 'mcp__gdream__' + name,
                     'arguments': json.dumps(args or {})}}


def result(cid, text='evidence', error=False, seq=2):
    return {'type': 'tool/result', 'seq': seq, 'data': {'message': {'content': [
        {'type': 'tool-result', 'toolCallId': cid, 'isError': error,
         'content': [{'type': 'text', 'text': text}]}]}}}


def state(cid='s', project='proj-test', seq=1):
    return [call(cid, 'workshop_get_state', seq=seq),
            result(cid, json.dumps({'open': True, 'project': {'id': project}}), seq=seq+1)]


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'source').mkdir()

    def write(self, events, name='session.jsonl'):
        p = self.root / 'source' / name
        p.write_text('\n'.join(json.dumps(e) if isinstance(e, dict) else e for e in events) + '\n')
        return p

    def extract(self, events, **kwargs):
        return extract_session(self.write(events), **kwargs)

    def test_paged_state_prefix_establishes_scope_without_future_pages(self):
        text = ('{"output_id":"page-1","offset":0,"complete":false,"next_offset":8000}\n'
                '[状态快照分页；正文按 offset 顺序拼接]\n'
                '{"open":true,"project":{"id":"proj-test","name":"x"},"huge":"partial')
        data = self.extract([call('s', 'workshop_get_state'), result('s', text),
                             call('a', seq=3), result('a', seq=4)], target_project='proj-test')
        self.assertEqual(len(data['decisions']), 2)
        self.assertIn('state_body_not_reconstructed', data['decisions'][0]['input']['unknowns'])

    def test_project_paths_uses_aigc_not_canvas_id(self):
        text = json.dumps({'current': {'canvas_project_id': 'proj-wrong', 'aigc_project_id': 'proj-test'}})
        data = self.extract([call('s', 'project_get_paths'), result('s', text)], target_project='proj-test')
        self.assertEqual(len(data['decisions']), 1)

    def test_nonadjacent_mirrored_events_do_not_poison_order(self):
        c, r = call('a'), result('a')
        data = self.extract([c, r, call('b', seq=3), result('b', seq=4), c, r])
        self.assertTrue(data['integrity_ok'])

    def test_empty_source_and_publish_receipt_are_not_semantic(self):
        for name, text in [('workshop_read_source', '{"files":[]}'),
                           ('workshop_publish_ad_research', '{"status":"saved"}')]:
            d = self.extract([call('a', name), result('a', text)])['decisions'][0]
            self.assertEqual(d['triage']['category'], 'deterministic')
            self.assertEqual(d['baseline']['action'], 'observe_only')

    def test_cancel_error_is_preserved_as_block_not_retry(self):
        d = self.extract([call('a'), result('a', '用户取消', True)])['decisions'][0]
        self.assertEqual(d['baseline']['action'], 'stop_without_retry')

    def test_path_guards_and_duplicate_inputs(self):
        p = self.write([call('a'), result('a')])
        with self.assertRaises(ValueError):
            run_audit([p, p], self.root / 'duplicate')
        with self.assertRaises(ValueError):
            run_audit([p], p.parent / 'report')
        link = self.root / 'link'; link.symlink_to(self.root / 'source')
        with self.assertRaises(ValueError):
            run_audit([p], link / 'report')

    def test_invalid_shapes_are_reported_without_crashing(self):
        events = [{'type': 'tool/call', 'data': []},
                  {'type': 'tool/call', 'data': {'callId': 1}},
                  {'type': 'tool/result', 'data': {'message': {'content': {}}}},
                  {'type': 'tool/result', 'data': {'message': {'content': [
                      None, {'type': 'tool-result', 'toolCallId': 2}]}}}]
        data = self.extract(events)
        self.assertEqual(data['trace'], [])
        self.assertFalse(data['integrity_ok'])

    def test_bad_utf8_and_unterminated_tail(self):
        p = self.write([call('a')]);p.write_bytes(p.read_bytes() + b'\xff\n{"type":')
        data = extract_session(p)
        self.assertEqual(data['stats']['malformed_lines'], 2)
        self.assertEqual(data['stats']['missing_results'], 1)

    def test_late_state_result_does_not_rollback_newer_scope(self):
        events = state(project='proj-a') + [call('old', 'workshop_get_state', seq=3)]
        events += state('new', 'proj-b', 4)
        events += [result('old', '{"projectId":"proj-a"}', seq=6), call('x', seq=7), result('x', seq=8)]
        data = self.extract(events)
        self.assertEqual(data['decisions'][-1]['input']['project_id'], 'proj-b')

    def test_sequence_gap_is_not_automatically_missing_history(self):
        data = self.extract([call('a', seq=10), result('a', seq=50)])
        self.assertTrue(data['integrity_ok'])

    def test_state_close_clears_scope(self):
        events = state() + [call('close', 'workshop_get_state', seq=3), result('close', '{"open":false}', seq=4),
                            call('after', seq=5), result('after', seq=6)]
        data = self.extract(events)
        self.assertIsNone(data['trace'][-1]['project_id'])

    def test_formal_events_only_and_nested_results(self):
        c = call('a')
        r = result('a')
        data = self.extract([c, {'type': 'assistant/message', 'data': c['data']}, c, r, r])
        self.assertEqual(len(data['trace']), 1)
        self.assertEqual(data['trace'][0]['status'], 'success')
        self.assertEqual(data['stats']['duplicate_calls'], 1)
        self.assertEqual(data['stats']['duplicate_results'], 1)
        self.assertEqual(data['decisions'][0]['input']['observation']['excerpt'], 'evidence')

    def test_future_suffix_does_not_change_decision_input(self):
        events = state() + [call('a', seq=3), result('a', seq=4)]
        before = self.extract(events)['decisions']
        after = self.extract(events + [call('b', args={'query': 'FUTURE'}, seq=5),
                                       result('b', 'FUTURE ANSWER', seq=6)])['decisions']
        self.assertEqual(before, after[:len(before)])
        self.assertNotIn('FUTURE', json.dumps(before))

    def test_scope_switch_and_parallel_call_attribution(self):
        events = state(project='proj-a') + [call('pending', seq=3)]
        events += state('switch', 'proj-b', 4) + [result('pending', seq=6)]
        data = self.extract(events, target_project='proj-a')
        pending = next(t for t in data['trace'] if t['call_id'] == 'pending')
        self.assertEqual(pending['project_id'], 'proj-a')
        decision = next(d for d in data['decisions'] if d['input']['source']['call_id'] == 'pending')
        self.assertIn('project_changed_while_in_flight', decision['input']['unknowns'])
        self.assertFalse(decision['input']['candidate_set_verified'])
        self.assertTrue(all(d['input']['project_id'] == 'proj-a' for d in data['decisions']))

    def test_out_of_order_or_missing_never_invents_snapshot(self):
        data = self.extract([result('a', seq=5), call('a', seq=2), call('b', seq=6)])
        self.assertEqual(data['decisions'], [])
        self.assertTrue(any('out_of_order' in d['kind'] for d in data['diagnostics']))
        self.assertEqual(next(t for t in data['trace'] if t['call_id'] == 'b')['status'], 'missing_result')

    def test_malformed_lines_and_non_object_records(self):
        data = self.extract([call('a'), '{broken', '[]', result('a')])
        self.assertEqual(data['stats']['malformed_lines'], 2)
        self.assertIn('incomplete_history', data['decisions'][0]['input']['unknowns'])

    def test_explicit_project_beats_mentions_and_unknown_is_excluded(self):
        data = self.extract([call('a', args={'query': 'proj-test'}), result('a', 'proj-test')],
                            target_project='proj-test')
        self.assertEqual(data['decisions'], [])
        self.assertEqual(data['trace'][0]['project_id'], None)
        data = self.extract([call('a', args={'project_id': 'proj-test'}), result('a')],
                            target_project='proj-test')
        self.assertEqual(len(data['decisions']), 1)

    def test_conflicting_duplicates_are_flagged_not_counted_twice(self):
        data = self.extract([call('a'), call('a', 'bash'), result('a'), result('a', 'conflict')])
        self.assertEqual(len(data['trace']), 1)
        self.assertFalse(data['evaluation_ready'])
        self.assertEqual(sum(d['kind'] == 'conflicting_duplicate' for d in data['diagnostics']), 2)

    def test_deterministic_error_and_rule_model_skip(self):
        data = self.extract(state() + [call('a', 'workshop_set_shots', seq=3),
            result('a', '拆解任务正文已变化：请使用当前检查点的 workUnitId', True, 4)])
        d = data['decisions'][-1]
        self.assertEqual(d['triage']['category'], 'deterministic')
        self.assertEqual(d['baseline']['action'], 'refresh_state_before_retry')
        self.assertFalse(d['baseline']['call_model'])

    def test_visual_not_claimed_from_text(self):
        d = self.extract([call('a', 'read_image'), result('a', '/tmp/image.png')])['decisions'][0]
        self.assertEqual(d['triage']['category'], 'visual')
        self.assertFalse(d['baseline']['call_model'])

    def test_sensitive_input_is_not_serialized(self):
        events = [call('a', args={'api_key': 'supersecret', 'prompt': 'PRIVATE_PROMPT'}),
                  result('a', 'Authorization: Bearer TOPSECRET\napi_key=supersecret\nhttps://x.test/a?token=SECRET\n/Users/alice/private.txt')]
        output = json.dumps(self.extract(events)['decisions'])
        for secret in ['TOPSECRET', 'supersecret', 'PRIVATE_PROMPT', 'token=SECRET', '/Users/alice']:
            self.assertNotIn(secret, output)

    def test_oversized_line_is_skipped_and_bounds_diagnosed(self):
        data = self.extract(['x' * 1200, call('a'), result('a')], max_line_bytes=1000)
        self.assertEqual(data['stats']['oversized_lines'], 1)
        self.assertEqual(len(data['trace']), 1)

    def test_singleton_and_no_state_not_mistaken_for_legal_choice(self):
        d = self.extract([call('a', 'unknown_tool'), result('a', 'unknown')])['decisions'][0]
        self.assertFalse(d['input']['candidate_set_verified'])
        self.assertFalse(d['baseline']['call_model'])
        self.assertEqual(d['baseline']['action'], 'escalate_to_planner')

    def test_malformed_arguments_and_missing_error_flag_are_unknown(self):
        c = call('a'); c['data']['arguments'] = '{'
        r = result('a'); del r['data']['message']['content'][0]['isError']
        data = self.extract([c, r])
        self.assertEqual(data['trace'][0]['status'], 'unknown')
        self.assertIn('invalid_arguments', data['decisions'][0]['input']['unknowns'])

    def test_outputs_readonly_private_no_overwrite_no_labels_fabricated(self):
        p = self.write(state() + [call('a', seq=3), result('a', seq=4)])
        before = p.read_bytes()
        output = self.root / 'report'
        run_audit([p], output, 'proj-test')
        self.assertEqual(p.read_bytes(), before)
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        for f in output.iterdir():
            self.assertEqual(f.stat().st_mode & 0o777, 0o600)
        labels = [json.loads(l) for l in (output / 'labels.jsonl').read_text().splitlines()]
        self.assertTrue(all(x['status'] == 'unlabeled' for x in labels))
        with self.assertRaises(FileExistsError):
            run_audit([p], output, 'proj-test')

    def test_redaction_handles_json_keys_credentials_and_urls(self):
        safe = redact('{"apiKey":"secretABC", "password": "hello"} sk-1234567890123456 https://a.test/x?signature=foo#bar')
        for value in ['secretABC', 'hello', 'sk-1234567890123456', 'signature=foo']:
            self.assertNotIn(value, safe)


if __name__ == '__main__':
    unittest.main()
