"""서버 API·AI 계층 시험 (pytest). 실제 Gemini는 부르지 않고, httpx 응답을 흉내 내 오류 처리를 확인한다."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import httpx
import pytest
from fastapi.testclient import TestClient
from server.app import app
from ai import gemini, verify

c = TestClient(app)
IMG = ('x.png', b'\x89PNG fake', 'image/png')
P18 = {'text': 'K/(s(s+3)(s^2+2s+2))'}


def test_analyze_and_check():
    r = c.post('/api/analyze', json={'problem': P18}).json()
    assert r['ok'] and r['verification']['verified'] == 9
    assert all(len(st['hints']) == 4 for st in r['steps'])
    v = c.post('/api/check', json={'problem': P18, 'field': 'stableRange', 'answer': '0<K<204/25'}).json()
    assert v['status'] == 'correct'


def test_out_of_range_message():
    r = c.post('/api/analyze', json={'problem': {'text': 'K/(s(s+1)(s+2)(s+3)(s+4))'}}).json()
    assert not r['ok'] and r['error']['code'] == 'order'


def test_block_diagram_preview():
    r = c.post('/api/diagram', json={'G': 'K/(s(s+1))', 'H': '(s+2)/(s+4)'}).json()
    assert r['ok'] and r['unityFeedback'] is False and 's + 2' in r['L']


def test_offline_hint_without_key(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    r = c.post('/api/ai/hint', json={'problem': P18, 'step': 4, 'level': 1}).json()
    assert r['ok'] and r['source'] == 'team' and r['aiError']['code'] == 'noKey'


def test_photo_needs_consent():
    r = c.post('/api/ai/recognize', files={'image': IMG}, data={}).json()
    assert not r['ok'] and r['error']['code'] == 'consent'


def test_mock_handwriting_dual_verification():
    r = c.post('/api/ai/handwriting', files={'image': IMG}, data={'demo': 'true', 'problem': json.dumps(P18)}).json()
    s = r['report']['summary']
    assert s == {'agree_correct': 2, 'agree_wrong': 1, 'disagree': 1, 'recognize': 1, 'unverifiable': 0}


class FakeResp:
    def __init__(self, code, body):
        self.status_code, self._b = code, body

    def json(self):
        return self._b


@pytest.mark.parametrize('code,body,expect', [
    (429, {}, 'rateLimit'),
    (403, {}, 'noKey'),
    (500, {}, 'badResponse'),
    (200, {'candidates': [{'finishReason': 'SAFETY', 'content': {'parts': []}}]}, 'blocked'),
    (200, {'candidates': [{'content': {'parts': [{'text': 'not json'}]}}]}, 'badResponse'),
])
def test_gemini_errors(monkeypatch, code, body, expect):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key-not-real')
    monkeypatch.setattr(httpx, 'post', lambda *a, **k: FakeResp(code, body))
    with pytest.raises(gemini.AIError) as e:
        gemini.GeminiProvider().extract_problem(b'x', 'image/png')
    assert e.value.code == expect
    assert 'test-key-not-real' not in e.value.message   # 키가 오류 문구에 새지 않음


def test_gemini_timeout(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'k')
    def boom(*a, **k):
        raise httpx.ConnectTimeout('t')
    monkeypatch.setattr(httpx, 'post', boom)
    with pytest.raises(gemini.AIError) as e:
        gemini.GeminiProvider().explain('x')
    assert e.value.code == 'network'


def test_gemini_request_shape(monkeypatch):
    seen = {}
    def fake(url, params=None, json=None, timeout=None):
        seen.update(url=url, params=params, body=json)
        return FakeResp(200, {'candidates': [{'content': {'parts': [{'text': '{"kind":"unknown","conditions":[],"uncertain":[],"confidence":0.1}'}]}}]})
    monkeypatch.setenv('GEMINI_API_KEY', 'k')
    monkeypatch.setattr(httpx, 'post', fake)
    out = gemini.GeminiProvider().extract_problem(b'abc', 'image/png')
    assert out['kind'] == 'unknown'
    assert seen['url'].endswith(':generateContent') and 'models/' in seen['url']
    gc = seen['body']['generationConfig']
    assert gc['response_mime_type'] == 'application/json' and 'response_schema' in gc
    assert seen['body']['contents'][0]['parts'][1]['inline_data']['mime_type'] == 'image/png'


def test_ai_hint_number_guard(monkeypatch):
    # AI가 엔진에 없는 숫자(-7.3)를 쓰면 팀 힌트로 바뀌어야 한다
    monkeypatch.setenv('GEMINI_API_KEY', 'k')
    monkeypatch.setattr(gemini.GeminiProvider, 'explain', lambda self, p: '중심은 -7.3 입니다.')
    r = c.post('/api/ai/hint', json={'problem': P18, 'step': 4, 'level': 3}).json()
    assert r['source'] == 'team' and -7.3 in r['unknownNumbers']
    monkeypatch.setattr(gemini.GeminiProvider, 'explain', lambda self, p: '극점의 합 -5에서 영점의 합을 빼고 4로 나눠 보세요.')
    r = c.post('/api/ai/hint', json={'problem': P18, 'step': 4, 'level': 3}).json()
    assert r['source'] == 'gemini'


def test_number_check_unit():
    assert verify.check_numbers('σa = -1.25', ['σa = −5/4 = −1.25']) == []
    assert verify.check_numbers('K = 99.9', ['K = 8.16']) == [99.9]


# 학습 화면의 예시 문제는 모두 서버(JSON 응답)를 통과해야 한다.
# (2026-11-17: 중근 문제에서 sympy 정수가 섞여 500 오류가 났던 것의 재발 방지)
EXAMPLES = ['K/(s(s+1)(s+2))', 'K(s+2)/(s(s+1))', 'K/(s(s+3)(s^2+2s+2))', 'K(s+1)/(s^2(s+9))',
            'K/(s(s+2)(s^2+2s+5))', 'K(s+1)/(s(s-1))']


@pytest.mark.parametrize('tf', EXAMPLES)
def test_examples_through_server(tf):
    r = c.post('/api/analyze', json={'problem': {'text': tf}})
    assert r.status_code == 200 and r.json()['ok']


def test_odd_answer_shapes_never_500():
    fields = c.get('/api/fields').json()
    for fs in fields.values():
        for f in fs:
            for ans in ['[-1, 0]', '0<K<1', '없음', '', 'abc', 's^2+K', '1, 2']:
                r = c.post('/api/check', json={'problem': P18, 'field': f['field'], 'answer': ans, 'K': 10})
                assert r.status_code == 200
