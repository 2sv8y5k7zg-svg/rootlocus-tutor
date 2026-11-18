"""
fmt.py — 수식과 숫자를 사람이 읽기 좋은 글자로 바꾸는 도구

엔진은 sympy(기호 계산 라이브러리) 객체로 계산하고, 화면에는 이 파일의 함수로 바꾼 글자를 보낸다.
  - 정확한 값(분수·제곱근)은 그대로:  -3/2, 2√2
  - 근사값은 소수 4자리:             -0.8026
  - 허수 단위는 공학 표기 j를 쓴다:   -1 + j1
"""
import math
import re
import sympy as sp

s = sp.Symbol('s')
K = sp.Symbol('K')

_SUP = str.maketrans('0123456789-', '⁰¹²³⁴⁵⁶⁷⁸⁹⁻')


def num(x, digits=4):
    """실수 하나를 짧은 글자로. 정수에 가까우면 정수로, 아니면 소수 digits자리."""
    x = float(x)
    if math.isinf(x):
        return '∞' if x > 0 else '−∞'
    if abs(x - round(x)) < 1e-9:
        return _minus(str(int(round(x))))
    t = f'{x:.{digits}f}'.rstrip('0').rstrip('.')
    return _minus(t)


def _minus(t):
    # 화면용 빼기 기호(−)는 하이픈(-)보다 길어서 읽기 쉽다.
    return t.replace('-', '−')


def cnum(z, digits=4):
    """복소수 하나를 'a + jb' 꼴로."""
    z = complex(z)
    re_, im_ = z.real, z.imag
    scale = max(1.0, abs(z))
    if abs(im_) < 1e-10 * scale:
        return num(re_, digits)
    if abs(re_) < 1e-10 * scale:
        return ('−' if im_ < 0 else '') + 'j' + num(abs(im_), digits)
    sign = '−' if im_ < 0 else '+'
    return f'{num(re_, digits)} {sign} j{num(abs(im_), digits)}'


def expr(e):
    """sympy 식을 화면 글자로. sqrt(2) → √2, I → j, ** → 위첨자."""
    if e is None:
        return ''
    e = sp.sympify(e)
    if e.is_number and not e.is_real and e.is_finite:
        # 복소수는 'a ± jb' 꼴로 (공학 표기: j를 앞에)
        re_, im_ = sp.nsimplify(sp.re(e)), sp.nsimplify(sp.im(e))
        jb = 'j' if abs(im_) == 1 else 'j' + expr(sp.Abs(im_)).replace('−', '-')
        if re_ == 0:
            return _minus(('-' if im_ < 0 else '') + jb)
        return _minus(expr(re_).replace('−', '-') + (' - ' if im_ < 0 else ' + ') + jb)
    t = sp.sstr(e)
    t = t.replace('**', '^').replace('*I', 'j').replace('I*', 'j').replace('I', 'j')
    t = re.sub(r'sqrt\(([0-9]+)\)', r'√\1', t)
    t = t.replace('sqrt', '√')
    t = t.replace('*', '·').replace('·√', '√')
    t = re.sub(r'\^([0-9]+)', lambda m: m.group(1).translate(_SUP), t)
    return _minus(t)


def value(e, digits=4):
    """정확한 값과 근사값을 함께 돌려준다. 화면은 둘 다 보여 주고, 채점은 approx로 비교한다."""
    e = sp.nsimplify(e) if isinstance(e, (int, float)) else sp.sympify(e)
    approx = complex(sp.N(e, 30))
    exact_text = expr(e)
    approx_text = cnum(approx, digits)
    is_exact = e.is_number and not e.has(sp.Float)
    return {
        'exact': exact_text if is_exact else None,
        'approx': [approx.real, approx.imag] if abs(approx.imag) > 0 else approx.real,
        'text': exact_text if (is_exact and len(exact_text) <= 24) else approx_text,
        'approxText': approx_text,
    }


def poly(P, var='s'):
    """다항식(sympy Poly)을 's³ + 3s² + 2s + K' 같은 글자로. 계수가 K를 포함해도 된다."""
    if not isinstance(P, sp.Poly):
        P = sp.Poly(sp.expand(P), s)
    terms = []
    deg = P.degree()
    for (k,), c in zip(P.monoms(), P.coeffs()):
        c = sp.nsimplify(c) if isinstance(c, sp.Float) else c
        power = '' if k == 0 else (var if k == 1 else var + str(k).translate(_SUP))
        terms.append(_term(c, power))
    if not terms:
        return '0'
    out = terms[0]
    for t in terms[1:]:
        out += (' − ' + t[1:]) if t.startswith('-') else (' + ' + t)
    return _minus(out) if out.startswith('-') else out


def _term(c, power):
    """계수 c와 거듭제곱 글자 power를 한 항으로 합친다. (계수가 1이면 생략)"""
    c = sp.sympify(c)
    if power == '':
        return expr(c).replace('−', '-')
    if c == 1:
        return power
    if c == -1:
        return '-' + power
    ct = expr(c).replace('−', '-')
    if c.is_Add:  # 계수가 'K + 2'처럼 여러 항이면 괄호
        ct = '(' + ct + ')'
    return ct + power


def factored(P):
    """다항식을 유리수 범위에서 인수분해한 글자. 예: s(s + 1)(s + 2)"""
    e = sp.factor(P.as_expr() if isinstance(P, sp.Poly) else P)
    t = expr(e)
    return t.replace('·', '')
