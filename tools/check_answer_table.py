"""
check_answer_table.py — 검증/AI-오답률-정답표.csv를 독립 계산으로 다시 확인

정답표의 '전달함수' 칸만 읽어 tools/reference.py(sympy + numpy)로 다시 계산한 뒤,
항목 1~5와 실수축 구간의 숫자가 정답표 글에 들어 있는지 비교합니다.
tests/problems.json에 없는 문제(T16~T32)도 정답표만으로 검증할 수 있습니다.

실행: python3 tools/check_answer_table.py            (전체)
      python3 tools/check_answer_table.py T17 T29    (일부)
필요: pip install sympy numpy
끝 코드: 0 = 모두 일치, 1 = 불일치 있음
"""
import csv, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sympy as sp
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application
import reference as ref

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / '검증' / 'AI-오답률-정답표.csv'
TR = standard_transformations + (implicit_multiplication_application,)
s, K = sp.symbols('s K')


def parse_tf(text):
    """'K(s+2)/(s(s+1))' → reference.analyze가 받는 {num, den} (정수 계수)."""
    expr = parse_expr(text.replace('^', '**'), local_dict={'s': s, 'K': K}, transformations=TR)
    num, den = sp.fraction(sp.together(sp.simplify(expr / K)))
    Np, Dp = sp.Poly(num, s), sp.Poly(den, s)
    lc = Dp.LC()
    Np, Dp = Np.mul_ground(1 / lc), Dp.mul_ground(1 / lc)   # 분모 최고차 계수 1
    if any(not c.is_integer for c in Np.all_coeffs() + Dp.all_coeffs()):
        raise ValueError('정수가 아닌 계수')
    return [[int(c) for c in Np.all_coeffs()]], [[int(c) for c in Dp.all_coeffs()]]


def nums(cell):
    """칸 글에서 숫자를 모두 뽑음(분수 a/b 포함). 필요한 값이 이 안에 있는지만 봄."""
    t = cell.replace('−', '-')
    out = [int(a) / int(b) for a, b in re.findall(r'(-?\d+)/(\d+)(?![\d.])', t)]
    out += [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', t)]
    return out


def has(cell, v, tol):
    return any(abs(x - v) <= tol for x in nums(cell))


def tol_num(v):
    return max(1e-4, 1e-3 * abs(v))


def norm_ang(a):
    a = (a + 180) % 360 - 180
    return 180.0 if abs(a + 180) < 1e-9 else a


def check_row(row):
    errs = []
    num, den = parse_tf(row['전달함수'])
    r = ref.analyze({'id': row['번호'], 'num': num, 'den': den})

    # 1 점근선
    c = row['1 점근선']
    a = r['asymptotes']
    if a is None:
        if not c.startswith('없음'):
            errs.append('1: 점근선이 없어야 함')
    else:
        q = len(a['angles'])
        if not c.startswith(f'{q}개'):
            errs.append(f'1: 개수 {q}개가 아님')
        if q > 1 and not has(c, a['centroid'], tol_num(a['centroid'])):
            errs.append(f"1: 중심 {a['centroid']:.4f} 없음")
        for ang in a['angles']:
            if not has(c, norm_ang(ang), 0.06) and not has(c, ang, 0.06):
                errs.append(f'1: 각도 {ang:g}° 없음')

    # 2 이탈점·진입점 (실수축 위, K > 0)
    c = row['2 이탈점·진입점']
    bps = [b for b in r['breakCandidates'] if b['status'] in ('breakaway', 'breakin', 'multiple')]
    if not bps:
        if not c.startswith('없음'):
            errs.append('2: 실수축 이탈·진입점이 없어야 함')
    for b in bps:
        if not has(c, b['s'][0], tol_num(b['s'][0])):
            errs.append(f"2: 위치 {b['s'][0]:.4f} 없음")
        if not has(c, b['K'], tol_num(b['K'])):
            errs.append(f"2: K {b['K']:.4f} 없음")

    # 3 허수축 교차
    c = row['3 허수축 교차']
    cr = r['crossings']
    if not cr and not c.startswith('없음'):
        errs.append('3: 교차가 없어야 함')
    for x in cr:
        if x['omega'] < 1e-9:
            if '원점' not in c or not has(c, x['K'], tol_num(x['K'])):
                errs.append(f"3: 원점 통과 K {x['K']:.4f} 없음")
        else:
            if not has(c, x['omega'], tol_num(x['omega'])):
                errs.append(f"3: ω {x['omega']:.4f} 없음")
            if not has(c, x['K'], tol_num(x['K'])):
                errs.append(f"3: K {x['K']:.4f} 없음")

    # 4 안정한 K 범위 (numpy 판정 기준)
    c = row['4 안정한 K 범위']
    st = r['stableSetNumeric']
    if not st:
        if not c.startswith('없음'):
            errs.append('4: 안정 범위가 없어야 함')
    elif len(st) == 1 and st[0]['lo'] == 0 and st[0]['hi'] is None:
        if '모든 K' not in c:
            errs.append('4: 모든 K > 0이어야 함')
    else:
        for iv in st:
            for v in (iv['lo'], iv['hi']):
                if v and not has(c, v, tol_num(v)):
                    errs.append(f'4: 경계 {v:.4f} 없음')

    # 5 출발각·도착각 (복소 극점·영점, 위쪽 점)
    c = row['5 출발각·도착각']
    angs = [x for x in r['angles'] if x['at'][1] > 1e-12]
    if not angs and not c.startswith('해당 없음'):
        errs.append('5: 해당 없음이어야 함')
    for x in angs:
        word = '출발각' if x['kind'] == 'departure' else '도착각'
        for ang in x['angles']:
            if word not in c or not has(c, ang, 0.06):
                errs.append(f'5: {word} {ang:.1f}° (s = {x["at"][0]:g} + j{x["at"][1]:.4f}) 없음')

    # 그림 확인용 실수축 구간
    c = row['그림 확인용 실수축 구간']
    segs = r['realAxisSegments']
    if not segs:
        if not c.startswith('없음'):
            errs.append('구간: 없어야 함')
    else:
        if len(re.findall(r'[\[(]', c)) != len(segs):
            errs.append(f'구간: 개수 {len(segs)}개가 아님')
        for g in segs:
            for v in (g['lo'], g['hi']):
                if v is not None and not has(c, v, 1e-6):
                    errs.append(f'구간: 끝점 {v:g} 없음')
    return errs


def main():
    want = set(sys.argv[1:])
    rows = list(csv.DictReader(CSV.open(encoding='utf-8-sig')))
    bad = 0
    for row in rows:
        if want and row['번호'] not in want:
            continue
        try:
            errs = check_row(row)
        except Exception as e:  # 식 해석 실패 등
            errs = [f'계산 실패: {e}']
        print(('일치 ' if not errs else '불일치 ') + row['번호'] + ' ' + row['전달함수'])
        for e in errs:
            print('   - ' + e)
        bad += bool(errs)
    n = len(want) if want else len(rows)
    print(f'\n결과: {n - bad}/{n} 일치')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
