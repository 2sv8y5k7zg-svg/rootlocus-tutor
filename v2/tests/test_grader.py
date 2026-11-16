"""채점 모듈 시험: 정답·동치·반올림·흔한 실수·읽기 실패를 제대로 가르는지 (pytest)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pytest
from engine import solver, grader

R18 = solver.analyze_text('K/(s(s+3)(s^2+2s+2))')     # T18
R16 = solver.analyze_text('K/((s+1)(s+2)(s+3))')      # T16
R03 = solver.analyze_text('K(s+2)/(s(s+1))')
R29 = solver.analyze_text('K/(s(s+2)(s^2+2s+5))')


@pytest.mark.parametrize('res,field,ans,status,diag_has', [
    (R16, 'charPoly', 's^3+6s^2+11s+6+K', 'correct', None),
    (R16, 'charPoly', '2s^3+12s^2+22s+12+2K = 0', 'correct', None),            # 상수배 = 같은 방정식
    (R16, 'charPoly', '(s+1)(s+2)(s+3)+K', 'correct', None),                   # 인수 꼴도 동치
    (R16, 'charPoly', 's^3+6s^2+11s+6-K', 'incorrect', '부호'),
    (R16, 'poles', '-1, -2, -3', 'correct', None),
    (R16, 'poles', '1, 2, 3', 'incorrect', '부호'),
    (R16, 'branches', '3', 'correct', None),
    (R16, 'segments', '[-2,-1], (-inf,-3]', 'correct', None),
    (R16, 'segments', '-2<s<-1, s<-3', 'correct', None),
    (R16, 'segments', '[-3,-2]', 'incorrect', '홀수'),
    (R16, 'centroid', '-2', 'correct', None),
    (R16, 'centroid', '-6', 'incorrect', '나누지'),
    (R16, 'asymAngles', '60, 180, 300', 'correct', None),
    (R16, 'asymAngles', '0, 120, 240', 'incorrect', '(2k + 1)'),
    (R16, 'breakpoints', '-1.42', 'approx', None),
    (R16, 'breakpoints', '-2+√3/3', 'correct', None),
    (R16, 'breakpoints', '-1.42, -2.58', 'incorrect', 'K = −D/N'),
    (R16, 'stableRange', '0<K<60', 'correct', None),
    (R16, 'stableRange', '0≤K<60', 'correct', None),
    (R16, 'stableRange', '0<K≤60', 'incorrect', '임계 안정'),
    (R16, 'crossK', '60', 'correct', None),
    (R16, 'crossOmega', '±j√11', 'correct', None),
    (R16, 'crossOmega', '3.317', 'approx', None),
    (R16, 'crossOmega', '11', 'incorrect', 'ω²'),
    (R18, 'angles', '-71.57', 'approx', None),
    (R18, 'angles', '-45-atan(1/2)*180/pi', 'correct', None),
    (R18, 'angles', '108.43', 'incorrect', None),
    (R18, 'centroid', '-5/4', 'correct', None),
    (R18, 'centroid', '-1.25', 'correct', None),
    (R03, 'centroid', '1', 'correct', None),
    (R03, 'centroid', '-1', 'incorrect', None),
    (R03, 'centroid', '1/2', 'incorrect', 'n으로'),
    (R16, 'poles', '마이너스 일', 'unreadable', '읽지 못'),
    (R29, 'breakpoints', '-1, -1+j1.2247', 'approx', None),
    (R29, 'breakpoints', '-1', 'incorrect', '빠진'),
])
def test_cases(res, field, ans, status, diag_has):
    v = grader.check(res, field, ans)
    assert v['status'] == status, v
    if diag_has:
        assert v['diagnosis'] and diag_has in v['diagnosis'], v


def test_polesAtK_correct():
    # K = 6: s³+6s²+11s+12 = (s+4)(s²+2s+3) → −4, −1 ± j√2
    v = grader.check(R16, 'polesAtK', '-4, -1±j√2', k_value=6)
    assert v['status'] == 'correct', v


def test_angle_quadrant_rule():
    # T05: K/(s(s^2+4s+8)) 출발각 −45°. arctan만 쓰면 사분면 보정 실수
    r = solver.analyze_text('K/(s(s^2+4s+8))')
    v = grader.check(r, 'angles', '-45')
    assert v['status'] == 'correct'
