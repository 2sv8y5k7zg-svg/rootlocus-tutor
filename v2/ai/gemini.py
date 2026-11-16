"""
gemini.py — Google Gemini API 연결 (REST, httpx 사용)

확인한 공식 문서 (2026-11-17 KST 확인)
  - 주소: POST https://generativelanguage.googleapis.com/v1beta/models/{모델}:generateContent
          (https://ai.google.dev/api/generate-content)
  - 키 전달: 문서 예시대로 주소 뒤 ?key= (키는 서버 환경변수 GEMINI_API_KEY에서만 읽고, 로그·오류 문구에 남기지 않는다)
  - 사진: parts 안에 inline_data {mime_type, data(base64)}
  - JSON 응답 고정: generationConfig.response_mime_type = application/json, response_schema
  - 기본 모델: gemini-3.5-flash-lite — 모델 목록에서 'Stable', 가격표에서 무료 등급 'Free of charge',
    이미지 입력 가격이 표시된 모델. (https://aistudio.google.com/docs/models, /docs/pricing)
    무료 모델은 바뀔 수 있으므로 환경변수 GEMINI_MODEL로 바꿀 수 있게 했다.
  - 무료 등급은 입력 내용이 Google 제품 개선에 쓰인다("Used to improve our products: Yes", 가격표).
  - 무료 등급 호출 한도(분당·일일)는 공식 페이지를 이번에 읽지 못해 이 코드에 숫자로 넣지 않았다.
    한도 초과(HTTP 429)는 rateLimit 오류로 사용자에게 알린다.
"""
import base64
import json
import os

import httpx

from .base import AIProvider, AIError

API = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
DEFAULT_MODEL = 'gemini-3.5-flash-lite'
TIMEOUT = 40.0


class GeminiProvider(AIProvider):
    name = 'gemini'
    label = 'Google Gemini'
    sends_data_to = 'Google Gemini API (무료 등급은 입력 내용이 Google 제품 개선에 사용될 수 있음)'

    def __init__(self):
        self.model = os.environ.get('GEMINI_MODEL', DEFAULT_MODEL)

    def _key(self):
        return os.environ.get('GEMINI_API_KEY', '').strip()

    def available(self):
        return bool(self._key())

    # ───── 공통 호출 ─────
    def _call(self, parts, schema=None, temperature=0.1):
        key = self._key()
        if not key:
            raise AIError('noKey', '서버에 GEMINI_API_KEY가 설정되지 않아 AI 기능이 꺼져 있습니다. 계산 기능은 그대로 쓸 수 있습니다.')
        body = {'contents': [{'role': 'user', 'parts': parts}],
                'generationConfig': {'temperature': temperature}}
        if schema:
            body['generationConfig']['response_mime_type'] = 'application/json'
            body['generationConfig']['response_schema'] = schema
        try:
            r = httpx.post(API.format(model=self.model), params={'key': key}, json=body, timeout=TIMEOUT)
        except httpx.TimeoutException:
            raise AIError('network', 'AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.')
        except httpx.HTTPError:
            raise AIError('network', 'AI 서버에 연결하지 못했습니다.')
        if r.status_code == 429:
            raise AIError('rateLimit', 'AI 무료 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요. (계산·채점 기능은 계속 사용할 수 있습니다)')
        if r.status_code in (401, 403):
            raise AIError('noKey', 'AI 키가 올바르지 않거나 권한이 없습니다. 서버 관리자에게 알려 주세요.')
        if r.status_code >= 400:
            # 응답 본문에 요청 주소(키 포함)가 들어갈 수 있으므로 상태 코드만 전한다
            raise AIError('badResponse', f'AI 요청이 실패했습니다 (HTTP {r.status_code}).')
        try:
            data = r.json()
            cand = data['candidates'][0]
            if cand.get('finishReason') in ('SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'):
                raise AIError('blocked', 'AI가 이 요청에 답하지 않았습니다.')
            text = ''.join(p.get('text', '') for p in cand['content']['parts'])
        except AIError:
            raise
        except Exception:
            raise AIError('badResponse', 'AI 응답 형식이 예상과 다릅니다.')
        if schema:
            try:
                return json.loads(text)
            except Exception:
                raise AIError('badResponse', 'AI가 약속한 JSON 형식으로 답하지 않았습니다.')
        return text

    @staticmethod
    def _image(image, mime):
        return {'inline_data': {'mime_type': mime, 'data': base64.b64encode(image).decode('ascii')}}

    # ───── 세 가지 일 ─────
    def extract_problem(self, image, mime):
        from .prompts import EXTRACT, EXTRACT_SCHEMA
        return self._call([{'text': EXTRACT}, self._image(image, mime)], EXTRACT_SCHEMA)

    def read_handwriting(self, image, mime, problem_text):
        from .prompts import HANDWRITING, HANDWRITING_SCHEMA, FIELDS_DOC
        prompt = HANDWRITING.format(problem=problem_text, fields=FIELDS_DOC)
        return self._call([{'text': prompt}, self._image(image, mime)], HANDWRITING_SCHEMA)

    def explain(self, prompt):
        return self._call([{'text': prompt}], None, temperature=0.3)
