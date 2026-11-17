import io
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
import server


class FakeModel:
    def __init__(self):
        self.calls = []

    def generate_custom_voice(self, **kwargs):
        self.calls.append(kwargs)
        return [np.zeros(2400, dtype=np.float32)], 24000


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.model = FakeModel()
        self.model_patch = patch.object(server, 'model', self.model)
        self.model_patch.start()
        # No lifespan: these tests must never load real weights or allocate GPU.
        self.client = TestClient(server.app)

    def tearDown(self):
        self.client.close()
        self.model_patch.stop()

    def test_exact_text_and_instructions_are_separate(self):
        response = self.client.post('/v1/audio/speech', json={
            'input': '别怕，跟着我。', 'instructions': '坚定、清亮，不要拖长音', 'voice': 'Dylan',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['content-type'], 'audio/wav')
        audio, sr = sf.read(io.BytesIO(response.content))
        self.assertEqual(sr, 24000)
        self.assertEqual(len(audio), 2400)
        self.assertEqual(self.model.calls[0]['text'], '别怕，跟着我。')
        self.assertEqual(self.model.calls[0]['instruct'], '坚定、清亮，不要拖长音')
        self.assertEqual(self.model.calls[0]['speaker'], 'dylan')

    def test_input_validation(self):
        for payload in [{'input': ' '}, {'input': '字' * 301}, {'input': '你好', 'voice': 'unknown'}, {'input': '你好', 'response_format': 'mp3'}, {'input': '你好', 'instructions': '字' * 2001}]:
            self.assertEqual(self.client.post('/v1/audio/speech', json=payload).status_code, 422)
        self.assertEqual(self.model.calls, [])

    def test_busy_and_not_ready_do_not_run_model(self):
        server.inference_lock.acquire()
        try:
            self.assertEqual(self.client.post('/v1/audio/speech', json={'input': '你好'}).status_code, 429)
        finally:
            server.inference_lock.release()
        with patch.object(server, 'model', None):
            self.assertEqual(self.client.get('/health').status_code, 503)
            self.assertEqual(self.client.post('/v1/audio/speech', json={'input': '你好'}).status_code, 503)
        self.assertEqual(self.model.calls, [])

    def test_failed_generation_releases_lock_without_retry(self):
        with patch.object(self.model, 'generate_custom_voice', side_effect=RuntimeError('test')) as generate:
            self.assertEqual(self.client.post('/v1/audio/speech', json={'input': '你好'}).status_code, 500)
            generate.assert_called_once()
        self.assertFalse(server.inference_lock.locked())

    def test_health_declares_customvoice_not_voice_design(self):
        result = self.client.get('/health')
        self.assertEqual(result.json()['task'], 'custom_voice')
        self.assertEqual(len(result.json()['speakers']), 9)


if __name__ == '__main__':
    unittest.main()
