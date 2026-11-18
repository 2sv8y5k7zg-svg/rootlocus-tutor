"""Gemini 장애·한도 대비 시험 (pytest). 실제 Gemini는 부르지 않고, 응답을 흉내 낸다. 키도 쓰지 않는다.

본선 시연(2026-12-03)에서 일어날 수 있는 경우를 하나씩 재현한다.
  - 503(일시 장애)·응답 잘림 → 같은 모델로 다시 시도해 성공
  - 429(한도 초과)·404(모델 없어짐) → 대체 모델로 넘어감
  - 403(키 문제)·안전 필터 차단 → 재시도하지 않고 바로 알림
  - 모두 실패 → 미리 받아 둔 실제 응답(시연 백업)이 있으면 그것을 밝히고 보여 줌
  - 한 기기가 너무 자주 부르거나 하루 상한을 넘으면 서버가 먼저 막음
"""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import httpx
import pytest
from fastapi.testclient import TestClient
from server.app import app
from ai import routes, gemini

c = TestClient(app)
GOOD = {'kind': 'transferFunction', 'tf': 'K/(s(s+1)(s+2))', 'conditions': [], 'uncertain': [], 'confidence': 0.9}


def ok_body(obj=GOOD, reason='STOP'):
    return {'candidates': [{'content': {'parts': [{'text': json.dumps(obj)}]}, 'finishReason': reason}]}


@pytest.fixture
def fake(monkeypatch, tmp_path):
    """script: 모델 이름 → 차례로 돌려줄 (상태 코드, 본문) 목록. calls에 (모델, 순번)이 쌓인다."""
    calls, script = [], {}

    def post(url, headers=None, json=None, timeout=None, **kw):
        model = url.split('/models/')[1].split(':')[0]
        calls.append(model)
        seq = script.get(model) or [(404, {'error': {'status': 'NOT_FOUND'}})]
        st, body = seq.pop(0) if len(seq) > 1 else seq[0]
        if st == 'timeout':
            raise httpx.ReadTimeout('timeout')
        return httpx.Response(st, json=body, request=httpx.Request('POST', url))

    monkeypatch.setenv('GEMINI_API_KEY', 'test-key-not-real')
    monkeypatch.setenv('AI_PROVIDER', 'gemini')
    monkeypatch.setenv('GEMINI_MODEL', 'main-model')
    monkeypatch.setenv('GEMINI_FALLBACK_MODELS', 'spare-model')
    monkeypatch.setattr(httpx, 'post', post)
    monkeypatch.setattr(gemini.time, 'sleep', lambda s: None)      # 시험에서는 기다리지 않음
    monkeypatch.setattr(routes, '_rate_ok', lambda *a: True)
    monkeypatch.setattr(routes, 'BACKUP_DIR', tmp_path)
    routes._cache.clear()
    return calls, script


def upload(img=b'photo', photo_id=''):
    return c.post('/api/ai/recognize', files={'image': ('p.png', b'\x89PNG\r\n\x1a\n' + img, 'image/png')},
                  data={'consent': 'true', 'demo': 'false', 'photoId': photo_id}).json()


def test_503_then_success_retries_same_model(fake):
    calls, script = fake
    script['main-model'] = [(503, {}), (503, {}), (200, ok_body())]
    r = upload()
    assert r['ok'] and r['ai']['tf'] == GOOD['tf']
    assert calls == ['main-model'] * 3


def test_cut_off_answer_is_retried(fake):
    calls, script = fake
    script['main-model'] = [(200, ok_body(reason='MAX_TOKENS')), (200, ok_body())]
    assert upload()['ok'] and calls == ['main-model'] * 2


def test_429_with_long_wait_moves_to_spare_model(fake):
    calls, script = fake
    script['main-model'] = [(429, {'error': {'details': [{'retryDelay': '60s'}]}})]
    script['spare-model'] = [(200, ok_body())]
    r = upload()
    assert r['ok'] and calls == ['main-model', 'spare-model']
    assert '대체 모델' in r['providerLabel']


def test_retired_model_404_moves_to_spare_model(fake):
    calls, script = fake
    script['spare-model'] = [(200, ok_body())]
    assert upload()['ok'] and calls == ['main-model', 'spare-model']


def test_bad_key_403_stops_at_once(fake):
    calls, script = fake
    script['main-model'] = [(403, {})]
    r = upload()
    assert not r['ok'] and r['error']['code'] == 'noKey' and calls == ['main-model']


def test_safety_block_is_not_retried(fake):
    calls, script = fake
    script['main-model'] = [(200, {'promptFeedback': {'blockReason': 'SAFETY'}})]
    r = upload()
    assert not r['ok'] and r['error']['code'] == 'blocked' and calls == ['main-model']


def test_all_fail_without_backup_reports_error(fake):
    calls, script = fake
    script['main-model'] = [(429, {})]
    script['spare-model'] = [(429, {})]
    r = upload()
    assert not r['ok'] and r['error']['code'] == 'rateLimit'
    assert 'fallback' in r                      # 계산·채점은 계속된다는 안내


def test_backup_answer_is_used_and_labeled_when_ai_fails(fake, monkeypatch):
    calls, script = fake
    monkeypatch.setenv('AI_BACKUP', '1')
    script['main-model'] = [(200, ok_body())]
    first = upload(b'demo-photo', photo_id='a' * 64)          # 리허설: 실제로 한 번 읽어 둠
    assert first['ok'] and first['provider'] == 'gemini'
    routes._cache.clear()
    script['main-model'] = [('timeout', None)]                # 본선 현장: 인터넷이 끊김
    script['spare-model'] = [('timeout', None)]
    r = upload(b'demo-photo-resized-differently', photo_id='a' * 64)   # 원본 사진 지문으로 찾음
    assert r['ok'] and r['provider'] == 'gemini-backup' and r['ai']['tf'] == GOOD['tf']
    assert '미리 받아 둔' in r['providerLabel'] and '연결하지 못해' in r['message']
    # 사진 자체는 저장하지 않고 인식 결과(JSON)만 남는다
    files = list(routes.BACKUP_DIR.iterdir())
    assert files and all(f.suffix == '.json' for f in files)


def test_backup_off_by_default(fake):
    calls, script = fake
    script['main-model'] = [(200, ok_body())]
    upload(b'x')
    assert list(routes.BACKUP_DIR.iterdir()) == []


def test_server_limits_per_device_and_per_day(monkeypatch):
    routes._calls.clear(); routes._ip_calls.clear(); routes._day.update(date=None, n=0)
    assert all(routes._rate_ok('1.1.1.1') for _ in range(routes.PER_IP))
    assert not routes._rate_ok('1.1.1.1')          # 한 기기가 1분에 너무 많이
    assert routes._rate_ok('2.2.2.2')              # 다른 기기는 괜찮음
    routes._calls.clear(); routes._ip_calls.clear(); routes._day.update(date=None, n=0)
    monkeypatch.setenv('AI_DAILY_LIMIT', '3')
    assert [routes._rate_ok('9.9.9.%d' % i) for i in range(4)] == [True, True, True, False]
    routes._calls.clear(); routes._ip_calls.clear(); routes._day.update(date=None, n=0)
