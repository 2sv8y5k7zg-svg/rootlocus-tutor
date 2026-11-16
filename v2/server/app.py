"""
app.py — FastAPI 서버 (웹사이트 + 계산 엔진 API + AI 중계를 한 프로그램에서)

실행:  python run.py   (또는 uvicorn server.app:app --port 8000)

주소
  GET  /                  랜딩 페이지 (web/index.html)
  GET  /learn             학습 화면   (web/learn.html)
  GET  /api/health        서버·AI 상태
  POST /api/analyze       문제 → 9단계 풀이 + 그래프 데이터 + 힌트
  POST /api/check         학생 답 하나 채점
  POST /api/poles         K 하나 → 폐루프 극점
  POST /api/gain          그래프 위 한 점 → 그 점의 K (크기 조건)
  POST /api/diagram       블록선도 구조 → 전달함수 (사용자 확인용, 계산 전 단계)
  POST /api/ai/...        AI 기능 (ai/routes.py). AI가 꺼져 있어도 위 계산 API는 그대로 동작한다.

문제 입력(problem) 형식은 네 가지 중 하나:
  {"text": "K(s+2)/(s(s+1))"}
  {"G": "K/(s(s+1))", "H": "(s+2)/(s+4)"}
  {"diagram": {...블록선도 구조...}}
  {"num": [[1, 2]], "den": [[1, 0], [1, 1]]}     (인수별 계수)
"""
import json
from collections import OrderedDict
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from engine import solver, parse, blockdiagram, grader, hints
from engine.branches import poles_at, gain_at_point

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / 'web'

app = FastAPI(title='근궤적 AI 튜터', version='2.0')


# ───────────────────── 문제 해석 + 결과 캐시 ─────────────────────
# 같은 문제를 여러 번 채점할 때 매번 9단계를 다시 계산하지 않도록 최근 64개 결과를 기억한다.
_CACHE: 'OrderedDict[str, tuple]' = OrderedDict()


def _key(problem: dict) -> str:
    return json.dumps(problem, sort_keys=True, ensure_ascii=False)


def solve_problem(problem: dict):
    """problem → (Loop 또는 None, 결과 사전, 블록선도 정보 또는 None)"""
    k = _key(problem)
    if k in _CACHE:
        _CACHE.move_to_end(k)
        return _CACHE[k]
    bd_info = None
    try:
        if 'text' in problem:
            loop = parse.parse_text(problem['text'])
        elif 'diagram' in problem:
            bd = blockdiagram.solve(problem['diagram'])
            loop, bd_info = bd['loop'], {x: bd[x] for x in bd if x != 'loop'}
        elif 'G' in problem:
            bd = blockdiagram.from_g_h(problem['G'], problem.get('H', '1'), problem.get('sign', '-'))
            loop, bd_info = bd['loop'], {x: bd[x] for x in bd if x != 'loop'}
        elif 'num' in problem and 'den' in problem:
            loop = parse.from_factors(problem['num'], problem['den'])
        else:
            raise parse.InputError('parse', '문제 형식을 알 수 없습니다 (text, G/H, diagram, num/den 중 하나).')
    except parse.InputError as e:
        out = (None, {'ok': False, 'error': e.to_dict()}, None)
        return out
    try:
        res = solver.analyze(loop)
    except Exception as e:  # 계산 중 예상하지 못한 오류 → 정답을 지어내지 않고 '검증 불가'
        res = {'ok': False, 'error': {'code': 'engineError', 'message': f'계산 중 오류(검증 불가): {type(e).__name__}'}}
    if res.get('ok'):
        for st in res['steps']:
            st['hints'] = hints.ladder(st)
        if bd_info:
            bd_info['unityFeedback'] = bool(bd_info.get('unityFeedback'))
            res['diagram'] = bd_info
    out = (loop, res, bd_info)
    _CACHE[k] = out
    if len(_CACHE) > 64:
        _CACHE.popitem(last=False)
    return out


# ───────────────────── 요청 모양 ─────────────────────

class AnalyzeReq(BaseModel):
    problem: dict


class CheckReq(BaseModel):
    problem: dict
    field: str
    answer: str
    K: float | None = None


class PolesReq(BaseModel):
    problem: dict
    K: float


class GainReq(BaseModel):
    problem: dict
    re: float
    im: float


class DiagramReq(BaseModel):
    diagram: dict | None = None
    G: str | None = None
    H: str | None = None


# ───────────────────── 계산 API ─────────────────────

@app.get('/api/health')
def health():
    from ai import status as ai_status
    return {'ok': True, 'engine': 'python', 'ai': ai_status()}


@app.post('/api/analyze')
def analyze(req: AnalyzeReq):
    _, res, _ = solve_problem(req.problem)
    return res


@app.post('/api/check')
def check(req: CheckReq):
    if req.field not in {f for fs in grader.FIELDS.values() for f, _ in fs}:
        raise HTTPException(400, f'모르는 항목: {req.field}')
    _, res, _ = solve_problem(req.problem)
    return grader.check(res, req.field, req.answer, req.K)


@app.post('/api/poles')
def poles(req: PolesReq):
    loop, res, _ = solve_problem(req.problem)
    if loop is None:
        return res
    if not (0 <= req.K < 1e12):
        raise HTTPException(400, 'K는 0 이상이어야 합니다.')
    return poles_at(loop, req.K)


@app.post('/api/gain')
def gain(req: GainReq):
    loop, res, _ = solve_problem(req.problem)
    if loop is None:
        return res
    return gain_at_point(loop, req.re, req.im)


@app.post('/api/diagram')
def diagram(req: DiagramReq):
    """블록선도를 계산 전에 미리 해석해 사용자에게 확인받기 위한 API"""
    try:
        if req.diagram:
            bd = blockdiagram.solve(req.diagram)
        elif req.G:
            bd = blockdiagram.from_g_h(req.G, req.H or '1')
        else:
            raise parse.InputError('parse', '블록선도나 G(s)가 필요합니다.')
    except parse.InputError as e:
        return {'ok': False, 'error': e.to_dict()}
    loop = bd.pop('loop')
    bd['unityFeedback'] = bool(bd.get('unityFeedback'))
    return {'ok': True, **bd, 'loopText': loop.text()}


@app.get('/api/fields')
def fields():
    """단계별 답 입력 칸 목록 (화면이 이 목록으로 입력 칸을 만든다)"""
    return {str(n): [{'field': f, 'label': lb} for f, lb in fs] for n, fs in grader.FIELDS.items()}


# ───────────────────── AI 중계 ─────────────────────
from ai.routes import router as ai_router  # noqa: E402
app.include_router(ai_router)


# ───────────────────── 웹 페이지 ─────────────────────

@app.get('/')
def index():
    return FileResponse(WEB / 'index.html')


@app.get('/learn')
def learn():
    return FileResponse(WEB / 'learn.html')


app.mount('/static', StaticFiles(directory=WEB), name='static')


@app.exception_handler(Exception)
def on_error(_, exc):  # pragma: no cover
    return JSONResponse({'ok': False, 'error': {'code': 'serverError', 'message': '서버 오류가 났습니다.'}}, status_code=500)
