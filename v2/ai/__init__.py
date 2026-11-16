"""
AI 연결 계층. 기본은 Gemini, 키가 없으면 AI 기능만 꺼진다(계산은 계속 동작).
환경변수
  AI_PROVIDER    gemini(기본) | mock(시연용 모의 AI)
  GEMINI_API_KEY 서버에만 두는 키 (HTML·JavaScript에 넣지 않는다)
  GEMINI_MODEL   기본 gemini-3.5-flash-lite
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
    return out
