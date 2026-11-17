import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from curate import build_packets, write_review


class CurateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'session.jsonl'
        self.events = [
            {'type': 'user/message', 'data': {'content': [{'type': 'text', 'text': 'goal and limits'}]}},
            {'type': 'tool/result', 'data': {'message': {'content': [{'type': 'tool-result',
                'toolCallId': 'c1', 'isError': False, 'content': [{'type': 'text', 'text': 'source evidence'}]}]}}},
            {'type': 'assistant/message', 'data': {'text': 'FUTURE'}}]
        self.write()
        self.plan = {'session_path': str(self.path), 'source_sha256': self.sha(), 'split_group': 'one-session',
                     'cases': [{'id': 'case-1', 'cutoff_line': 2, 'cutoff_call_id': 'c1',
                      'references': [{'id': 'goal', 'role': 'goal', 'line': 1,
                          'pointer': '/data/content/0/text', 'start': 0, 'end': 4, 'expected_text': 'goal'},
                          {'id': 'e1', 'role': 'evidence', 'line': 2,
                          'pointer': '/data/message/content/0/content/0/text', 'start': 0, 'end': 15,
                          'expected_text': 'source evidence'}],
                      'questions': [{'id': 'q1', 'prompt': 'Is claim supported?',
                          'choices': [{'id': 'yes', 'description': 'supported'}, {'id': 'unknown', 'description': 'insufficient'}]}]}]}

    def write(self):
        self.path.write_text('\n'.join(json.dumps(e) for e in self.events) + '\n')

    def sha(self):
        return hashlib.sha256(self.path.read_bytes()).hexdigest()

    def test_private_writer_reproducibility_and_no_overwrite(self):
        plan_path = Path(self.tmp.name).resolve() / 'plan.json'
        plan_path.write_text(json.dumps(self.plan))
        # Source directory must stay separate from output.
        source_dir = Path(self.tmp.name).resolve() / 'sources'; source_dir.mkdir()
        moved = source_dir / 'session.jsonl'; moved.write_bytes(self.path.read_bytes())
        self.plan['session_path'] = str(moved); plan_path.write_text(json.dumps(self.plan))
        a, b = Path(self.tmp.name).resolve()/'a', Path(self.tmp.name).resolve()/'b'
        self.assertEqual(write_review(plan_path,a), {'cases':1,'questions':1,'external_calls':0})
        write_review(plan_path,b)
        self.assertTrue(all(f.read_bytes()==(b/f.name).read_bytes() for f in a.iterdir()))
        self.assertEqual(a.stat().st_mode & 0o777,0o700)
        self.assertTrue(all(f.stat().st_mode & 0o777 == 0o600 for f in a.iterdir()))
        with self.assertRaises(FileExistsError): write_review(plan_path,a)
        with self.assertRaises(ValueError): write_review(plan_path,source_dir/'bad')
        labels=[json.loads(x) for x in (a/'labels.blank.jsonl').read_text().splitlines()]
        self.assertTrue(all(x['status']=='unlabeled' for x in labels))
        self.assertNotIn('FUTURE',(a/'blind-review.md').read_text())

    def test_invalid_reference_pointer_and_role(self):
        for key,value in [('pointer','not-pointer'),('pointer','/data/content/99/text'),('role','outcome')]:
            plan=copy.deepcopy(self.plan);plan['cases'][0]['references'][0][key]=value
            with self.assertRaises(ValueError):build_packets(plan)

    def test_non_text_and_failed_evidence(self):
        for field,value in [('isError',True),('type','other')]:
            self.events[1]['data']['message']['content'][0][field]=value
            self.write();self.plan['source_sha256']=self.sha()
            with self.assertRaises(ValueError):build_packets(self.plan)

    def test_empty_cases_and_duplicate_refs(self):
        plan=copy.deepcopy(self.plan);plan['cases']=[]
        with self.assertRaises(ValueError):build_packets(plan)
        plan=copy.deepcopy(self.plan);plan['cases'][0]['references'][1]['id']='goal'
        with self.assertRaises(ValueError):build_packets(plan)

    def test_valid_and_future_suffix_invariance(self):
        before = build_packets(self.plan)
        self.events[-1]['data']['text'] = 'A DIFFERENT FUTURE'; self.write()
        self.plan['source_sha256'] = self.sha()
        after = build_packets(self.plan)
        self.assertEqual(before, after)
        self.assertNotIn('FUTURE', json.dumps(before))
        self.assertNotIn('source_sha256', json.dumps(before))
        self.assertFalse(before[0]['production_action_authorized'])

    def test_reject_future_and_assistant_refs(self):
        for line in [3, 1]:
            p = copy.deepcopy(self.plan)
            p['cases'][0]['references'][1]['line'] = line
            if line == 1:
                self.events[0]['type'] = 'assistant/message'; self.write(); p['source_sha256'] = self.sha()
            with self.assertRaises(ValueError): build_packets(p)

    def test_offset_mismatch_and_bounds_rejected(self):
        for key, value in [('end', 9999), ('start', -1), ('expected_text', 'fabricated')]:
            p = copy.deepcopy(self.plan); p['cases'][0]['references'][1][key] = value
            with self.assertRaises(ValueError): build_packets(p)

    def test_changed_source_fails(self):
        self.path.write_text(self.path.read_text() + '\n')
        with self.assertRaises(ValueError): build_packets(self.plan)

    def test_cutoff_must_be_matching_result(self):
        p = copy.deepcopy(self.plan); p['cases'][0]['cutoff_call_id'] = 'wrong'
        with self.assertRaises(ValueError): build_packets(p)

    def test_choices_unique_and_minimum_two(self):
        for choices in [[], [{'id':'x','description':'a'}], [{'id':'x','description':'a'},{'id':'x','description':'b'}]]:
            p = copy.deepcopy(self.plan); p['cases'][0]['questions'][0]['choices'] = choices
            with self.assertRaises(ValueError): build_packets(p)

    def test_embedded_json_offsets_use_decoded_string(self):
        block = self.events[1]['data']['message']['content'][0]['content'][0]
        block['text'] = '[search]\\n' + json.dumps({'results':[{'content':'中文\\n正文'}]}, ensure_ascii=False) + '\nfooter'
        self.write(); self.plan['source_sha256'] = self.sha()
        ref = self.plan['cases'][0]['references'][1]
        ref.update(embedded_json_pointer='/results/0/content', start=0, end=6, expected_text='中文\\n正文')
        self.assertEqual(build_packets(self.plan)[0]['references'][1]['text'], '中文\\n正文')

    def test_redacts_reference_and_question_secrets(self):
        self.events[0]['data']['content'][0]['text'] = 'api_key=secretValue'
        self.write(); self.plan['source_sha256'] = self.sha()
        ref=self.plan['cases'][0]['references'][0];ref.update(end=19, expected_text='api_key=secretValue')
        # correct length is derived, not assumed
        ref['end']=len(ref['expected_text'])
        packet=build_packets(self.plan)[0]
        self.assertNotIn('secretValue', json.dumps(packet))


if __name__ == '__main__': unittest.main()
