"""
gemini.py — Google Gemini API 연결 (REST, httpx 사용)

확인한 공식 문서 (2026-11-17 KST 확인)
  - 주소: POST https://generativelanguage.googleapis.com/v1beta/models/{모델}:generateContent
          (https://ai.google.dev/api/generate-content)
  - 키 전달: 공식 키 문서(https://ai.google.dev/gemini-api/docs/api-key)의 REST 예시대로 x-goog-api-key 헤더.
    주소(?key=)에 키를 넣지 않으므로 오류 메시지·접속 기록에 주소가 찍혀도 키가 남지 않는다.
  - 사진: parts 안에 inline_data {mime_type, data(base64)}. 요청 전체(글+사진) 20MB 이하
    (https://ai.google.dev/gemini-api/docs/image-understanding)
  - JSON 응답 고정: generationConfig.response_mime_type = application/json, response_schema
  - 기본 모델: gemini-3.5-flash-lite — 모델 목록 'Stable', 가격표 무료 등급 'Free of charge'.
    (https://aistudio.google.com/docs/models, /docs/pricing) 환경변수 GEMINI_MODEL로 바꿀 수 있다.
  - 호출 한도(https://ai.google.dev/gemini-api/docs/rate-limits, 2026-10-28 갱신):
    분당 요청·분당 토큰·하루 요청으로 재고, 키가 아니라 '프로젝트' 단위로 적용, 하루 한도는 태평양 시간 자정에 초기화.
    무료 등급 숫자는 이 페이지에 없고 AI Studio에서만 보인다. "보장되지 않는다"고 적혀 있다.
  - 오류 대처(https://ai.google.dev/gemini-api/docs/troubleshooting):
    429 RESOURCE_EXHAUSTED · 503 UNAVAILABLE · 408 · 5xx는 지수 백오프(+무작위 지연)로 횟수를 정해 재시도,
    400 · 403은 재시도하지 않는다.
  - 약관(https://ai.google.dev/gemini-api/terms): 무료(Unpaid) 등급은 입력·응답이 Google 제품 개선에 쓰이고
    사람이 검토할 수 있으며, 민감·기밀·개인정보를 보내지 말라고 한다. → 화면 동의 문구와 사진 전처리(위치정보 제거)에 반영.

예방·대처 (시연이 끊기지 않게)
  - 재시도: 일시 오류는 최대 RETRIES번, 0.8초·1.6초 + 무작위 지연. 전체 시간 예산 BUDGET초를 넘기지 않는다.
  - 대체 모델: GEMINI_FALLBACK_MODELS(쉼표로 여러 개, 기본 gemini-3.1-flash-lite)에 적은 모델로 차례로 넘어간다.
    AI Studio 한도 표는 모델별로 나뉘므로, 기본 모델 한도가 다 차도 다른 모델로 이어 갈 수 있다(팀 확인 필요).
    모델이 없어진 경우(404)도 바로 다음 모델로 넘어간다.
"""
import base64
import json
import os
import random
import re
import time

import httpx

from .base import AIProvider, AIError

API = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
DEFAULT_MODEL = 'gemini-3.5-flash-lite'
# 대체 모델: 가격표(2026-11-17 확인)에서 무료 등급·이미지 입력이 표시된 다른 Flash-Lite 모델.
# 환경변수 GEMINI_FALLBACK_MODELS로 바꿀 수 있고, 빈 값('')으로 두면 대체 모델을 쓰지 않는다.
DEFAULT_FALLBACKS = 'gemini-3.1-flash-lite'
TIMEOUT = 20.0      # 한 번 호출의 최대 대기(초)
BUDGET = 35.0       # 재시도·대체 모델까지 합친 전체 대기 한도(초). 시연 중 화면이 오래 멈추지 않게
RETRIES = 2         # 일시 오류일 때 같은 모델로 다시 시도하는 횟수
RETRY_STATUS = {408, 429, 500, 502, 503, 504}
# 응답을 거부·중단한 이유(finishReason). 이 값이면 내용이 없거나 믿을 수 없으므로 쓰지 않는다
BLOCK_REASONS = {'SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'OTHER'}


class GeminiProvider(AIProvider):
    name = 'gemini'
    label = 'Google Gemini'
    sends_data_to = ('Google Gemini 무료 등급: 보낸 사진과 답이 Google 제품 개선에 쓰이고 사람이 검토할 수 있습니다. '
                     '이름·학번 등 개인정보가 없는 문제 부분만 올려 주세요. 사진 속 위치정보는 보내기 전에 지웁니다.')

    def __init__(self):
        self.model = os.environ.get('GEMINI_MODEL', DEFAULT_MODEL)
        self.last_model = None      # 마지막으로 답한 모델 (대체 모델로 넘어갔는지 화면에 알리기 위해)

    def _key(self):
        return os.environ.get('GEMINI_API_KEY', '').strip()

    def available(self):
        return bool(self._key())

    def models(self):
        """시도할 모델 순서: 기본 모델 → 대체 모델들 (중복 제거)"""
        extra = [m.strip() for m in os.environ.get('GEMINI_FALLBACK_MODELS', DEFAULT_FALLBACKS).split(',') if m.strip()]
        out = []
        for m in [self.model] + extra:
            if m not in out:
                out.append(m)
        return out

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
        t0 = time.monotonic()
        last = AIError('network', 'AI 서버에 연결하지 못했습니다.')
        text = None
        for model in self.models():
            for attempt in range(RETRIES + 1):
                left = BUDGET - (time.monotonic() - t0)
                if left < 3:
                    raise last                    # 시간 예산을 다 씀
                try:
                    text = self._once(model, key, body, min(TIMEOUT, left))
                except _Retry as e:
                    last = e.error
                    wait = e.wait if e.wait is not None else 0.8 * (2 ** attempt) + random.uniform(0, 0.4)
                    if attempt < RETRIES and wait <= BUDGET - (time.monotonic() - t0) - 3:
                        time.sleep(wait)
                        continue                  # 같은 모델로 다시
                except _NextModel as e:
                    last = e.error
                break                             # 성공했거나, 이 모델은 포기하고 다음 모델로
            if text is not None:
                self.last_model = model
                break
        if text is None:
            raise last
        if schema:
            try:
                return json.loads(text)
            except Exception:
                raise AIError('badResponse', 'AI가 약속한 JSON 형식으로 답하지 않았습니다.')
        return text

    def _once(self, model, key, body, timeout):
        """한 모델에 한 번 요청. 성공하면 글자를 돌려주고, 실패하면 재시도·다음 모델·즉시 중단 중 하나를 알린다."""
        try:
            r = httpx.post(API.format(model=model), headers={'x-goog-api-key': key}, json=body, timeout=timeout)
        except httpx.TimeoutException:
            raise _Retry(AIError('network', 'AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'))
        except httpx.HTTPError:
            raise _Retry(AIError('network', 'AI 서버에 연결하지 못했습니다.'))
        st = r.status_code
        if st == 429:
            raise _Retry(AIError('rateLimit', 'AI 무료 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요. (계산·채점 기능은 계속 사용할 수 있습니다)'),
                         _retry_delay(r))
        if st in RETRY_STATUS:
            raise _Retry(AIError('busy', f'AI 서버가 잠시 응답하지 못했습니다 (HTTP {st}). 잠시 후 다시 시도해 주세요.'))
        if st == 404:
            raise _NextModel(AIError('badResponse', f'AI 모델({model})을 찾지 못했습니다. 모델 이름이 바뀌었을 수 있습니다.'))
        if st in (401, 403) or (st == 400 and 'API_KEY' in r.text):
            # 키 오류는 다른 모델로 바꿔도 같으므로 바로 멈춘다
            raise AIError('noKey', 'AI 키가 올바르지 않거나 권한이 없습니다. 서버 관리자에게 알려 주세요.')
        if st >= 400:
            # 응답 본문은 그대로 전하지 않는다 (상태 코드만)
            raise AIError('badResponse', f'AI 요청이 실패했습니다 (HTTP {st}).')
        try:
            data = r.json()
        except Exception:
            raise _Retry(AIError('badResponse', 'AI 응답 형식이 예상과 다릅니다.'))
        fb = (data.get('promptFeedback') or {}).get('blockReason')
        cands = data.get('candidates') or []
        if fb or not cands:
            raise AIError('blocked', 'AI가 이 사진(요청)에 답하지 않았습니다. 문제 부분만 잘라서 다시 올리거나 식을 직접 입력해 주세요.')
        cand = cands[0]
        reason = cand.get('finishReason')
        if reason in BLOCK_REASONS:
            raise AIError('blocked', 'AI가 이 사진(요청)에 답하지 않았습니다. 문제 부분만 잘라서 다시 올리거나 식을 직접 입력해 주세요.')
        try:
            text = ''.join(p.get('text', '') for p in cand['content']['parts'])
        except Exception:
            raise _Retry(AIError('badResponse', 'AI 응답 형식이 예상과 다릅니다.'))
        if reason == 'MAX_TOKENS' or not text.strip():
            raise _Retry(AIError('badResponse', 'AI 응답이 중간에 끊겼습니다.'))
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


class _Retry(Exception):
    """잠깐 뒤 다시 해 볼 만한 실패 (429, 503, 시간 초과 등). wait: 서버가 알려 준 대기 시간(초)"""
    def __init__(self, error, wait=None):
        self.error, self.wait = error, wait


class _NextModel(Exception):
    """이 모델로는 안 되니 다음 모델로 넘어갈 실패 (모델 없음 등)"""
    def __init__(self, error):
        self.error = error


def _retry_delay(r):
    """429 응답 본문의 RetryInfo.retryDelay("17s" 같은 값)를 초로 읽는다. 없으면 None."""
    try:
        for d in r.json().get('error', {}).get('details', []):
            m = re.match(r'^([0-9.]+)s$', str(d.get('retryDelay', '')))
            if m:
                return float(m.group(1))
    except Exception:
        pass
    return None
