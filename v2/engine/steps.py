"""
steps.py — 근궤적 1~6단계 계산 (수업 풀이 순서)

각 함수는 같은 모양의 '단계 결과' 사전(dict)을 돌려준다.
    title    단계 이름
    formula  적용 공식 (글자)
    inputs   계산에 사용한 값
    work     중간 계산식 (한 줄씩)
    result   최종 결과 (채점·그래프에 쓰는 값)
    check    수학적 검증 상태 {'status': verified | failed | unverifiable, 'method', 'detail'}
    graph    그래프 표시 데이터

check는 '같은 답을 다른 방법으로 한 번 더 구해서 맞는지' 확인한 결과다.
예) 극점: 인수분해로 구한 근 ↔ numpy 고유값 방식(np.roots)으로 구한 근
"""
import cmath
import math
import numpy as np
import sympy as sp
from . import fmt, roots as R

s, K = fmt.s, fmt.K


# ───────────────────────── 공통 도구 ─────────────────────────

def make_step(n, key, title, formula, inputs, work, result, check, graph=None):
    return {'n': n, 'key': key, 'title': title, 'formula': formula, 'inputs': inputs,
            'work': work, 'result': result, 'check': check, 'graph': graph or {}}


def ok(method, detail=''):
    return {'status': 'verified', 'method': method, 'detail': detail}


def fail(method, detail=''):
    return {'status': 'failed', 'method': method, 'detail': detail}


def floats(P):
    """sympy Poly → numpy용 실수 계수 배열 (내림차순)."""
    return np.array([float(c) for c in P.all_coeffs()], dtype=float)


def same_multiset(a, b, tol):
    """복소수 목록 두 개가 순서와 상관없이 같은지 (가장 가까운 것끼리 짝지어 비교)."""
    a, b = list(a), list(b)
    if len(a) != len(b):
        return False
    for z in a:
        best, bd = -1, 1e300
        for i, w in enumerate(b):
            d = abs(z - w)
            if d < bd:
                best, bd = i, d
        if best < 0 or bd > tol * max(1.0, abs(z)):
            return False
        b.pop(best)
    return True


def deg_norm(a):
    """각도를 (−180°, 180°] 범위로."""
    a = math.fmod(math.fmod(a, 360.0) + 360.0, 360.0)
    return a - 360.0 if a > 180.0 + 1e-9 else a


# ───────────────────────── 1단계 ─────────────────────────

def step1_char_eq(loop):
    """특성방정식: 1 + K·N(s)/D(s) = 0  →  D(s) + K·N(s) = 0"""
    N, D = loop.N, loop.D
    cp = loop.char_poly()
    # 검증: 1 + K·N/D 를 통분한 분자가 정말 D + K·N 인지 sympy로 다시 확인
    numer, _ = sp.fraction(sp.together(1 + K * N.as_expr() / D.as_expr()))
    # 통분하면 분모의 분수 계수 때문에 상수배가 생길 수 있으므로 '비율이 상수인지'로 비교한다
    ratio = sp.cancel(numer / cp.as_expr())
    same = not ratio.has(s) and not ratio.has(K) and ratio != 0
    work = [
        f'개루프 전달함수  K·G(s)H(s) = {loop.text()}',
        f'N(s) = {fmt.poly(N)},   D(s) = {fmt.poly(D)}',
        '1 + K·N(s)/D(s) = 0 의 양변에 D(s)를 곱하면',
        f'D(s) + K·N(s) = ({fmt.poly(D)}) + K({fmt.poly(N)}) = 0',
        f'정리:  {fmt.poly(cp)} = 0',
    ]
    return make_step(
        1, 'charEq', '특성방정식',
        '1 + K·G(s)H(s) = 0  →  D(s) + K·N(s) = 0',
        {'N': fmt.poly(N), 'D': fmt.poly(D)},
        work,
        {'charPoly': fmt.poly(cp), 'charPolyExpr': str(cp.as_expr()),
         'N': [str(c) for c in N.all_coeffs()], 'D': [str(c) for c in D.all_coeffs()]},
        ok('통분 후 분자 비교(sympy)', '1 + K·N/D를 통분한 분자와 D + K·N이 같음') if same
        else fail('통분 후 분자 비교(sympy)', '불일치'),
    )


# ───────────────────────── 2단계 ─────────────────────────

def step2_poles_zeros(loop):
    """극점(K=0 출발점), 영점(K→∞ 도착점), 가지 수 = 분모 차수 n"""
    poles = R.find(loop.D)
    zeros = R.find(loop.N)
    n, m = loop.n, loop.m
    # 검증: numpy의 다른 알고리즘(동반행렬 고유값)으로 구한 근과 비교
    np_p = np.roots(floats(loop.D))
    np_z = np.roots(floats(loop.N)) if m > 0 else np.array([])
    # 중근은 수치적으로 √ε 정도 흩어지므로 허용 오차를 중복도에 맞춰 넓힌다.
    maxmult = max([r['mult'] for r in poles + zeros] + [1])
    tol = 1e-6 if maxmult == 1 else 1e-14 ** (1.0 / maxmult) * 10
    good = same_multiset(R.expand_mult(poles), np_p, tol) and same_multiset(R.expand_mult(zeros), np_z, tol)
    pt = ', '.join(R.describe(r) + (f' (×{r["mult"]})' if r['mult'] > 1 else '') for r in poles)
    zt = ', '.join(R.describe(r) + (f' (×{r["mult"]})' if r['mult'] > 1 else '') for r in zeros) or '없음'
    work = [
        f'D(s) = {fmt.factored(loop.D)} = 0  →  극점: {pt}',
        f'N(s) = {fmt.factored(loop.N)} = 0  →  영점: {zt}' if m > 0 else 'N(s)가 상수 → 유한 영점 없음',
        f'가지 수 = 분모 차수 n = {n}',
        f'유한 영점 수 m = {m}  →  무한대로 가는 가지 n − m = {n - m}개',
    ]
    return make_step(
        2, 'polesZeros', '극점 · 영점 · 가지 수',
        '극점: D(s) = 0 (K = 0에서 출발),  영점: N(s) = 0 (K → ∞에서 도착),  가지 수 = n',
        {'D': fmt.factored(loop.D), 'N': fmt.factored(loop.N)},
        work,
        {'poles': [R.to_json(r) for r in poles], 'zeros': [R.to_json(r) for r in zeros],
         'n': n, 'm': m, 'branches': n, 'toInfinity': n - m},
        ok('np.roots(동반행렬 고유값)와 비교', '두 방법의 근이 일치') if good
        else fail('np.roots(동반행렬 고유값)와 비교', '근이 일치하지 않음'),
        {'poles': [[r['value'].real, r['value'].imag, r['mult']] for r in poles],
         'zeros': [[r['value'].real, r['value'].imag, r['mult']] for r in zeros]},
    ), poles, zeros


# ───────────────────────── 3단계 ─────────────────────────

def step3_real_axis(loop, poles, zeros):
    """실수축 구간: 시험점의 오른쪽에 있는 실수 극점·영점 개수(중근은 겹친 수만큼)가 홀수이면 근궤적."""
    pts = []
    for r in poles:
        if R.is_real(r):
            pts.append((r['value'].real, r['mult'], '극점', R.describe(r)))
    for r in zeros:
        if R.is_real(r):
            pts.append((r['value'].real, r['mult'], '영점', R.describe(r)))
    pts.sort(key=lambda t: -t[0])
    segs, table, cnt = [], [], 0
    for i in range(len(pts) + 1):
        hi = pts[i - 1][0] if i > 0 else None
        lo = pts[i][0] if i < len(pts) else None
        hi_t = pts[i - 1][3] if i > 0 else '+∞'
        lo_t = pts[i][3] if i < len(pts) else '−∞'
        on = cnt % 2 == 1
        if hi is None or lo is None or hi - lo > 1e-12:
            table.append({'range': f'{lo_t} ~ {hi_t}', 'rightCount': cnt, 'onLocus': on})
            if on:
                segs.append({'lo': lo, 'hi': hi, 'loText': lo_t, 'hiText': hi_t})
        if i < len(pts):
            cnt += pts[i][1]
    # 같은 경계에서 맞닿은 구간 합치기 (예: 중근 사이 길이 0 구간)
    merged = []
    for g in segs:
        if merged and merged[-1]['lo'] is not None and g['hi'] is not None and abs(merged[-1]['lo'] - g['hi']) < 1e-12:
            merged[-1]['lo'], merged[-1]['loText'] = g['lo'], g['loText']
        else:
            merged.append(dict(g))
    # 검증: 각 구간 가운데 시험점에서 각 조건 ∠G(σ) = 180° 를 직접 계산
    good = True
    for row_seg in _sample_segments(pts):
        sigma, expected = row_seg
        on = _real_point_on_locus(loop, sigma)
        if on != expected:
            good = False
    work = ['실수축 위 극점·영점 (오른쪽부터): ' + (', '.join(f'{t[3]}({t[2]}{"×" + str(t[1]) if t[1] > 1 else ""})' for t in pts) or '없음')]
    for row in table:
        work.append(f'  {row["range"]}: 오른쪽 개수 {row["rightCount"]} → {"홀수 → 근궤적" if row["onLocus"] else "짝수 → 아님"}')
    seg_text = ', '.join(f'[{g["loText"]}, {g["hiText"]}]' for g in merged) or '없음'
    work.append('근궤적 구간: ' + seg_text)
    return make_step(
        3, 'realAxis', '실수축 근궤적 구간',
        '시험점 오른쪽의 실수 극점 + 실수 영점 개수가 홀수이면 근궤적 (중근은 겹친 수만큼 센다)',
        {'realPoints': [{'x': t[0], 'mult': t[1], 'kind': t[2], 'text': t[3]} for t in pts]},
        work,
        {'segments': [{'lo': g['lo'], 'hi': g['hi'], 'loText': g['loText'], 'hiText': g['hiText']} for g in merged],
         'table': table, 'text': seg_text},
        ok('각 구간 시험점에서 각 조건 ∠K·G(σ) = 180° 직접 계산', '모든 구간에서 홀짝 규칙과 일치') if good
        else fail('각 조건 직접 계산', '홀짝 규칙과 다른 구간이 있음'),
        {'segments': [[g['lo'], g['hi']] for g in merged]},
    )


def _sample_segments(pts):
    """각 구간의 가운데 시험점과 '홀짝 규칙으로 본 답'을 만든다."""
    xs = [p[0] for p in pts]
    out, cnt = [], 0
    for i in range(len(pts) + 1):
        hi = xs[i - 1] if i > 0 else None
        lo = xs[i] if i < len(pts) else None
        if hi is None and lo is None:
            out.append((0.0, False))
        elif hi is None:
            out.append((lo + 1.0, cnt % 2 == 1))
        elif lo is None:
            out.append((hi - 1.0, cnt % 2 == 1))
        elif hi - lo > 1e-9:
            out.append(((hi + lo) / 2, cnt % 2 == 1))
        if i < len(pts):
            cnt += pts[i][1]
    return out


def _real_point_on_locus(loop, sigma):
    """실수 σ가 근궤적 위인지: K = −D(σ)/N(σ) 가 양수이면 위."""
    Dv = float(loop.D.eval(sigma))
    Nv = float(loop.N.eval(sigma))
    if abs(Nv) < 1e-300:
        return False
    return -Dv / Nv > 0


# ───────────────────────── 4단계 ─────────────────────────

def step4_asymptotes(loop, poles, zeros):
    """점근선: 각 (2k+1)·180°/(n−m),  중심 σa = (Σ극점 − Σ영점)/(n−m)"""
    n, m = loop.n, loop.m
    q = n - m
    if q == 0:
        return make_step(
            4, 'asymptotes', '점근선',
            'n − m = 0 이면 모든 가지가 유한 영점으로 들어가므로 점근선이 없다',
            {'n': n, 'm': m}, [f'n − m = {n} − {m} = 0  →  점근선 없음'],
            {'count': 0, 'centroid': None, 'angles': []},
            ok('n − m = 0 확인'), {'asymptotes': None})
    Dc, Nc = loop.D.all_coeffs(), loop.N.all_coeffs()
    # 근과 계수의 관계: Σ근 = −(둘째 계수)/(최고차 계수). 근을 직접 더하지 않아도 정확한 값이 나온다.
    sumP = -sp.Rational(Dc[1]) / Dc[0] if n >= 1 else sp.Integer(0)
    sumZ = (-sp.Rational(Nc[1]) / Nc[0]) if m >= 1 else sp.Integer(0)
    cen = sp.nsimplify((sumP - sumZ) / q)
    angles = [(2 * k + 1) * 180.0 / q for k in range(q)]
    # 검증: numpy로 구한 근을 직접 더해 같은 중심이 나오는지
    num_c = (sum(np.roots(floats(loop.D))) - (sum(np.roots(floats(loop.N))) if m > 0 else 0)) / q
    good = abs(complex(num_c) - float(cen)) < 1e-6 * max(1.0, abs(float(cen)))
    work = [
        f'Σ극점 = {fmt.expr(sumP)}   (D(s)의 계수 관계 −a₁/a₀ 로 계산)',
        f'Σ영점 = {fmt.expr(sumZ)}' if m > 0 else 'Σ영점 = 0 (유한 영점 없음)',
        f'σa = (Σ극점 − Σ영점)/(n − m) = ({fmt.expr(sumP)} − ({fmt.expr(sumZ)}))/{q} = {fmt.expr(cen)}',
        f'각도 = (2k+1)·180°/{q},  k = 0..{q - 1}  →  ' + ', '.join(fmt.num(a) + '°' for a in angles),
    ]
    note = None
    if q == 1:
        note = '점근선이 하나(180°)면 음의 실수축 방향 그 자체이므로 중심은 그림에서 의미가 없습니다.'
        work.append(note)
    return make_step(
        4, 'asymptotes', '점근선',
        'σa = (Σ극점 − Σ영점)/(n − m),   θk = (2k+1)·180°/(n − m)',
        {'sumPoles': fmt.expr(sumP), 'sumZeros': fmt.expr(sumZ), 'n': n, 'm': m},
        work,
        {'count': q, 'centroid': fmt.value(cen), 'centroidExact': str(cen), 'angles': angles, 'note': note},
        ok('numpy 근을 직접 더한 값과 비교', f'수치 중심 {fmt.cnum(num_c)}') if good
        else fail('numpy 근을 직접 더한 값과 비교', f'수치 중심 {fmt.cnum(num_c)}'),
        {'asymptotes': {'centroid': float(cen), 'angles': angles, 'showCentroid': q > 1}},
    )


# ───────────────────────── 5단계 ─────────────────────────

STATUS_TEXT = {
    'breakaway': '이탈점 (K의 극대, 두 가지가 실수축을 떠남)',
    'breakin': '진입점 (K의 극소, 두 가지가 실수축으로 들어옴)',
    'multiple': '세 가지 이상이 만나는 점 (K′ = K″ = 0)',
    'complexBreak': '복소 평면 위의 이탈·진입점 (K > 0 실수)',
    'negativeK': 'K < 0 → 근궤적 위가 아님 (버림)',
    'complexK': 'K가 복소수 → 근궤적 위가 아님 (버림)',
    'start': 'K = 0 (극점 자체, 이탈점 아님)',
    'end': 'K = ∞ (중복 영점 자체, 이탈점 아님)',
}


def step5_breakpoints(loop):
    """이탈점·진입점: dK/ds = 0  ⇔  D′(s)N(s) − D(s)N′(s) = 0,  K = −D/N 이 양의 실수인 후보만 남긴다."""
    N, D = loop.N.as_expr(), loop.D.as_expr()
    B = sp.Poly(sp.expand(sp.diff(D, s) * N - D * sp.diff(N, s)), s)
    cands = []
    if B.degree() >= 1:
        for r in R.find(B):
            z = r['value']
            if z.imag < -1e-12:
                continue   # 켤레 복소수는 위쪽 하나만 본다
            if abs(complex(loop.N.eval(sp.Float(z.real, 30)) if abs(z.imag) == 0 else
                           sp.N(N.subs(s, sp.Float(z.real, 30) + sp.I * sp.Float(z.imag, 30))))) < 1e-20:
                # N(s₀) = 0 → 영점 자체 (중복 영점이면 D′N − DN′ 의 근이 된다). K → ∞ 이므로 이탈점이 아님
                cands.append({'s': [z.real, z.imag], 'sText': R.describe(r), 'mult': r['mult'], 'K': None, 'KText': '∞',
                              'status': 'end', 'statusText': STATUS_TEXT['end'], 'valid': False})
                continue
            if r['exact'] is not None:
                Kc = sp.nsimplify(sp.simplify(-D.subs(s, r['exact']) / N.subs(s, r['exact'])))
                Kv = complex(sp.N(Kc, 30))
            else:
                # 정확한 근이 없으면 30자리 수치로 K = −D/N 계산
                Kc = None
                zs = sp.Float(z.real, 30) + sp.I * sp.Float(z.imag, 30)
                Kv = complex(sp.N(-D.subs(s, zs) / N.subs(s, zs), 30))
            st = _classify(loop, z, r['mult'], Kv, B)
            cands.append({'s': [z.real, z.imag], 'sText': R.describe(r), 'mult': r['mult'],
                          'K': Kv.real if abs(Kv.imag) <= 1e-9 * max(1, abs(Kv)) else [Kv.real, Kv.imag],
                          'KText': (fmt.expr(Kc) if Kc is not None and len(fmt.expr(Kc)) <= 20 else fmt.cnum(Kv)),
                          'status': st, 'statusText': STATUS_TEXT[st],
                          'valid': st in ('breakaway', 'breakin', 'multiple', 'complexBreak')})
    cands.sort(key=lambda c: -c['s'][0])
    # 검증: 유효한 점 s₀에서 K₀를 대입한 특성다항식이 s₀를 중근으로 갖는지 (P(s₀) = P′(s₀) = 0)
    good = True
    for c in cands:
        if not c['valid']:
            continue
        z = complex(*c['s'])
        P = np.polyadd(floats(loop.D), c['K'] * floats(loop.N))
        scale = max(1.0, float(np.max(np.abs(P))))
        r0 = abs(np.polyval(P, z)) / scale
        r1 = abs(np.polyval(np.polyder(P), z)) / scale
        if r0 > 1e-8 or r1 > 1e-8:
            good = False
    work = [
        'K = −D(s)/N(s) 를 s로 미분해 0으로 놓으면  D′(s)N(s) − D(s)N′(s) = 0',
        f'D′N − DN′ = {fmt.poly(B)} = 0' if B.degree() >= 0 else '',
    ]
    if not cands:
        work.append('후보 없음')
    for c in cands:
        kt = c['KText']
        work.append(f'  s = {c["sText"]}:  K = −D/N = {kt}  →  {c["statusText"]}')
    valid = [c for c in cands if c['valid']]
    return make_step(
        5, 'breakpoints', '이탈점 · 진입점',
        'dK/ds = 0  ⇔  D′(s)N(s) − D(s)N′(s) = 0,  K = −D(s)/N(s) > 0 인 점만 근궤적 위',
        {'breakEquation': fmt.poly(B)},
        [w for w in work if w],
        {'equation': fmt.poly(B), 'candidates': cands, 'valid': valid},
        ok('K₀를 넣은 특성다항식이 s₀에서 중근인지 확인 (P = P′ = 0)', f'유효한 점 {len(valid)}개 모두 중근') if good
        else fail('중근 확인', '중근 조건을 만족하지 않는 점이 있음'),
        {'breakpoints': [[c['s'][0], c['s'][1], c['K'] if not isinstance(c['K'], list) else None, c['status']] for c in valid]},
    )


def _classify(loop, z, mult, Kv, B):
    """후보점 하나의 판정. K의 부호·실수 여부와 K″의 부호(극대/극소)를 본다."""
    mag = max(1.0, abs(Kv))
    if abs(Kv.imag) > 1e-9 * mag:
        return 'complexK'
    k = Kv.real
    if abs(k) < 1e-9 * mag:
        return 'start'
    if k < 0:
        return 'negativeK'
    if abs(z.imag) > 1e-12:
        return 'complexBreak'
    if mult >= 2:
        return 'multiple'
    # K(s) = −D/N 이므로 K′ = −B/N² , B = 0인 점에서 K″ = −B′/N²
    dB = B.diff(s)
    Kpp = -float(dB.eval(z.real)) / float(loop.N.eval(z.real)) ** 2
    return 'breakaway' if Kpp < 0 else 'breakin'


# ───────────────────────── 6단계 ─────────────────────────

def step6_angles(loop, poles, zeros):
    """출발각·도착각:
        출발각 θd = 180° + Σ(영점에서 온 각) − Σ(다른 극점에서 온 각)
        도착각 θa = 180° + Σ(극점에서 온 각) − Σ(다른 영점에서 온 각)
    k중 극점·영점이면 (위 값 + 360°·i)/k, i = 0..k−1 로 k개 방향이 나온다."""
    items = []
    P_ = [(r['value'], r['mult'], R.describe(r)) for r in poles]
    Z_ = [(r['value'], r['mult'], R.describe(r)) for r in zeros]
    for r in poles:
        z = r['value']
        if z.imag > 0 or (abs(z.imag) == 0 and r['mult'] >= 2):
            items.append(_angle_item(loop, 'departure', r, Z_, P_))
    for r in zeros:
        z = r['value']
        if z.imag > 0 or (abs(z.imag) == 0 and r['mult'] >= 2):
            items.append(_angle_item(loop, 'arrival', r, P_, Z_))
    good = all(it['verified'] for it in items)
    work = []
    if not items:
        work.append('복소 극점·영점이나 실수축 위 중근이 없어 계산할 출발각·도착각이 없음')
    for it in items:
        work.extend(it['work'])
    return make_step(
        6, 'angles', '출발각 · 도착각',
        'θd = 180° + Σ∠(영점→) − Σ∠(다른 극점→),   θa = 180° + Σ∠(극점→) − Σ∠(다른 영점→)',
        {'complexPoles': [it['atText'] for it in items if it['kind'] == 'departure'],
         'complexZeros': [it['atText'] for it in items if it['kind'] == 'arrival']},
        work,
        {'items': [{k: v for k, v in it.items() if k != 'work'} for it in items]},
        ok('출발 방향으로 아주 조금 이동한 점에서 각 조건 ∠K·G = 180° 확인', '모든 방향이 각 조건 만족') if good
        else fail('각 조건 확인', '각 조건을 만족하지 않는 방향이 있음'),
        {'angles': [[it['at'][0], it['at'][1], a, it['kind']] for it in items for a in it['angles']]},
    )


def _angle_item(loop, kind, r, plus, minus):
    at, mult = r['value'], r['mult']
    plus_sum, minus_sum = 0.0, 0.0
    contrib = []
    for e, k, t in plus:
        a = math.degrees(cmath.phase(at - e))
        plus_sum += a * k
        contrib.append({'from': t, 'sign': '+', 'angle': a, 'mult': k})
    for e, k, t in minus:
        if abs(e - at) < 1e-12:
            continue
        a = math.degrees(cmath.phase(at - e))
        minus_sum += a * k
        contrib.append({'from': t, 'sign': '−', 'angle': a, 'mult': k})
    base = 180.0 + plus_sum - minus_sum
    angles = sorted((deg_norm((base + 360.0 * i) / mult) for i in range(mult)), reverse=True)
    name = '출발각' if kind == 'departure' else '도착각'
    what = '극점' if kind == 'departure' else '영점'
    at_t = R.describe(r)
    work = [f'{what} {at_t}{" (" + str(mult) + "중)" if mult > 1 else ""}의 {name}:']
    for c in contrib:
        times = f'×{c["mult"]}' if c['mult'] > 1 else ''
        work.append(f'    {c["sign"]} ∠({at_t} − ({c["from"]})) = {c["sign"]}{fmt.num(c["angle"], 2)}°{times}')
    if mult == 1:
        work.append(f'  θ = 180° + {fmt.num(plus_sum, 2)}° − {fmt.num(minus_sum, 2)}° = {fmt.num(base, 2)}° → {fmt.num(angles[0], 2)}°')
    else:
        work.append(f'  {mult}·θ = 180° + {fmt.num(plus_sum, 2)}° − {fmt.num(minus_sum, 2)}° + 360°·i  →  θ = ' +
                    ', '.join(fmt.num(a, 2) + '°' for a in angles))
    # 검증: 계산한 방향으로 ε만큼 움직인 점 s에서 K = −D/N 이 양의 실수인지 (각 조건)
    verified = True
    eps = 1e-5 * max(1.0, abs(at))
    for a in angles:
        z = at + eps * cmath.exp(1j * math.radians(a))
        # 극점 근처는 K → 0, 영점 근처는 K → ∞ 이지만 어느 쪽이든 각 조건은 ∠(−D/N) = 0°
        Kz = -complex(np.polyval(floats(loop.D), z)) / complex(np.polyval(floats(loop.N), z))
        if abs(math.degrees(cmath.phase(Kz))) > 0.5:
            verified = False
    return {'kind': kind, 'at': [at.real, at.imag], 'atText': at_t, 'mult': mult, 'angles': angles,
            'base': base, 'contributions': contrib, 'verified': verified, 'work': work}
