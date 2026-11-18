"""
parse.py — 입력 해석과 지원 범위 검사 (1단계 이전의 관문)

학생이 입력한 개루프 전달함수 K·G(s)H(s) 를 받아
    K · N(s) / D(s)
꼴로 나누고, 지원 범위를 벗어나면 계산하지 않고 이유를 돌려준다.

지원 범위: 연속시간, 음의 피드백, K ≥ 0, 실수 계수, 분모 4차 이하, 분자 차수 ≤ 분모 차수
범위 밖 코드:
    parse        식을 읽을 수 없음
    delay        시간 지연 e^(-sT) 등 유리함수가 아님
    complexCoeff 복소수 계수
    gainForm     K가 전체에 곱해진 꼴이 아님 (예: 1/(s+K))
    improper     분자 차수 > 분모 차수
    order        분모 5차 이상
    noPoles      분모가 상수
    cancel       극점·영점 상쇄 (같은 인수가 분자·분모에 모두 있음)
    negativeGain 최고차항 계수의 부호가 반대 → 실질적으로 K ≤ 0 (양의 피드백)
"""
from dataclasses import dataclass, field
import sympy as sp
from sympy.parsing.sympy_parser import (
    parse_expr, standard_transformations,
    implicit_multiplication_application, convert_xor,
)
from . import fmt

s, K = fmt.s, fmt.K
MAX_ORDER = 4
_TRANS = standard_transformations + (implicit_multiplication_application, convert_xor)


class InputError(Exception):
    """지원 범위 밖이거나 읽을 수 없는 입력. code는 위 표의 값, message는 학생에게 보여 줄 한국어 설명."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message

    def to_dict(self):
        return {'code': self.code, 'message': self.message}


@dataclass
class Loop:
    """개루프 전달함수 K·N(s)/D(s). N, D는 유리수 계수 다항식(sympy Poly)."""
    N: sp.Poly
    D: sp.Poly
    source: str = ''
    notes: list = field(default_factory=list)   # 입력을 해석하며 세운 가정 (예: K가 없어서 곱함)

    @property
    def n(self):
        return self.D.degree()

    @property
    def m(self):
        return self.N.degree()

    def char_poly(self):
        """특성다항식 D(s) + K·N(s) (s의 다항식, 계수에 K 포함)."""
        return sp.Poly(self.D.as_expr() + K * self.N.as_expr(), s)

    def text(self):
        # 화면 표시용: 유리수 범위에서 인수분해한 꼴. 예) K·(s + 2)/(s(s + 1))
        e = sp.factor(self.N.as_expr() / self.D.as_expr())
        n, d = sp.fraction(e)
        nt = fmt.expr(n).replace('·', '')
        dt = fmt.expr(d).replace('·', '')
        nt = nt if (n.is_Atom or n.is_Pow) else '(' + nt + ')'
        if n == 1:
            nt = ''
        return 'K' + ('·' + nt if nt else '') + '/' + (dt if (d.is_Atom or d.is_Pow) else '(' + dt + ')')


def _frac_text(N, D):
    nt = fmt.factored(N)
    dt = fmt.factored(D)
    if nt == '1':
        return '1/(' + dt + ')'
    return '(' + nt + ')/(' + dt + ')'


def _clean(text):
    """화면에서 자주 쓰는 기호를 sympy가 읽을 수 있는 글자로 바꾼다."""
    t = text.strip()
    for a, b in (('−', '-'), ('·', '*'), ('×', '*'), ('²', '^2'), ('³', '^3'), ('⁴', '^4'),
                 ('，', ','), ('（', '('), ('）', ')'), ('{', '('), ('}', ')'), ('[', '('), (']', ')')):
        t = t.replace(a, b)
    # 'G(s)H(s) = ...' 처럼 앞에 이름이 붙어 있으면 '=' 뒤만 쓴다.
    if '=' in t:
        t = t.split('=')[-1]
    return t


def parse_text(text):
    """글자로 된 식을 Loop으로 바꾼다. 예: 'K(s+2)/(s(s+1))'
    evaluate=False 로 읽는 이유: sympy는 보통 (s+1)/(s+1) 을 읽는 순간 1로 지워 버린다.
    그러면 극점·영점 상쇄를 감지할 수 없으므로, 식을 '있는 그대로' 읽은 뒤 분자·분모를 직접 만든다."""
    if not text or not text.strip():
        raise InputError('parse', '식이 비어 있습니다.')
    t = _clean(text)
    try:
        e = parse_expr(t, local_dict={'s': s, 'K': K, 'k': K, 'e': sp.E, 'j': sp.I},
                       transformations=_TRANS, evaluate=False)
    except Exception:
        raise InputError('parse', '식을 읽지 못했습니다. 예: K(s+2)/(s(s+1)) 처럼 입력해 주세요.')
    return from_expr(e, source=text)


def num_den(e):
    """식 트리를 따라가며 (분자, 분모)를 만든다. 약분은 하지 않는다.
        덧셈  a/b + c/d = (ad + cb)/(bd)
        곱셈  (a/b)(c/d) = ac/(bd)
        거듭제곱(정수 지수)  (a/b)^k = a^k/b^k,  음수 지수면 분자·분모를 바꾼다"""
    if e.is_Add:
        n, d = sp.Integer(0), sp.Integer(1)
        for a in e.args:
            an, ad = num_den(a)
            n, d = n * ad + an * d, d * ad
        return sp.expand(n), sp.expand(d)
    if e.is_Mul:
        n, d = sp.Integer(1), sp.Integer(1)
        for a in e.args:
            an, ad = num_den(a)
            n, d = n * an, d * ad
        return sp.expand(n), sp.expand(d)
    if e.is_Pow:
        k = e.exp
        if not (k.is_Integer or (k.is_number and sp.nsimplify(k).is_Integer)):
            raise InputError('parse', '거듭제곱 지수는 정수여야 합니다.')
        k = int(sp.nsimplify(k))
        bn, bd = num_den(e.base)
        if k >= 0:
            return sp.expand(bn ** k), sp.expand(bd ** k)
        return sp.expand(bd ** (-k)), sp.expand(bn ** (-k))
    if e.is_Symbol or e.is_number:
        if e.is_number and e.is_Rational is False and e.is_Float:
            return sp.nsimplify(e, rational=True), sp.Integer(1)
        return e, sp.Integer(1)
    raise InputError('delay', '시간 지연(e^(−sT))이나 삼각함수처럼 유리함수가 아닌 식은 지원하지 않습니다.')


def from_expr(e, source=''):
    """sympy 식을 Loop으로. K가 없으면 전체에 K를 곱한 것으로 본다."""
    e = sp.sympify(e, evaluate=False) if isinstance(e, str) else e
    notes = []
    extra = e.free_symbols - {s, K}
    if extra:
        names = ', '.join(sorted(str(x) for x in extra))
        raise InputError('parse', f'모르는 문자({names})가 있습니다. 변수는 s, 이득은 K만 쓸 수 있습니다.')
    if e.has(sp.exp) or e.has(sp.E):
        raise InputError('delay', '시간 지연(e^(−sT))처럼 유리함수가 아닌 식은 지원하지 않습니다.')
    if e.has(sp.I):
        raise InputError('complexCoeff', '복소수 계수는 지원하지 않습니다. 실수 계수만 입력해 주세요.')
    num, den = num_den(e)
    if den.has(K):
        raise InputError('gainForm', 'K가 식 전체에 곱해진 꼴(K·G(s)H(s))이어야 합니다. 분모에 K가 있습니다.')
    if num.has(K):
        pk = sp.Poly(num, K)
        if pk.degree() != 1 or pk.coeff_monomial(1) != 0:
            raise InputError('gainForm', 'K가 식 전체에 곱해진 꼴(K·G(s)H(s))이어야 합니다.')
        num = sp.expand(pk.coeff_monomial(K))
    else:
        notes.append('K가 없어서 입력한 식 전체에 K를 곱한 것으로 보았습니다.')
    if not num.is_polynomial(s) or not den.is_polynomial(s):
        raise InputError('parse', '분자와 분모가 s의 다항식이어야 합니다.')
    return from_polys(sp.Poly(num, s), sp.Poly(den, s), source=source, notes=notes)


def _rational(e):
    """식의 계수를 유리수로 바꿀 수 있는지(소수는 분수로 바꿔 정확히 계산한다)."""
    return all(c.is_number for c in sp.Poly(e, s).coeffs())


def from_polys(N, D, source='', notes=None):
    """분자·분모 다항식에서 Loop을 만들고 지원 범위를 검사한다."""
    notes = list(notes or [])
    N = _to_rational_poly(N)
    D = _to_rational_poly(D)
    if N.is_zero:
        raise InputError('parse', '분자가 0입니다.')
    if D.is_zero:
        raise InputError('parse', '분모가 0입니다.')
    for c in list(N.all_coeffs()) + list(D.all_coeffs()):
        if not c.is_real:
            raise InputError('complexCoeff', '복소수 계수는 지원하지 않습니다.')
    if D.degree() < 1:
        raise InputError('noPoles', '분모에 s가 없습니다. 극점이 있는 전달함수를 입력해 주세요.')
    if N.degree() > D.degree():
        raise InputError('improper', f'분자 차수({N.degree()})가 분모 차수({D.degree()})보다 큽니다. 지원 범위 밖입니다.')
    if D.degree() > MAX_ORDER:
        raise InputError('order', f'분모가 {D.degree()}차입니다. 지원 범위는 분모 {MAX_ORDER}차 이하입니다.')
    g = sp.gcd(N, D)
    if g.degree() > 0:
        common = fmt.factored(g)
        raise InputError('cancel', f'분자와 분모에 같은 인수 {common} 가 있습니다(극점·영점 상쇄). '
                                   '상쇄된 극점은 근궤적에 나타나지 않아 안정성을 잘못 판단할 수 있으므로 계산하지 않습니다.')
    # 분모 최고차항을 양수로 맞춘다 (분자·분모에 −1을 함께 곱해도 값은 같다).
    if D.LC() < 0:
        N, D = -N, -D
    if N.LC() < 0:
        raise InputError('negativeGain', '분자와 분모의 최고차항 부호가 반대입니다. K ≥ 0에서 실질적으로 양의 피드백(K ≤ 0)이 되므로 '
                                         '이 도구의 범위(음의 피드백, K ≥ 0) 밖입니다.')
    return Loop(N=N, D=D, source=source, notes=notes)


def _to_rational_poly(P):
    """계수가 소수면 분수로 바꾼다. 0.5 → 1/2. 정확한 기호 계산을 위해서다."""
    if not isinstance(P, sp.Poly):
        P = sp.Poly(sp.expand(sp.sympify(P)), s)
    coeffs = [sp.nsimplify(c, rational=True) for c in P.all_coeffs()]
    return sp.Poly(coeffs, s, domain='QQ') if all(c.is_rational for c in coeffs) else sp.Poly(coeffs, s)


def from_factors(num_factors, den_factors):
    """내림차순 계수 배열들의 곱으로 Loop을 만든다. 예: num=[[1,2]], den=[[1,0],[1,1]] → K(s+2)/(s(s+1))"""
    def build(factors):
        e = sp.Integer(1)
        for f in factors:
            e *= sum(sp.nsimplify(c, rational=True) * s ** (len(f) - 1 - i) for i, c in enumerate(f))
        return sp.Poly(sp.expand(e), s)
    return from_polys(build(num_factors), build(den_factors))


def from_coeffs(num, den):
    """내림차순 계수 배열 하나씩으로 Loop을 만든다. 예: num=[1,2], den=[1,1,0]"""
    return from_factors([num], [den])
