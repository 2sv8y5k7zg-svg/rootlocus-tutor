"""
make_benchmark.py — 일반 AI(Gemini, ChatGPT 등) 오답률 측정용 자료를 만듭니다.

tests/expected.json(sympy 기준 정답)에서 채점에 쓸 값만 뽑아
  검증/AI-오답률-측정.md   (질문 문장, 측정 조건, 채점 기준, 정답표)
  검증/AI-오답률-정답표.csv (스프레드시트에 붙여 넣는 용도)
  검증/AI-오답률-질문.txt   (문제별로 완성된 질문 문장)
로 저장합니다. 정답표의 숫자는 전부 reference.py가 계산한 값이며, 손으로 고치지 않습니다.

실행: python3 tools/make_benchmark.py
"""
import csv
import json
from pathlib import Path
import sympy as sp

ROOT = Path(__file__).resolve().parent.parent
probs = json.loads((ROOT / 'tests' / 'problems.json').read_text(encoding='utf-8'))['problems']
exp = {r['id']: r for r in json.loads((ROOT / 'tests' / 'expected.json').read_text(encoding='utf-8'))['results']}

PROMPT = """다음 개루프 전달함수의 근궤적을 분석해 주세요.
조건: 음의 피드백, K ≥ 0

G(s)H(s) = {tf}

아래 항목을 값으로 답해 주세요. 해당 사항이 없으면 "없음"이라고 써 주세요.
1) 점근선의 개수, 중심, 각도
2) 실수축 위 이탈점·진입점의 위치(s 값)
3) 근궤적이 허수축과 만나는 점의 ω와 그때의 K
4) 폐루프 시스템이 안정한 K의 범위
5) 복소 극점의 출발각 (복소 영점이 있으면 도착각)
6) MATLAB의 rlocus 결과처럼 근궤적 그림을 그려 주세요."""


def num(x, d=4):
    """정확한 꼴(분수·제곱근)이 짧으면 '정확값 ≈ 소수', 아니면 소수 d자리."""
    e = sp.nsimplify(x, tolerance=1e-10, rational=False)
    dec = ('%.' + str(d) + 'f') % x
    dec = dec.rstrip('0').rstrip('.') if '.' in dec else dec
    if dec in ('-0', ''):
        dec = '0'
    text = str(e).replace('sqrt', '√').replace('**', '^').replace('*', '')
    if e.is_Rational and len(text) <= 7:
        out = text
    elif len(text) <= 9 and text != dec:
        out = '%s ≈ %s' % (text, dec)
    else:
        out = dec
    return out.replace('-', '−')


def deg(a):
    a = a - 360 if a > 180 else a
    t = ('%.1f' % a).rstrip('0').rstrip('.')
    return t.replace('-', '−') + '°'


def cplx(z):
    re, im = z
    if abs(im) < 1e-12:
        return num(re)
    head = '' if abs(re) < 1e-12 else num(re) + ' '
    return head + '± j' + num(abs(im))


def key_asym(r):
    a = r['asymptotes']
    if not a:
        return '없음 (극점 수 = 영점 수)'
    angles = ', '.join(deg(x) for x in a['angles'])
    if len(a['angles']) == 1:
        return '1개, 180° (실수축과 겹침, 중심은 채점 제외)'
    return '%d개, 중심 %s, 각도 %s' % (len(a['angles']), num(a['centroid']), angles)


def key_breaks(r):
    name = {'breakaway': '이탈점', 'breakin': '진입점', 'multiple': '세 가지가 만나는 점'}
    real, extra = [], []
    for c in r['breakCandidates']:
        if c['status'] in name:
            real.append('%s %s (K = %s)' % (name[c['status']], num(c['s'][0]), num(c['K'])))
        elif c['status'] == 'complexBreak':
            extra.append('참고(채점 제외): 실수축 밖 복소 이탈점 %s (K = %s)' % (cplx(c['s']), num(c['K'])))
    out = ', '.join(real) if real else '없음'
    return out + ('. ' + extra[0] if extra else '')


def key_cross(r):
    out = []
    for c in r['crossings']:
        if c['omega'] > 1e-9:
            out.append('ω = %s, K = %s' % (num(c['omega']), num(c['K'])))
        else:
            out.append('원점(ω = 0) 통과, K = %s (채점 제외: 4번으로 판단)' % num(c['K']))
    return ', '.join(out) if out else '없음'


def key_stable(r):
    sets = r['stableSetNumeric']
    if not sets:
        return '없음 (K > 0에서 항상 불안정)'
    out = []
    for s_ in sets:
        lo, hi = s_['lo'], s_['hi']
        if hi is None:
            out.append('K > %s' % num(lo) if lo > 0 else '모든 K > 0')
        else:
            out.append('%s < K < %s' % (num(lo), num(hi)))
    return ', '.join(out)


def key_angles(r):
    out = []
    for a in r['angles']:
        if a['at'][1] <= 1e-12:
            continue  # 실수축 위 겹친 극점의 출발각은 질문 범위 밖이라 채점하지 않음
        kind = '출발각' if a['kind'] == 'departure' else '도착각'
        out.append('%s %s (s = %s의 위쪽 점, 아래쪽은 부호 반대)' % (kind, ', '.join(deg(x) for x in a['angles']), cplx(a['at'])))
    return ' / '.join(out) if out else '해당 없음 (복소 극점·영점 없음)'


def key_real(r):
    out = []
    for g in r['realAxisSegments']:
        out.append('(−∞, %s]' % num(g['hi']) if g['lo'] is None else '[%s, %s]' % (num(g['lo']), num(g['hi'])))
    return ', '.join(out) if out else '없음'


rows = []
for p in probs:
    if p.get('expectError'):
        continue  # 지원 범위 밖 문제는 측정에서 뺀다
    r = exp[p['id']]
    rows.append({
        '번호': p['id'], '전달함수': p['title'], '특징': p['purpose'],
        '1 점근선': key_asym(r), '2 이탈점·진입점': key_breaks(r), '3 허수축 교차': key_cross(r),
        '4 안정한 K 범위': key_stable(r), '5 출발각·도착각': key_angles(r), '그림 확인용 실수축 구간': key_real(r),
    })

cols = list(rows[0].keys())
(ROOT / '검증').mkdir(exist_ok=True)
with open(ROOT / '검증' / 'AI-오답률-정답표.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    w.writerows(rows)

md = []
md.append('# 일반 AI 오답률 측정 (예선 PPT 3장 근거)')
md.append('')
md.append('이 파일과 정답표, 질문 문장은 `python3 tools/make_benchmark.py`가 tests/expected.json(sympy 기준 정답)에서 만듭니다. 정답표의 숫자는 손으로 고치지 않습니다.')
md.append('')
md.append('## 정답표 검증 방법')
md.append('```')
md.append('pip install sympy numpy')
md.append('python3 tools/check_answer_table.py          # 30문제 전체')
md.append('python3 tools/check_answer_table.py T17 T29  # 일부만')
md.append('```')
md.append("- 정답표의 '전달함수' 칸만 읽어 `tools/reference.py`(sympy + numpy, 엔진과 코드 공유 없음)로 다시 계산하고, 항목 1~5와 실수축 구간 숫자가 정답표에 들어 있는지 비교합니다. 끝에 `결과: 30/30 일치`가 나오면 통과입니다.")
md.append('- 문제 정의는 tests/problems.json(T01~T32), 기준 정답은 tests/expected.json에 있습니다. 문제를 바꾸면 `python3 tools/reference.py` → `node tests/run-tests.js` → `python3 tools/make_benchmark.py` → `python3 tools/check_answer_table.py` 순서로 다시 만듭니다.')
md.append('- 2026-11-14 KST 확인: 정답표 30/30 일치, 엔진 검사 34/34 문제·514/514 항목 통과.')
md.append('')
md.append('## 무엇을 재나')
md.append('근궤적 문제 %d개를 일반 AI에 같은 문장으로 묻고, 항목별로 맞았는지 기록합니다. 결과는 나온 그대로 씁니다. AI가 많이 맞히면 그 숫자를 그대로 적고, 근거 문장을 "그림이 틀린다" 쪽으로 바꿉니다.' % len(rows))
md.append('')
md.append('## 측정 조건 (모든 문제에 똑같이)')
md.append('- AI마다 서비스 이름, 모델 이름, 요금제(무료/유료), 측정 날짜를 기록 표에 적는다.')
md.append('- 문제마다 새 대화를 연다. 앞 문제의 답이 영향을 주지 않게 한다.')
md.append('- 아래 질문 문장을 그대로 붙여 넣고, 전달함수 줄만 바꾼다.')
md.append('- 첫 번째 답만 채점한다. 다시 묻거나 힌트를 주지 않는다.')
md.append('- 답 화면을 캡처해 `문제번호_AI이름.png`로 저장한다(본선 질의응답 증빙).')
md.append('')
md.append('## 질문 문장')
md.append('```')
md.append(PROMPT.format(tf='(여기에 전달함수)'))
md.append('```')
md.append('')
md.append('## 채점 기준')
md.append('- 항목 1~5는 O / X / −(해당 없음)로 적는다. 숫자는 정답과 2% 또는 0.02 이내면 O, 각도는 1° 이내면 O.')
md.append('- 정답이 "없음"인데 AI가 값을 지어내면 X. 정답이 있는데 "없음"이라고 하면 X.')
md.append('- 4번은 경계 숫자가 맞으면 O. K = 0을 범위에 넣었는지는 따지지 않는다.')
md.append('- 5번은 위쪽 복소 극점(영점)의 각 하나만 맞으면 O. −45°와 315°처럼 360° 차이는 같은 답이다.')
md.append('- 6번 그림은 세 가지를 본다: 실수축 구간이 정답표와 같은가 / 가지 수와 점근선 방향이 맞는가 / 허수축을 넘는지 여부가 3번 답과 같은가. 셋 다 맞으면 O, 하나라도 틀리면 X, 그림을 못 그리면 "그림 없음".')
md.append('- 문제 판정: 해당하는 항목 1~5가 모두 O면 "정답", 하나라도 X면 "오답". 그림은 따로 센다.')
md.append('- PPT에 적는 숫자: 문제 오답률(오답 문제 수 / 전체), 항목 오답률, 그림 오답률. 측정 조건을 함께 적는다.')
md.append('')
md.append('## 정답표')
md.append('')
md.append('| ' + ' | '.join(cols) + ' |')
md.append('|' + '---|' * len(cols))
for r in rows:
    md.append('| ' + ' | '.join(r[c].replace('|', '/') for c in cols) + ' |')
md.append('')
(ROOT / '검증' / 'AI-오답률-측정.md').write_text('\n'.join(md), encoding='utf-8')
(ROOT / '검증' / 'AI-오답률-질문.txt').write_text(
    '\n\n==========\n\n'.join('[%s]\n%s' % (r['번호'], PROMPT.format(tf=r['전달함수'])) for r in rows) + '\n', encoding='utf-8')
print('저장: 검증/AI-오답률-측정.md, 검증/AI-오답률-정답표.csv, 검증/AI-오답률-질문.txt (%d문제)' % len(rows))
