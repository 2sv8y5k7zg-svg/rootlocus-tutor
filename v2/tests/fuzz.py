"""
fuzz.py — 무작위 전달함수 수백 개로 엔진이 멈추거나 자체 검증에 실패하는지 확인한다.
    python tests/fuzz.py [개수]
(정답 비교가 아니라 '오류 없이 돌고, 9단계 자체 검증이 모두 통과하는지'를 보는 안정성 시험)
"""
import random, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine import solver

def rand_factor(rng):
    if rng.random() < 0.3:
        a = rng.randint(-3, 6); b = rng.randint(1, 5)
        return f'(s^2+{2*a}s+{a*a+b*b})'.replace('+-', '-')
    return f'(s+{rng.randint(-2, 8)})'.replace('+-', '-')

def main(n=300, seed=1):
    rng = random.Random(seed)
    bad, skipped, t0 = [], 0, time.time()
    for i in range(n):
        den, deg = '', 0
        target = rng.randint(1, 4)
        while deg < target:
            f = rand_factor(rng); d = 2 if 's^2' in f else 1
            if deg + d > 4: f, d = f'(s+{rng.randint(0, 6)})', 1
            den += f; deg += d
        num, ndeg = '', 0
        tn = rng.randint(0, deg)
        while ndeg < tn:
            f = rand_factor(rng); d = 2 if 's^2' in f else 1
            if ndeg + d > tn: f, d = f'(s+{rng.randint(-1, 9)})', 1
            num += f; ndeg += d
        text = f'K{num}/({den})' if num else f'K/({den})'
        r = solver.analyze_text(text)
        if not r['ok']:
            if r['error']['code'] in ('cancel', 'negativeGain'):
                skipped += 1; continue
            bad.append((text, r['error'])); continue
        if r['verification']['failed']:
            bad.append((text, [(s['n'], s['check']['detail']) for s in r['steps'] if s['check']['status'] != 'verified']))
    print(f'{n}개 중 범위 밖 {skipped}개, 실패 {len(bad)}개, {time.time()-t0:.1f}초')
    for b in bad[:30]: print('  ', b)
    return 0 if not bad else 1

if __name__ == '__main__':
    sys.exit(main(int(sys.argv[1]) if len(sys.argv) > 1 else 300))
