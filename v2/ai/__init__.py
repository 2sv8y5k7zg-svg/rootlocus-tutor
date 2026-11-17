"""
AI 연결 계층. 기본은 Gemini, 키가 없으면 AI 기능만 꺼진다(계산은 계속 동작).
환경변수
  AI_PROVIDER    gemini(기본) | mock(시연용 모의 AI)
  GEMINI_API_KEY 서버에만 두는 키 (HTML·JavaScript에 넣지 않는다)
  GEMINI_MODEL   기본 gemini-3.5-flash-lite
  GEMINI_FALLBACK_MODELS  기본 모델이 한도 초과·장애·폐지일 때 차례로 쓸 모델(쉼표로 구분, 기본 gemini-3.1-flash-lite)
  AI_DAILY_LIMIT 서버가 하루에 외부 AI를 부르는 최대 횟수(기본 300)
  AI_BACKUP      1이면 성공한 사진 인식 결과를 ai_backup/에 남기고, AI 실패 때 같은 사진이면 그 결과를 밝히고 보여 줌
"""
import os
from .base import AIError, AIProvider  # noqa: F401
from .gemini import GeminiProvider
from .mock import MockProvider

_PROVIDERS = {'gemini': GeminiProvider, 'mock': MockProvider}


def get_provider(demo: bool = False) -> AIProvider:
    if demo:
        return MockProvider()
    name = os.environ.get('AI_PROVIDER', 'gemini').lower()
    return _PROVIDERS.get(name, GeminiProvider)()


def status():
    p = get_provider()
    out = {'provider': p.name, 'label': p.label, 'available': p.available(), 'sendsDataTo': p.sends_data_to,
           'demoAvailable': True}
    if isinstance(p, GeminiProvider):
        out['model'] = p.model
        out['fallbackModels'] = p.models()[1:]
    out['backup'] = os.environ.get('AI_BACKUP', '') == '1'
    return out
