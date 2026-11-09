"""
overlay.py — 엔진 가지(색 선)와 python-control 라이브러리 결과(회색 점)를 겹쳐 그립니다.
회색 점이 색 선 위에 모두 올라가 있으면 두 계산이 일치하는 것입니다.

실행: node tools/dump-branches.js && python3 tools/overlay.py
출력: docs/verification-overlay.png, docs/verification-overlay.json
"""
import json
from pathlib import Path
import numpy as np
import control as ct
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = Path(__file__).resolve().parent.parent
names = {f.name for f in font_manager.fontManager.ttflist}
for nm in ['Noto Sans CJK KR', 'Malgun Gothic', 'AppleGothic', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans CJK HK']:
    if nm in names:
        plt.rcParams['font.family'] = nm
        break
plt.rcParams['axes.unicode_minus'] = False

data = json.loads((ROOT / 'tests' / 'branches.json').read_text(encoding='utf-8'))
COLORS = ['#1D9E75', '#D85A30', '#378ADD', '#B0479E']
gains = np.concatenate([[0.0], np.logspace(-6, 7, 6000)])

fig, axes = plt.subplots(4, 3, figsize=(12, 16.5))
summary = []
for ax, d in zip(axes.flat, data):
    sys = ct.tf(d['N'], d['D'])
    if hasattr(ct, 'root_locus_map'):
        loci = ct.root_locus_map(sys, gains).loci
    else:
        loci, _ = ct.root_locus(sys, gains, plot=False)
    v = d['view']
    span = np.hypot(v['xmax'] - v['xmin'], v['ymax'] - v['ymin'])
    pc = loci.flatten()
    inside = pc[(pc.real > v['xmin']) & (pc.real < v['xmax']) & (np.abs(pc.imag) < v['ymax'])]

    eng = np.concatenate([np.array(b)[:, 0] + 1j * np.array(b)[:, 1] for b in d['branches']])
    # python-control 점마다 엔진 곡선(조밀한 점)까지 가장 가까운 거리
    dmax = 0.0
    for chunk in np.array_split(inside, max(1, len(inside) // 2000)):
        dist = np.min(np.abs(chunk[:, None] - eng[None, :]), axis=1)
        dmax = max(dmax, float(dist.max()) if len(dist) else 0.0)
    summary.append({'id': d['id'], 'title': d['title'], 'pointsChecked': int(len(inside)), 'maxGapPctOfView': round(100 * dmax / span, 3)})

    ax.scatter(pc.real, pc.imag, s=2, c='#9a9a9a', zorder=1, linewidths=0)
    for i, b in enumerate(d['branches']):
        a = np.array(b)
        ax.plot(a[:, 0], a[:, 1], color=COLORS[i % len(COLORS)], lw=1.4, zorder=2)
    if d['asymptotes']:
        c0, R = d['asymptotes']['centroid'], span
        for ang in d['asymptotes']['angles']:
            t = np.radians(ang)
            ax.plot([c0, c0 + R * np.cos(t)], [0, R * np.sin(t)], ls='--', lw=0.7, color='#777', zorder=0)
    for x, y, k in d['poles']:
        ax.plot(x, y, 'x', color='k', ms=8, mew=2, zorder=3)
        if k > 1:
            ax.annotate('×%d' % k, (x, y), textcoords='offset points', xytext=(5, 5), fontsize=8)
    for x, y, k in d['zeros']:
        ax.plot(x, y, 'o', mfc='white', mec='k', ms=7, mew=1.5, zorder=3)
    for x, y in d['keyPoints']:
        for yy in ([y, -y] if y else [y]):
            ax.plot(x, yy, 'D', color='#E8A317', ms=5, zorder=4)
    ax.axhline(0, color='k', lw=0.5); ax.axvline(0, color='k', lw=0.5)
    ax.set_xlim(v['xmin'], v['xmax']); ax.set_ylim(v['ymin'], v['ymax']); ax.set_aspect('equal')
    ax.set_title('%s  %s\n최대 차이 %.2f%% (화면 대각선 대비)' % (d['id'], d['title'], 100 * dmax / span), fontsize=9.5)
    ax.tick_params(labelsize=7)

fig.suptitle('엔진 가지(색 선) vs python-control(회색 점)\n× 극점  ○ 영점  ◆ 이탈·진입·교차점  점선: 점근선', fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.965])
out = ROOT / 'docs' / 'verification-overlay.png'
out.parent.mkdir(exist_ok=True)
fig.savefig(out, dpi=110)
(ROOT / 'docs' / 'verification-overlay.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
for s_ in summary:
    print(s_)
print('저장:', out)
