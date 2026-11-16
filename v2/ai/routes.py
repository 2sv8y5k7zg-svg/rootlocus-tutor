"""
routes.py — AI 기능 API (FastAPI 라우터)

  POST /api/ai/recognize    문제·블록선도 사진 → AI 인식 결과 + 엔진이 미리 해석한 전달함수 (사용자 확인용)
  POST /api/ai/handwriting  손글씨 풀이 사진 → AI 읽기 → 엔진 검증 → 비교 결과
  POST /api/ai/hint         단계·힌트 수준 → AI 설명 (엔진 숫자만 쓰는지 검사, 실패하면 팀 힌트)

공통 규칙
  - 사진은 consent=true(사용자가 외부 AI 전송에 동의)일 때만 보낸다.
  - 사진은 메모리에서만 처리하고 디스크에 저장하지 않는다.
  - 같은 사진은 다시 보내지 않도록 최근 결과를 사진 해시로 기억한다 (무료 한도 절약).
  - 서버 자체에도 분당 호출 수 제한을 둔다 (남용 방지).
  - demo=true 이면 모의 AI를 쓴다 (화면에 '모의 응답'으로 표시).
"""
import hashlib
import time
from collections import OrderedDict, deque

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

from engine import parse, blockdiagram, hints
from . import get_provider, AIError
from .verify import verify_handwriting, check_numbers
from .prompts import HINT

router = APIRouter(prefix='/api/ai')
MAX_IMAGE = 6 * 1024 * 1024
ALLOWED = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}
PER_MINUTE = 12
_calls: deque = deque()
_cache: 'OrderedDict[str, dict]' = OrderedDict()


def _rate_ok():
    now = time.time()
    while _calls and now - _calls[0] > 60:
        _calls.popleft()
    if len(_calls) >= PER_MINUTE:
        return False
    _calls.append(now)
    return True


def _remember(key, value):
    _cache[key] = value
    if len(_cache) > 32:
        _cache.popitem(last=False)


def _err(e: AIError, provider):
    return {'ok': False, 'error': e.to_dict(), 'provider': provider.name, 'fallback': '계산·채점·팀 힌트는 계속 사용할 수 있습니다.'}


async def _read_image(file: UploadFile):
    data = await file.read()
    mime = (file.content_type or '').lower()
    if mime not in ALLOWED:
        raise AIError('badResponse', 'JPG, PNG, WEBP, HEIC 사진만 올릴 수 있습니다.')
    if len(data) > MAX_IMAGE:
        raise AIError('badResponse', '사진이 6MB보다 큽니다. 크기를 줄여 주세요.')
    return data, mime


def _preview(ai):
    """AI가 읽은 구조를 엔진으로 미리 해석해 화면에 보여 줄 값(계산 전 확인용)을 만든다."""
    out = {'loopText': None, 'T': None, 'charPoly': None, 'error': None, 'problem': None}
    try:
        if ai.get('kind') == 'blockDiagram' and ai.get('diagram') and ai['diagram'].get('blocks'):
            bd = blockdiagram.solve(ai['diagram'])
            out.update(loopText=bd['loop'].text(), T=bd['T'], charPoly=bd['charPoly'], problem={'diagram': ai['diagram']})
        elif ai.get('G'):
            bd = blockdiagram.from_g_h(ai['G'], ai.get('H') or '1', ai.get('feedbackSign') or '-')
            out.update(loopText=bd['loop'].text(), T=bd['T'], charPoly=bd['charPoly'], problem={'G': ai['G'], 'H': ai.get('H') or '1'})
        elif ai.get('tf'):
            loop = parse.parse_text(ai['tf'])
            out.update(loopText=loop.text(), charPoly=None, problem={'text': ai['tf']})
    except parse.InputError as e:
        out['error'] = e.to_dict()
    return out


@router.post('/recognize')
async def recognize(image: UploadFile = File(...), consent: bool = Form(False), demo: bool = Form(False)):
    provider = get_provider(demo)
    try:
        if not consent and not demo:
            raise AIError('consent', '사진을 외부 AI로 보내려면 동의가 필요합니다.')
        data, mime = await _read_image(image)
        key = 'rec:' + provider.name + hashlib.sha256(data).hexdigest()
        if key in _cache:
            ai = _cache[key]
        else:
            if not _rate_ok():
                raise AIError('rateLimit', '요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.')
            ai = provider.extract_problem(data, mime)
            _remember(key, ai)
    except AIError as e:
        return _err(e, provider)
    return {'ok': True, 'provider': provider.name, 'providerLabel': provider.label, 'ai': ai,
            'preview': _preview(ai), 'needsConfirm': True,
            'message': 'AI가 읽은 내용입니다. 식·부호·연결을 확인하고 고친 뒤 [확정]을 눌러야 계산을 시작합니다.'}


@router.post('/handwriting')
async def handwriting(image: UploadFile = File(...), problem: str = Form(...), consent: bool = Form(False),
                      demo: bool = Form(False)):
    import json
    from server.app import solve_problem   # 순환 import 방지
    provider = get_provider(demo)
    try:
        prob = json.loads(problem)
    except Exception:
        return {'ok': False, 'error': {'code': 'parse', 'message': '문제 형식이 잘못되었습니다.'}}
    _, res, _ = solve_problem(prob)
    if not res.get('ok'):
        return {'ok': False, 'error': res['error']}
    try:
        if not consent and not demo:
            raise AIError('consent', '사진을 외부 AI로 보내려면 동의가 필요합니다.')
        data, mime = await _read_image(image)
        key = 'hw:' + provider.name + hashlib.sha256(data + problem.encode()).hexdigest()
        if key in _cache:
            ai = _cache[key]
        else:
            if not _rate_ok():
                raise AIError('rateLimit', '요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.')
            ai = provider.read_handwriting(data, mime, res['input']['text'])
            _remember(key, ai)
    except AIError as e:
        return _err(e, provider)
    report = verify_handwriting(ai, res)
    return {'ok': True, 'provider': provider.name, 'providerLabel': provider.label, 'ai': ai, 'report': report,
            'note': '근궤적 그림 자체는 AI가 채점하지 않습니다. 곡선은 Python 엔진 결과를 보세요.'}


class HintReq(BaseModel):
    problem: dict
    step: int
    level: int = 1
    student: str | None = None
    verdict: dict | None = None
    demo: bool = False


@router.post('/hint')
def hint(req: HintReq):
    from server.app import solve_problem
    _, res, _ = solve_problem(req.problem)
    if not res.get('ok') or not (1 <= req.step <= 9):
        return {'ok': False, 'error': res.get('error') or {'code': 'parse', 'message': '단계 번호가 잘못되었습니다.'}}
    st = res['steps'][req.step - 1]
    level = max(1, min(4, req.level))
    team = hints.ladder(st)[level - 1]
    provider = get_provider(req.demo)
    prompt = HINT.format(level=level, step=st['n'], title=st['title'], formula=st['formula'],
                         work='\n'.join(st['work']), team_hint=team['text'],
                         student=req.student or '(아직 없음)',
                         verdict=(req.verdict or {}).get('status', '(채점 전)') + ' / ' + str((req.verdict or {}).get('diagnosis') or ''))
    base = {'team': team, 'step': st['n']}
    try:
        if not provider.available():
            raise AIError('noKey', 'AI가 설정되지 않아 팀이 쓴 힌트를 보여 드립니다.')
        if not _rate_ok():
            raise AIError('rateLimit', '요청이 많아 팀이 쓴 힌트를 보여 드립니다.')
        text = provider.explain(prompt)
    except AIError as e:
        return {'ok': True, 'source': 'team', 'text': team['text'], 'aiError': e.to_dict(), **base}
    # AI가 엔진에 없는 숫자를 썼는지 검사 → 있으면 AI 설명을 쓰지 않고 팀 힌트로 바꾼다
    bad = check_numbers(text, st['work'] + [st['formula'], team['text'], req.student or ''])
    if bad:
        return {'ok': True, 'source': 'team', 'text': team['text'], 'rejectedAI': text, 'unknownNumbers': bad,
                'warning': '엔진 계산에 없는 숫자가 들어 있어 AI 설명 대신 팀 힌트를 보여 드립니다.', **base}
    return {'ok': True, 'source': provider.name, 'providerLabel': provider.label, 'text': text, **base}
