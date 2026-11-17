"""
routes.py — AI 기능 API (FastAPI 라우터)

  POST /api/ai/recognize    문제·블록선도 사진 → AI 인식 결과 + 엔진이 미리 해석한 전달함수 (사용자 확인용)
  POST /api/ai/handwriting  손글씨 풀이 사진 → AI 읽기 → 엔진 검증 → 비교 결과
  POST /api/ai/hint         단계·힌트 수준 → AI 설명 (엔진 숫자만 쓰는지 검사, 실패하면 팀 힌트)

공통 규칙
  - 사진은 consent=true(사용자가 외부 AI 전송에 동의)일 때만 보낸다.
  - 사진은 메모리에서만 처리하고 디스크에 저장하지 않는다.
  - 같은 사진은 다시 보내지 않도록 최근 결과를 사진 해시로 기억한다 (무료 한도 절약).
  - 서버 자체에도 호출 수 제한을 둔다 (남용 방지, 무료 한도 보호):
      전체 분당 PER_MINUTE회, 접속한 기기(IP)마다 분당 PER_IP회, 하루 AI_DAILY_LIMIT회(환경변수, 기본 300).
      Gemini 한도는 키가 아니라 Google 프로젝트 단위이므로, 공개 사이트가 시연용 한도를 다 쓰지 않게
      시연 노트북에는 별도 프로젝트의 키를 쓰는 것을 권한다 (docs/Gemini-점검.md).
  - demo=true 이면 모의 AI를 쓴다 (화면에 '모의 응답'으로 표시).
  - 시연 백업(AI_BACKUP=1일 때만): 성공한 사진 인식 결과(JSON, 사진은 아님)를 ai_backup/에 남겨 두고,
    나중에 같은 사진에서 AI 호출이 실패하면 그 결과를 '미리 받아 둔 실제 응답'이라고 밝히고 보여 준다.
    리허설 때 시연 사진을 한 번 인식해 두면, 본선 현장에서 인터넷·한도 문제가 생겨도 흐름이 끊기지 않는다.
"""
import hashlib
import json as _json
import os
import re
import time
from collections import OrderedDict, deque
from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile
from pydantic import BaseModel

from engine import parse, blockdiagram, hints
from . import get_provider, AIError
from .verify import verify_handwriting, check_numbers
from .prompts import HINT

router = APIRouter(prefix='/api/ai')
MAX_IMAGE = 6 * 1024 * 1024
ALLOWED = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}
PER_MINUTE = 12
PER_IP = 6
_calls: deque = deque()
_ip_calls: dict = {}
_day = {'date': None, 'n': 0}
_cache: 'OrderedDict[str, dict]' = OrderedDict()
BACKUP_DIR = Path(os.environ.get('AI_BACKUP_DIR') or Path(__file__).resolve().parent.parent / 'ai_backup')


def _daily_limit():
    try:
        return int(os.environ.get('AI_DAILY_LIMIT', '300'))
    except ValueError:
        return 300


def _rate_ok(ip=None):
    """외부 AI를 불러도 되는지: 전체 분당·기기별 분당·하루 상한을 모두 지켜야 True"""
    now = time.time()
    today = time.strftime('%Y-%m-%d')
    if _day['date'] != today:
        _day.update(date=today, n=0)
    if _day['n'] >= _daily_limit():
        return False
    while _calls and now - _calls[0] > 60:
        _calls.popleft()
    if len(_calls) >= PER_MINUTE:
        return False
    if ip:
        q = _ip_calls.setdefault(ip, deque())
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= PER_IP:
            return False
        q.append(now)
        if len(_ip_calls) > 500:                # 오래된 기기 기록 정리
            for k in [k for k, v in _ip_calls.items() if not v][:250]:
                _ip_calls.pop(k, None)
    _calls.append(now)
    _day['n'] += 1
    return True


def _backup_on():
    return os.environ.get('AI_BACKUP', '') == '1'


def _backup_keys(kind, data, photo_id):
    keys = [kind + '-' + hashlib.sha256(data).hexdigest()]
    if photo_id and re.fullmatch(r'[0-9a-f]{64}', photo_id):
        keys.append(kind + '-' + photo_id)      # 브라우저가 줄이기 전 원본 사진의 지문
    return keys


def _backup_save(keys, ai):
    if not _backup_on():
        return
    try:
        BACKUP_DIR.mkdir(exist_ok=True)
        for k in keys:
            (BACKUP_DIR / (k + '.json')).write_text(_json.dumps(ai, ensure_ascii=False), encoding='utf-8')
    except OSError:
        pass                                    # 백업 실패는 인식 결과에 영향 없음


def _backup_load(keys):
    if not _backup_on():
        return None
    for k in keys:
        f = BACKUP_DIR / (k + '.json')
        if f.exists():
            try:
                return _json.loads(f.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                return None
    return None


def _ip(request):
    return request.client.host if request and request.client else None


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
async def recognize(request: Request, image: UploadFile = File(...), consent: bool = Form(False),
                    demo: bool = Form(False), photoId: str = Form('')):
    provider = get_provider(demo)
    backup = None
    try:
        if not consent and not demo:
            raise AIError('consent', '사진을 외부 AI로 보내려면 동의가 필요합니다.')
        data, mime = await _read_image(image)
        key = 'rec:' + provider.name + hashlib.sha256(data).hexdigest()
        bkeys = _backup_keys('rec', data, photoId)
        if key in _cache:
            ai = _cache[key]
        else:
            try:
                if not _rate_ok(_ip(request)):
                    raise AIError('rateLimit', '요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.')
                ai = provider.extract_problem(data, mime)
            except AIError as e:
                # 실제 AI가 실패했을 때만: 같은 사진을 전에 읽어 둔 실제 응답이 있으면 그것을 밝히고 쓴다
                backup = None if (demo or e.code == 'consent') else _backup_load(bkeys)
                if backup is None:
                    raise
                ai = backup
            else:
                _remember(key, ai)
                if not demo:
                    _backup_save(bkeys, ai)
    except AIError as e:
        return _err(e, provider)
    out = {'ok': True, 'provider': provider.name, 'providerLabel': provider.label, 'ai': ai,
           'preview': _preview(ai), 'needsConfirm': True,
           'message': 'AI가 읽은 내용입니다. 식·부호·연결을 확인하고 고친 뒤 [확정]을 눌러야 계산을 시작합니다.'}
    used = getattr(provider, 'last_model', None)
    if used and used != getattr(provider, 'model', used):
        out['providerLabel'] = f'{provider.label} ({used}, 기본 모델이 응답하지 않아 대체 모델 사용)'
    if backup is not None:
        out['provider'] = provider.name + '-backup'
        out['providerLabel'] = '미리 받아 둔 실제 AI 응답'
        out['message'] = ('지금은 AI에 연결하지 못해, 이 사진을 전에 인식해 둔 실제 결과를 보여 드립니다. '
                          + out['message'])
    return out


@router.post('/handwriting')
async def handwriting(request: Request, image: UploadFile = File(...), problem: str = Form(...),
                      consent: bool = Form(False), demo: bool = Form(False)):
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
            if not _rate_ok(_ip(request)):
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
def hint(req: HintReq, request: Request):
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
        if not _rate_ok(_ip(request)):
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
