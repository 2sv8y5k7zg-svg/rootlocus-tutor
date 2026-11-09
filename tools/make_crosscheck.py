"""
make_crosscheck.py — ChatGPT 등 다른 AI에게 독립 검증을 맡길 표를 만듭니다.
tests/expected.json(기준 정답)과 tests/results.json(엔진 대조 결과)을 읽어 docs/교차검증_표.md로 저장합니다.
실행: python3 tools/make_crosscheck.py
"""
import json
from pathlib import Path
import sympy as sp

ROOT = Path(__file__).resolve().parent.parent
probs = {p['id']: p for p in json.loads((ROOT / 'tests' / 'problems.json').read_text(encoding='utf-8'))['problems']}
exp = json.loads((ROOT / 'tests' / 'expected.json').read_text(encoding='utf-8'))['results']
res = {r['id']: r for r in json.loads((ROOT / 'tests' / 'results.json').read_text(encoding='utf-8'))['report']}

LABEL = {'breakaway': '이탈점', 'breakin': '진입점', 'multiple': '여러 가지가 만나는 점(중근)', 'complexBreak': '복소 이탈점(궤적 위)',
         'complexK': '기각: K가 복소수', 'negativeK': '기각: K<0 (K≥0 궤적 밖)', 'start': '출발점(개루프 중근, K=0)'}
ERR = {'cancel': '극점·영점 상쇄 → 계산하지 않고 안내', 'improper': '분자 차수 > 분모 차수 → 지원 안 함 안내',
       'order': '분모 5차 → 지원 범위(4차) 밖 안내', 'negativeGain': '최고차항 부호 반대(실질적 음의 이득) → 지원 안 함 안내'}


def num(x, d=4):
    if x is None:
        return '∞'
    e = sp.nsimplify(x, tolerance=1e-10, rational=False)
    s_ = str(e).replace('sqrt', '√').replace('**', '^').replace('*', '')
    dec = ('%.' + str(d) + 'f') % x
    dec = dec.rstrip('0').rstrip('.') if '.' in dec else dec
    if len(s_) <= 9 and s_ != dec:
        out = s_ if e.is_Rational else '%s ≈ %s' % (s_, dec)
    else:
        out = dec
    return out.replace('-', '−')


def short(x, d=4):
    e = sp.nsimplify(x, tolerance=1e-10, rational=False)
    if e.is_Rational and len(str(e)) <= 7:
        return str(e).replace('-', '−')
    dec = ('%.' + str(d) + 'f') % x
    return (dec.rstrip('0').rstrip('.') if '.' in dec else dec).replace('-', '−')


def cnum(z):
    re_, im_ = z
    if abs(im_) < 1e-12:
        return num(re_)
    return '%s %s j%s' % (short(re_), '+' if im_ > 0 else '−', short(abs(im_)))


SUP = str.maketrans('0123456789', '⁰¹²³⁴⁵⁶⁷⁸⁹')


def poly(c):
    n = len(c) - 1
    terms = []
    for i, a in enumerate(c):
        pw = n - i
        if abs(a) < 1e-12:
            continue
        mag = abs(a)
        coef = '' if (mag == 1 and pw > 0) else num(mag)
        term = coef + ('s' + (str(pw).translate(SUP) if pw > 1 else '') if pw > 0 else '')
        terms.append(('− ' if a < 0 else '+ ') + term)
    out = ' '.join(terms)
    return out[2:] if out.startswith('+ ') else '−' + out[2:]


def interval(iv):
    lo = ('[' if iv['loIncl'] else '(') + num(iv['lo'])
    hi = ('∞)' if iv['hi'] is None else num(iv['hi']) + (']' if iv['hiIncl'] else ')'))
    return lo + ', ' + hi


lines = ['# 근궤적 계산 교차검증 표', '',
         '이 표는 근궤적 학습 홈페이지의 계산 엔진(JavaScript)과, 엔진과 독립적으로 sympy·numpy로 계산한 기준값이 **일치한 결과**입니다.',
         '다른 AI나 사람이 처음부터 다시 풀어 보고 다른 곳을 찾는 용도입니다.', '',
         '## 다른 AI에게 맡길 때 쓸 요청문', '',
         '> 아래 각 문제를 처음부터 직접 풀어서, 표의 값과 다른 곳이 있으면 문제 번호·항목·올바른 값·근거를 알려 주세요.',
         '> 조건: 연속시간, 음의 피드백, 개루프 전달함수 G(s)H(s) = K·N(s)/D(s), K ≥ 0.',
         '> 규칙: 실수축은 시험점 오른쪽의 실수 극점·영점 개수(중근은 겹친 수만큼)가 홀수인 구간.',
         '> 점근선 각 (2k+1)·180°/(n−m), 중심 (Σ극점 − Σ영점)/(n−m).',
         '> 이탈점·진입점 후보는 D′N − DN′ = 0의 근, K = −D/N이 양의 실수일 때만 인정.',
         '> 출발각 θ = 180° + Σ(영점→그 극점 각) − Σ(다른 극점→그 극점 각), 중근이면 나누고 360°/중복수씩 더함. 도착각은 극점·영점 역할을 바꿈.',
         '> 안정 범위는 Routh 판별법, 경계(허수축 위 극점)는 포함하지 않음. K = 0은 개루프 극점이 모두 좌반면일 때만 포함.', '']

for e in exp:
    pid = e['id']
    p = probs[pid]
    ok = '✅ 엔진 일치' if res[pid]['pass'] else '❌ 불일치'
    lines.append('## %s  %s  — %s' % (pid, p['title'], ok))
    lines.append('목적: ' + p['purpose'])
    lines.append('')
    if 'expectError' in e:
        lines.append('- 기대 동작: ' + ERR[e['expectError']])
        lines.append('')
        continue
    poles = ', '.join(cnum(q['s']) + (' (×%d)' % q['mult'] if q['mult'] > 1 else '') for q in e['poles'])
    zeros = ', '.join(cnum(q['s']) + (' (×%d)' % q['mult'] if q['mult'] > 1 else '') for q in e['zeros']) or '없음'
    segs = ', '.join(('(−∞, %s]' % num(s_['hi'])) if s_['lo'] is None else '[%s, %s]' % (num(s_['lo']), num(s_['hi'])) for s_ in e['realAxisSegments']) or '없음'
    if e['asymptotes']:
        a = e['asymptotes']
        asym = '중심 %s, 각 %s' % (num(a['centroid']), ', '.join('%g°' % x for x in a['angles']))
    else:
        asym = '없음 (n = m)'
    br = '; '.join('s = %s, K = %s → %s' % (cnum(c['s']), (num(c['K']) if not isinstance(c['K'], list) else '%s %s j%s' % (short(c['K'][0]), '+' if c['K'][1] > 0 else '−', short(abs(c['K'][1])))), LABEL[c['status']]) for c in e['breakCandidates']) or '후보 없음'
    ang = '; '.join('%s %s%s: %s' % ('출발각' if a['kind'] == 'departure' else '도착각', cnum(a['at']), (' (×%d)' % a['mult'] if a['mult'] > 1 else ''), ', '.join(('%.2f°' % x).replace('-', '−') for x in a['angles'])) for a in e['angles']) or '해당 없음 (복소·중복 극점·영점 없음)'
    col = ', '.join(x.replace('**', '^').replace('*', '').replace('epsilon', 'ε').replace(' - ', ' − ').replace('-', '−') for x in e['routhFirstColumn'])
    cross = '; '.join('s = ±j%s, K = %s' % (c['omegaExact'].replace('sqrt', '√').replace('*', ''), c['KExact']) for c in e['crossings']) or '없음'
    st = e['stableSetRouth'] if e['stableSetRouth'] is not None else e['stableSetNumeric']
    stab = ' ∪ '.join(interval(iv) for iv in st) or '안정한 K 없음'
    lines += ['| 항목 | 값 |', '|---|---|',
              '| D(s) | %s |' % poly(e['D']), '| N(s) | %s |' % poly(e['N']),
              '| 극점 | %s |' % poles, '| 영점 | %s |' % zeros,
              '| 가지 수 | %d (영점으로 %d, 무한대로 %d) |' % (e['n'], e['m'], e['n'] - e['m']),
              '| 실수축 근궤적 | %s |' % segs, '| 점근선 | %s |' % asym,
              '| 이탈점·진입점 후보 | %s |' % br, '| 출발각·도착각 | %s |' % ang,
              '| Routh 첫 열 | %s%s |' % (col, ' (첫 열 0 → ε 처리)' if e['routhSpecial'] == 'firstColZero' else ''),
              '| 허수축 교차 | %s |' % cross, '| 안정한 K 범위 | %s |' % stab, '']

(ROOT / 'docs' / '교차검증_표.md').write_text('\n'.join(lines), encoding='utf-8')
print('저장: docs/교차검증_표.md')
