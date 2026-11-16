"""
solver.py — 9단계 풀이를 한 번에 실행하는 입구

    analyze_text('K(s+2)/(s(s+1))')  →  {'ok': True, 'steps': [...9개...], 'graph': {...}, ...}
    지원 범위 밖이면                    {'ok': False, 'error': {'code', 'message'}}

AI나 화면은 이 결과만 사용한다. 숫자를 새로 만들지 않는다.
"""
import time
from . import parse, steps, routh, branches, fmt

SAMPLE_K = [0.1, 0.5, 1, 2, 5, 10, 30, 100]


def analyze(loop):
    t0 = time.perf_counter()
    st1 = steps.step1_char_eq(loop)
    st2, poles, zeros = steps.step2_poles_zeros(loop)
    st3 = steps.step3_real_axis(loop, poles, zeros)
    st4 = steps.step4_asymptotes(loop, poles, zeros)
    st5 = steps.step5_breakpoints(loop)
    st6 = steps.step6_angles(loop, poles, zeros)
    st7 = routh.step7_routh(loop)

    valid = st5['result']['valid']
    cross = st7['result']['crossings']
    crit_k = [c['K'] for c in valid if not isinstance(c['K'], list)] + [c['K'] for c in cross]
    extra = [complex(c['s'][0], c['s'][1]) for c in valid] + [complex(0, c['omega']) for c in cross]
    if st4['result']['count'] > 1:
        extra.append(complex(st4['graph']['asymptotes']['centroid'], 0))
    pole_pts = st2['graph']['poles']
    zero_pts = st2['graph']['zeros']
    st8 = branches.step8_complete(loop, pole_pts, zero_pts, extra, crit_k, valid, cross)
    sample = sorted(set(SAMPLE_K + [round(k, 6) for k in crit_k]))
    st9 = branches.step9_k_sweep(loop, sample, st7['result']['stableText'])

    all_steps = [st1, st2, st3, st4, st5, st6, st7, st8, st9]
    verified = sum(1 for x in all_steps if x['check']['status'] == 'verified')
    graph = {
        'view': st8['graph']['view'],
        'poles': pole_pts, 'zeros': zero_pts,
        'segments': st3['graph']['segments'],
        'asymptotes': st4['graph']['asymptotes'],
        'breakpoints': st5['graph']['breakpoints'],
        'angles': st6['graph']['angles'],
        'crossings': st7['graph']['crossings'],
        'K': st8['graph']['K'], 'branches': st8['graph']['branches'],
    }
    # 그래프 데이터는 graph에 한 번만 담고, 8단계 안에서는 지운다 (응답 크기 절약)
    st8['graph'] = {'see': 'graph'}
    return {
        'ok': True,
        'input': {'text': loop.text(), 'source': loop.source, 'notes': loop.notes,
                  'N': fmt.poly(loop.N), 'D': fmt.poly(loop.D),
                  'Nfactored': fmt.factored(loop.N), 'Dfactored': fmt.factored(loop.D),
                  'n': loop.n, 'm': loop.m},
        'steps': all_steps,
        'graph': graph,
        'verification': {'verified': verified, 'total': len(all_steps),
                         'failed': [x['n'] for x in all_steps if x['check']['status'] != 'verified']},
        'elapsedMs': round((time.perf_counter() - t0) * 1000, 1),
    }


def safe(fn, *args):
    """입력 오류는 안내 문구로, 예상하지 못한 오류는 '검증 불가'로 돌려준다 (정답을 지어내지 않음)."""
    try:
        loop = fn(*args)
    except parse.InputError as e:
        return {'ok': False, 'error': e.to_dict()}
    try:
        return analyze(loop)
    except Exception as e:  # 계산 중 예상 못 한 오류
        return {'ok': False, 'error': {'code': 'engineError',
                                       'message': f'계산 중 오류가 나서 결과를 확정하지 못했습니다(검증 불가): {type(e).__name__}'}}


def analyze_text(text):
    return safe(parse.parse_text, text)


def analyze_factors(num, den):
    return safe(parse.from_factors, num, den)


def get_loop(text):
    return parse.parse_text(text)
