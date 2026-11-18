"""
run_tests.py — 검증 문제 전체를 실제로 실행하고 결과 보고서를 만든다.

    python tests/run_tests.py            → 화면 출력 + tests/results.json + docs/테스트-결과.md

검사 묶음
  A. 기존 저장소 17문제 (T01~T15, T13·T14a~c): 기존 프로젝트의 기준 정답(tests/data/legacy_expected.json,
     기존 tools/reference.py가 sympy로 만든 값)과 새 Python 엔진 결과를 비교
  B. 새 문제 19개 (T16~T34): 손으로 푼 정확한 값(tests/data/new_problems.json)과 비교
  C. 모든 정상 문제: python-control(별도 라이브러리)의 폐루프 극점·근궤적과 겹쳐 보기
     (python-control이 설치되어 있지 않으면 C는 '건너뜀'으로 기록, 통과로 세지 않음)
  D. 엔진의 단계별 자체 검증(check.status)이 9단계 모두 verified 인지
"""
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import sympy as sp

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from engine import solver, parse, blockdiagram  # noqa: E402

try:
    import control  # python-control
except Exception:  # pragma: no cover
    control = None

TOL = 1e-7


def close(a, b, tol=TOL):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def ev(x):
    return complex(sp.N(sp.sympify(x), 30))


def same_multiset(a, b, tol):
    a, b = list(a), list(b)
    if len(a) != len(b):
        return False
    for z in a:
        j = int(np.argmin([abs(z - w) for w in b])) if b else -1
        if j < 0 or abs(z - b[j]) > tol * max(1.0, abs(z)):
            return False
        b.pop(j)
    return True


def angle_eq(a, b, tol=1e-6):
    d = math.fmod(abs(a - b), 360.0)
    return min(d, 360.0 - d) < tol


class Report:
    def __init__(self, pid, title):
        self.pid, self.title, self.items = pid, title, []

    def check(self, name, okv, expected='', actual='', cause=''):
        self.items.append({'name': name, 'ok': bool(okv), 'expected': str(expected), 'actual': str(actual),
                           'cause': '' if okv else cause})

    @property
    def ok(self):
        return all(i['ok'] for i in self.items if i['ok'] is not None)


# ─────────────────── 결과에서 값 꺼내기 ───────────────────

def expanded(lst):
    out = []
    for p in lst:
        for _ in range(p['mult']):
            out.append(complex(p['re'], p['im']))
    return out


def get_step(res, n):
    return res['steps'][n - 1]


def seg_list(res):
    return get_step(res, 3)['result']['segments']


def common_checks(rep, res, n_expected=None):
    """D. 엔진 자체 검증 + 가지 수"""
    failed = res['verification']['failed']
    rep.check('엔진 단계별 자체 검증 9/9', not failed, '9/9', f'{9 - len(failed)}/9 (실패 단계 {failed})',
              '엔진 내부 교차 확인 실패')
    br = res['graph']['branches']
    rep.check('가지 수 = 분모 차수', len(br) == res['input']['n'], res['input']['n'], len(br), '가지 계산 오류')


# ─────────────────── A. 기존 17문제 ───────────────────

def legacy():
    probs = json.loads((ROOT / 'tests/data/legacy_problems.json').read_text(encoding='utf-8'))['problems']
    exps = {e['id']: e for e in json.loads((ROOT / 'tests/data/legacy_expected.json').read_text(encoding='utf-8'))['results']}
    reports = []
    for pr in probs:
        rep = Report(pr['id'], pr['title'])
        t0 = time.perf_counter()
        res = solver.analyze_factors(pr['num'], pr['den'])
        rep.ms = (time.perf_counter() - t0) * 1000
        rep.input = pr['title']
        exp = exps[pr['id']]
        if pr.get('expectError'):
            code = None if res['ok'] else res['error']['code']
            rep.check('지원 밖 입력 안내', code == pr['expectError'], pr['expectError'], code or '계산해 버림',
                      '지원 범위 판정 오류')
            reports.append((rep, res))
            continue
        if not res['ok']:
            rep.check('분석 성공', False, '계산 결과', res['error'], '엔진 오류')
            reports.append((rep, res))
            continue
        st2 = get_step(res, 2)['result']
        ep = [complex(*p['s']) for p in exp['poles'] for _ in range(p['mult'])]
        ez = [complex(*p['s']) for p in exp['zeros'] for _ in range(p['mult'])]
        rep.check('극점', same_multiset(expanded(st2['poles']), ep, 1e-8), ep, expanded(st2['poles']), '근 계산 차이')
        rep.check('영점', same_multiset(expanded(st2['zeros']), ez, 1e-8), ez, expanded(st2['zeros']), '근 계산 차이')
        segs = seg_list(res)
        es = exp['realAxisSegments']
        sok = len(segs) == len(es) and all(
            ((a['hi'] is None) == (b['hi'] is None)) and ((a['lo'] is None) == (b['lo'] is None)) and
            (a['hi'] is None or close(a['hi'], b['hi'])) and (a['lo'] is None or close(a['lo'], b['lo']))
            for a, b in zip(sorted(segs, key=lambda g: -(g['hi'] if g['hi'] is not None else 1e9)),
                            sorted(es, key=lambda g: -(g['hi'] if g['hi'] is not None else 1e9))))
        rep.check('실수축 구간', sok, es, [(g['lo'], g['hi']) for g in segs], '홀짝 규칙 적용 차이')
        a4 = get_step(res, 4)['result']
        if exp['asymptotes'] is None:
            rep.check('점근선 없음', a4['count'] == 0, '없음', a4['count'], '')
        else:
            cen = a4['centroid']['approx']
            aok = close(cen, exp['asymptotes']['centroid']) and len(a4['angles']) == len(exp['asymptotes']['angles']) and \
                all(close(x, y) for x, y in zip(a4['angles'], exp['asymptotes']['angles']))
            rep.check('점근선 중심·각도', aok, exp['asymptotes'], (cen, a4['angles']), '점근선 공식 적용 차이')
        # 이탈점·진입점: 위치와 판정이 모두 같아야 함
        bc = get_step(res, 5)['result']['candidates']
        eb = exp['breakCandidates']
        bok = len(bc) == len(eb)
        if bok:
            for e in eb:
                z = complex(*e['s'])
                hit = [c for c in bc if abs(complex(*c['s']) - z) < 1e-7 * max(1, abs(z))]
                if not hit or hit[0]['status'] != e['status']:
                    bok = False
        rep.check('이탈점·진입점 판정', bok, [(e['s'], e['status']) for e in eb], [(c['s'], c['status']) for c in bc],
                  '후보 판정 차이')
        items = get_step(res, 6)['result']['items']
        ea = exp['angles']
        aok = len(items) == len(ea)
        if aok:
            for e in ea:
                hit = [i for i in items if i['kind'] == e['kind'] and abs(complex(*i['at']) - complex(*e['at'])) < 1e-7]
                if not hit or len(hit[0]['angles']) != len(e['angles']) or \
                        not all(any(angle_eq(x, y) for x in hit[0]['angles']) for y in e['angles']):
                    aok = False
        rep.check('출발각·도착각', aok, [(e['kind'], e['angles']) for e in ea], [(i['kind'], i['angles']) for i in items],
                  '각 조건 계산 차이')
        r7 = get_step(res, 7)['result']
        cr = r7['crossings']
        ec = exp['crossings']
        cok = len(cr) == len(ec) and all(close(a['omega'], b['omega'], 1e-8) and close(a['K'], b['K'], 1e-8)
                                         for a, b in zip(cr, ec))
        rep.check('허수축 교차', cok, [(c['omega'], c['K']) for c in ec], [(c['omega'], c['K']) for c in cr], 'jω 대입 풀이 차이')
        target = exp['stableSetRouth'] if exp['stableSetRouth'] is not None else exp['stableSetNumeric']
        st = r7['stable']
        sok = len(st) == len(target) and all(
            close(a['lo'], b['lo']) and ((a['hi'] is None) == (b['hi'] is None)) and (a['hi'] is None or close(a['hi'], b['hi']))
            for a, b in zip(st, target))
        rep.check('안정한 K 범위', sok, target, st, '안정 범위 판정 차이')
        rep.check('Routh 특수 경우 감지', (exp['routhSpecial'] is None) == (len(r7['specials']) == 0),
                  exp['routhSpecial'], [x['kind'] for x in r7['specials']], 'Routh 특수 경우 처리 차이')
        # K별 폐루프 극점: numpy 기준값과 비교
        from engine.branches import poles_at
        loop = parse.from_factors(pr['num'], pr['den'])
        clok = True
        for smp in exp['closedLoop']:
            got = [complex(p['re'], p['im']) for p in poles_at(loop, smp['K'])['poles']]
            if not same_multiset(got, [complex(*r) for r in smp['roots']], 1e-6):
                clok = False
        rep.check('K별 폐루프 극점 (8개 K)', clok, '기준 numpy 값', '일치' if clok else '불일치', '폐루프 극점 계산 차이')
        common_checks(rep, res)
        reports.append((rep, res))
    return reports


# ─────────────────── B. 새 문제 ───────────────────

def run_input(inp):
    """문제의 입력 형식(text / G,H / diagram)에 맞게 엔진을 부른다."""
    if 'text' in inp:
        return solver.analyze_text(inp['text']), None
    try:
        if 'diagram' in inp:
            bd = blockdiagram.solve(inp['diagram'])
        else:
            bd = blockdiagram.from_g_h(inp['G'], inp.get('H', '1'))
    except parse.InputError as e:
        return {'ok': False, 'error': e.to_dict()}, None
    return solver.analyze(bd['loop']), bd


def new_problems():
    probs = json.loads((ROOT / 'tests/data/new_problems.json').read_text(encoding='utf-8'))['problems']
    reports = []
    for pr in probs:
        rep = Report(pr['id'], pr['title'])
        rep.input = json.dumps(pr['input'], ensure_ascii=False)
        t0 = time.perf_counter()
        res, bd = run_input(pr['input'])
        rep.ms = (time.perf_counter() - t0) * 1000
        ex = pr['expect']
        if 'error' in ex:
            code = None if res['ok'] else res['error']['code']
            rep.check('지원 밖 입력 안내', code == ex['error'], ex['error'], code or '계산해 버림', '지원 범위 판정 오류')
            reports.append((rep, res))
            continue
        if not res['ok']:
            rep.check('분석 성공', False, '계산 결과', res['error'], '엔진 오류')
            reports.append((rep, res))
            continue
        if 'L' in ex:
            want = sp.sympify(ex['L'], locals={'K': sp.Symbol('K'), 's': sp.Symbol('s')})
            s_, K_ = sp.Symbol('s'), sp.Symbol('K')
            Np = sum(sp.Rational(c) * s_ ** (len(res['steps'][0]['result']['N']) - 1 - i) for i, c in enumerate(res['steps'][0]['result']['N']))
            Dp = sum(sp.Rational(c) * s_ ** (len(res['steps'][0]['result']['D']) - 1 - i) for i, c in enumerate(res['steps'][0]['result']['D']))
            okL = sp.simplify(K_ * Np / Dp - want) == 0
            rep.check('루프 전달함수 L(s)', okL, ex['L'], bd['L'] if bd else '', '블록선도 해석 차이')
        if ex.get('notes'):
            rep.check('가정 안내 표시', bool(res['input']['notes']), '안내 있음', res['input']['notes'], '가정 안내 누락')
        st2 = get_step(res, 2)['result']
        if 'poles' in ex:
            want = [ev(x) for x in ex['poles']]
            rep.check('극점', same_multiset(expanded(st2['poles']), want, 1e-8), ex['poles'], [p['text'] for p in st2['poles']], '근 계산 차이')
        if 'zeros' in ex:
            want = [ev(x) for x in ex['zeros']]
            rep.check('영점', same_multiset(expanded(st2['zeros']), want, 1e-8), ex['zeros'], [p['text'] for p in st2['zeros']], '근 계산 차이')
        if 'segments' in ex:
            segs = seg_list(res)
            want = [(None if a is None else ev(a).real, ev(b).real) for a, b in ex['segments']]
            got = [(g['lo'], g['hi']) for g in segs]
            okS = len(want) == len(got) and all(any(((w[0] is None and g[0] is None) or (w[0] is not None and g[0] is not None and close(w[0], g[0])))
                                                    and g[1] is not None and close(w[1], g[1]) for g in got) for w in want)
            rep.check('실수축 구간', okS, ex['segments'], got, '홀짝 규칙 적용 차이')
        a4 = get_step(res, 4)['result']
        if 'centroid' in ex:
            okc = a4['centroid'] is not None and close(a4['centroid']['approx'], ev(ex['centroid']).real)
            rep.check('점근선 중심', okc, ex['centroid'], a4['centroid'] and a4['centroid']['text'], '점근선 중심 공식 차이')
        if 'angles' in ex:
            rep.check('점근선 각도', len(a4['angles']) == len(ex['angles']) and all(close(x, y) for x, y in zip(a4['angles'], ex['angles'])),
                      ex['angles'], a4['angles'], '점근선 각도 차이')
        bc = get_step(res, 5)['result']['candidates']
        for b in ex.get('breaks', []):
            z = ev(b['s'])
            hit = [c for c in bc if abs(complex(*c['s']) - z) < 1e-7 * max(1, abs(z))]
            okb = bool(hit) and hit[0]['status'] == b['status']
            if okb and 'K' in b:
                okb = not isinstance(hit[0]['K'], list) and close(hit[0]['K'], ev(b['K']).real)
            rep.check(f'이탈·진입 후보 {b["s"]}', okb, (b['status'], b.get('K')),
                      (hit[0]['status'], hit[0]['K']) if hit else '후보 없음', '후보 판정 차이')
        if 'validBreaks' in ex:
            nv = len(get_step(res, 5)['result']['valid'])
            rep.check('유효 이탈·진입점 개수', nv == ex['validBreaks'], ex['validBreaks'], nv, '후보 판정 차이')
        items = get_step(res, 6)['result']['items']
        for key, kind in (('departure', 'departure'), ('arrival', 'arrival')):
            for d in ex.get(key, []):
                at = ev(d['at'])
                hit = [i for i in items if i['kind'] == kind and abs(complex(*i['at']) - at) < 1e-7]
                want = [ev(a).real for a in d['angles']]
                oka = bool(hit) and len(hit[0]['angles']) == len(want) and all(any(angle_eq(x, y) for x in hit[0]['angles']) for y in want)
                rep.check(('출발각 ' if kind == 'departure' else '도착각 ') + d['at'], oka, [round(w, 4) for w in want],
                          hit[0]['angles'] if hit else '없음', '각 조건 계산 차이')
        r7 = get_step(res, 7)['result']
        if 'crossings' in ex:
            want = sorted([(ev(c['omega']).real, ev(c['K']).real) for c in ex['crossings']], key=lambda t: (t[1], t[0]))
            got = [(c['omega'], c['K']) for c in r7['crossings']]
            okc = len(want) == len(got) and all(close(a[0], b[0], 1e-8) and close(a[1], b[1], 1e-8) for a, b in zip(want, got))
            rep.check('허수축 교차 (ω, K)', okc, want, got, 'jω 대입 풀이 차이')
        if 'stable' in ex:
            want = ex['stable']
            got = r7['stable']
            oks = len(want) == len(got)
            if oks:
                for w, g in zip(want, got):
                    if not close(ev(w['lo']).real, g['lo']):
                        oks = False
                    if (w['hi'] is None) != (g['hi'] is None) or (w['hi'] is not None and not close(ev(w['hi']).real, g['hi'])):
                        oks = False
                    if w['loIncl'] != g['loIncl'] or w['hiIncl'] != g['hiIncl']:
                        oks = False
            rep.check('안정한 K 범위 (경계 포함 여부까지)', oks, want, [(g['lo'], g['hi'], g['loIncl'], g['hiIncl']) for g in got], '안정 범위 판정 차이')
        if 'routhSpecial' in ex:
            kinds = [x['kind'] for x in r7['specials']]
            okr = (ex['routhSpecial'] is None and not kinds) or (ex['routhSpecial'] in kinds)
            rep.check('Routh 특수 경우', okr, ex['routhSpecial'], kinds, 'Routh 특수 경우 처리 차이')
        common_checks(rep, res)
        reports.append((rep, res))
    return reports


# ─────────────────── C. python-control 대조 ───────────────────

def control_crosscheck(rep, res):
    """python-control로 같은 시스템을 만들어 ① 폐루프 극점 ② 근궤적 모양을 비교한다."""
    if control is None:
        rep.items.append({'name': 'python-control 대조', 'ok': None, 'expected': '', 'actual': '설치 안 됨 → 건너뜀', 'cause': ''})
        return
    N = [float(sp.Rational(c)) for c in res['steps'][0]['result']['N']]
    D = [float(sp.Rational(c)) for c in res['steps'][0]['result']['D']]
    L = control.tf(N, D)
    ok1 = True
    for k in (0.5, 2.0, 7.0):
        cl = control.feedback(k * L, 1)
        pc = control.poles(cl)
        # 엔진 공개 함수(poles_at)로 같은 K의 극점
        from engine.branches import poles_at
        ours = [complex(p['re'], p['im']) for p in poles_at(_loop_from_res(res), k)['poles']]
        if not same_multiset(ours, list(pc), 1e-6):
            ok1 = False
    rep.check('python-control 폐루프 극점 (K=0.5, 2, 7)', ok1, 'control.feedback 극점', '일치' if ok1 else '불일치', '폐루프 극점 차이')
    # 근궤적 모양: control이 계산한 점들이 엔진 곡선에서 얼마나 떨어져 있는지 (화면 대각선 대비)
    v = res['graph']['view']
    span = math.hypot(v['xmax'] - v['xmin'], v['ymax'] - v['ymin'])
    kv = np.array(res['graph']['K'])
    kmax = float(kv[-1])
    gains = np.concatenate([[0.0], np.geomspace(1e-4, kmax, 300)])
    try:
        rl = control.root_locus_map(L, gains=gains)
        pts = np.array(rl.loci).ravel()
    except Exception:
        roots, _ = control.root_locus(L, gains=gains, plot=False)
        pts = np.array(roots).ravel()
    ours = np.array([complex(x, y) for b in res['graph']['branches'] for x, y in b])
    inside = [p for p in pts if v['xmin'] <= p.real <= v['xmax'] and v['ymin'] <= p.imag <= v['ymax']]
    worst = 0.0
    for p in inside:
        worst = max(worst, float(np.min(np.abs(ours - p))))
    okm = worst <= 0.005 * span
    rep.check('python-control 근궤적과 겹침 (화면 대각선 0.5% 이내)', okm, '≤ 0.5%', f'{worst / span * 100:.3f}%', '곡선 모양 차이')


def _loop_from_res(res):
    N = [sp.Rational(c) for c in res['steps'][0]['result']['N']]
    D = [sp.Rational(c) for c in res['steps'][0]['result']['D']]
    return parse.from_coeffs(N, D)


# ─────────────────── 실행과 보고 ───────────────────

def main():
    all_reports = []
    t0 = time.perf_counter()
    for group, fn in (('A 기존 17문제', legacy), ('B 새 문제', new_problems)):
        for rep, res in fn():
            rep.group = group
            if res.get('ok'):
                control_crosscheck(rep, res)
            all_reports.append(rep)
    total_items = sum(1 for r in all_reports for i in r.items if i['ok'] is not None)
    pass_items = sum(1 for r in all_reports for i in r.items if i['ok'])
    skipped = sum(1 for r in all_reports for i in r.items if i['ok'] is None)
    pass_probs = sum(1 for r in all_reports if r.ok)
    elapsed = time.perf_counter() - t0
    for r in all_reports:
        mark = '통과' if r.ok else '실패'
        n_ok = sum(1 for i in r.items if i['ok'])
        n_all = sum(1 for i in r.items if i['ok'] is not None)
        print(f'[{mark}] {r.pid:5s} {r.title:38s} {n_ok}/{n_all}  ({r.ms:.0f} ms)')
        for i in r.items:
            if i['ok'] is False:
                print(f'       ✗ {i["name"]}: 기대 {i["expected"]} / 실제 {i["actual"]} / 원인 {i["cause"]}')
    print(f'\n문제 {pass_probs}/{len(all_reports)} 통과, 검사 항목 {pass_items}/{total_items} 통과'
          + (f', 건너뜀 {skipped}' if skipped else '') + f'  (총 {elapsed:.1f}초)')
    out = {'when': time.strftime('%Y-%m-%d %H:%M:%S'), 'problems': len(all_reports), 'problemsPassed': pass_probs,
           'items': total_items, 'itemsPassed': pass_items, 'skipped': skipped, 'seconds': round(elapsed, 2),
           'control': getattr(control, '__version__', None), 'sympy': sp.__version__, 'numpy': np.__version__,
           'reports': [{'id': r.pid, 'group': r.group, 'title': r.title, 'input': r.input, 'ok': r.ok, 'ms': round(r.ms, 1),
                        'items': r.items} for r in all_reports]}
    (ROOT / 'tests/results.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    return 0 if pass_probs == len(all_reports) else 1


if __name__ == '__main__':
    sys.exit(main())
