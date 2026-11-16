// graph.js — s평면 그래프를 캔버스에 그립니다.
// 그리는 데이터(극점, 영점, 구간, 점근선, 가지 곡선, 교차점)는 모두 Python 엔진이 보낸 값입니다.
// 이 파일이 하는 계산은 '좌표 → 화면 픽셀' 변환뿐입니다.

class PlaneGraph {
  // canvas: 그릴 <canvas>, onPick: 그래프를 눌렀을 때 (re, im) 좌표를 넘겨받을 함수
  constructor(canvas, onPick) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = null;      // 서버의 result.graph
    this.step = 1;         // 현재 단계 (단계마다 보여 주는 요소가 다름)
    this.kIndex = null;    // K 슬라이더 위치 (가지 배열의 몇 번째 점인지)
    this.pick = null;      // 사용자가 누른 점
    this.progress = 1;     // 8단계 곡선 그리기 애니메이션 진행률 (0~1)
    this.onPick = onPick;

    // 화면 크기가 바뀌면 다시 그립니다 (ResizeObserver: 요소 크기 변화를 알려 주는 브라우저 기능)
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('click', (e) => {
      if (!this.data) return;
      const r = canvas.getBoundingClientRect();
      const p = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.pick = p;
      this.draw();
      if (this.onPick) this.onPick(p.x, p.y);
    });
  }

  // 레티나 화면에서도 선이 흐리지 않도록 실제 픽셀 수를 devicePixelRatio 배로 잡습니다.
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.fitView();
    this.draw();
  }

  setData(graph) {
    this.data = graph;
    this.pick = null;
    this.fitView();
    this.draw();
  }

  // Python이 정한 보기 범위(view)를 화면 비율에 맞춰 늘립니다. 가로·세로 축척을 같게(원이 원으로 보이게).
  fitView() {
    if (!this.data || !this.w) return;
    const v = this.data.view;
    let x0 = v.xmin, x1 = v.xmax, y0 = v.ymin, y1 = v.ymax;
    const sx = this.w / (x1 - x0), sy = this.h / (y1 - y0);
    const s = Math.min(sx, sy);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.scale = s;
    this.cx = cx; this.cy = cy;
  }

  // 좌표 변환: 복소평면 (x, y) ↔ 화면 픽셀 (px, py). y축은 화면에서 위가 +.
  toPx(x, y) { return [this.w / 2 + (x - this.cx) * this.scale, this.h / 2 - (y - this.cy) * this.scale]; }
  toWorld(px, py) { return { x: this.cx + (px - this.w / 2) / this.scale, y: this.cy - (py - this.h / 2) / this.scale }; }

  // 단계별로 보여 줄 요소를 정합니다. 앞 단계에서 구한 것은 계속 보입니다.
  show(what) {
    const need = { pz: 2, seg: 3, asym: 4, brk: 5, ang: 6, cross: 7, branch: 8, kmove: 8 };
    return this.step >= need[what];
  }

  draw() {
    const c = this.ctx;
    if (!this.w) return;
    c.clearRect(0, 0, this.w, this.h);
    this.drawGrid();
    if (!this.data) return;
    const d = this.data;
    const css = getComputedStyle(document.documentElement);
    const col = {
      ink: css.getPropertyValue('--ink').trim(), ice: css.getPropertyValue('--ice-deep').trim(),
      violet: css.getPropertyValue('--violet-deep').trim(), coral: css.getPropertyValue('--coral').trim(),
      iceSoft: css.getPropertyValue('--ice').trim(),
    };

    // 4단계: 점근선 (중심에서 각 방향으로 뻗는 점선)
    if (this.show('asym') && d.asymptotes) {
      c.save();
      c.setLineDash([6, 6]);
      c.strokeStyle = col.violet; c.globalAlpha = .7; c.lineWidth = 1.2;
      const R = 4 * Math.max(this.w, this.h) / this.scale;
      for (const a of d.asymptotes.angles) {
        const t = a * Math.PI / 180;
        const [x0, y0] = this.toPx(d.asymptotes.centroid, 0);
        const [x1, y1] = this.toPx(d.asymptotes.centroid + R * Math.cos(t), R * Math.sin(t));
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      }
      c.restore();
      if (d.asymptotes.showCentroid) this.dot(d.asymptotes.centroid, 0, 4, col.violet, true);
    }

    // 3단계: 실수축 근궤적 구간 (굵은 띠)
    if (this.show('seg') && !this.show('branch')) {
      c.save();
      c.strokeStyle = col.iceSoft; c.lineWidth = 7; c.lineCap = 'round';
      const far = 4 * Math.max(this.w, this.h) / this.scale;
      for (const [lo, hi] of d.segments) {
        const a = this.toPx(lo === null ? this.cx - far : lo, 0);
        const b = this.toPx(hi === null ? this.cx + far : hi, 0);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
      c.restore();
    }

    // 8단계: 근궤적 가지 곡선. progress만큼만 그려 '그려지는' 움직임을 만듭니다.
    if (this.show('branch')) {
      c.save();
      c.strokeStyle = col.ice; c.lineWidth = 2.2; c.lineJoin = 'round';
      const n = d.K.length;
      const upto = Math.max(2, Math.floor(n * this.progress));
      for (const br of d.branches) {
        c.beginPath();
        for (let i = 0; i < upto; i++) {
          const [px, py] = this.toPx(br[i][0], br[i][1]);
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
      }
      c.restore();
    }

    // 6단계: 출발각·도착각 화살표
    if (this.show('ang')) {
      for (const [x, y, deg] of d.angles) {
        for (const sgn of [1, -1]) {           // 켤레(아래쪽) 극점은 각의 부호만 바뀝니다
          if (sgn === -1 && Math.abs(y) < 1e-12) continue;
          this.arrow(x, sgn * y, sgn * deg, col.violet);
        }
      }
    }

    // 7단계: 허수축 교차점 (±jω)
    if (this.show('cross')) {
      for (const [, w] of d.crossings) {
        this.dot(0, w, 5, col.coral, true);
        if (w > 0) this.dot(0, -w, 5, col.coral, true);
      }
    }

    // 5단계: 이탈점·진입점
    if (this.show('brk')) {
      for (const [x, y] of d.breakpoints) {
        this.dot(x, y, 5, col.violet, true);
        if (Math.abs(y) > 1e-12) this.dot(x, -y, 5, col.violet, true);
      }
    }

    // 2단계: 극점(×)과 영점(○)
    if (this.show('pz')) {
      for (const [x, y, m] of d.poles) this.cross(x, y, col.ink, m);
      for (const [x, y, m] of d.zeros) this.ring(x, y, col.ink, m);
    }

    // 8·9단계: 현재 K에서의 폐루프 극점 (슬라이더로 움직임)
    if (this.show('kmove') && this.kIndex !== null) {
      for (const br of d.branches) {
        const p = br[Math.min(this.kIndex, br.length - 1)];
        this.dot(p[0], p[1], 6, col.ink, true, '#fff');
      }
    }

    // 사용자가 누른 점
    if (this.pick) this.dot(this.pick.x, this.pick.y, 4, col.coral, false);
  }

  // 격자와 실수축·허수축
  drawGrid() {
    const c = this.ctx;
    c.fillStyle = '#fff'; c.fillRect(0, 0, this.w, this.h);
    if (!this.scale) return;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    // 눈금 간격: 화면에 대략 8~12칸이 보이도록 1, 2, 5 × 10^k 중에서 고릅니다
    const span = br.x - tl.x;
    const raw = span / 10, p10 = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(m => m * p10).find(s => s >= raw);
    c.lineWidth = 1;
    c.strokeStyle = '#EEECE6';
    c.fillStyle = '#9AA0AC';
    c.font = '11px ' + getComputedStyle(document.body).fontFamily;
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
      const [px] = this.toPx(x, 0);
      c.beginPath(); c.moveTo(px, 0); c.lineTo(px, this.h); c.stroke();
      if (Math.abs(x) > step / 2) c.fillText(+x.toFixed(6) + '', px + 3, this.toPx(0, 0)[1] + 13);
    }
    for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
      const [, py] = this.toPx(0, y);
      c.beginPath(); c.moveTo(0, py); c.lineTo(this.w, py); c.stroke();
      if (Math.abs(y) > step / 2) c.fillText('j' + (+y.toFixed(6)), this.toPx(0, 0)[0] + 4, py - 3);
    }
    c.strokeStyle = '#B9BDC6'; c.lineWidth = 1.2;
    const [ox, oy] = this.toPx(0, 0);
    c.beginPath(); c.moveTo(0, oy); c.lineTo(this.w, oy); c.moveTo(ox, 0); c.lineTo(ox, this.h); c.stroke();
    c.fillStyle = '#6B7180';
    c.fillText('Re', this.w - 20, oy - 6);
    c.fillText('Im', ox + 6, 12);
  }

  // 작은 도형들 ----------------------------------------------------------
  dot(x, y, r, color, fill, stroke) {
    const c = this.ctx, [px, py] = this.toPx(x, y);
    c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = color; c.fill(); } else { c.strokeStyle = color; c.lineWidth = 2; c.stroke(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
  }
  cross(x, y, color, mult) {
    const c = this.ctx, [px, py] = this.toPx(x, y), s = 6;
    c.strokeStyle = color; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(px - s, py - s); c.lineTo(px + s, py + s); c.moveTo(px + s, py - s); c.lineTo(px - s, py + s); c.stroke();
    if (mult > 1) { c.fillStyle = color; c.font = '600 11px sans-serif'; c.fillText('×' + mult, px + 7, py - 7); }
  }
  ring(x, y, color, mult) {
    const c = this.ctx, [px, py] = this.toPx(x, y);
    c.strokeStyle = color; c.lineWidth = 2; c.fillStyle = '#fff';
    c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2); c.fill(); c.stroke();
    if (mult > 1) { c.fillStyle = color; c.font = '600 11px sans-serif'; c.fillText('×' + mult, px + 8, py - 8); }
  }
  // (x, y)에서 deg 방향으로 짧은 화살표 (화면 기준 길이 34px)
  arrow(x, y, deg, color) {
    const c = this.ctx, [px, py] = this.toPx(x, y), t = deg * Math.PI / 180, L = 34;
    const ex = px + L * Math.cos(t), ey = py - L * Math.sin(t);
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(px, py); c.lineTo(ex, ey); c.stroke();
    const h = 7, a1 = t + Math.PI * 0.85, a2 = t - Math.PI * 0.85;
    c.beginPath(); c.moveTo(ex, ey);
    c.lineTo(ex + h * Math.cos(a1), ey - h * Math.sin(a1)); c.lineTo(ex + h * Math.cos(a2), ey - h * Math.sin(a2)); c.closePath(); c.fill();
  }

  // 8단계에 들어올 때 곡선이 극점에서 뻗어 나가는 움직임 (약 1.4초)
  animateBranches() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.progress = 1; this.draw(); return; }
    const t0 = performance.now(), dur = 1400;
    const tick = (now) => {
      const u = Math.min(1, (now - t0) / dur);
      this.progress = 1 - Math.pow(1 - u, 3);     // 끝에서 부드럽게 멈추는 곡선(ease-out)
      this.draw();
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
