"""
blockdiagram.py — 블록선도 구조 → 폐루프 전달함수 → 근궤적용 K·N(s)/D(s)

AI(또는 학생)가 블록선도를 아래 같은 구조(JSON)로 적으면, 이 파일이 신호 방정식을 세워 푼다.

{
  "input": "R", "output": "Y",
  "blocks": [ {"id": "G1", "tf": "K", "in": "E"},          블록 출력 = tf × (in 신호)
              {"id": "G2", "tf": "1/(s(s+2))", "in": "G1"},
              {"id": "H",  "tf": "(s+3)/(s+4)", "in": "G2"} ],
  "sums":   [ {"id": "E", "inputs": [["R", "+"], ["H", "-"]]} ],   합산점 = Σ(부호 × 신호)
  "outputNode": "G2"    출력 Y가 어느 신호인지
}

풀이 순서
  1) 신호마다 sympy 변수를 하나씩 만든다 (R은 1로 둔다 → 결과가 곧 Y/R)
  2) 블록 식: x_블록 = tf · x_입력,   합산점 식: x_합 = Σ 부호·x_입력
  3) 연립 일차방정식을 풀어 T(s) = Y/R 을 구한다
  4) T(s)의 분모 = 특성다항식 Δ(s, K) = A(s) + K·B(s)  →  근궤적용 N = B, D = A
     (단위 피드백이 아니어도, 여러 루프가 있어도 같은 방법이 통한다)
"""
import sympy as sp
from . import fmt
from .parse import InputError, parse_expr, _TRANS, _clean, from_polys

s, K = fmt.s, fmt.K


def _tf(text):
    try:
        e = parse_expr(_clean(str(text)), local_dict={'s': s, 'K': K, 'k': K}, transformations=_TRANS)
    except Exception:
        raise InputError('parse', f'블록 전달함수 "{text}"를 읽지 못했습니다.')
    if e.free_symbols - {s, K}:
        raise InputError('parse', f'블록 "{text}"에 s, K 말고 다른 문자가 있습니다.')
    return e


def solve(diagram):
    """블록선도 사전 → {'T': 폐루프 전달함수, 'L': 루프 전달함수, 'loop': Loop, 'equations': [...]}"""
    inp = diagram.get('input', 'R')
    blocks = diagram.get('blocks', [])
    sums = diagram.get('sums', [])
    out_node = diagram.get('outputNode') or diagram.get('output')
    if not blocks:
        raise InputError('parse', '블록이 없습니다.')
    names = [inp] + [b['id'] for b in blocks] + [x['id'] for x in sums]
    if len(set(names)) != len(names):
        raise InputError('parse', '블록·합산점 이름이 겹칩니다.')
    if out_node not in names:
        raise InputError('parse', f'출력 신호 "{out_node}"를 찾을 수 없습니다.')
    sym = {nm: sp.Symbol('x_' + nm) for nm in names}
    eqs, shown = [sp.Eq(sym[inp], 1)], []
    for b in blocks:
        if b.get('in') not in sym:
            raise InputError('parse', f'블록 {b["id"]}의 입력 "{b.get("in")}"을 찾을 수 없습니다.')
        g = _tf(b['tf'])
        eqs.append(sp.Eq(sym[b['id']], g * sym[b['in']]))
        shown.append(f'{b["id"]} = ({fmt.expr(g)})·{b["in"]}')
    for x in sums:
        total = 0
        parts = []
        for item in x['inputs']:
            # AI 응답은 {"from": "R", "sign": "+"}, 사람이 쓴 구조는 ["R", "+"] 일 수 있어 둘 다 받는다
            src, sign = (item.get('from'), item.get('sign', '+')) if isinstance(item, dict) else item
            if src not in sym:
                raise InputError('parse', f'합산점 {x["id"]}의 입력 "{src}"를 찾을 수 없습니다.')
            sg = -1 if str(sign).strip() in ('-', '−') else 1
            total += sg * sym[src]
            parts.append(('−' if sg < 0 else '+') + ' ' + src)
        eqs.append(sp.Eq(sym[x['id']], total))
        shown.append(f'{x["id"]} = ' + ' '.join(parts).lstrip('+ '))
    sol = sp.solve(eqs, list(sym.values()), dict=True)
    if not sol:
        raise InputError('parse', '신호 방정식의 해가 없습니다. 연결을 확인해 주세요.')
    T = sp.factor(sp.together(sol[0][sym[out_node]]))
    num, den = sp.fraction(sp.together(T))
    # 분모의 상수 배를 정리해 최고차 계수 1인 꼴로 비교하기 쉽게 한다
    den_p = sp.Poly(sp.expand(den), s)
    delta = sp.expand(den_p.as_expr())
    if not delta.has(K):
        raise InputError('gainForm', '특성다항식에 K가 없습니다. 근궤적을 그릴 이득 K가 어느 블록에 있는지 확인해 주세요.')
    dP = sp.Poly(delta, K)
    if dP.degree() != 1:
        raise InputError('gainForm', '특성다항식이 K에 대해 일차식이 아닙니다(K가 여러 곳에 곱해짐). 지원 범위 밖입니다.')
    B = sp.expand(dP.coeff_monomial(K))
    A = sp.expand(dP.coeff_monomial(1))
    loop = from_polys(sp.Poly(B, s), sp.Poly(A, s), source='블록선도')
    L = sp.factor(K * B / A)
    return {
        'equations': shown,
        'T': fmt.expr(T), 'Tnum': fmt.poly(sp.Poly(sp.expand(num), s)), 'Tden': fmt.poly(sp.Poly(delta, s)),
        'L': fmt.expr(L), 'charPoly': fmt.poly(sp.Poly(delta, s)),
        'loop': loop,
        'unityFeedback': None,
    }


def from_g_h(G, H='1', sign='-'):
    """가장 흔한 구조: 앞먹임 G(s), 되먹임 H(s). 음의 피드백만 지원."""
    if str(sign).strip() not in ('-', '−'):
        raise InputError('negativeGain', '양의 피드백은 지원 범위 밖입니다.')
    d = {'input': 'R', 'outputNode': 'G',
         'blocks': [{'id': 'G', 'tf': G, 'in': 'E'}, {'id': 'H', 'tf': H, 'in': 'G'}],
         'sums': [{'id': 'E', 'inputs': [['R', '+'], ['H', '-']]}]}
    out = solve(d)
    out['unityFeedback'] = sp.simplify(_tf(H) - 1) == 0
    return out
