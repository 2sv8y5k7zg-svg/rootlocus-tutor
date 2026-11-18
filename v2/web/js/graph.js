// graph.js — s평면 그래프를 캔버스에 그립니다 (어두운 무대 위에 빛나는 선).
// 그리는 데이터(극점, 영점, 구간, 점근선, 가지 곡선, 교차점)는 모두 Python 엔진이 보낸 값입니다.
// 이 파일이 하는 계산은 '좌표 → 화면 픽셀' 변환과 '움직임(보간)'뿐입니다. 수학 값은 만들지 않습니다.
//
// 움직임의 원리
//   단계가 바뀌면 그 단계에서 새로 나오는 요소(layer)의 '드러남 정도'(0~1)를 시간에 따라 0 → 1로 바꿉니다.
//   그리기 함수는 그 값만큼만 그립니다. (예: 0.4이면 실수축 구간을 40%만, 가지 곡선을 40%까지만)
//   K 표시는 목표 위치를 바로 뛰지 않고 매 프레임 조금씩 따라가서(감쇠) 미끄러지듯 움직입니다.

// 무대 색 (base.css의 브랜드 색과 같은 계열. 캔버스는 CSS 변수를 못 쓰므로 여기 적어 둡니다)
const STAGE = {
  grid: 'rgba(245,244,240,0.05)', axis: 'rgba(245,244,240,0.30)', label: 'rgba(245,244,240,0.42)',
  pole: '#F5F4F0', ice: '#B1CBE6', violet: '#B4A9D5', coral: '#E8A493',
};
// 요소(layer)가 처음 나오는 단계와, 드러나는 데 걸리는 시간(ms)
const LAYERS = {
  pz: { step: 2, dur: 900 }, seg: { step: 3, dur: 900 }, asym: { step: 4, dur: 1200 }, brk: { step: 5, dur: 800 },
  ang: { step: 6, dur: 900 }, cross: { step: 7, dur: 800 }, branch: { step: 8, dur: 2600 },
};

// 속도 곡선(easing): 0~1 입력을 받아 0~1을 돌려줍니다
const easeOut = (x) => 1 - Math.pow(1 - x, 3);                 // 빨리 출발해서 부드럽게 멈춤
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeBack = (x) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };  // 살짝 넘쳤다 돌아옴
const clamp01 = (x) => Math.max(0, Math.min(1, x));

class PlaneGraph {
  // canvas: 그릴 <canvas>
  // onPick: 그래프를 눌렀을 때 불리는 함수. 표시된 점(anchor) 근처를 눌렀으면 그 점, 빈 곳이면 null을 넘깁니다.
  //   (예전에는 아무 곳이나 누르면 그 좌표의 K를 물었는데, 손가락으로 −1 같은 점을 정확히 누르기 어려워
  //    필요한 값을 얻지 못했습니다. 그래서 '의미 있는 점'에만 달라붙게 바꿨습니다.)
  constructor(canvas, onPick) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = null;        // 서버의 result.graph
    this.step = 1;           // 현재 단계
    this.kIndex = null;      // K 표시의 목표 위치 (가지 배열의 몇 번째 점인지)
    this.kShown = null;      // 화면에 실제로 그려지는 위치 (목표를 부드럽게 따라감, 소수 가능)
    this.pick = null;        // 사용자가 누른 점 (anchor 하나)
    this.anchors = [];       // 누를 수 있는 점 목록 {x, y, layer, ...} — 값과 글자는 모두 엔진 결과 (learn.js가 만듦)
    this.onTip = null;       // 누른 점의 화면 위치가 바뀔 때 (px, py)를 알려 줄 함수 (말풍선 위치 맞추기)
    // 그래프가 차지할 안쪽 여백(px). 시트가 열리면 오른쪽 여백이 커지고, 그래프는 남은 자리 가운데로 미끄러져 갑니다.
    this.ins = { t: 0, r: 0, b: 0, l: 0 };
    this.insT = { t: 0, r: 0, b: 0, l: 0 };
    // 카메라: 화면 가운데에 둘 복소평면 좌표(x, y)와 확대 배율 z. 단계마다 그 단계의 주인공 쪽으로 천천히 다가갑니다.
    this.cam = { x: 0, y: 0, z: 1 };
    this.camT = { x: 0, y: 0, z: 1 };
    // 조명: 지금 단계의 주인공 자리에 빛이 고이고, 바깥은 어두워집니다(a = 세기 0~1)
    this.light = { x: 0, y: 0, a: 0 };
    this.lightT = { x: 0, y: 0, a: 0 };
    this.pulses = [];        // 수식에서 날아온 숫자가 도착한 자리의 물결 {x, y, t0}
    this.onFrame = null;     // 매 프레임 그린 뒤 불리는 함수 (수식↔점 연결선 위치 맞추기)
    this.dprCap = 2;         // 프레임이 밀리는 기기에서는 스스로 낮춥니다 (선명도보다 부드러움 우선)
    this.slow = 0;
    this.pickT = 0;          // 누른 순간의 시각 (물결 효과용)
    this.onPick = onPick;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 드러남 정도(0~1): 축(axes)과 각 요소. 그리고 요소별 강조 정도(em: 지금 단계의 주인공이면 1)
    this.v = { axes: 0 };
    this.em = {};
    for (const k in LAYERS) { this.v[k] = 0; this.em[k] = 1; }
    this.tweens = [];        // 진행 중인 움직임 목록
    this.running = false;

    // 화면 크기가 바뀌면 다시 그립니다 (ResizeObserver: 요소 크기 변화를 알려 주는 브라우저 기능)
    new ResizeObserver(() => this.resize()).observe(canvas);
    // 누르기: 손가락은 넉넉하게(반지름 40px), 마우스는 26px 안의 가장 가까운 점에 달라붙습니다
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.data || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
      if (moved > 12) return;                                   // 끌기는 누르기로 보지 않음
      const r = canvas.getBoundingClientRect();
      const a = this.nearest(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'mouse' ? 26 : 40);
      this.pick = a;
      this.pickT = performance.now();
      this.kick();
      if (this.onPick) this.onPick(a);
    });
    // 마우스를 점 위에 올리면 손가락 모양 커서 (누를 수 있다는 표시)
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.data) return;
      const r = canvas.getBoundingClientRect();
      canvas.classList.toggle('can-pick', !!this.nearest(e.clientX - r.left, e.clientY - r.top, 26));
    });
  }

  // 레티나 화면에서도 선이 흐리지 않도록 실제 픽셀 수를 devicePixelRatio 배로 잡습니다.
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.aimCamera();
    this.cam = { ...this.camT };          // 창 크기가 바뀌면 카메라는 바로 새 자리로
    this.fitView();
    this.draw();
  }

  // 새 문제의 데이터를 받습니다. 축이 원점에서 바깥으로 그려지며 시작합니다.
  setData(graph) {
    this.data = graph;
    this.pick = null; this.kIndex = null; this.kShown = null;
    this.tweens = [];
    for (const k in LAYERS) { this.v[k] = 0; this.em[k] = 1; }
    this.v.axes = 0; this.step = 1;
    const v = graph.view;
    this.box = null;
    this.cam = { x: (v.xmin + v.xmax) / 2, y: (v.ymin + v.ymax) / 2, z: 1 };
    this.camT = { ...this.cam };
    this.light = { x: this.cam.x, y: this.cam.y, a: 0 }; this.lightT = { ...this.light };
    this.pulses = [];
    this.fitView();
    this.tween(this.v, 'axes', 1, 1100, 0);
  }

  // Python이 정한 보기 범위(view)를 화면 비율에 맞춥니다. 가로·세로 축척을 같게(원이 원으로 보이게).
  // 여백(ins)을 뺀 자리 안에 맞추므로, 떠 있는 패널에 가리지 않습니다.
  fitView(skipArc) {
    if (!this.data || !this.w) return;
    const v = this.data.view, i = this.ins;
    const W = Math.max(120, this.w - i.l - i.r), H = Math.max(120, this.h - i.t - i.b);
    this.scale = Math.min(W / (v.xmax - v.xmin), H / (v.ymax - v.ymin));
    this.cx = (v.xmin + v.xmax) / 2; this.cy = (v.ymin + v.ymax) / 2;
    this.ox = i.l + W / 2; this.oy = i.t + H / 2;
    if (!skipArc) this.buildArc();
  }

  // 여백을 바꿉니다. 그래프는 새 자리로 부드럽게 미끄러져 갑니다(카메라 이동). instant면 바로.
  setInsets(ins, instant) {
    this.insT = { ...this.insT, ...ins };
    this.aimCamera();                     // 쓸 수 있는 자리가 바뀌었으니 담을 영역을 다시 맞춥니다
    if (instant || this.reduced || !this.data) { this.ins = { ...this.insT }; this.cam = { ...this.camT }; this.fitView(); this.draw(); return; }
    this.kick();
  }

  // 자동 카메라: 이 단계에서 꼭 보여야 하는 영역(box = {xmin, xmax, ymin, ymax}, 수학 좌표)을 받아
  // 패널을 뺀 화면 자리에 여백을 두고 꽉 차게 맞춥니다. 범위가 좁으면 다가가고(줌 인), 넓으면 물러납니다(줌 아웃).
  // box가 null이면 Python이 정한 전체 보기 범위(근궤적 전체)를 그대로 씁니다.
  frame(box) {
    this.box = box || null;
    this.aimCamera();
    if (this.reduced) { this.cam = { ...this.camT }; this.fitView(); this.draw(); return; }
    this.kick();
  }
  // 목표 카메라(camT) 계산. 화면 축척은 fitView와 같은 식(전체 보기 기준)이고, z는 그 축척에 곱하는 배율입니다.
  aimCamera() {
    const v = this.data && this.data.view;
    if (!v || !this.w) return;
    const b = this.box;
    if (!b) { this.camT = { x: (v.xmin + v.xmax) / 2, y: (v.ymin + v.ymax) / 2, z: 1 }; return; }
    const i = this.insT;
    const W = Math.max(120, this.w - i.l - i.r), H = Math.max(120, this.h - i.t - i.b);
    const base = Math.min(W / (v.xmax - v.xmin), H / (v.ymax - v.ymin));
    const PAD = Math.min(56, W * 0.1, H * 0.12);   // 점 표시·글자가 가장자리·패널에 붙지 않게 남기는 화면 여백(px)
    const fit = Math.min((W - 2 * PAD) / Math.max(b.xmax - b.xmin, 1e-6), (H - 2 * PAD) / Math.max(b.ymax - b.ymin, 1e-6));
    const z = Math.max(0.35, Math.min(2.6, fit / base));
    this.camT = { x: (b.xmin + b.xmax) / 2, y: (b.ymin + b.ymax) / 2, z };
  }

  // 화면 좌표 (px, py) 근처 radius 안에서 지금 보이는 점 중 가장 가까운 것
  nearest(px, py, radius) {
    let best = null, bd = radius;
    for (const a of this.anchors) {
      if (!(this.v[a.layer] > 0.5)) continue;               // 아직 나오지 않은 단계의 점은 누를 수 없음
      const [ax, ay] = this.toPx(a.x, a.y), d = Math.hypot(ax - px, ay - py);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  setAnchors(list) { this.anchors = list || []; this.pick = null; }
  clearPick() { this.pick = null; this.draw(); }

  // 곡선이 '일정한 속도'로 그려지도록, 점 번호별로 화면에서 지나온 길이(누적)를 미리 구해 둡니다.
  // (K 표본은 처음에 아주 촘촘해서, 점 번호대로 그리면 처음엔 멈춘 듯하다가 갑자기 지나가 버립니다)
  // 화면 밖으로 나간 부분은 길이에 넣지 않습니다. 네 가지 중 가장 긴 것을 기준으로 삼아 같은 K끼리 함께 움직입니다.
  buildArc() {
    const d = this.data, n = d.K.length, arc = new Float32Array(n), m = 40;
    const inside = (p) => p[0] > -m && p[0] < this.w + m && p[1] > -m && p[1] < this.h + m;
    for (let i = 1; i < n; i++) {
      let seg = 0;
      for (const br of d.branches) {
        const a = this.toPx(br[i - 1][0], br[i - 1][1]), b = this.toPx(br[i][0], br[i][1]);
        if (inside(a) || inside(b)) seg = Math.max(seg, Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      arc[i] = arc[i - 1] + seg;
    }
    this.arc = arc;
  }
  // 진행률 p(0~1) → 점 번호(소수). 누적 길이 표에서 이분 탐색으로 찾습니다.
  indexAt(p) {
    const arc = this.arc, n = arc.length - 1, total = arc[n];
    if (!(total > 0)) return n * p;
    const target = total * p;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arc[mid] < target) lo = mid; else hi = mid; }
    const span = arc[hi] - arc[lo];
    return lo + (span > 0 ? (target - arc[lo]) / span : 0);
  }

  // 좌표 변환: 복소평면 (x, y) ↔ 화면 픽셀 (px, py). y축은 화면에서 위가 +.
  toPx(x, y) { const k = this.scale * this.cam.z; return [this.ox + (x - this.cam.x) * k, this.oy - (y - this.cam.y) * k]; }
  toWorld(px, py) { const k = this.scale * this.cam.z; return { x: this.cam.x + (px - this.ox) / k, y: this.cam.y - (py - this.oy) / k }; }

  // 조명 자리와 세기. pt가 null이면 보기 범위 가운데.
  setLight(pt, a) {
    const v = this.data && this.data.view;
    if (!v) return;
    this.lightT = { x: pt ? pt[0] : (v.xmin + v.xmax) / 2, y: pt ? pt[1] : (v.ymin + v.ymax) / 2, a };
    if (this.reduced) this.light = { ...this.lightT };
    this.kick();
  }
  placeSpot() {
    const el = this.spot || (this.spot = document.getElementById('spot'));
    if (!el || !this.w) return;
    const L = this.light, [lx, ly] = this.toPx(L.x, L.y);
    // 막은 지름 600px 원판. 화면 대각선의 2.2배까지 키워 어느 자리에 빛이 있어도 무대 전체를 덮습니다
    const k = 2.2 * Math.hypot(this.w, this.h) / 600;
    el.style.transform = `translate(${lx - 300}px, ${ly - 300}px) scale(${k})`;
    el.style.opacity = L.a.toFixed(3);
  }
  // 수식에서 날아온 숫자가 도착했을 때 그 점에서 물결이 한 번 퍼집니다
  pulse(x, y) { this.pulses.push({ x, y, t0: performance.now() }); this.kick(); }

  // 카메라를 한 점으로 (pt = [x, y], z = 확대 배율). pt가 null이면 전체 보기로 물러납니다.
  setFocus(pt, z) {
    const v = this.data && this.data.view;
    if (!v) return;
    this.camT = pt ? { x: pt[0], y: pt[1], z: z || 1.6 } : { x: (v.xmin + v.xmax) / 2, y: (v.ymin + v.ymax) / 2, z: 1 };
    if (this.reduced) { this.cam = { ...this.camT }; this.buildArc(); this.draw(); return; }
    this.kick();
  }

  // ── 움직임 엔진 ────────────────────────────────────────────────
  // obj[key] 값을 지금 값에서 to까지 dur(ms) 동안 바꿉니다. delay(ms) 뒤에 시작.
  tween(obj, key, to, dur, delay) {
    this.tweens = this.tweens.filter((t) => !(t.obj === obj && t.key === key));
    if (this.reduced || dur <= 0) { obj[key] = to; this.kick(); return; }
    this.tweens.push({ obj, key, from: obj[key], to, dur, t0: performance.now() + (delay || 0) });
    this.kick();
  }
  // 그리기 반복을 시작합니다. 움직일 것이 없으면 스스로 멈춥니다(배터리 절약).
  kick() {
    if (this.running) return;
    this.running = true;
    const loop = (now) => {
      let busy = false;
      for (const t of this.tweens) {
        const u = clamp01((now - t.t0) / t.dur);
        t.obj[t.key] = t.from + (t.to - t.from) * u;      // 여기서는 일정한 속도, 모양(easing)은 그릴 때 적용
        if (u < 1) busy = true;
      }
      this.tweens = this.tweens.filter((t) => now - t.t0 < t.dur);
      // K 표시가 목표 위치를 부드럽게 따라갑니다. 지난 시간 기준으로 계산해 주사율(60Hz·120Hz)과 무관하게 같은 속도입니다.
      const dt = this.lastNow ? Math.min(now - this.lastNow, 100) : 16.7; this.lastNow = now;
      if (this.kIndex !== null && this.kShown !== null) {
        const d = this.kIndex - this.kShown;
        if (Math.abs(d) > 0.02 && !this.reduced) { this.kShown += d * (1 - Math.pow(0.84, dt / 16.7)); busy = true; } else this.kShown = this.kIndex;
      }
      if (this.pick && now - this.pickT < 900) busy = true;
      // 여백(카메라)이 목표를 따라갑니다. 지난 시간 기준이라 주사율과 무관하게 같은 속도입니다.
      let moving = false;
      for (const k of ['t', 'r', 'b', 'l']) {
        const d = this.insT[k] - this.ins[k];
        if (Math.abs(d) > 0.3) { this.ins[k] += d * (1 - Math.pow(0.86, dt / 16.7)); moving = true; } else this.ins[k] = this.insT[k];
      }
      // 카메라는 조금 더 느리게(영화의 카메라처럼) 따라갑니다
      for (const k of ['x', 'y', 'z']) {
        const d = this.camT[k] - this.cam[k], eps = k === 'z' ? 0.002 : 0.002 / this.scale * 100;
        if (Math.abs(d) > eps) { this.cam[k] += d * (1 - Math.pow(0.94, dt / 16.7)); moving = true; } else this.cam[k] = this.camT[k];
      }
      for (const k of ['x', 'y', 'a']) {
        const d = this.lightT[k] - this.light[k];
        if (Math.abs(d) > 1e-3) { this.light[k] += d * (1 - Math.pow(0.93, dt / 16.7)); busy = true; } else this.light[k] = this.lightT[k];
      }
      this.pulses = this.pulses.filter((q) => now - q.t0 < 900);
      if (this.pulses.length) busy = true;
      if (moving) { busy = true; this.fitView(true); this.arcStale = true; }
      else if (this.arcStale) { this.arcStale = false; this.buildArc(); }
      this.draw(now);
      // 큰 화면에서 프레임이 계속 밀리면(33ms 넘는 프레임이 잦으면) 해상도를 한 단계 낮춥니다
      if (busy && dt > 33) this.slow++; else if (busy) this.slow = Math.max(0, this.slow - 0.25);
      if (this.slow > 12 && this.dprCap > 1) { this.dprCap = Math.max(1, this.dprCap - 0.5); this.slow = 0; this.resize(); }
      if (busy) requestAnimationFrame(loop); else { this.running = false; this.lastNow = 0; }
    };
    requestAnimationFrame(loop);
  }

  // 단계 이동. 새로 나오는 요소는 차례로 드러나고, 지나간 단계의 요소는 조금 어두워져 지금 단계가 눈에 띕니다.
  // instant: true면 움직임 없이 바로 완성 상태 (랜딩의 스크롤 연출처럼 바깥에서 진행률을 직접 줄 때)
  setStep(n, opts) {
    const instant = opts && opts.instant;
    const prev = this.step;
    this.step = n;
    let delay = (opts && opts.delay) || 0;              // 수식의 숫자가 날아와 닿을 때 맞춰 나오도록 늦출 수 있음
    for (const k in LAYERS) {
      const L = LAYERS[k];
      let on = n >= L.step;
      if (k === 'seg' && n >= 8) on = false;            // 완성된 곡선이 실수축 구간을 대신합니다
      const target = on ? 1 : 0;
      if (instant) { this.v[k] = target; this.em[k] = 1; continue; }
      if (target > this.v[k]) {
        // 여러 단계를 한꺼번에 건너뛰면 요소들이 조금씩 시차를 두고 나옵니다
        const skip = n - prev > 1;
        this.tween(this.v, k, 1, skip ? Math.min(L.dur, 900) : L.dur, delay);
        if (skip) delay += 160;
      } else if (target < this.v[k]) {
        this.tween(this.v, k, 0, 260, 0);
      }
      const focus = n >= 8 || L.step === n;             // 8·9단계는 전체가 주인공
      this.tween(this.em, k, focus ? 1 : 0.32, 700, 0); // 조명: 지난 단계의 요소는 그림자 속으로
    }
    if (instant) { this.tweens = []; this.v.axes = 1; this.draw(); }
  }

  // K 표시 위치를 정합니다 (null이면 숨김). 표시는 목표까지 미끄러지듯 이동합니다.
  setK(i) {
    this.kIndex = i;
    if (i === null) this.kShown = null;
    else if (this.kShown === null) this.kShown = i;
    this.kick();
  }

  // 바깥(스크롤 연출)에서 곡선이 그려진 정도를 직접 정할 때
  setBranchProgress(p) { this.v.branch = clamp01(p); this.draw(); }

  // ── 그리기 ────────────────────────────────────────────────────
  draw(now) {
    const c = this.ctx;
    if (!this.w) return;
    now = now || performance.now();
    c.clearRect(0, 0, this.w, this.h);
    if (!this.data || !this.scale) return;
    const d = this.data, v = this.v, em = this.em;
    this.drawGrid(easeOut(v.axes));
    // 조명은 캔버스에 그리지 않고, 그래프 위의 투명한 막(.spot)을 옮겨서 표현합니다.
    // 막의 무늬(가운데 빛, 바깥 어둠)는 한 번만 그려 두고 위치·크기·투명도만 바꾸므로 프레임 부담이 거의 없습니다.
    this.placeSpot();

    // 4단계: 점근선 — 중심점이 먼저 나타나고, 점선이 중심에서 바깥으로 뻗습니다
    if (v.asym > 0 && d.asymptotes) {
      const p = v.asym, [x0, y0] = this.toPx(d.asymptotes.centroid, 0);
      const reach = Math.hypot(this.w, this.h) * easeInOut(clamp01((p - 0.15) / 0.85));
      c.save();
      c.setLineDash([5, 7]); c.lineDashOffset = -reach;     // 점선 무늬가 함께 흘러 '뻗어 나가는' 느낌
      c.strokeStyle = STAGE.violet; c.globalAlpha = 0.75 * em.asym; c.lineWidth = 1.2;
      for (const a of d.asymptotes.angles) {
        const t = a * Math.PI / 180;
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + reach * Math.cos(t), y0 - reach * Math.sin(t)); c.stroke();
      }
      c.restore();
      if (d.asymptotes.showCentroid) this.pop(d.asymptotes.centroid, 0, clamp01(p / 0.3), STAGE.violet, 4, em.asym);
    }

    // 3단계: 실수축 근궤적 구간 — 오른쪽 끝에서 왼쪽으로 자라는 빛나는 띠
    if (v.seg > 0) {
      const p = easeInOut(v.seg), far = 4 * Math.max(this.w, this.h) / this.scale;
      c.save(); c.lineCap = 'round';
      for (const [lo, hi] of d.segments) {
        const b = this.toPx(hi === null ? this.cam.x + far : hi, 0), a = this.toPx(lo === null ? this.cam.x - far : lo, 0);
        const ex = b[0] + (a[0] - b[0]) * p;
        c.strokeStyle = STAGE.ice; c.globalAlpha = 0.22 * em.seg; c.lineWidth = 9;
        c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(ex, a[1]); c.stroke();
        c.globalAlpha = 0.95 * em.seg; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(ex, a[1]); c.stroke();
      }
      c.restore();
    }

    // 8단계: 근궤적 가지 — 극점에서 출발해 그려지고, 맨 앞에 빛나는 머리가 달립니다
    if (v.branch > 0) this.drawBranches(v.branch);

    // 6단계: 출발각·도착각 화살표 (길이가 자라며 나타남)
    if (v.ang > 0) {
      for (const [x, y, deg] of d.angles) {
        for (const sgn of [1, -1]) {           // 켤레(아래쪽) 극점은 각의 부호만 바뀝니다
          if (sgn === -1 && Math.abs(y) < 1e-12) continue;
          this.arrow(x, sgn * y, sgn * deg, easeOut(v.ang), em.ang);
        }
      }
    }

    // 7단계: 허수축 교차점 (±jω)
    if (v.cross > 0) {
      for (const [, w] of d.crossings) {
        this.pop(0, w, v.cross, STAGE.coral, 5, em.cross);
        if (w > 0) this.pop(0, -w, v.cross, STAGE.coral, 5, em.cross);
      }
    }

    // 5단계: 이탈점·진입점
    if (v.brk > 0) {
      for (const [x, y] of d.breakpoints) {
        this.pop(x, y, v.brk, STAGE.violet, 5, em.brk);
        if (Math.abs(y) > 1e-12) this.pop(x, -y, v.brk, STAGE.violet, 5, em.brk);
      }
    }

    // 2단계: 극점(×)과 영점(○) — 하나씩 시차를 두고 나타납니다
    if (v.pz > 0) {
      const all = [...d.poles.map((q) => ['p', q]), ...d.zeros.map((q) => ['z', q])];
      all.forEach(([kind, [x, y, m]], i) => {
        const p = clamp01(v.pz * (1 + 0.12 * all.length) - 0.12 * i);
        if (p <= 0) return;
        if (kind === 'p') this.cross(x, y, m, p, em.pz); else this.ring(x, y, m, p, em.pz);
      });
    }

    // 수식에서 날아온 숫자가 닿은 자리: 빛이 번쩍이며 물결이 퍼집니다
    for (const q of this.pulses) {
      const u = clamp01((now - q.t0) / 900), [px, py] = this.toPx(q.x, q.y);
      c.save();
      c.strokeStyle = STAGE.ice; c.globalAlpha = 0.7 * (1 - u); c.lineWidth = 1.4;
      c.beginPath(); c.arc(px, py, 6 + 30 * easeOut(u), 0, Math.PI * 2); c.stroke();
      const g = c.createRadialGradient(px, py, 0, px, py, 26);
      g.addColorStop(0, `rgba(255,255,255,${0.55 * (1 - u)})`); g.addColorStop(1, 'rgba(177,203,230,0)');
      c.globalAlpha = 1; c.fillStyle = g; c.beginPath(); c.arc(px, py, 26, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    // 8·9단계: 현재 K에서의 폐루프 극점. 우반면(불안정)이면 붉은 계열로 바뀝니다
    if (v.branch >= 1 && this.kShown !== null) {
      for (const br of d.branches) {
        const [x, y] = this.at(br, this.kShown);
        this.marker(x, y, x > 1e-9 ? STAGE.coral : STAGE.ice);
      }
    }

    // 누른 점: 그 점을 감싸는 고리가 조여 들며 '잡혔다'를 보여 주고, 말풍선 위치를 알려 줍니다
    if (this.pick) {
      const [px, py] = this.toPx(this.pick.x, this.pick.y), u = clamp01((now - this.pickT) / 900);
      c.save(); c.strokeStyle = STAGE.ice;
      c.globalAlpha = 0.5 * (1 - u); c.lineWidth = 1.2; c.beginPath(); c.arc(px, py, 12 + 26 * easeOut(u), 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 0.95; c.lineWidth = 1.6; c.beginPath(); c.arc(px, py, 12 + 10 * (1 - easeOut(clamp01(u * 1.8))), 0, Math.PI * 2); c.stroke();
      c.restore();
      if (this.onTip) this.onTip(px, py);
    }
    if (this.onFrame) this.onFrame();
  }

  // 가지 배열 br의 '소수 번째' 점 (두 점 사이를 직선으로 이어 구함 — 화면 표시용 보간)
  at(br, f) {
    const i = Math.max(0, Math.min(br.length - 1, Math.floor(f))), j = Math.min(br.length - 1, i + 1), u = f - i;
    return [br[i][0] + (br[j][0] - br[i][0]) * u, br[i][1] + (br[j][1] - br[i][1]) * u];
  }

  // 가지 곡선: 0번 점(K=0, 극점)에서 frac 지점까지의 길
  tracePath(br, upto) {
    const c = this.ctx, last = Math.floor(upto);
    c.beginPath();
    for (let i = 0; i <= last; i++) {
      const [px, py] = this.toPx(br[i][0], br[i][1]);
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    if (upto > last) { const [x, y] = this.at(br, upto); c.lineTo(...this.toPx(x, y)); }
  }

  drawBranches(p) {
    const c = this.ctx, d = this.data, n = d.K.length - 1;
    const upto = p >= 1 ? n : this.indexAt(easeInOut(p));
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    for (const br of d.branches) {
      // 넓고 옅은 선(빛 번짐) 위에 가는 밝은 선을 겹쳐 '빛나는 선'을 만듭니다
      this.tracePath(br, upto);
      c.strokeStyle = STAGE.ice; c.globalAlpha = 0.10; c.lineWidth = 9; c.stroke();
      c.globalAlpha = 0.95; c.lineWidth = 2; c.stroke();
    }
    // K 표시가 지나온 부분은 조금 더 밝게
    if (p >= 1 && this.kShown !== null && this.kShown > 0) {
      for (const br of d.branches) {
        this.tracePath(br, this.kShown);
        c.strokeStyle = '#FFFFFF'; c.globalAlpha = 0.16; c.lineWidth = 7; c.stroke();
        c.globalAlpha = 0.9; c.lineWidth = 2.2; c.stroke();
      }
    }
    // 그려지는 동안 맨 앞의 빛나는 머리
    if (p < 1) {
      for (const br of d.branches) {
        const [x, y] = this.at(br, upto), [px, py] = this.toPx(x, y);
        if (px < -40 || px > this.w + 40 || py < -40 || py > this.h + 40) continue;
        const g = c.createRadialGradient(px, py, 0, px, py, 18);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(177,203,230,0.5)'); g.addColorStop(1, 'rgba(177,203,230,0)');
        c.globalAlpha = 1; c.fillStyle = g; c.beginPath(); c.arc(px, py, 18, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
  }

  // 격자와 실수축·허수축. p: 드러남 정도 (축이 원점에서 양쪽으로 자람)
  drawGrid(p) {
    const c = this.ctx;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    // 눈금 간격: 화면에 대략 8~12칸이 보이도록 1, 2, 5 × 10^k 중에서 고릅니다
    const raw = (br.x - tl.x) / 10, p10 = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * p10).find((s) => s >= raw);
    const [ox, oy] = this.toPx(0, 0);
    c.save();
    c.lineWidth = 1; c.strokeStyle = STAGE.grid; c.globalAlpha = p;
    c.fillStyle = STAGE.label; c.font = '11px "JetBrains Mono", ui-monospace, monospace';
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
      const [px] = this.toPx(x, 0);
      c.beginPath(); c.moveTo(px, 0); c.lineTo(px, this.h); c.stroke();
      if (Math.abs(x) > step / 2) c.fillText(+x.toFixed(6) + '', px + 4, oy + 14);
    }
    for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
      const [, py] = this.toPx(0, y);
      c.beginPath(); c.moveTo(0, py); c.lineTo(this.w, py); c.stroke();
      if (Math.abs(y) > step / 2) c.fillText('j' + (+y.toFixed(6)), ox + 5, py - 4);
    }
    // 축: 원점에서 양쪽으로 자랍니다
    c.globalAlpha = 1; c.strokeStyle = STAGE.axis; c.lineWidth = 1.2;
    const rx = Math.max(ox, this.w - ox) * p, ry = Math.max(oy, this.h - oy) * p;
    c.beginPath(); c.moveTo(ox - rx, oy); c.lineTo(ox + rx, oy); c.moveTo(ox, oy - ry); c.lineTo(ox, oy + ry); c.stroke();
    c.globalAlpha = p;
    c.fillText('Re', this.w - 24, oy - 8);
    c.fillText('Im', ox + 8, 14);
    c.restore();
  }

  // ── 작은 도형들 ────────────────────────────────────────────────
  // 점이 '톡' 하고 나타나며 물결이 한 번 퍼집니다. p: 0~1
  pop(x, y, p, color, r, alpha) {
    if (p <= 0) return;
    const c = this.ctx, [px, py] = this.toPx(x, y);
    c.save();
    if (p < 1) {
      c.strokeStyle = color; c.globalAlpha = (1 - p) * 0.8 * alpha; c.lineWidth = 1.2;
      c.beginPath(); c.arc(px, py, r + 20 * easeOut(p), 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = alpha; c.fillStyle = color;
    c.beginPath(); c.arc(px, py, r * easeBack(clamp01(p * 1.6)), 0, Math.PI * 2); c.fill();
    c.restore();
  }
  cross(x, y, mult, p, alpha) {
    const c = this.ctx, [px, py] = this.toPx(x, y), s = 6 * easeBack(clamp01(p * 1.5));
    c.save();
    if (p < 1) {
      c.strokeStyle = STAGE.pole; c.globalAlpha = (1 - p) * 0.6; c.lineWidth = 1;
      c.beginPath(); c.arc(px, py, 6 + 20 * easeOut(p), 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = alpha; c.strokeStyle = STAGE.pole; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(px - s, py - s); c.lineTo(px + s, py + s); c.moveTo(px + s, py - s); c.lineTo(px - s, py + s); c.stroke();
    if (mult > 1) { c.fillStyle = STAGE.pole; c.font = '600 11px "JetBrains Mono", monospace'; c.fillText('×' + mult, px + 9, py - 9); }
    c.restore();
  }
  ring(x, y, mult, p, alpha) {
    const c = this.ctx, [px, py] = this.toPx(x, y);
    c.save();
    c.globalAlpha = alpha; c.strokeStyle = STAGE.pole; c.lineWidth = 2; c.fillStyle = '#10141D';
    c.beginPath(); c.arc(px, py, 6 * easeBack(clamp01(p * 1.5)), 0, Math.PI * 2); c.fill(); c.stroke();
    if (mult > 1) { c.fillStyle = STAGE.pole; c.font = '600 11px "JetBrains Mono", monospace'; c.fillText('×' + mult, px + 9, py - 9); }
    c.restore();
  }
  // (x, y)에서 deg 방향으로 짧은 화살표 (화면 기준 길이 최대 38px). p만큼 자랍니다
  arrow(x, y, deg, p, alpha) {
    const c = this.ctx, [px, py] = this.toPx(x, y), t = deg * Math.PI / 180, L = 38 * p;
    if (L < 2) return;
    const ex = px + L * Math.cos(t), ey = py - L * Math.sin(t);
    c.save();
    c.globalAlpha = alpha; c.strokeStyle = STAGE.violet; c.fillStyle = STAGE.violet; c.lineWidth = 1.8; c.lineCap = 'round';
    c.beginPath(); c.moveTo(px, py); c.lineTo(ex, ey); c.stroke();
    const h = 7 * p, a1 = t + Math.PI * 0.85, a2 = t - Math.PI * 0.85;
    c.beginPath(); c.moveTo(ex, ey);
    c.lineTo(ex + h * Math.cos(a1), ey - h * Math.sin(a1)); c.lineTo(ex + h * Math.cos(a2), ey - h * Math.sin(a2)); c.closePath(); c.fill();
    c.restore();
  }
  // 현재 K의 폐루프 극점: 빛 번짐 + 밝은 중심
  marker(x, y, color) {
    const c = this.ctx, [px, py] = this.toPx(x, y);
    if (px < -30 || px > this.w + 30 || py < -30 || py > this.h + 30) return;
    c.save();
    const g = c.createRadialGradient(px, py, 0, px, py, 20);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(16,20,29,0)');
    c.globalAlpha = 0.45; c.fillStyle = g; c.beginPath(); c.arc(px, py, 20, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1; c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = color; c.lineWidth = 2; c.stroke();
    c.restore();
  }
}
