/*
 * graph.js — s평면 그래프와 단계별 움직임
 *
 * 단계가 바뀔 때마다 그 단계까지의 결과를 다시 그리고, 이번 단계에서 새로 생긴 것만 움직임을 줍니다.
 * 모든 점의 위치는 엔진이 계산한 값입니다(모양을 흉내 낸 그림이 아님).
 * 움직임은 브라우저 내장 기능(Web Animations)으로 만들어서, 일시정지하면 한꺼번에 멈춥니다.
 */
(function (RL) {
  'use strict';
  var C = RL.complex, F = RL.format, P = RL.poly, CT = RL.content;
  var NS = 'http://www.w3.org/2000/svg';
  var EASE = 'cubic-bezier(.22,.8,.24,1)';

  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag), k;
    if (attrs) for (k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function anim(node, frames, opts) { if (reduced() || !node.animate) return null; return node.animate(frames, opts); }
  function pop(node, delay) {
    return anim(node, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 520, delay: delay || 0, easing: EASE, fill: 'backwards' });
  }
  function fadeIn(node, delay, dur) { return anim(node, [{ opacity: 0 }, { opacity: 1 }], { duration: dur || 420, delay: delay || 0, easing: 'ease-out', fill: 'backwards' }); }
  function drawLine(node, dur, delay) {
    if (reduced() || !node.getTotalLength) return null;
    var len = node.getTotalLength();
    if (!len || !isFinite(len)) return null;
    node.style.strokeDasharray = len + ' ' + len;
    var a = node.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: dur, delay: delay || 0, easing: EASE, fill: 'backwards' });
    a.finished.then(function () { node.style.strokeDasharray = ''; }).catch(function () {});
    return a;
  }
  function niceStep(span) {
    var raw = span / 8, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  function Graph(svg, opts) {
    this.svg = svg;
    this.opts = opts || {};
    this.res = null;
    this.token = 0;
    this.k = 1;         // 화면 1px이 viewBox에서 몇 단위인지
    this.onRef = null;  // 그래프 요소를 가리킬 때 부르는 함수
    var self = this;
    svg.addEventListener('pointerover', function (e) { var t = e.target.closest ? e.target.closest('[data-ref]') : null; if (t && self.onRef) self.onRef(t.getAttribute('data-ref'), true); });
    svg.addEventListener('pointerout', function (e) { var t = e.target.closest ? e.target.closest('[data-ref]') : null; if (t && self.onRef) self.onRef(t.getAttribute('data-ref'), false); });
  }

  Graph.prototype.setProblem = function (res) { this.res = res; this.fit(); };

  // 화면 비율에 맞춰 보이는 범위를 정하고 격자를 그림
  Graph.prototype.fit = function () {
    var res = this.res;
    if (!res) return;
    var box = this.svg.getBoundingClientRect(), cw = box.width || 600, ch = box.height || 600, aspect = cw / ch;
    var v = res.view, S = v.xmax - v.xmin, cx = (v.xmin + v.xmax) / 2, cy = 0;
    var spanX = aspect >= 1 ? S * aspect : S, spanY = aspect >= 1 ? S : S / aspect;
    this.w = { xmin: cx - spanX / 2, xmax: cx + spanX / 2, ymin: cy - spanY / 2, ymax: cy + spanY / 2 };
    this.VW = aspect >= 1 ? 1000 * aspect : 1000;
    this.VH = aspect >= 1 ? 1000 : 1000 / aspect;
    this.scale = this.VW / spanX;
    this.k = this.VW / cw;
    this.svg.setAttribute('viewBox', '0 0 ' + this.VW.toFixed(1) + ' ' + this.VH.toFixed(1));
    this.svg.innerHTML = '';
    var defs = el('defs', null, this.svg);
    var clip = el('clipPath', { id: this.id('clip') }, defs);
    el('rect', { x: 0, y: 0, width: this.VW, height: this.VH }, clip);
    var kinds = ['pole', 'zero', 'dep'];
    for (var q = 0; q < kinds.length; q++) { // 화살촉은 색마다 따로 (context-stroke를 못 쓰는 브라우저 대비)
      var mk = el('marker', { id: this.id('arrow-' + kinds[q]), viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M1 1L9 5L1 9', fill: 'none', 'class': 'ah ah-' + kinds[q], 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mk);
    }
    var names = ['grid', 'region', 'axes', 'real', 'asym', 'branch', 'angle', 'key', 'pz', 'cl', 'probe', 'label'];
    this.L = {};
    for (var i = 0; i < names.length; i++) this.L[names[i]] = el('g', { 'class': 'L-' + names[i], 'clip-path': 'url(#' + this.id('clip') + ')' }, this.svg);
    this.drawGrid();
  };
  Graph.prototype.id = function (s) { if (!this._uid) this._uid = 'g' + Math.random().toString(36).slice(2, 7); return this._uid + '-' + s; };
  Graph.prototype.X = function (x) { return (x - this.w.xmin) * this.scale; };
  Graph.prototype.Y = function (y) { return (this.w.ymax - y) * this.scale; };
  Graph.prototype.px = function (n) { return n * this.k; };

  Graph.prototype.drawGrid = function () {
    var g = this.L.grid, w = this.w, st = niceStep(w.ymax - w.ymin), x, y;
    for (x = Math.ceil(w.xmin / st) * st; x <= w.xmax; x += st) el('line', { x1: this.X(x), y1: 0, x2: this.X(x), y2: this.VH, 'class': 'grid' }, g);
    for (y = Math.ceil(w.ymin / st) * st; y <= w.ymax; y += st) el('line', { x1: 0, y1: this.Y(y), x2: this.VW, y2: this.Y(y), 'class': 'grid' }, g);
    var a = this.L.axes;
    el('line', { x1: 0, y1: this.Y(0), x2: this.VW, y2: this.Y(0), 'class': 'axis' }, a);
    el('line', { x1: this.X(0), y1: 0, x2: this.X(0), y2: this.VH, 'class': 'axis' }, a);
    var fs = this.px(11);
    for (x = Math.ceil(w.xmin / st) * st; x <= w.xmax; x += st) {
      if (Math.abs(x) < st / 2) continue;
      var t = el('text', { x: this.X(x), y: this.Y(0) + this.px(15), 'class': 'tick', 'font-size': fs, 'text-anchor': 'middle' }, a);
      t.textContent = F.dec(x, 2);
    }
    for (y = Math.ceil(w.ymin / st) * st; y <= w.ymax; y += st) {
      if (Math.abs(y) < st / 2) continue;
      var t2 = el('text', { x: this.X(0) - this.px(6), y: this.Y(y) + this.px(4), 'class': 'tick', 'font-size': fs, 'text-anchor': 'end' }, a);
      t2.textContent = (y < 0 ? '−' : '') + 'j' + F.dec(Math.abs(y), 2);
    }
    var lx = el('text', { x: this.VW - this.px(10), y: this.Y(0) - this.px(8), 'class': 'axlabel', 'font-size': this.px(13), 'text-anchor': 'end' }, a);
    lx.textContent = 'σ (실수부)';
    var nearRight = this.X(0) > this.VW - this.px(110); // 허수축이 오른쪽 끝에 가까우면 글자를 왼쪽에
    var ly = el('text', { x: this.X(0) + (nearRight ? -this.px(8) : this.px(8)), y: this.px(18), 'class': 'axlabel', 'font-size': this.px(13), 'text-anchor': nearRight ? 'end' : 'start' }, a);
    ly.textContent = 'jω (허수부)';
  };

  Graph.prototype.clearDynamic = function () {
    var names = ['region', 'real', 'asym', 'branch', 'angle', 'key', 'pz', 'cl', 'probe', 'label'];
    for (var i = 0; i < names.length; i++) this.L[names[i]].innerHTML = '';
  };
  Graph.prototype.stop = function () {
    this.token++;
    if (this.svg.getAnimations) {
      var list = this.svg.getAnimations({ subtree: true });
      for (var i = 0; i < list.length; i++) list[i].cancel();
    }
  };
  // 일시정지에도 함께 멈추는 기다리기
  Graph.prototype.wait = function (ms, token) {
    var self = this;
    if (reduced()) return Promise.resolve(self.token === token);
    var a = this.L.probe.animate([{ opacity: 1 }, { opacity: 1 }], { duration: ms });
    return a.finished.then(function () { return self.token === token; }, function () { return false; });
  };

  // ── 그리는 부품 ─────────────────────────────
  Graph.prototype.poleMark = function (p, i) {
    var g = el('g', { 'class': 'mk pole', 'data-ref': 'p' + i, transform: 'translate(' + this.X(p.s.re) + ' ' + this.Y(p.s.im) + ')' }, this.L.pz);
    var r = this.px(7), inner = el('g', { 'class': 'pop' }, g);
    el('circle', { r: this.px(14), 'class': 'hit' }, inner);
    el('path', { d: 'M' + (-r) + ' ' + (-r) + 'L' + r + ' ' + r + 'M' + (-r) + ' ' + r + 'L' + r + ' ' + (-r), 'stroke-width': this.px(2.6) }, inner);
    if (p.mult > 1) { var t = el('text', { x: this.px(10), y: -this.px(9), 'font-size': this.px(12), 'class': 'mult' }, inner); t.textContent = '×' + p.mult; }
    return inner;
  };
  Graph.prototype.zeroMark = function (z, i) {
    var g = el('g', { 'class': 'mk zero', 'data-ref': 'z' + i, transform: 'translate(' + this.X(z.s.re) + ' ' + this.Y(z.s.im) + ')' }, this.L.pz);
    var inner = el('g', { 'class': 'pop' }, g);
    el('circle', { r: this.px(14), 'class': 'hit' }, inner);
    el('circle', { r: this.px(6.5), 'stroke-width': this.px(2.4), 'class': 'ring' }, inner);
    if (z.mult > 1) { var t = el('text', { x: this.px(10), y: -this.px(9), 'font-size': this.px(12), 'class': 'mult' }, inner); t.textContent = '×' + z.mult; }
    return inner;
  };
  Graph.prototype.dot = function (x, y, cls, ref, r, layer) {
    var g = el('g', { 'class': 'mk ' + cls, 'data-ref': ref || null, transform: 'translate(' + this.X(x) + ' ' + this.Y(y) + ')' }, layer || this.L.key);
    var inner = el('g', { 'class': 'pop' }, g);
    el('circle', { r: this.px(13), 'class': 'hit' }, inner);
    el('circle', { r: this.px(r || 5.5), 'class': 'core' }, inner);
    return inner;
  };
  Graph.prototype.label = function (x, y, text, cls, dx, dy, anchor) {
    var t = el('text', { x: this.X(x) + this.px(dx || 0), y: this.Y(y) + this.px(dy || 0), 'font-size': this.px(12.5), 'class': 'lbl ' + (cls || ''), 'text-anchor': anchor || 'start' }, this.L.label);
    t.textContent = text;
    return t;
  };
  Graph.prototype.segment = function (iv, ref) {
    var w = this.w, lo = Math.max(iv.lo, w.xmin - 1), hi = Math.min(iv.hi, w.xmax + 1);
    return el('line', { x1: this.X(lo), y1: this.Y(0), x2: this.X(hi), y2: this.Y(0), 'class': 'seg', 'data-ref': ref, 'stroke-width': this.px(6) }, this.L.real);
  };
  Graph.prototype.inBox = function (re, im, pad) {
    var w = this.w, S = (w.xmax - w.xmin) * (pad || 0.6);
    return re > w.xmin - S && re < w.xmax + S && im > w.ymin - S && im < w.ymax + S;
  };
  Graph.prototype.branchPath = function (b) {
    var last = -1, i, d = '';
    for (i = 0; i < b.length; i++) if (this.inBox(b[i].re, b[i].im)) last = i;
    var end = Math.min(b.length - 1, last + 1);
    for (i = 0; i <= end; i++) d += (i ? 'L' : 'M') + this.X(b[i].re).toFixed(2) + ' ' + this.Y(b[i].im).toFixed(2);
    return d;
  };
  Graph.prototype.arrowOn = function (path, frac) {
    var len = path.getTotalLength ? path.getTotalLength() : 0;
    if (!len) return null;
    var a = path.getPointAtLength(len * frac), b = path.getPointAtLength(Math.min(len, len * frac + this.px(4)));
    var ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, s = this.px(6);
    return el('path', { d: 'M' + (-s) + ' ' + (-s * 0.8) + 'L' + s + ' 0L' + (-s) + ' ' + (s * 0.8) + 'Z', transform: 'translate(' + a.x + ' ' + a.y + ') rotate(' + ang + ')', 'class': 'chev' }, this.L.branch);
  };

  // ── 단계별 장면 ─────────────────────────────
  // animate: 이번 단계 부분만 움직임. 반환값: 움직임이 끝날 때 이행되는 Promise
  Graph.prototype.show = function (step, animate) {
    this.stop();
    this.clearDynamic();
    var token = this.token, res = this.res, self = this, i, j, delay = 0, seq = Promise.resolve();
    var now = function (n) { return animate && step === n; };
    if (!res) return seq;

    // 2단계부터: 극점·영점
    if (step >= 2) {
      for (i = 0; i < res.poles.length; i++) { var pm = this.poleMark(res.poles[i], i); if (now(2)) pop(pm, delay += 260); }
      for (i = 0; i < res.zeros.length; i++) { var zm = this.zeroMark(res.zeros[i], i); if (now(2)) pop(zm, delay += 260); }
      if (now(2)) {
        for (i = 0; i < res.poles.length; i++) if (res.poles[i].s.im >= 0) fadeIn(this.label(res.poles[i].s.re, res.poles[i].s.im, 'K = 0 출발', 'pole', 10, -12), delay + 300);
        for (i = 0; i < res.zeros.length; i++) if (res.zeros[i].s.im >= 0) fadeIn(this.label(res.zeros[i].s.re, res.zeros[i].s.im, 'K → ∞ 도착', 'zero', 10, 20), delay + 400);
      }
    }
    // 3단계부터: 실수축 구간
    var ivs = res.realAxis.intervals;
    if (step >= 3 && !now(3)) for (i = 0; i < ivs.length; i++) if (ivs[i].onLocus) this.segment(ivs[i], 'r' + i);
    if (now(3)) seq = this.probeSequence(token);
    // 4단계부터: 점근선
    var A = res.asymptotes;
    if (step >= 4 && A) {
      var R = (this.w.xmax - this.w.xmin) * 3, d0 = now(4) ? 500 : 0;
      for (i = 0; i < A.angles.length; i++) {
        var t = A.angles[i] * Math.PI / 180;
        var ln = el('line', { x1: this.X(A.centroid), y1: this.Y(0), x2: this.X(A.centroid + R * Math.cos(t)), y2: this.Y(R * Math.sin(t)), 'class': 'asym', 'data-ref': 'c', 'stroke-width': this.px(1.6), 'stroke-dasharray': this.px(7) + ' ' + this.px(6) }, this.L.asym);
        if (now(4)) { ln.removeAttribute('stroke-dasharray'); this.dashAfter(ln, drawLine(ln, 900, d0 + i * 420)); }
        if (now(4)) {
          var lx = A.centroid + (this.w.xmax - this.w.xmin) * 0.16 * Math.cos(t), ly = (this.w.xmax - this.w.xmin) * 0.16 * Math.sin(t);
          fadeIn(this.label(lx, ly, F.deg(A.angles[i] > 180 ? A.angles[i] - 360 : A.angles[i]), 'asym', 6, ly >= 0 ? -6 : 16), d0 + i * 420 + 500);
        }
      }
      // 점근선이 1개면 실수축과 겹치므로 중심을 출발점처럼 표시하지 않는다.
      if (A.q > 1) {
        var cm = this.dot(A.centroid, 0, 'cen', 'c', 5, this.L.key);
        if (now(4)) { pop(cm, 150); fadeIn(this.label(A.centroid, 0, 'σ = ' + F.numShort(A.centroid), 'asym', 0, -14, 'middle'), 300); }
      }
    }
    // 5단계부터: 이탈점·진입점
    var vb = CT.validBreaks(res);
    if (step >= 5) {
      var cands = res.breaks.candidates, k = 0;
      for (i = 0; i < cands.length; i++) {
        var c = cands[i], valid = ['breakaway', 'breakin', 'multiple', 'complexBreak'].indexOf(c.status) >= 0;
        if (c.status === 'start') continue;
        var ref = valid ? 'b' + (k++) : null; // content.js의 b0, b1… 번호와 맞춤
        if (!valid && step !== 5) continue;
        if (!this.inBox(c.s.re, c.s.im, 0)) continue;
        var ys = c.s.im ? [c.s.im, -c.s.im] : [0];
        for (j = 0; j < ys.length; j++) {
          var dm = this.dot(c.s.re, ys[j], valid ? 'brk' : 'rej', ref, valid ? 6 : 4.5);
          if (now(5)) pop(dm, 300 + i * 380);
          if (now(5) && j === 0) {
            var txt = valid ? CT.breakLabel(c) : (c.status === 'negativeK' ? 'K < 0 ✗' : 'K 복소수 ✗');
            fadeIn(this.label(c.s.re, ys[j], txt, valid ? 'key' : 'rej', 0, valid ? -14 : 18, 'middle'), 500 + i * 380);
          }
        }
      }
    }
    // 6단계: 출발각 벡터 / 6단계 이후: 출발 방향 화살표
    if (step >= 6) for (i = 0; i < res.angles.length; i++) this.angleItem(res.angles[i], i, now(6), now(6) ? 400 + i * 2200 : 0, step === 6);
    // 7단계부터: 불안정 영역, 허수축 교차
    if (step >= 7) {
      var rg = el('rect', { x: this.X(0), y: 0, width: Math.max(0, this.VW - this.X(0)), height: this.VH, 'class': 'rhp' }, this.L.region);
      var rl = el('text', { x: this.VW - this.px(12), y: this.VH - this.px(14), 'class': 'rhplbl', 'font-size': this.px(12), 'text-anchor': 'end' }, this.L.region);
      rl.textContent = '불안정 영역 (Re s > 0)';
      if (now(7)) { fadeIn(rg, 200, 700); fadeIn(rl, 400); }
      var cp = CT.crossingsPos(res);
      for (i = 0; i < cp.length; i++) {
        var cc = cp[i].c;
        for (j = 0; j < 2; j++) {
          var xm = this.dot(0, j ? -cc.omega : cc.omega, 'crs', 'x' + i, 6);
          if (now(7)) pop(xm, 900 + i * 300);
        }
        var cl = this.label(0, cc.omega, '±j' + F.numShort(cc.omega) + ' (K = ' + F.numShort(cc.K) + ')', 'key', 10, -10);
        if (now(7)) fadeIn(cl, 1100);
      }
    }
    // 8단계부터: 가지
    if (step >= 8 && res.branches) {
      var paths = [];
      for (i = 0; i < res.branches.length; i++) {
        var pth = el('path', { d: this.branchPath(res.branches[i]), 'class': 'branch' + (step === 9 ? ' dim' : ''), 'stroke-width': this.px(2.6) }, this.L.branch);
        paths.push(pth);
        if (now(8)) drawLine(pth, 2200, 200);
      }
      var arrows = function () { if (self.token !== token) return; for (var q = 0; q < paths.length; q++) { var ar = self.arrowOn(paths[q], 0.34); if (ar && now(8)) fadeIn(ar, 0, 300); } };
      if (now(8)) seq = this.wait(2400, token).then(function (ok) { if (ok) arrows(); return ok; }); else arrows();
    }
    // 9단계: 폐루프 극점
    if (step >= 9) this.initCL();
    return seq;
  };

  // 점근선은 다 그려진 뒤 점선으로 바꿈
  Graph.prototype.dashAfter = function (ln, a) {
    var self = this, dash = this.px(7) + ' ' + this.px(6);
    if (!a) { ln.setAttribute('stroke-dasharray', dash); return; }
    a.finished.then(function () { ln.style.strokeDasharray = ''; ln.setAttribute('stroke-dasharray', dash); }).catch(function () {});
  };

  // 3단계: 시험점이 오른쪽 구간부터 왼쪽으로 이동하며 개수를 셈
  Graph.prototype.probeSequence = function (token) {
    var self = this, res = this.res, ivs = res.realAxis.intervals, w = this.w, span = w.xmax - w.xmin;
    var probe = el('g', { 'class': 'probe' }, this.L.probe);
    el('line', { x1: 0, y1: -this.px(16), x2: 0, y2: this.px(16), 'stroke-width': this.px(1.6) }, probe);
    el('circle', { r: this.px(5), 'class': 'pc' }, probe);
    var bubble = el('text', { y: -this.px(24), 'font-size': this.px(13), 'text-anchor': 'middle', 'class': 'pt' }, probe);
    var marks = this.L.pz.querySelectorAll('.mk');
    function place(x) { probe.setAttribute('transform', 'translate(' + self.X(x) + ' ' + self.Y(0) + ')'); }
    function mark(x) {
      for (var m = 0; m < marks.length; m++) {
        var ref = marks[m].getAttribute('data-ref'), idx = +ref.slice(1), item = ref.charAt(0) === 'p' ? res.poles[idx] : res.zeros[idx];
        var on = item.s.im === 0 && item.s.re > x;
        marks[m].classList.toggle('counted', on);
      }
    }
    var i = 0;
    function next() {
      if (self.token !== token) return Promise.resolve(false);
      if (i >= ivs.length) {
        mark(Infinity);
        var f = anim(probe, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
        return f ? f.finished.then(function () { return true; }, function () { return false; }) : Promise.resolve(true);
      }
      var iv = ivs[i], x;
      if (iv.hi === Infinity && iv.lo === -Infinity) x = w.xmin + span * 0.7;
      else if (iv.hi === Infinity) x = Math.min(iv.lo + span * 0.08, w.xmax - span * 0.05);
      else if (iv.lo === -Infinity) x = Math.max(iv.hi - span * 0.08, w.xmin + span * 0.05);
      else x = (iv.lo + iv.hi) / 2;
      var from = probe.__x === undefined ? x : probe.__x;
      probe.__x = x;
      var mv = anim(probe, [{ transform: 'translate(' + self.X(from) + 'px,' + self.Y(0) + 'px)' }, { transform: 'translate(' + self.X(x) + 'px,' + self.Y(0) + 'px)' }], { duration: 650, easing: EASE });
      place(x);
      var go = mv ? mv.finished : Promise.resolve();
      return go.then(function () {
        if (self.token !== token) return false;
        mark(x);
        bubble.textContent = '오른쪽 ' + iv.rightCount + '개 · ' + (iv.rightCount % 2 ? '홀수 ✓' : '짝수');
        bubble.setAttribute('class', 'pt ' + (iv.onLocus ? 'yes' : 'no'));
        if (iv.onLocus) drawLine(self.segment(iv, 'r' + i), 600, 150);
        i++;
        return self.wait(1150, token).then(function (ok) { return ok ? next() : false; });
      }, function () { return false; });
    }
    return this.wait(500, token).then(function (ok) { return ok ? next() : false; });
  };

  // 6단계: 다른 극점·영점에서 그 점까지 벡터, 각, 출발 방향
  Graph.prototype.angleItem = function (it, idx, animate, d0, showVectors) {
    var self = this, tx = this.X(it.at.re), ty = this.Y(it.at.im), list = [], j;
    for (j = 0; j < it.plus.length; j++) list.push({ t: it.plus[j], cls: it.kind === 'departure' ? 'zero' : 'pole' });
    for (j = 0; j < it.minus.length; j++) list.push({ t: it.minus[j], cls: it.kind === 'departure' ? 'pole' : 'zero' });
    if (showVectors) {
      for (j = 0; j < list.length; j++) {
        var t = list[j].t, fx = this.X(t.from.re), fy = this.Y(t.from.im), dl = d0 + j * 520;
        var ln = el('line', { x1: fx, y1: fy, x2: tx, y2: ty, 'class': 'vec ' + list[j].cls, 'stroke-width': this.px(1.6), 'marker-end': 'url(#' + this.id('arrow-' + list[j].cls) + ')' }, this.L.angle);
        if (animate) drawLine(ln, 480, dl);
        var r = this.px(22), a0 = 0, a1 = -t.angle * Math.PI / 180;
        var large = Math.abs(t.angle) > 180 ? 1 : 0, sweep = t.angle > 0 ? 0 : 1;
        var arc = el('path', { d: 'M' + (fx + r) + ' ' + fy + 'A' + r + ' ' + r + ' 0 ' + large + ' ' + sweep + ' ' + (fx + r * Math.cos(a1)) + ' ' + (fy + r * Math.sin(a1)), 'class': 'arc ' + list[j].cls, 'stroke-width': this.px(1.4) }, this.L.angle);
        var mid = -t.angle * Math.PI / 360;
        var lb = el('text', { x: fx + (r + this.px(14)) * Math.cos(mid), y: fy + (r + this.px(14)) * Math.sin(mid) + this.px(4), 'font-size': this.px(11.5), 'class': 'lbl ' + list[j].cls, 'text-anchor': 'middle' }, this.L.angle);
        lb.textContent = F.deg(t.angle);
        if (animate) { fadeIn(arc, dl + 380); fadeIn(lb, dl + 420); }
        void a0;
      }
    }
    // 출발(도착) 방향 화살표: 위쪽 점과 아래쪽 켤레
    var L = this.px(46), ends = [];
    for (j = 0; j < it.angles.length; j++) ends.push({ a: it.angles[j], y: 1 });
    if (it.at.im > 0) for (j = 0; j < it.angles.length; j++) ends.push({ a: -it.angles[j], y: -1 });
    for (j = 0; j < ends.length; j++) {
      var ay = ends[j].y > 0 ? ty : this.Y(-it.at.im), ang = ends[j].a * Math.PI / 180;
      var dirSign = it.kind === 'departure' ? 1 : -1;
      var x2 = tx + L * Math.cos(ang), y2 = ay - L * Math.sin(ang);
      var ar = el('line', it.kind === 'departure'
        ? { x1: tx, y1: ay, x2: x2, y2: y2 }
        : { x1: x2, y1: y2, x2: tx, y2: ay }, this.L.angle);
      ar.setAttribute('class', 'dep');
      ar.setAttribute('data-ref', 'a' + idx);
      ar.setAttribute('stroke-width', this.px(3));
      ar.setAttribute('marker-end', 'url(#' + this.id('arrow-dep') + ')');
      void dirSign;
      if (animate) drawLine(ar, 500, d0 + list.length * 520 + 200);
      if (j === 0 && showVectors) {
        var tl = el('text', { x: x2 + this.px(6), y: y2 - this.px(6), 'font-size': this.px(13), 'class': 'lbl angle' }, this.L.angle);
        tl.textContent = 'θ = ' + F.deg(ends[j].a);
        if (animate) fadeIn(tl, d0 + list.length * 520 + 600);
      }
    }
  };

  // 9단계: 폐루프 극점 표시 준비
  Graph.prototype.initCL = function () {
    var res = this.res;
    this.cl = [];
    this.trails = [];
    this.zeta = el('g', { 'class': 'zeta' }, this.L.cl);
    for (var i = 0; i < res.n; i++) {
      this.trails.push({ pts: [], el: el('polyline', { 'class': 'trail', 'stroke-width': this.px(3) }, this.L.cl) });
      var g = el('g', { 'class': 'mk clp' }, this.L.cl);
      el('circle', { r: this.px(12), 'class': 'glow' }, g);
      el('circle', { r: this.px(6), 'class': 'core' }, g);
      this.cl.push(g);
    }
    this.clPos = null;
  };
  // K를 바꾸면 폐루프 극점을 다시 계산해서 옮김
  Graph.prototype.setK = function (K, resetTrail) {
    if (!this.cl) return null;
    var rs = RL.routh.closedLoopPoles(this.res.N, this.res.D, K), n = rs.length, order = [], i;
    if (this.clPos && this.clPos.length === n) {
      var used = [];
      for (i = 0; i < n; i++) used.push(false);
      for (i = 0; i < n; i++) {
        var best = -1, bd = Infinity;
        for (var j = 0; j < n; j++) { if (used[j]) continue; var d = C.dist(this.clPos[i], rs[j]); if (d < bd) { bd = d; best = j; } }
        used[best] = true; order.push(rs[best]);
      }
      rs = order;
    }
    // 화면 폭·높이의 4%보다 크게 건너뛴 점은 직선 잔상으로 잇지 않는다.
    if (this.clPos && this.clPos.length === n) {
      var jumpLimit = 0.04 * Math.hypot(this.w.xmax - this.w.xmin, this.w.ymax - this.w.ymin);
      for (i = 0; i < n; i++) if (C.dist(this.clPos[i], rs[i]) > jumpLimit) resetTrail = true;
    }
    if (resetTrail) {
      for (i = 0; i < this.trails.length; i++) {
        this.trails[i].pts = [];
        this.trails[i].el.setAttribute('points', '');
      }
    }
    this.clPos = rs;
    for (i = 0; i < n; i++) {
      var x = this.X(rs[i].re), y = this.Y(rs[i].im), tr = this.trails[i];
      this.cl[i].setAttribute('transform', 'translate(' + x + ' ' + y + ')');
      tr.pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      if (tr.pts.length > 18) tr.pts.shift();
      tr.el.setAttribute('points', tr.pts.join(' '));
    }
    // 주된 복소 극점 쌍의 ωn 원과 감쇠비
    this.zeta.innerHTML = '';
    var dom = null;
    for (i = 0; i < n; i++) if (rs[i].im > 1e-9 && (!dom || rs[i].re > dom.re)) dom = rs[i];
    var info = null;
    if (dom) {
      var wn = C.abs(dom), zeta = -dom.re / wn, r = wn * this.scale;
      el('path', { d: 'M' + this.X(0) + ' ' + (this.Y(0) - r) + 'A' + r + ' ' + r + ' 0 0 0 ' + this.X(0) + ' ' + (this.Y(0) + r), 'class': 'wn', 'stroke-width': this.px(1.2), 'stroke-dasharray': this.px(4) + ' ' + this.px(4) }, this.zeta);
      el('line', { x1: this.X(0), y1: this.Y(0), x2: this.X(dom.re), y2: this.Y(dom.im), 'class': 'wn', 'stroke-width': this.px(1.2) }, this.zeta);
      info = { zeta: zeta, wn: wn };
    }
    return { poles: rs, info: info };
  };

  // 5단계 보조 그래프: 실수축 위의 K(σ) = −D(σ)/N(σ) (언덕 꼭대기 = 이탈점, 골짜기 바닥 = 진입점)
  function kChart(container, res, view) {
    var vb = CT.validBreaks(res), real = [], i;
    for (i = 0; i < vb.length; i++) if (vb[i].c.s.im === 0) real.push(vb[i].c);
    if (!real.length) return false;
    var segs = CT.onSegments(res), W = 640, H = 220, padL = 46, padB = 30, padT = 18;
    var x0 = view.xmin, x1 = view.xmax, pts = [], kmax = 0;
    for (i = 0; i < real.length; i++) kmax = Math.max(kmax, real[i].K);
    var ycap = kmax * 1.8;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'kchart', role: 'img', 'aria-label': '실수축 위 K(σ) 그래프' });
    function X(x) { return padL + (x - x0) / (x1 - x0) * (W - padL - 10); }
    function Y(k) { return H - padB - Math.min(k, ycap) / ycap * (H - padB - padT); }
    el('line', { x1: padL, y1: H - padB, x2: W - 10, y2: H - padB, 'class': 'axis' }, svg);
    el('line', { x1: padL, y1: padT, x2: padL, y2: H - padB, 'class': 'axis' }, svg);
    for (var s = 0; s < segs.length; s++) {
      var lo = Math.max(segs[s].lo, x0), hi = Math.min(segs[s].hi, x1), d = '', N = 220, started = false;
      for (i = 0; i <= N; i++) {
        var x = lo + (hi - lo) * i / N, nv = P.evalReal(res.N, x);
        if (Math.abs(nv) < 1e-12) continue;
        var k = -P.evalReal(res.D, x) / nv;
        if (!(k >= 0)) { started = false; continue; }
        d += (started ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(k).toFixed(1);
        started = true;
      }
      if (d) el('path', { d: d, 'class': 'kc' }, svg);
      el('line', { x1: X(lo), y1: H - padB, x2: X(hi), y2: H - padB, 'class': 'kseg' }, svg);
    }
    for (i = 0; i < real.length; i++) {
      var c = real[i], cx = X(c.s.re), cy = Y(c.K);
      el('line', { x1: cx, y1: cy, x2: cx, y2: H - padB, 'class': 'kguide' }, svg);
      el('circle', { cx: cx, cy: cy, r: 5, 'class': 'kpt' }, svg);
      var t = el('text', { x: cx, y: cy - 10, 'text-anchor': 'middle', 'class': 'klbl' }, svg);
      t.textContent = (c.status === 'breakaway' ? '이탈점 (언덕 꼭대기)' : c.status === 'breakin' ? '진입점 (골짜기 바닥)' : CT.breakLabel(c)) + ' K = ' + F.numShort(c.K);
      var tx = el('text', { x: cx, y: H - padB + 18, 'text-anchor': 'middle', 'class': 'ktick' }, svg);
      tx.textContent = F.numShort(c.s.re);
    }
    var yl = el('text', { x: padL - 8, y: padT + 4, 'text-anchor': 'end', 'class': 'ktick' }, svg); yl.textContent = 'K';
    var xl = el('text', { x: W - 12, y: H - padB - 8, 'text-anchor': 'end', 'class': 'ktick' }, svg); xl.textContent = 'σ (실수축)';
    container.appendChild(svg);
    return true;
  }

  RL.Graph = Graph;
  RL.kChart = kChart;
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));

