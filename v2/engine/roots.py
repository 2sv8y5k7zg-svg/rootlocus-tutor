"""
roots.py — 다항식의 근과 중복도(중근 개수) 구하기

방법
  1) 유리수 범위에서 인수분해한다 (sympy.factor_list). 같은 인수가 k번 나오면 그 근은 k중근이다.
  2) 1차·2차 인수는 근의 공식으로 정확한 값(분수·제곱근)을 구한다.
  3) 3차 이상 인수(유리수로 더 쪼개지지 않는 것)는 30자리 정밀도 수치해(nroots)를 쓴다.

수치 반올림 때문에 중근이 '아주 가까운 두 근'으로 갈라지는 문제를
인수분해 단계에서 미리 막는 것이 이 방식의 장점이다.
"""
import sympy as sp
from . import fmt

s = fmt.s
PREC = 30
REAL_TOL = 1e-12   # 허수부가 이보다 작으면 실수로 본다 (수치해에만 적용)


def find(P):
    """다항식 P의 근 목록. 각 근은 {'value': complex, 'mult': int, 'exact': sympy식 또는 None}.
    정렬: 실수부 큰 것부터, 같으면 허수부 큰 것부터."""
    if not isinstance(P, sp.Poly):
        P = sp.Poly(P, s)
    out = []
    if P.degree() < 1:
        return out
    _, factors = sp.factor_list(P.as_expr(), s)
    for f, mult in factors:
        fp = sp.Poly(f, s)
        d = fp.degree()
        if d < 1:
            continue
        if d <= 2:
            # 1·2차: 근의 공식 → 정확한 값
            for r, k in sp.roots(fp, s).items():
                r = sp.nsimplify(sp.simplify(r))
                out.append({'value': complex(sp.N(r, PREC)), 'mult': int(mult * k), 'exact': r})   # int(): sympy 정수가 JSON에 섞이지 않게
        else:
            # 3차 이상: 고정밀 수치해
            for r in fp.nroots(n=PREC, maxsteps=200):
                z = complex(r)
                if abs(z.imag) < REAL_TOL * max(1.0, abs(z)):
                    z = complex(z.real, 0.0)
                out.append({'value': z, 'mult': int(mult), 'exact': None, 'hp': r})   # hp: 30자리 값 (경계 판정용)
    out.sort(key=lambda r: (-round(r['value'].real, 12), -round(r['value'].imag, 12)))
    return out


def is_real(r):
    """근이 실수인지. 정확한 값이 있으면 그것으로, 없으면 허수부 크기로 판단."""
    if r.get('exact') is not None:
        return bool(sp.im(r['exact']) == 0)
    return abs(r['value'].imag) == 0.0


def expand_mult(rs):
    """중근을 겹친 수만큼 펼친 복소수 목록. 예: 이중근 0 → [0, 0]"""
    out = []
    for r in rs:
        for _ in range(r['mult']):
            out.append(r['value'])
    return out


def describe(r):
    """화면용 글자. 정확한 값이 있으면 정확한 값, 없으면 소수."""
    if r.get('exact') is not None:
        t = fmt.expr(r['exact'])
        if len(t) <= 22:
            return t
    return fmt.cnum(r['value'])


def to_json(r):
    v = r['value']
    return {
        're': v.real, 'im': v.imag, 'mult': r['mult'],
        'exact': fmt.expr(r['exact']) if r.get('exact') is not None else None,
        'text': describe(r),
    }
