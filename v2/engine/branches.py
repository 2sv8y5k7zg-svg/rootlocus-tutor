"""
branches.py — 8단계(근궤적 완성)와 9단계(K 변화에 따른 폐루프 극점)

근궤적 곡선 = K를 0부터 아주 크게 늘리면서 D(s) + K·N(s) = 0 의 근을 이어 그린 것.

방법
  1) K 값 목록을 만든다: 0, 이탈점·교차점의 K, 그리고 로그 간격의 K들
  2) 각 K에서 폐루프 극점(근)을 numpy로 구한다
  3) 앞 K의 근과 '가장 가까운 것끼리' 짝지어 가지(branch)를 잇는다
     (n ≤ 4 이므로 가능한 짝 맞춤 24가지를 모두 비교해 거리 합이 가장 작은 것을 고른다)
  4) 이웃한 두 점 사이가 화면 크기의 0.5%보다 멀면 그 사이 K를 반으로 나눠 점을 더 넣는다
"""
import itertools
import math
import numpy as np
from . import fmt
from .steps import make_step, ok, fail, floats
from .routh import closed_loop_poles, status_at

MAX_POINTS = 4000      # 가지 하나당 최대 점 수 (응답 크기 제한)
GAP = 0.005            # 이웃 점 사이 최대 간격 (화면 대각선 대비)


def view_box(poles, zeros, extra):
    """그래프에 보여 줄 범위. 극점·영점·이탈점·교차점·점근선 중심이 모두 들어가게 잡는다."""
    xs, ys = [0.0], [0.0]
    for z in list(poles) + list(zeros) + list(extra):
        xs.append(z.real)
        ys.append(z.imag)
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    span = max(x1 - x0, y1 - y0, 2.0)
    cx, cy = (x0 + x1) / 2, 0.0
    half = span * 0.75 + 1.0
    return {'xmin': cx - half, 'xmax': cx + half, 'ymin': cy - half * 0.8, 'ymax': cy + half * 0.8}


def _match(prev, cur):
    """prev의 각 근에 cur의 근을 하나씩 짝짓는다. 거리 합이 가장 작은 순열을 고른다."""
    n = len(prev)
    best, best_d = None, 1e300
    for perm in itertools.permutations(range(n)):
        d = 0.0
        for i in range(n):
            d += abs(prev[i] - cur[perm[i]])
            if d >= best_d:
                break
        if d < best_d:
            best, best_d = perm, d
    return [cur[best[i]] for i in range(n)]


def _k_max(loop, center, R):
    """충분히 큰 K: 무한대로 가는 가지는 화면 밖 멀리, 나머지는 영점 가까이 갈 때까지."""
    q = loop.n - loop.m
    zeros = np.roots(floats(loop.N)) if loop.m > 0 else np.array([])
    k = 1.0
    while k < 1e12:
        r = closed_loop_poles(loop, k)
        far = int(np.sum(np.abs(r - center) > 3.0 * R))
        if far >= q:
            near = 0
            for z in zeros:
                if np.min(np.abs(r - z)) < 2e-3 * R:
                    near += 1
            if near >= len(zeros) or k > 1e8:
                return k
        k *= 2.0
    return k


def compute(loop, crit_k, view):
    """가지 계산. 반환: Ks(공통 K 목록), branches(가지별 [[re, im], ...])"""
    center = complex((view['xmin'] + view['xmax']) / 2, 0)
    R = math.hypot(view['xmax'] - view['xmin'], view['ymax'] - view['ymin']) / 2
    kmax = _k_max(loop, center, R)
    base = list(np.geomspace(1e-6, kmax, 400))
    ks = sorted(set([0.0] + base + [k for k in crit_k if 0 < k < kmax]))
    tol = GAP * 2 * R
    Dc, Nc = floats(loop.D), floats(loop.N)   # 계수를 한 번만 실수 배열로 바꿔 둔다 (속도)

    # 앞에서부터 근을 이어 가며, 간격이 크면 중간 K를 넣는다 (반복 대신 스택 사용)
    out_k = [0.0]
    cur = list(closed_loop_poles(loop, 0.0))
    cur.sort(key=lambda z: (-z.real, -z.imag))
    paths = [[z] for z in cur]
    i = 1
    pending = ks[1:]
    total = 0
    while pending and total < MAX_POINTS * 4:
        k = pending[0]
        nxt = _match(cur, list(np.roots(np.polyadd(Dc, k * Nc))))
        # 간격은 화면 근처(중심에서 1.6R 안)에 있는 점끼리만 본다. 화면 밖 멀리 있는 점은 촘촘할 필요 없음
        jump = 0.0
        for a, b in zip(cur, nxt):
            if abs(a - center) < 1.6 * R or abs(b - center) < 1.6 * R:
                jump = max(jump, abs(a - b))
        k_prev = out_k[-1]
        if jump > tol and (k - k_prev) > 1e-12 * max(1.0, k):
            pending.insert(0, (k + k_prev) / 2)
            total += 1
            continue
        pending.pop(0)
        out_k.append(k)
        for j in range(len(paths)):
            paths[j].append(nxt[j])
        cur = nxt
        total += 1
        i += 1
    return out_k, paths, kmax


def step8_complete(loop, poles, zeros, extra_pts, crit_k, valid_breaks, cross):
    """8단계: 지금까지의 결과를 모아 전체 근궤적을 그린다."""
    view = view_box([complex(*p[:2]) for p in poles], [complex(*z[:2]) for z in zeros], extra_pts)
    Ks, paths, kmax = compute(loop, crit_k, view)
    span = math.hypot(view['xmax'] - view['xmin'], view['ymax'] - view['ymin'])
    center = complex((view['xmin'] + view['xmax']) / 2, 0)
    R = span / 2

    # 검증 항목
    starts = sorted([p[0] for p in paths], key=lambda z: (z.real, z.imag))
    open_poles = sorted(list(np.roots(floats(loop.D))), key=lambda z: (z.real, z.imag))
    start_ok = all(abs(a - b) < 1e-6 * max(1, abs(b)) for a, b in zip(starts, open_poles))
    max_gap = 0.0
    for p in paths:
        for a, b in zip(p, p[1:]):
            if abs(a - center) < 1.5 * R and abs(b - center) < 1.5 * R:
                max_gap = max(max_gap, abs(a - b))
    gap_ok = max_gap <= 0.0065 * span
    q = loop.n - loop.m
    ends = [p[-1] for p in paths]
    far = sum(1 for z in ends if abs(z - center) > 2.5 * R)
    end_ok = far >= q
    pass_ok = True
    for c in valid_breaks:
        z = complex(c['s'][0], c['s'][1])
        d = min(abs(pt - z) for p in paths for pt in p)
        if d > 0.01 * span:
            pass_ok = False
    for c in cross:
        z = complex(0, c['omega'])
        d = min(abs(pt - z) for p in paths for pt in p)
        if d > 0.01 * span:
            pass_ok = False
    good = start_ok and gap_ok and end_ok and pass_ok
    detail = (f'K=0 출발=극점 {"O" if start_ok else "X"}, 최대 간격 {max_gap / span * 100:.2f}% (기준 0.65%) {"O" if gap_ok else "X"}, '
              f'K→∞ 무한대 가지 {far}/{q} {"O" if end_ok else "X"}, 이탈점·교차점 통과 {"O" if pass_ok else "X"}')

    # 응답 크기를 줄이기 위해 소수 6자리로 반올림
    branches = [[[round(z.real, 6), round(z.imag, 6)] for z in p] for p in paths]
    work = [
        f'가지 {loop.n}개를 K = 0 ~ {fmt.num(kmax)} 범위에서 계산 (점 {len(Ks)}개, 간격이 크면 자동으로 더 촘촘히)',
        '극점에서 출발 → 실수축 구간·이탈점·출발각을 따라 → 영점 또는 점근선 방향으로',
    ]
    return make_step(
        8, 'complete', '근궤적 완성',
        'K = 0 → ∞ 동안 D(s) + K·N(s) = 0 의 근을 이어 그린다',
        {'Kmax': kmax},
        work,
        {'branchCount': len(paths), 'points': len(Ks)},
        ok('출발점·연속성·끝점·핵심 점 통과를 자동 확인', detail) if good else fail('자동 확인', detail),
        {'view': view, 'K': [round(k, 9) for k in Ks], 'branches': branches},
    )


def poles_at(loop, k):
    """9단계 계산: K = k 일 때 폐루프 극점, 감쇠비, 안정 여부."""
    r = sorted(closed_loop_poles(loop, k), key=lambda z: (-z.real, -z.imag))
    items = []
    for z in r:
        z = complex(z)
        mag = abs(z)
        zeta = (-z.real / mag) if mag > 1e-12 and abs(z.imag) > 1e-9 else None
        items.append({'re': z.real, 'im': z.imag, 'text': fmt.cnum(z), 'zeta': zeta,
                      'wn': mag if zeta is not None else None})
    return {'K': k, 'poles': items, 'status': status_at(loop, k)}


def gain_at_point(loop, re, im):
    """그래프 위 한 점 s에서 K = −D(s)/N(s). 근궤적 위의 점이면 양의 실수가 나온다(크기 조건)."""
    z = complex(re, im)
    Nv = complex(np.polyval(floats(loop.N), z))
    if abs(Nv) < 1e-300:
        return {'K': None, 'onLocus': False, 'angleError': None}
    Kz = -complex(np.polyval(floats(loop.D), z)) / Nv
    ang = math.degrees(math.atan2(Kz.imag, Kz.real))
    return {'K': abs(Kz), 'onLocus': abs(ang) < 2.0 and Kz.real > 0, 'angleError': ang}


def step9_k_sweep(loop, sample_k, stable_text):
    samples = [poles_at(loop, k) for k in sample_k]
    # 검증: 각 K에서 구한 극점을 특성다항식에 넣으면 0인지
    worst = 0.0
    for smp in samples:
        P = np.polyadd(floats(loop.D), smp['K'] * floats(loop.N))
        sc = max(1.0, float(np.max(np.abs(P))))
        for p in smp['poles']:
            z = complex(p['re'], p['im'])
            worst = max(worst, abs(np.polyval(P, z)) / (sc * max(1.0, abs(z)) ** len(P)))
    good = worst < 1e-9
    work = [f'K를 바꾸면 D(s) + K·N(s) = 0 의 근(폐루프 극점)이 근궤적을 따라 움직인다.',
            f'안정 범위: {stable_text}']
    for smp in samples:
        work.append(f'  K = {fmt.num(smp["K"])}: ' + ', '.join(p['text'] for p in smp['poles']) +
                    {'stable': '  (안정)', 'marginal': '  (임계 안정)', 'unstable': '  (불안정)'}[smp['status']])
    return make_step(
        9, 'kSweep', 'K 변화에 따른 폐루프 극점',
        '주어진 K에서 D(s) + K·N(s) = 0 의 근 = 폐루프 극점',
        {'samples': sample_k},
        work,
        {'samples': samples},
        ok('구한 극점을 특성다항식에 다시 대입 (잔차 확인)', f'최대 상대 잔차 {worst:.1e}') if good
        else fail('특성다항식 대입', f'최대 상대 잔차 {worst:.1e}'),
        {'samples': samples},
    )
