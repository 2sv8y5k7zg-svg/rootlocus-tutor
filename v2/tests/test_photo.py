"""문제 사진 인식 흐름 시험 (pytest).

2026-11-17 KST 버그: "사진을 바꿔도 늘 같은 식만 나온다".
원인은 시연 모드(모의 AI)가 사진을 읽지 않고 정해 둔 예시 하나를 돌려주는 것이었다.
여기서는 실제 Gemini 경로가 사진마다 다른 결과를 내는지를, Gemini 응답을 흉내 내서 확인한다.
(실제 Gemini 호출은 하지 않는다. 키도 쓰지 않는다.)
"""
import base64
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import httpx
from fastapi.testclient import TestClient
from server.app import app
from ai import routes

c = TestClient(app)

# 사진 내용(바이트)에 따라 Gemini가 다른 식을 읽었다고 흉내 낸다
READS = {
    b'photo-A': {'kind': 'transferFunction', 'tf': 'K/(s(s+1)(s+2))', 'conditions': [], 'uncertain': [], 'confidence': 0.93},
    b'photo-B': {'kind': 'transferFunction', 'tf': 'K(s+2)/(s(s+1))', 'conditions': [], 'uncertain': [], 'confidence': 0.9},
    b'photo-C': {'kind': 'blockDiagram', 'G': 'K/(s(s+2))', 'H': '(s+4)/(s+8)', 'feedbackSign': '-',
                 'conditions': ['음의 피드백'], 'uncertain': [], 'confidence': 0.8},
}


def fake_gemini(monkeypatch, seen):
    def post(url, headers=None, json=None, timeout=None, **kw):
        part = json['contents'][0]['parts'][1]['inline_data']
        img = base64.b64decode(part['data'])
        assert 'key' not in (kw.get('params') or {}) and headers['x-goog-api-key'] == 'test-key-not-real'
        seen.append({'url': url, 'mime': part['mime_type'], 'img': img,
                     'schema': json['generationConfig'].get('response_mime_type')})
        body = {'candidates': [{'content': {'parts': [{'text': __import__('json').dumps(READS[img[8:]])}]},
                                'finishReason': 'STOP'}]}
        return httpx.Response(200, json=body, request=httpx.Request('POST', url))
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key-not-real')
    monkeypatch.setenv('AI_PROVIDER', 'gemini')
    monkeypatch.setattr(httpx, 'post', post)
    monkeypatch.setattr(routes, '_rate_ok', lambda *a: True)
    routes._cache.clear()


def upload(img, demo=False, consent=True):
    return c.post('/api/ai/recognize', files={'image': ('p.png', b'\x89PNG\r\n\x1a\n' + img, 'image/png')},
                  data={'consent': str(consent).lower(), 'demo': str(demo).lower()}).json()


def test_different_photos_give_different_results(monkeypatch):
    seen = []
    fake_gemini(monkeypatch, seen)
    a, b, cc = upload(b'photo-A'), upload(b'photo-B'), upload(b'photo-C')
    assert a['ok'] and b['ok'] and cc['ok']
    assert a['provider'] == 'gemini'
    assert a['ai']['tf'] == 'K/(s(s+1)(s+2))' and b['ai']['tf'] == 'K(s+2)/(s(s+1))'
    # 엔진이 미리 해석한 값도 사진마다 다르다
    assert a['preview']['loopText'] != b['preview']['loopText']
    assert cc['preview']['T'] and cc['preview']['problem'] == {'G': 'K/(s(s+2))', 'H': '(s+4)/(s+8)'}
    # 사진 바이트와 형식이 그대로 Gemini에 갔고, JSON 응답을 요구했다
    assert [s['img'][8:] for s in seen] == [b'photo-A', b'photo-B', b'photo-C']
    assert all(s['mime'] == 'image/png' and s['schema'] == 'application/json' for s in seen)


def test_same_photo_uses_cache_but_new_photo_does_not(monkeypatch):
    seen = []
    fake_gemini(monkeypatch, seen)
    upload(b'photo-A'); upload(b'photo-A'); upload(b'photo-B')
    assert len(seen) == 2          # 같은 사진은 한 번만 보낸다 (무료 한도 절약), 새 사진은 새로 읽는다


def test_demo_mode_is_marked_as_not_reading(monkeypatch):
    seen = []
    fake_gemini(monkeypatch, seen)
    a, b = upload(b'photo-A', demo=True, consent=False), upload(b'photo-B', demo=True, consent=False)
    # 시연 모드는 사진과 상관없이 같은 예시를 돌려주고, 그 사실이 응답에 드러나야 한다
    assert a['provider'] == b['provider'] == 'mock' and a['ai'] == b['ai']
    assert '실제로 읽지 않음' in a['providerLabel']
    assert seen == []              # 시연 모드는 외부로 아무것도 보내지 않는다


def test_no_consent_no_upload(monkeypatch):
    seen = []
    fake_gemini(monkeypatch, seen)
    r = upload(b'photo-A', consent=False)
    assert not r['ok'] and r['error']['code'] == 'consent' and seen == []
