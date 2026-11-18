"""
grader.py — 학생 답 채점 (단계별 답 입력 + 손글씨 인식 결과 모두 여기로 온다)

판정 종류
    correct       정답 (수학적으로 같은 식·값이면 모양이 달라도 정답)
    approx        반올림 범위 안에서 정답 (예: −1.4226 → −1.42)
    incorrect     오답 → 팀이 미리 정해 둔 '흔한 실수 규칙'으로 원인을 찾아 본다
    unreadable    읽을 수 없는 답 (오답이 아님, 다시 확인 요청)
    unverifiable  엔진이 이 항목의 정답을 확정하지 못함 (정답을 지어내지 않음)

정답은 항상 엔진 결과(analyze의 출력)에서 꺼낸다. 이 파일은 정답을 새로 계산하지 않는다.
(흔한 실수 규칙에서만 '틀린 공식으로 계산하면 나오는 값'을 만들어 학생 답과 비교한다)
"""
import math
import re
import sympy as sp
from sympy.parsing.sympy_parser import parse_expr
from . import fmt
from .parse import _TRANS

s, K = fmt.s, fmt.K
ABS_TOL = 0.005      # 반올림 허용 (절대)
REL_TOL = 0.005      # 반올림 허용 (상대 0.5%)
ANG_TOL = 0.5        # 각도 허용 (도)

# 단계별로 채점할 수 있는 항목 (화면의 입력 칸과 같은 이름)
FIELDS = {
    1: [('charPoly', '특성방정식 (예: s^3+3s^2+2s+K)')],
    2: [('poles', '극점 (쉼표로 구분, 예: 0, -1, -2)'), ('zeros', '영점 (없으면 비워 두기)'), ('branches', '가지 수')],
    3: [('segments', '실수축 구간 (예: [-2, 0], (-inf, -3])')],
    4: [('centroid', '점근선 중심 σa'), ('asymAngles', '점근선 각도 (예: 60, 180, 300)')],
    5: [('breakpoints', '이탈점·진입점 (없으면 "없음")')],
    6: [('angles', '출발각·도착각 (도, 예: -71.57)')],
    7: [('stableRange', '안정한 K 범위 (예: 0<K<6)'), ('crossK', '허수축 교차 K'), ('crossOmega', '교차 주파수 ω')],
    8: [],
    9: [('polesAtK', '주어진 K에서 폐루프 극점')],
}


# ───────────────────── 학생 답 읽기 ─────────────────────

def _prep(t):
    """학생 답 글자 → sympy가 읽을 수 있는 글자."""
    t = str(t).strip()
    for a, b in (('−', '-'), ('–', '-'), ('·', '*'), ('×', '*'), ('÷', '/'), ('²', '^2'), ('³', '^3'), ('⁴', '^4'),
                 ('∞', 'oo'), ('inf', 'oo'), ('Infinity', 'oo'), ('°', ''), ('도', ''), ('π', 'pi')):
        t = t.replace(a, b)
    t = re.sub(r'√\s*\(', 'sqrt(', t)
    t = re.sub(r'√\s*([0-9.]+)', r'sqrt(\1)', t)
    # 공학 표기 j: 'j2' → 'I*2', '2j' → '2*I', 'j√2' → 'I*sqrt(2)'
    t = re.sub(r'\bj\s*(?=[0-9(s])', 'I*', t)
    t = re.sub(r'([0-9.)])\s*j\b', r'\1*I', t)
    t = re.sub(r'\bj\b', 'I', t)
    t = re.sub(r'(?<![a-zA-Z])i\b', 'I', t)
    return t


def read_value(t):
    """숫자 하나(복소수 가능) 읽기. 실패하면 None."""
    try:
        e = parse_expr(_prep(t), local_dict={'I': sp.I, 'sqrt': sp.sqrt, 'pi': sp.pi, 'oo': sp.oo}, transformations=_TRANS)
        if e.free_symbols:
            return None
        if e in (sp.oo, -sp.oo):
            return complex(float(e), 0)
        return complex(sp.N(e, 30))
    except Exception:
        return None


def read_values(t):
    """'−1 ± j2, −3' 처럼 여러 값 읽기. '±'는 두 값으로 펼친다. 실패하면 None."""
    t = str(t).strip()
    if t in ('', '없음', '없다', 'none', 'None', '-', 'x', 'X'):
        return []
    parts = re.split(r'[,;]|\s{2,}|그리고', t.replace('，', ','))
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if '±' in p or '+-' in p:
            a, b = re.split(r'±|\+-', p, maxsplit=1)
            a = a.strip() or '0'
            for sg in ('+', '-'):
                v = read_value(f'({a}){sg}({b})')
                if v is None:
                    return None
                out.append(v)
            continue
        v = read_value(p)
        if v is None:
            return None
        out.append(v)
    return out


def read_poly(t):
    """식(특성방정식) 읽기. '= 0'은 지운다."""
    try:
        t = _prep(t).split('=')[0]
        return parse_expr(t, local_dict={'s': s, 'K': K, 'k': K}, transformations=_TRANS)
    except Exception:
        return None


def read_intervals(t, var='s'):
    """구간 읽기. '[-2, 0], (-inf, -3]'  또는  '-2 < s < 0, s < -3'  또는  '0<K<6'"""
    t = _prep(t)
    out = []
    for lo_br, a, b, hi_br in re.findall(r'([\[(])\s*([^,\[\]()]+?)\s*,\s*([^,\[\]()]+?)\s*([\])])', t):
        va, vb = read_value(a), read_value(b)
        if va is None or vb is None:
            return None
        out.append({'lo': va.real, 'hi': vb.real, 'loIncl': lo_br == '[', 'hiIncl': hi_br == ']'})
    if out:
        return out
    for chunk in re.split(r',|또는|or', t):
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.fullmatch(r'(.+?)\s*(<=|<|≤)\s*[sSKk]\s*(<=|<|≤)\s*(.+)', chunk)
        if m:
            va, vb = read_value(m.group(1)), read_value(m.group(4))
            if va is None or vb is None:
                return None
            out.append({'lo': va.real, 'hi': vb.real, 'loIncl': m.group(2) != '<', 'hiIncl': m.group(3) != '<'})
            continue
        m = re.fullmatch(r'[sSKk]\s*(>=|>|≥)\s*(.+)', chunk) or re.fullmatch(r'(.+?)\s*(<=|<|≤)\s*[sSKk]', chunk)
        if m:
            g = m.groups()
            v = read_value(g[1] if g[0] in ('>=', '>', '≥') else g[0])
            op = g[0] if g[0] in ('>=', '>', '≥') else g[1]
            if v is None:
                return None
            out.append({'lo': v.real, 'hi': math.inf, 'loIncl': op != '>' and op != '<', 'hiIncl': False})
            continue
        m = re.fullmatch(r'[sSKk]\s*(<=|<|≤)\s*(.+)', chunk)
        if m:
            v = read_value(m.group(2))
            if v is None:
                return None
            out.append({'lo': -math.inf, 'hi': v.real, 'loIncl': False, 'hiIncl': m.group(1) != '<'})
            continue
        return None
    return out


# ───────────────────── 비교 도구 ─────────────────────

def _close(a, b):
    """두 수가 같은지: (정확) 1e−9 이내 → 'exact', 반올림 범위 → 'approx', 아니면 None"""
    a, b = complex(a), complex(b)
    if math.isinf(a.real) or math.isinf(b.real):
        return 'exact' if a.real == b.real else None
    d = abs(a - b)
    if d <= 1e-9 * max(1.0, abs(b)):
        return 'exact'
    if d <= max(ABS_TOL, REL_TOL * abs(b)):
        return 'approx'
    return None


def _match_sets(got, want):
    """순서 없이 두 값 목록 비교. 반환: 'exact' / 'approx' / None"""
    got, want = list(got), list(want)
    if len(got) != len(want):
        return None
    level = 'exact'
    for w in want:
        best = None
        for i, g in enumerate(got):
            c = _close(g, w)
            if c == 'exact':
                best = (i, c)
                break
            if c == 'approx' and best is None:
                best = (i, c)
        if best is None:
            return None
        if best[1] == 'approx':
            level = 'approx'
        got.pop(best[0])
    return level


def _ang_close(a, b):
    d = math.fmod(abs(a - b), 360.0)
    return min(d, 360.0 - d) <= ANG_TOL


def _ang_level(got, want):
    """각도 목록 비교 (360° 차이는 같은 각). 반환: 'exact'(1e−6° 이내) / 'approx'(0.5° 이내) / None"""
    got = list(got)
    if len(got) != len(want):
        return None
    level = 'exact'
    for w in want:
        best, bd = -1, 1e9
        for i, g in enumerate(got):
            d = math.fmod(abs(g - w), 360.0)
            d = min(d, 360.0 - d)
            if d < bd:
                best, bd = i, d
        if best < 0 or bd > ANG_TOL:
            return None
        if bd > 1e-6:
            level = 'approx'
        got.pop(best)
    return level


def _verdict(level, expected_text, student_text, diagnosis=None, extra=None):
    status = {'exact': 'correct', 'approx': 'approx', None: 'incorrect'}[level]
    out = {'status': status, 'expected': expected_text, 'student': student_text, 'diagnosis': diagnosis}
    if status == 'approx':
        out['note'] = '반올림 범위 안에서 정답입니다.'
    if extra:
        out.update(extra)
    return out


def _unreadable(student_text):
    return {'status': 'unreadable', 'expected': None, 'student': student_text,
            'diagnosis': '답을 읽지 못했습니다. 오답으로 처리하지 않았습니다. 숫자·식을 다시 확인해 주세요.'}


def _unverifiable(why):
    return {'status': 'unverifiable', 'expected': None, 'student': None, 'diagnosis': why}


def _vals_text(vs):
    return ', '.join(fmt.cnum(v) for v in vs) or '없음'


# ───────────────────── 단계별 채점 ─────────────────────

def check(result, field, answer, k_value=None):
    """result: engine.analyze() 결과, field: FIELDS의 이름, answer: 학생 답 글자.
    k_value: 9단계(polesAtK)에서 사용할 K."""
    if not result or not result.get('ok'):
        return _unverifiable('엔진 결과가 없어 채점할 수 없습니다.')
    st = {x['n']: x for x in result['steps']}
    # 해당 단계의 엔진 자체 검증이 실패했으면 정답을 확정하지 않는다
    step_of = {f: n for n, fs in FIELDS.items() for f, _ in fs}
    n = step_of.get(field)
    if n is None:
        return _unverifiable(f'모르는 항목: {field}')
    if st[n]['check']['status'] != 'verified':
        return _unverifiable(f'{n}단계 엔진 검증이 통과하지 않아 정답을 확정하지 않았습니다.')
    fn = globals().get('_check_' + field)
    try:
        return fn(st, answer, k_value) if field == 'polesAtK' else fn(st, answer)
    except Exception as e:   # 예상하지 못한 답 모양 → 오답으로 단정하지 않고 '검증 불가'
        return _unverifiable(f'이 답은 자동 채점하지 못했습니다 ({type(e).__name__}). 형식을 바꿔 다시 입력해 주세요.')


def _check_charPoly(st, answer):
    e = read_poly(answer)
    if not isinstance(e, sp.Expr) or e.free_symbols - {s, K}:   # '[-1, 0]'처럼 식이 아닌 답도 '읽지 못함'
        return _unreadable(answer)
    ref = sp.sympify(st[1]['result']['charPolyExpr'], locals={'s': s, 'K': K})
    ratio = sp.cancel(sp.expand(e) / ref) if ref != 0 else None
    exp_t = st[1]['result']['charPoly'] + ' = 0'
    if ratio is not None and not ratio.has(s) and not ratio.has(K) and ratio != 0:
        return _verdict('exact', exp_t, fmt.expr(e))
    # 흔한 실수: D − K·N (부호), N + K·D (뒤바뀜), D·N
    N = sp.sympify(st[1]['result']['charPolyExpr']).coeff(K)
    D = sp.expand(ref - K * N)
    diag = None
    for wrong, why in ((D - K * N, '1 + KGH = 0 이므로 D(s) + K·N(s) 입니다. K·N(s) 앞의 부호를 확인해 보세요.'),
                       (N + K * D, 'N(s)와 D(s)를 바꿔 쓴 것 같습니다. 분모 D(s)에 K·(분자 N(s))를 더합니다.'),
                       (D, 'K·N(s) 항이 빠졌습니다.')):
        r = sp.cancel(sp.expand(e) / sp.expand(wrong)) if sp.expand(wrong) != 0 else None
        if r is not None and not r.has(s) and not r.has(K):
            diag = why
            break
    if diag is None and sp.Poly(sp.expand(e), s).degree() != sp.Poly(ref, s).degree():
        diag = f'차수가 다릅니다. 특성방정식의 차수는 분모 차수 n = {sp.Poly(ref, s).degree()} 입니다.'
    return _verdict(None, exp_t, fmt.expr(e), diag or '전개 과정에서 계수를 다시 확인해 보세요.')


def _roots_of(st, key):
    return [complex(p['re'], p['im']) for p in st[2]['result'][key] for _ in range(p['mult'])]


def _check_poles(st, answer):
    vs = read_values(answer)
    if vs is None:
        return _unreadable(answer)
    want = _roots_of(st, 'poles')
    lvl = _match_sets(vs, want)
    diag = None
    if lvl is None:
        if _match_sets(vs, _roots_of(st, 'zeros')):
            diag = '영점을 적은 것 같습니다. 극점은 분모 D(s) = 0 의 근입니다.'
        elif _match_sets(vs, [-v for v in want]):
            diag = '부호가 반대입니다. (s + a) = 0 의 근은 s = −a 입니다.'
        elif len(vs) != len(want):
            diag = f'개수가 다릅니다. 극점은 중근을 겹친 수만큼 세어 {len(want)}개입니다.'
    return _verdict(lvl, _vals_text(want), _vals_text(vs), diag)


def _check_zeros(st, answer):
    vs = read_values(answer)
    if vs is None:
        return _unreadable(answer)
    want = _roots_of(st, 'zeros')
    lvl = _match_sets(vs, want)
    diag = None
    if lvl is None:
        if _match_sets(vs, _roots_of(st, 'poles')):
            diag = '극점을 적은 것 같습니다. 영점은 분자 N(s) = 0 의 근입니다.'
        elif _match_sets(vs, [-v for v in want]):
            diag = '부호가 반대입니다.'
    return _verdict(lvl, _vals_text(want), _vals_text(vs), diag)


def _check_branches(st, answer):
    v = read_value(answer)
    if v is None:
        return _unreadable(answer)
    want = st[2]['result']['branches']
    lvl = 'exact' if abs(v - want) < 1e-9 else None
    diag = None if lvl else (f'가지 수는 분모 차수 n = {want} 입니다.' if abs(v - st[2]['result']['m']) < 1e-9
                             else '가지 수 = 극점 수(분모 차수) 입니다.')
    return _verdict(lvl, str(want), fmt.cnum(v), diag)


def _check_segments(st, answer):
    ivs = read_intervals(answer)
    if ivs is None:
        return _unreadable(answer)
    want = st[3]['result']['segments']

    def key(lo, hi):
        return (-math.inf if lo is None else lo, math.inf if hi is None else hi)
    W = sorted(key(g['lo'], g['hi']) for g in want)
    G = sorted((min(i['lo'], i['hi']), max(i['lo'], i['hi'])) for i in ivs)
    lvl = 'exact' if len(W) == len(G) else None
    if lvl:
        for (a, b), (c, d) in zip(W, G):
            ca, cb = _close(a, c) if not math.isinf(a) else ('exact' if a == c else None), \
                _close(b, d) if not math.isinf(b) else ('exact' if b == d else None)
            if ca is None or cb is None:
                lvl = None
                break
            if 'approx' in (ca, cb):
                lvl = 'approx'
    diag = None
    if lvl is None:
        diag = '시험점 오른쪽에 있는 실수 극점·영점의 개수를 세어 보세요. 홀수인 구간만 근궤적입니다(중근은 겹친 수만큼).'
    return _verdict(lvl, st[3]['result']['text'], answer, diag)


def _check_centroid(st, answer):
    r4 = st[4]['result']
    if r4['count'] == 0:
        v = read_values(answer)
        ok_ = v == [] or str(answer).strip() in ('없음', '없다')
        return _verdict('exact' if ok_ else None, '없음 (n − m = 0)', answer,
                        None if ok_ else 'n − m = 0 이면 점근선이 없습니다.')
    v = read_value(answer)
    if v is None:
        return _unreadable(answer)
    want = r4['centroid']['approx']
    lvl = _close(v, want)
    diag = None
    if lvl is None:
        sp_ = float(sp.sympify(st[4]['inputs']['sumPoles'].replace('−', '-')))
        sz = float(sp.sympify(st[4]['inputs']['sumZeros'].replace('−', '-')))
        n, m = st[4]['inputs']['n'], st[4]['inputs']['m']
        q = n - m
        rules = [((sp_) / q, '영점의 합을 빼지 않았습니다. σa = (Σ극점 − Σ영점)/(n − m) 입니다.'),
                 ((sp_ - sz) / n, 'n − m 대신 n으로 나눴습니다.'),
                 ((sp_ + sz) / q, '영점의 합을 더했습니다. 빼야 합니다.'),
                 (-want, '부호가 반대입니다. 극점 −a 를 더할 때 부호를 확인해 보세요.'),
                 (sp_ - sz, '(n − m)으로 나누지 않았습니다.')]
        for val, why in rules:
            if m == 0 and why.startswith('영점'):
                continue
            if _close(v, val) and not _close(val, want):
                diag = why
                break
    return _verdict(lvl, r4['centroid']['text'], fmt.cnum(v), diag)


def _check_asymAngles(st, answer):
    vs = read_values(answer)
    if vs is None:
        return _unreadable(answer)
    want = st[4]['result']['angles']
    got = [v.real for v in vs]
    lv = _ang_level(got, want)
    diag = None
    if not lv:
        q = len(want)
        if q and len(got) == q and all(any(_ang_close(g, k * 360.0 / q) for g in got) for k in range(q)):
            diag = '각도 공식은 (2k + 1)·180°/(n − m) 입니다. k·360°/(n − m)과 헷갈린 것 같습니다.'
        elif len(got) != q:
            diag = f'점근선 개수는 n − m = {q}개 입니다.'
    return _verdict(lv, ', '.join(fmt.num(a) + '°' for a in want) or '없음',
                    ', '.join(fmt.num(g) + '°' for g in got), diag)


def _check_breakpoints(st, answer):
    vs = read_values(answer)
    if vs is None:
        return _unreadable(answer)
    r5 = st[5]['result']
    want = []
    for c in r5['valid']:
        z = complex(*c['s'])
        want.append(z)
        if abs(z.imag) > 1e-12:
            want.append(z.conjugate())
    got = list(vs)
    # 켤레 복소수를 하나만 적은 경우도 정답으로 인정
    if any(abs(z.imag) > 1e-12 for z in want):
        for z in list(got):
            if abs(z.imag) > 1e-12 and not any(abs(g - z.conjugate()) < 1e-6 for g in got):
                got.append(z.conjugate())
    lvl = _match_sets(got, want)
    diag = None
    if lvl is None:
        bad = [c for c in r5['candidates'] if not c['valid']]
        for c in bad:
            z = complex(*c['s'])
            if any(_close(g, z) for g in got):
                diag = (f's = {c["sText"]} 는 후보이지만 {c["statusText"]}. '
                        'D′N − DN′ = 0 의 근마다 K = −D/N 이 양의 실수인지 확인해야 합니다.')
                break
        if diag is None and len(got) < len(want):
            diag = '빠진 점이 있습니다. D′(s)N(s) − D(s)N′(s) = 0 의 근을 모두 구해 보세요.'
    return _verdict(lvl, _vals_text(want), _vals_text(vs), diag)


def _check_angles(st, answer):
    vs = read_values(answer)
    if vs is None:
        return _unreadable(answer)
    items = st[6]['result']['items']
    if not items:
        ok_ = vs == []
        return _verdict('exact' if ok_ else None, '없음', answer, None if ok_ else '복소 극점·영점이 없어 출발각·도착각이 없습니다.')
    got = [v.real for v in vs]
    want_all = [a for it in items for a in it['angles']]
    # 학생이 위쪽 복소 극점 하나의 각만 적는 경우가 많으므로, 어느 한 점의 각 묶음과 맞으면 정답
    for it in items:
        lv = _ang_level(got, it['angles'])
        if lv:
            return _verdict(lv, ', '.join(fmt.num(a, 2) + '°' for a in it['angles']), ', '.join(fmt.num(g, 2) + '°' for g in got),
                            extra={'matched': it['atText']})
    lv = _ang_level(got, want_all)
    if lv:
        return _verdict(lv, ', '.join(fmt.num(a, 2) + '°' for a in want_all), ', '.join(fmt.num(g, 2) + '°' for g in got))
    # 흔한 실수 규칙
    diag = None
    it = items[0]
    th = it['angles'][0] if it['mult'] == 1 else None
    if th is not None and got:
        g = got[0]
        plus = sum(c['angle'] * c['mult'] for c in it['contributions'] if c['sign'] == '+')
        minus = sum(c['angle'] * c['mult'] for c in it['contributions'] if c['sign'] == '−')
        # arctan 사분면 보정 없이 계산한 값 (atan만 쓴 경우)
        def raw(c):
            a = math.radians(c['angle'])
            x, y = math.cos(a), math.sin(a)
            return math.degrees(math.atan(y / x)) if abs(x) > 1e-12 else c['angle']
        noquad = 180 + sum(raw(c) * c['mult'] for c in it['contributions'] if c['sign'] == '+') - \
            sum(raw(c) * c['mult'] for c in it['contributions'] if c['sign'] == '−')
        rules = [(th - 180, '180°를 더하지 않았습니다. θ = 180° + Σ(영점 각) − Σ(다른 극점 각) 입니다.'),
                 (-th, '부호가 반대입니다. 위쪽 극점(허수부 양수)의 각인지 확인해 보세요.'),
                 (180 - plus + minus, '영점 각은 더하고 다른 극점 각은 빼야 합니다. 반대로 했습니다.'),
                 (noquad, 'arctan만 쓰고 사분면 보정을 하지 않았습니다. 벡터가 왼쪽(실수부 음수)을 향하면 180°를 더해야 합니다.')]
        for val, why in rules:
            if _ang_close(g, val) and not _ang_close(val, th):
                diag = why
                break
    return _verdict(None, ', '.join(f'{x["atText"]}: ' + ', '.join(fmt.num(a, 2) + '°' for a in x['angles']) for x in items),
                    ', '.join(fmt.num(g, 2) + '°' for g in got), diag)


def _check_stableRange(st, answer):
    t = str(answer).strip()
    r7 = st[7]['result']
    want = r7['stable']
    if t in ('없음', '없다', 'none') or '없' in t:
        ok_ = len(want) == 0
        return _verdict('exact' if ok_ else None, r7['stableText'], t, None if ok_ else '안정한 K 범위가 있습니다. Routh 표 첫 열을 다시 보세요.')
    ivs = read_intervals(t, 'K')
    if ivs is None:
        return _unreadable(answer)
    lvl = 'exact' if len(ivs) == len(want) else None
    incl_wrong = False
    if lvl:
        for g, w in zip(sorted(ivs, key=lambda x: x['lo']), want):
            lo_c = _close(g['lo'], w['lo'])
            hi_c = ('exact' if math.isinf(g['hi']) else None) if w['hi'] is None else \
                (None if math.isinf(g['hi']) else _close(g['hi'], w['hi']))
            if lo_c is None or hi_c is None:
                lvl = None
                break
            if 'approx' in (lo_c, hi_c):
                lvl = 'approx'
            if w['hi'] is not None and g['hiIncl'] != w['hiIncl']:
                incl_wrong = True
            if w['lo'] > 0 and g['loIncl'] != w['loIncl']:
                incl_wrong = True
    diag = None
    if lvl and incl_wrong:
        lvl = None
        diag = '경계값 K에서는 극점이 허수축 위에 있어 임계 안정(안정 아님)입니다. 등호를 빼야 합니다.'
    elif lvl is None:
        diag = 'Routh 표 첫 열의 모든 식이 양수가 되는 K를 함께 만족시켜 보세요.'
    return _verdict(lvl, r7['stableText'], t, diag)


def _check_crossK(st, answer):
    vs = read_values(answer)
    if vs is None:
        return _unreadable(answer)
    cr = st[7]['result']['crossings']
    want = [c['K'] for c in cr]
    lvl = _match_sets(vs, want)
    diag = None
    if lvl is None and cr and len(vs) == 1:
        if any(_close(vs[0], c['omega']) for c in cr):
            diag = 'ω 값을 적은 것 같습니다. 교차가 일어나는 K를 적어 주세요.'
        elif any(_close(vs[0], c['omega'] ** 2) for c in cr):
            diag = 'ω² 값입니다. K는 보조방정식 직전 행(첫 열 = 0)에서 구합니다.'
    return _verdict(lvl, ', '.join(c['KText'] for c in cr) or '없음', _vals_text(vs), diag)


def _check_crossOmega(st, answer):
    vs = read_values(answer)
    if vs is None:
        return _unreadable(answer)
    cr = st[7]['result']['crossings']
    want = [c['omega'] for c in cr]
    got = [abs(v.imag) if abs(v.imag) > 1e-12 else abs(v.real) for v in vs]   # ±j√2 처럼 적어도 인정
    uniq = []
    for g in got:
        if not any(abs(g - u) < 1e-9 for u in uniq):
            uniq.append(g)
    lvl = _match_sets(uniq, want)
    diag = None
    if lvl is None and cr and len(uniq) == 1 and any(_close(uniq[0], c['omega'] ** 2) for c in cr):
        diag = 'ω² 값입니다. 제곱근을 취해야 ω 입니다.'
    return _verdict(lvl, ', '.join('±j' + c['omegaText'] for c in cr) or '없음', _vals_text(vs), diag)


def _check_polesAtK(st, answer, k_value):
    from .branches import poles_at  # 순환 import 방지
    if k_value is None:
        return _unverifiable('K 값이 필요합니다.')
    vs = read_values(answer)
    if vs is None:
        return _unreadable(answer)
    # 9단계 표본에 없는 K라도 엔진 함수로 같은 방식으로 계산
    N = [sp.Rational(c) for c in st[1]['result']['N']]
    D = [sp.Rational(c) for c in st[1]['result']['D']]
    from .parse import from_coeffs
    loop = from_coeffs(N, D)
    want = [complex(p['re'], p['im']) for p in poles_at(loop, float(k_value))['poles']]
    lvl = _match_sets(vs, want)
    return _verdict(lvl, _vals_text(want), _vals_text(vs),
                    None if lvl else f'K = {fmt.num(k_value)} 를 특성방정식에 넣고 근을 구해 보세요.')
