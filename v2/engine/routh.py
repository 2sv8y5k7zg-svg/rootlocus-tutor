"""
routh.py — 7단계: Routh 표, 안정한 K 범위, 허수축 교차

1) Routh 표를 K를 문자로 둔 채 만든다 (sympy).
   특수 경우
     - 첫 열만 0 (행 전체는 0이 아님): 0 대신 아주 작은 양수 ε 을 넣고 계속한다.
     - 행 전체가 0: 바로 위 행으로 보조방정식 A(s)를 만들고, A′(s)의 계수로 그 행을 바꾼다.
2) 첫 열이 모두 양수가 되는 K ≥ 0 범위를 정확히 푼다 (부등식 풀이).
3) 허수축 교차: s = jω 를 대입해 실수부 = 0, 허수부 = 0 을 동시에 푼다.
4) 검증: 구간마다 폐루프 극점을 numpy로 직접 구해 안정 여부를 다시 판정하고 2)와 비교한다.
"""
import numpy as np
import sympy as sp
from . import fmt, roots as R
from .steps import make_step, ok, fail, floats

s, K = fmt.s, fmt.K
eps = sp.Symbol('ε', positive=True)
w = sp.Symbol('ω', real=True)


# ───────────────────── Routh 표 ─────────────────────

def build_table(coeffs):
    """coeffs: 특성다항식 계수(내림차순, K 포함 가능). 반환: (rows, specials)
    rows[i] = {'power': s의 차수, 'cells': [식...]}"""
    n = len(coeffs) - 1
    width = n // 2 + 1
    r0 = [coeffs[2 * j] if 2 * j <= n else sp.Integer(0) for j in range(width)]
    r1 = [coeffs[2 * j + 1] if 2 * j + 1 <= n else sp.Integer(0) for j in range(width)]
    rows = [r0, r1]
    specials = []
    # 둘째 행(s^(n−1))부터 특수 경우가 생길 수 있다. 예: s² + (K+4) → s¹ 행이 모두 0
    if n >= 1 and all(sp.simplify(e) == 0 for e in r1):
        aux = sum(r0[k] * s ** (n - 2 * k) for k in range(width) if n - 2 * k >= 0)
        rows[1] = [sp.factor(r0[k] * (n - 2 * k)) if n - 2 * k >= 0 else sp.Integer(0) for k in range(width)]
        specials.append({'kind': 'zeroRow', 'power': n - 1,
                         'text': f's^{n - 1} 행이 모두 0 → 보조방정식 A(s) = {fmt.expr(sp.expand(aux))}, A′(s)의 계수로 바꿈'})
    elif n >= 1 and sp.simplify(r1[0]) == 0:
        rows[1][0] = eps
        specials.append({'kind': 'firstColZero', 'power': n - 1, 'text': f's^{n - 1} 행의 첫 열이 0 → 작은 양수 ε 으로 바꾸어 계속'})
    for i in range(2, n + 1):
        a, b = rows[i - 2], rows[i - 1]   # a: 두 줄 위, b: 바로 위
        row = []
        for j in range(width):
            a_next = a[j + 1] if j + 1 < width else sp.Integer(0)
            b_next = b[j + 1] if j + 1 < width else sp.Integer(0)
            # 표준 공식: (b₀·a_{j+1} − a₀·b_{j+1}) / b₀
            row.append(sp.factor(sp.cancel((b[0] * a_next - a[0] * b_next) / b[0])))
        power = n - i
        if all(sp.simplify(e) == 0 for e in row):
            # 행 전체가 0 → 보조방정식 A(s) (바로 위 행, 차수 power+1)를 미분
            pw = power + 1
            aux = sum(b[k] * s ** (pw - 2 * k) for k in range(width) if pw - 2 * k >= 0)
            row = [sp.factor(b[k] * (pw - 2 * k)) if pw - 2 * k >= 0 else sp.Integer(0) for k in range(width)]
            specials.append({'kind': 'zeroRow', 'power': power,
                             'text': f's^{power} 행이 모두 0 → 보조방정식 A(s) = {fmt.expr(sp.expand(aux))}, A′(s)의 계수로 바꿈'})
        elif sp.simplify(row[0]) == 0:
            row[0] = eps
            specials.append({'kind': 'firstColZero', 'power': power,
                             'text': f's^{power} 행의 첫 열이 0 → 작은 양수 ε 으로 바꾸어 계속'})
        rows.append(row)
    out = [{'power': n - i, 'cells': rows[i]} for i in range(n + 1)]
    return out, specials


def table_text(rows):
    """화면용 Routh 표 (식 → 글자)."""
    out = []
    for r in rows:
        cells = [c for c in r['cells']]
        # 맨 뒤 0은 표에서 생략 (첫 칸은 항상 표시)
        while len(cells) > 1 and sp.simplify(cells[-1]) == 0:
            cells.pop()
        out.append({'power': r['power'], 'cells': [fmt.expr(c) for c in cells]})
    return out


# ───────────────────── 허수축 교차 ─────────────────────

def crossings(loop):
    """s = jω 대입: D(jω) + K·N(jω) = 0 을 실수부·허수부로 나눠 푼다.
    Re: Dr(ω) + K·Nr(ω) = 0,  Im: Di(ω) + K·Ni(ω) = 0
    두 식에서 K를 지우면  Dr·Ni − Di·Nr = 0  (ω만의 다항식) → 실근 ω ≥ 0 → K 계산 → K > 0 만 남김"""
    Dj = sp.expand(loop.D.as_expr().subs(s, sp.I * w))
    Nj = sp.expand(loop.N.as_expr().subs(s, sp.I * w))
    Dr, Di = sp.re(Dj), sp.im(Dj)
    Nr, Ni = sp.re(Nj), sp.im(Nj)
    E = sp.expand(Dr * Ni - Di * Nr)
    found = []
    if E == 0:
        return found, {'Re': fmt.expr(Dr + K * Nr), 'Im': fmt.expr(Di + K * Ni), 'eliminated': '0'}
    Ep = sp.Poly(E.subs(w, s), s)
    for r in R.find(Ep):
        if not R.is_real(r):
            continue
        om = r['exact'] if r['exact'] is not None else sp.Float(r['value'].real, 30)
        if float(om) < -1e-12:
            continue
        Kc = None
        for num_, den_ in ((Dr, Nr), (Di, Ni)):
            dv = sp.simplify(den_.subs(w, om))
            if dv != 0 and abs(complex(sp.N(dv))) > 1e-20:
                Kc = sp.nsimplify(sp.simplify(-num_.subs(w, om) / dv)) if r['exact'] is not None else -num_.subs(w, om) / dv
                break
        if Kc is None:
            continue
        kv = complex(sp.N(Kc, 30))
        if abs(kv.imag) > 1e-12 or kv.real <= 1e-12:
            continue
        # 두 식을 모두 만족하는지 확인
        resid = abs(complex(sp.N((Dr + Kc * Nr).subs(w, om)))) + abs(complex(sp.N((Di + Kc * Ni).subs(w, om))))
        if resid > 1e-8 * max(1.0, kv.real):
            continue
        found.append({'omega': abs(float(om)), 'K': kv.real,
                      'omegaText': fmt.expr(sp.Abs(om)) if r['exact'] is not None else fmt.num(abs(float(om))),
                      'KText': fmt.expr(Kc) if r['exact'] is not None else fmt.num(kv.real),
                      'omegaExact': r['exact'] is not None})
    uniq = []
    for c in sorted(found, key=lambda c: (c['K'], c['omega'])):
        if not any(abs(c['K'] - u['K']) < 1e-9 and abs(c['omega'] - u['omega']) < 1e-9 for u in uniq):
            uniq.append(c)
    return uniq, {'Re': fmt.expr(Dr + K * Nr), 'Im': fmt.expr(Di + K * Ni), 'eliminated': fmt.expr(E)}


# ───────────────────── 안정 범위 ─────────────────────

def closed_loop_poles(loop, k):
    """K = k 일 때 폐루프 극점 (D + kN = 0 의 근, numpy)."""
    Dc, Nc = floats(loop.D), floats(loop.N)
    P = np.polyadd(Dc, k * Nc)
    return np.roots(P)


def status_at(loop, k):
    """폐루프 극점의 실수부로 안정 판정: stable / marginal(허수축 위) / unstable"""
    r = closed_loop_poles(loop, k)
    sc = max(1.0, float(np.max(np.abs(r)))) if len(r) else 1.0
    mr = float(np.max(r.real)) if len(r) else -1.0
    if mr > 1e-7 * sc:
        return 'unstable'
    if mr >= -1e-7 * sc:
        return 'marginal'
    return 'stable'


def stable_numeric(loop, crit):
    """경계 K(교차점) 사이 구간마다 가운데 K에서 폐루프 극점을 직접 계산해 안정 구간을 만든다."""
    bounds = [0.0] + sorted(set(k for k in crit if k > 0))
    res = []
    for i, lo in enumerate(bounds):
        hi = bounds[i + 1] if i + 1 < len(bounds) else None
        mid = (lo + hi) / 2 if hi is not None else (lo * 2 + 1 if lo > 0 else 1.0)
        res.append({'lo': lo, 'hi': hi, 'status': status_at(loop, mid)})
    pts = [status_at(loop, b) for b in bounds]
    out = []
    for i, iv in enumerate(res):
        if iv['status'] != 'stable':
            continue
        lo_in = pts[i] == 'stable'
        hi_in = (pts[i + 1] == 'stable') if i + 1 < len(pts) else False
        if out and out[-1]['hi'] == iv['lo'] and out[-1]['hiIncl']:
            out[-1]['hi'], out[-1]['hiIncl'] = iv['hi'], hi_in
        else:
            out.append({'lo': iv['lo'], 'hi': iv['hi'], 'loIncl': lo_in, 'hiIncl': hi_in})
    return out


def stable_exact(first_col):
    """첫 열 식(K의 유리식)이 모두 양수인 K ≥ 0 범위.
    방법: 각 식의 분자·분모가 0이 되는 양의 K(임계값)를 모두 구해 정렬하고,
          임계값 사이마다 시험값 하나로 부호를 확인한다. 임계값 자체도 따로 확인한다(경계 포함 여부).
    임계값은 1·2차 인수면 정확한 값(√ 포함), 그보다 높으면 30자리 수치."""
    exprs = [sp.together(sp.sympify(e)) for e in first_col]
    crit = []   # (실수값, 표시용 sympy 값)
    for e in exprs:
        num, den = sp.fraction(e)
        for part in (num, den):
            if not part.has(K):
                continue
            for r in R.find(sp.Poly(sp.expand(part).subs(K, s), s)):
                if not R.is_real(r):
                    continue
                v = r['value'].real
                if v > 1e-12 and not any(abs(v - c[0]) < 1e-12 * max(1, v) for c in crit):
                    crit.append((v, r['exact'] if r['exact'] is not None else sp.re(r['hp'])))
    crit.sort(key=lambda c: c[0])
    bounds = [(0.0, sp.Integer(0))] + crit

    def all_positive(kv):
        # kv는 정확한 값 또는 30자리 값. 경계(임계값)에서는 어떤 식이 정확히 0이 되므로 '양수 아님'으로 판정된다.
        for e in exprs:
            num, den = sp.fraction(e)
            dv = sp.N(den.subs(K, kv), 40)
            nv = sp.N(num.subs(K, kv), 40)
            if abs(dv) < 1e-25 or abs(nv) < 1e-25:
                return False
            if nv / dv <= 0:
                return False
        return True

    def text(v):
        return fmt.num(float(v)) if (isinstance(v, sp.Float) or v.has(sp.Float)) else fmt.expr(v)

    out = []
    for i, (lo, lo_e) in enumerate(bounds):
        hi, hi_e = (bounds[i + 1] if i + 1 < len(bounds) else (None, None))
        mid = sp.Float((lo + hi) / 2 if hi is not None else lo * 2 + 1, 30)
        if not all_positive(mid):
            continue
        lo_in = all_positive(lo_e)
        hi_in = all_positive(hi_e) if hi is not None else False
        if out and out[-1]['hi'] is not None and abs(out[-1]['hi'] - lo) < 1e-12 and out[-1]['hiIncl']:
            out[-1].update({'hi': hi, 'hiIncl': hi_in, 'hiText': None if hi is None else text(hi_e)})
        else:
            out.append({'lo': lo, 'hi': hi, 'loIncl': lo_in, 'hiIncl': hi_in,
                        'loText': text(lo_e), 'hiText': None if hi is None else text(hi_e)})
    return out


def intervals_text(ivs):
    """[{lo, hi, ...}] → '0 < K < 6' 같은 글자"""
    if not ivs:
        return '안정한 K 없음'
    parts = []
    for iv in ivs:
        lo_t = iv.get('loText') or fmt.num(iv['lo'])
        hi_t = iv.get('hiText') or (fmt.num(iv['hi']) if iv['hi'] is not None else None)
        left = f'{lo_t} {"≤" if iv["loIncl"] else "<"} K'
        if hi_t is None:
            if iv['lo'] == 0 and iv['loIncl']:
                parts.append('K ≥ 0 (모든 K)')
            else:
                parts.append(f'K {"≥" if iv["loIncl"] else ">"} {lo_t}')
        else:
            parts.append(f'{left} {"≤" if iv["hiIncl"] else "<"} {hi_t}')
    return ' 또는 '.join(parts)


def same_intervals(a, b, tol=1e-7):
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if abs(x['lo'] - y['lo']) > tol * max(1, abs(x['lo'])):
            return False
        if (x['hi'] is None) != (y['hi'] is None):
            return False
        if x['hi'] is not None and abs(x['hi'] - y['hi']) > tol * max(1, abs(x['hi'])):
            return False
    return True


def sign_changes(vals):
    """첫 열 숫자들의 부호 변화 횟수 = 우반면 극점 수 (Routh 판별법)."""
    sgn = [1 if v > 0 else -1 for v in vals if v != 0]
    c = 0
    for i in range(1, len(sgn)):
        if sgn[i] != sgn[i - 1]:
            c += 1
    return c


# ───────────────────── 7단계 묶음 ─────────────────────

def step7_routh(loop):
    cp = loop.char_poly()
    coeffs = [sp.expand(c) for c in cp.all_coeffs()]
    rows, specials = build_table(coeffs)
    first = [r['cells'][0] for r in rows]
    cross, cross_eq = crossings(loop)
    crit = [c['K'] for c in cross]
    numeric = stable_numeric(loop, crit)

    # 특수 경우(ε, 영행)가 있으면 첫 열 부호만으로는 '허수축 위 극점(임계 안정)'을 가려낼 수 없으므로
    # 안정 범위는 폐루프 극점 직접 계산으로 정한다.
    has_eps = bool(specials)
    exact = None
    if not has_eps:
        exact = stable_exact(first)

    # 검증 ①: 정확한 부등식 풀이 결과 ↔ 폐루프 극점 직접 계산 결과
    # 검증 ②: 여러 K에서 '첫 열 부호 변화 수 = 우반면 극점 수' (Routh 판별법 자체 확인)
    checks = []
    agree = True
    if exact is not None:
        agree = same_intervals(exact, numeric)
        checks.append('부등식 풀이 ↔ 폐루프 극점 직접 계산: ' + ('일치' if agree else '불일치'))
    consistent = True
    if not has_eps:
        sample_k = [0.37, 1.3, 4.1] + [c * f for c in crit for f in (0.7, 1.3)]
        for k in sample_k:
            vals = [float(sp.N(sp.sympify(e).subs(K, k))) for e in first]
            if any(abs(v) < 1e-12 for v in vals):
                continue
            rhp = int(np.sum(closed_loop_poles(loop, k).real > 1e-9))
            if sign_changes(vals) != rhp:
                consistent = False
        checks.append('여러 K에서 첫 열 부호 변화 수 = 우반면 극점 수: ' + ('일치' if consistent else '불일치'))
    else:
        checks.append('특수 경우(ε 또는 영행)가 있는 표 → 안정 범위는 폐루프 극점 직접 계산으로 판정')

    # 교차점마다 보조방정식 보여 주기 (수업 풀이 방식)
    aux_lines = []
    for c in cross:
        line = _aux_for_crossing(rows, c)
        if line:
            aux_lines.append(line)

    stable = exact if exact is not None else numeric
    stable_t = intervals_text(stable)
    work = [f'특성다항식: {fmt.poly(cp)} = 0', 'Routh 표 (첫 열 부호를 본다):']
    for r in table_text(rows):
        work.append(f'  s^{r["power"]} │ ' + '   '.join(r['cells']))
    for sp_ in specials:
        work.append('  ※ ' + sp_['text'])
    work.append('첫 열: ' + ', '.join(fmt.expr(e) for e in first))
    work.append(f'첫 열이 모두 양수인 K 범위 → 안정: {stable_t}')
    if cross:
        work.append(f's = jω 대입 → 실수부 {cross_eq["Re"]} = 0,  허수부 {cross_eq["Im"]} = 0')
        for c in cross:
            work.append(f'  허수축 교차: s = ±j{c["omegaText"]}  (K = {c["KText"]})' if c['omega'] > 0
                        else f'  원점 통과: s = 0  (K = {c["KText"]})')
        work.extend(aux_lines)
    else:
        work.append('K > 0 에서 허수축과 만나는 점 없음')

    good = agree and consistent
    method = ' / '.join(checks)
    return make_step(
        7, 'routh', 'Routh 표 · 안정 범위 · 허수축 교차',
        'Routh 표 첫 열의 부호 변화 수 = 우반면 극점 수,  허수축 교차: s = jω 대입 (또는 보조방정식)',
        {'charPoly': fmt.poly(cp)},
        work,
        {'table': table_text(rows), 'firstColumn': [fmt.expr(e) for e in first],
         'specials': specials, 'stable': stable, 'stableText': stable_t,
         'stableNumeric': numeric, 'stableExact': exact, 'crossings': cross, 'crossEq': cross_eq},
        ok(method, stable_t) if good else fail(method, stable_t),
        {'crossings': [[0.0, c['omega'], c['K']] for c in cross]},
    )


def _aux_for_crossing(rows, c):
    """K = Kc 에서 첫 열이 0이 되는 행을 찾아, 바로 위 행으로 보조방정식을 만든다."""
    kc = sp.nsimplify(c['K']) if not isinstance(c['K'], sp.Basic) else c['K']
    for i in range(1, len(rows)):
        v = sp.sympify(rows[i]['cells'][0])
        if v.has(eps):
            return None
        try:
            val = complex(sp.N(v.subs(K, c['K'])))
        except Exception:
            continue
        if abs(val) < 1e-9 * max(1.0, c['K']):
            prev = rows[i - 1]
            pw = prev['power']
            aux = sum(sp.sympify(prev['cells'][k]).subs(K, sp.nsimplify(c['K'], tolerance=1e-12, rational=True)) * s ** (pw - 2 * k)
                      for k in range(len(prev['cells'])) if pw - 2 * k >= 0)
            aux = sp.expand(aux)
            return f'  K = {c["KText"]} 에서 s^{rows[i]["power"]} 행 첫 열 = 0 → 보조방정식 {fmt.expr(aux)} = 0 → s = ±j{c["omegaText"]}'
    return None
