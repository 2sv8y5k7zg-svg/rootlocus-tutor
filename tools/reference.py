"""
reference.py — 기준 정답 만들기 (JavaScript 엔진과 독립된 계산)

sympy(기호 계산)로 정확한 값을, numpy로 폐루프 극점을 계산해 tests/expected.json에 저장합니다.
엔진(js/)과 코드를 전혀 공유하지 않으므로, 둘의 결과가 같으면 서로를 검증하는 셈입니다.

실행: python3 tools/reference.py
"""
import json, math, cmath, sys
from pathlib import Path
import numpy as np
import sympy as sp

ROOT = Path(__file__).resolve().parent.parent
s, K, w, eps = sp.symbols('s K w epsilon')
PREC = 40
SAMPLE_K = [0.1, 0.5, 1, 2, 5, 10, 30, 100]


def poly_from_factors(factors):
    expr = sp.Integer(1)
    for f in factors:
        expr *= sum(sp.Integer(c) * s ** (len(f) - 1 - i) for i, c in enumerate(f))
    return sp.Poly(sp.expand(expr), s)


def roots_with_mult(poly):
    """중근 개수를 정확히 세기 위해 square-free 분해 후 각 인수의 근을 고정밀로 구함."""
    out = []
    if poly.degree() < 1:
        return out
    _, factors = sp.sqf_list(poly)
    for fac, mult in factors:
        fp = sp.Poly(fac, s)
        if fp.degree() < 1:
            continue
        for r in fp.nroots(n=PREC):
            out.append((complex(r), mult, r))
    return out


def c2j(z):
    return [float(z.real), float(z.imag)]


def deg_norm(a):
    a = math.fmod(math.fmod(a, 360) + 360, 360)
    return a - 360 if a > 180 + 1e-9 else a


def routh_first_column(charpoly_coeffs):
    """K를 기호로 둔 Routh 표의 첫 열. 첫 열 0이면 ε으로 바꾸고 표시."""
    n = len(charpoly_coeffs) - 1
    width = n // 2 + 1
    r0 = [charpoly_coeffs[2 * j] if 2 * j <= n else 0 for j in range(width)]
    r1 = [charpoly_coeffs[2 * j + 1] if 2 * j + 1 <= n else 0 for j in range(width)]
    rows = [r0, r1]
    special = None
    for i in range(2, n + 1):
        prev, prev2 = rows[i - 1], rows[i - 2]
        row = []
        for j in range(width):
            b = prev2[j + 1] if j + 1 < width else 0
            d = prev[j + 1] if j + 1 < width else 0
            row.append(sp.simplify((prev[0] * b - prev2[0] * d) / prev[0]))
        if all(sp.simplify(e) == 0 for e in row):
            pw = n - (i - 1)
            row = [sp.simplify(e * (pw - 2 * k)) for k, e in enumerate(prev)]
            special = special or 'zeroRow'
        elif sp.simplify(row[0]) == 0:
            row[0] = eps
            special = 'firstColZero'
        rows.append(row)
    return [sp.simplify(r[0]) for r in rows], special


def stable_set_routh(col):
    """첫 열이 모두 양수인 K ≥ 0 집합 (정확한 부등식 풀이)."""
    region = sp.Interval(0, sp.oo)
    for e in col:
        e = sp.simplify(e)
        if e.is_number:
            if e > 0:
                continue
            return sp.EmptySet
        cond = sp.solve_univariate_inequality(sp.StrictGreaterThan(e, 0), K, relational=False, domain=sp.S.Reals)
        region = region.intersect(cond)
    return region


def set_to_list(st):
    out = []
    if st is sp.EmptySet or st == sp.EmptySet:
        return out
    parts = st.args if isinstance(st, sp.Union) else [st]
    for iv in parts:
        if isinstance(iv, sp.Interval):
            out.append({'lo': float(iv.start), 'hi': (None if iv.end == sp.oo else float(iv.end)),
                        'loIncl': not iv.left_open, 'hiIncl': (False if iv.end == sp.oo else not iv.right_open),
                        'exact': [str(iv.start), str(iv.end)]})
    return out


def stable_numeric(Npoly, Dpoly, crit):
    """경계(교차 K) 사이 구간마다 폐루프 극점을 numpy로 직접 계산해 안정 여부 판정."""
    Nc = [float(c) for c in Npoly.all_coeffs()]
    Dc = [float(c) for c in Dpoly.all_coeffs()]

    def poles(k):
        L = max(len(Nc), len(Dc))
        Np = [0.0] * (L - len(Nc)) + Nc
        Dp = [0.0] * (L - len(Dc)) + Dc
        return np.roots([d + k * nn for d, nn in zip(Dp, Np)])

    def status(k):
        r = poles(k)
        sc = max(1.0, max(abs(r)))
        mr = max(r.real)
        return 'unstable' if mr > 1e-7 * sc else ('marginal' if mr >= -1e-7 * sc else 'stable')

    bounds = [0.0] + sorted(set(crit))
    res = []
    for i, lo in enumerate(bounds):
        hi = bounds[i + 1] if i + 1 < len(bounds) else None
        sample = (lo + hi) / 2 if hi is not None else (lo * 2 + 1 if lo > 0 else 1.0)
        # 구간 안을 촘촘히 확인 (경계 밖 놓친 변화가 없는지)
        g_lo = lo * 1.001 if lo > 0 else 1e-3
        g_hi = hi * 0.999 if hi else max(lo, 1) * 1e4
        grid = np.geomspace(g_lo, g_hi, 60)
        sts = {status(k) for k in grid}
        res.append({'lo': lo, 'hi': hi, 'status': status(sample), 'uniform': len(sts) == 1})
    pts = [{'K': b, 'status': status(b)} for b in bounds]
    stable = []
    for i, iv in enumerate(res):
        if iv['status'] != 'stable':
            continue
        lo_in = pts[i]['status'] == 'stable'
        hi_in = (pts[i + 1]['status'] == 'stable') if i + 1 < len(pts) else False
        if stable and stable[-1]['hi'] == iv['lo'] and stable[-1]['hiIncl']:
            stable[-1]['hi'] = iv['hi']; stable[-1]['hiIncl'] = hi_in
        else:
            stable.append({'lo': iv['lo'], 'hi': iv['hi'], 'loIncl': lo_in, 'hiIncl': hi_in})
    return stable, res, poles


def analyze(pr):
    Np = poly_from_factors(pr['num'])
    Dp = poly_from_factors(pr['den'])
    n, m = Dp.degree(), Np.degree()
    out = {'id': pr['id'], 'n': n, 'm': m,
           'N': [float(c) for c in Np.all_coeffs()], 'D': [float(c) for c in Dp.all_coeffs()]}

    poles = roots_with_mult(Dp)
    zeros = roots_with_mult(Np)
    out['poles'] = [{'s': c2j(z), 'mult': k} for z, k, _ in poles]
    out['zeros'] = [{'s': c2j(z), 'mult': k} for z, k, _ in zeros]

    # 3 실수축
    pts = [(z.real, k, 'pole') for z, k, _ in poles if abs(z.imag) < 1e-15] + \
          [(z.real, k, 'zero') for z, k, _ in zeros if abs(z.imag) < 1e-15]
    pts.sort(key=lambda t: -t[0])
    segs, cnt = [], 0
    for i in range(len(pts) + 1):
        hi = pts[i - 1][0] if i > 0 else None
        lo = pts[i][0] if i < len(pts) else None
        if cnt % 2 == 1:
            segs.append({'hi': hi, 'lo': lo})
        if i < len(pts):
            cnt += pts[i][1]
    out['realAxisSegments'] = segs

    # 4 점근선
    q = n - m
    if q > 0:
        Dc, Nc = Dp.all_coeffs(), Np.all_coeffs()
        sumP = -sp.Rational(Dc[1]) / Dc[0]
        sumZ = (-sp.Rational(Nc[1]) / Nc[0]) if m >= 1 else 0
        cen = sp.nsimplify((sumP - sumZ) / q)
        out['asymptotes'] = {'centroid': float(cen), 'centroidExact': str(cen),
                             'angles': [(2 * k + 1) * 180 / q for k in range(q)]}
    else:
        out['asymptotes'] = None

    # 5 이탈점·진입점
    B = sp.Poly(sp.diff(Dp.as_expr(), s) * Np.as_expr() - Dp.as_expr() * sp.diff(Np.as_expr(), s), s)
    dB = sp.Poly(sp.diff(B.as_expr(), s), s)
    cands = []
    for z, mult, zr in roots_with_mult(B):
        if z.imag < -1e-30:
            continue
        Kc = complex(sp.N(-Dp.as_expr().subs(s, zr) / Np.as_expr().subs(s, zr), PREC))
        mag = max(1.0, abs(Kc))
        if abs(Kc.imag) > 1e-9 * mag:
            st, Kv = 'complexK', [Kc.real, Kc.imag]
        else:
            Kv = Kc.real
            if abs(Kv) < 1e-9 * mag:
                st = 'start'
            elif Kv < 0:
                st = 'negativeK'
            elif abs(z.imag) > 1e-15:
                st = 'complexBreak'
            elif mult >= 2:
                st = 'multiple'
            else:
                Kpp = -float(sp.N(dB.as_expr().subs(s, zr))) / float(sp.N(Np.as_expr().subs(s, zr))) ** 2
                st = 'breakaway' if Kpp < 0 else 'breakin'
        cands.append({'s': c2j(z), 'mult': mult, 'K': Kv, 'status': st})
    cands.sort(key=lambda c: -c['s'][0])
    out['breakCandidates'] = cands
    out['breakEquation'] = [float(c) for c in B.all_coeffs()]

    # 6 출발각·도착각 (θ = 180° + Σ 더하는 쪽 − Σ 빼는 쪽, 중근이면 나누기)
    items = []
    def build(kind, at, mult, plus, minus):
        sp_ = sum(math.degrees(cmath.phase(at - e)) * k for e, k in plus)
        sm_ = sum(math.degrees(cmath.phase(at - e)) * k for e, k in minus if abs(e - at) > 1e-12)
        base = 180 + sp_ - sm_
        angs = sorted((deg_norm((base + 360 * k) / mult) for k in range(mult)), reverse=True)
        items.append({'kind': kind, 'at': c2j(at), 'mult': mult, 'angles': angs})
    P_ = [(z, k) for z, k, _ in poles]
    Z_ = [(z, k) for z, k, _ in zeros]
    for z, k in P_:
        if z.imag > 1e-15 or (abs(z.imag) <= 1e-15 and k >= 2):
            build('departure', z, k, Z_, P_)
    for z, k in Z_:
        if z.imag > 1e-15 or (abs(z.imag) <= 1e-15 and k >= 2):
            build('arrival', z, k, P_, Z_)
    out['angles'] = items

    # 7 허수축 교차 (s = jω 대입, 정확한 풀이)
    expr = sp.expand(Dp.as_expr().subs(s, sp.I * w) + K * Np.as_expr().subs(s, sp.I * w))
    re_, im_ = sp.re(expr.subs(w, sp.Symbol('w', real=True))), None
    wr, Kr = sp.symbols('wr Kr', real=True)
    e2 = sp.expand(Dp.as_expr().subs(s, sp.I * wr) + Kr * Np.as_expr().subs(s, sp.I * wr))
    re_, im_ = sp.re(e2), sp.im(e2)
    sols = sp.solve([re_, im_], [wr, Kr], dict=True)
    cross = []
    for so in sols:
        wv, kv = so.get(wr), so.get(Kr)
        if wv is None or kv is None or wv.free_symbols or kv.free_symbols:
            continue
        wv_f, kv_f = complex(sp.N(wv)), complex(sp.N(kv))
        if abs(wv_f.imag) > 1e-12 or abs(kv_f.imag) > 1e-12:
            continue
        if wv_f.real < -1e-12 or kv_f.real <= 1e-12:
            continue
        cross.append({'omega': abs(wv_f.real), 'K': kv_f.real, 'omegaExact': str(sp.nsimplify(sp.Abs(wv))), 'KExact': str(sp.nsimplify(kv))})
    uniq = []
    for c in sorted(cross, key=lambda c: (c['K'], c['omega'])):
        if not any(abs(c['K'] - u['K']) < 1e-9 and abs(c['omega'] - u['omega']) < 1e-9 for u in uniq):
            uniq.append(c)
    out['crossings'] = uniq

    # 안정 범위: ① 정확한 Routh 부등식 ② numpy 구간 판정 — 둘 다 기록
    charpoly = sp.Poly(Dp.as_expr() + K * Np.as_expr(), s)
    col, special = routh_first_column(charpoly.all_coeffs())
    out['routhFirstColumn'] = [str(e) for e in col]
    out['routhSpecial'] = special
    crit = [c['K'] for c in uniq]
    stable_num, ivs, poles_fn = stable_numeric(Np, Dp, crit)
    out['stableSetNumeric'] = stable_num
    out['intervalsUniform'] = all(iv['uniform'] for iv in ivs)
    if special is None:
        st = stable_set_routh(col)
        lst = set_to_list(st)
        # K = 0 경계는 개루프 극점으로 판정 (Routh 부등식은 K > 0만 보장)
        out['stableSetRouth'] = lst
    else:
        out['stableSetRouth'] = None

    # 9 K 슬라이더 대조용 폐루프 극점
    out['closedLoop'] = [{'K': k, 'roots': [c2j(r) for r in sorted(poles_fn(k), key=lambda z: (-z.real, -z.imag))]} for k in SAMPLE_K]
    return out


def main():
    data = json.loads((ROOT / 'tests' / 'problems.json').read_text(encoding='utf-8'))
    results = []
    for pr in data['problems']:
        if pr.get('expectError'):
            results.append({'id': pr['id'], 'expectError': pr['expectError']})
            continue
        print('계산 중', pr['id'], pr['title'], file=sys.stderr)
        results.append(analyze(pr))
    (ROOT / 'tests' / 'expected.json').write_text(json.dumps({'generatedBy': 'tools/reference.py (sympy + numpy)', 'results': results}, ensure_ascii=False, indent=1), encoding='utf-8')
    print('저장: tests/expected.json', file=sys.stderr)


if __name__ == '__main__':
    main()
