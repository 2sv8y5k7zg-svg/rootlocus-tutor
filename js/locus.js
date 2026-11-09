/*
 * locus.js — 근궤적 분석의 중심
 *
 * 입력: 개루프 전달함수 G(s)H(s) = K · N(s) / D(s)   (N, D는 내림차순 계수 배열)
 * 조건: 연속시간, 음의 피드백, K ≥ 0
 *
 * 수업에서 푼 순서 그대로 결과를 만듭니다.
 *   1 특성방정식 → 2 극점·영점·가지 수 → 3 실수축 구간 → 4 점근선
 *   → 5 이탈점·진입점 → 6 출발각·도착각 → 7 Routh 표·허수축 교차 → 8 근궤적 완성 → 9 K 변화
 *
 * 모든 숫자는 여기서 계산하고, AI는 이 결과만 참고합니다.
 */
(function (RL) {
  'use strict';
  var P = RL.poly, C = RL.complex, F = RL.format, R = RL.routh;
  var MAX_ORDER = 4;
  var RAD = 180 / Math.PI;

  function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
  function normDeg(a) { a = ((a % 360) + 360) % 360; return a > 180 + 1e-9 ? a - 360 : a; } // (−180°, 180°]
  function angDeg(z) { return Math.atan2(z.im, z.re) * RAD; }

  // ── 3 실수축 구간: 시험점 오른쪽의 실수 극점·영점 개수가 홀수면 근궤적 ──
  function realAxis(poles, zeros) {
    var pts = [];
    poles.forEach(function (p) { if (p.s.im === 0) pts.push({ x: p.s.re, mult: p.mult, type: 'pole' }); });
    zeros.forEach(function (z) { if (z.s.im === 0) pts.push({ x: z.s.re, mult: z.mult, type: 'zero' }); });
    pts.sort(function (a, b) { return b.x - a.x; });
    var intervals = [], count = 0, i;
    for (i = 0; i <= pts.length; i++) {
      var hi = i === 0 ? null : pts[i - 1], lo = i < pts.length ? pts[i] : null;
      intervals.push({
        hi: hi ? hi.x : Infinity, lo: lo ? lo.x : -Infinity,
        hiType: hi ? hi.type : 'inf', loType: lo ? lo.type : 'inf',
        rightCount: count, onLocus: count % 2 === 1
      });
      if (i < pts.length) count += pts[i].mult;
    }
    return { points: pts, intervals: intervals };
  }
  function onRealLocus(ra, x) {
    return ra.intervals.some(function (iv) { return iv.onLocus && x <= iv.hi + 1e-9 && x >= iv.lo - 1e-9; });
  }

  // ── 4 점근선 ──
  function asymptotes(N, D) {
    var n = D.length - 1, m = N.length - 1, q = n - m;
    if (q <= 0) return null;
    var sumP = -D[1] / D[0], sumZ = m >= 1 ? -N[1] / N[0] : 0, angles = [], k;
    for (k = 0; k < q; k++) angles.push((2 * k + 1) * 180 / q);
    return { q: q, sumPoles: sumP, sumZeros: sumZ, centroid: (sumP - sumZ) / q, angles: angles };
  }

  // ── 5 이탈점·진입점: D′N − DN′ = 0의 근 중 K = −D/N 이 0보다 큰 것 ──
  function breakPoints(N, D, ra) {
    var B = P.sub(P.mul(P.deriv(D), N), P.mul(D, P.deriv(N))), out = [];
    if (P.degree(B) < 1) return { B: B, candidates: out };
    var dB = P.deriv(B);
    P.groupedRoots(B).forEach(function (g) {
      if (g.s.im < 0) return; // 켤레쌍은 위쪽 하나로 대표
      var Ns = P.evalC(N, g.s);
      if (C.abs(Ns) < 1e-12) return;
      var Kc = C.scale(C.div(P.evalC(D, g.s), Ns), -1), mag = Math.max(1, C.abs(Kc));
      var cand = { s: g.s, mult: g.mult, K: Kc, conjugate: g.s.im !== 0 };
      if (Math.abs(Kc.im) > 1e-7 * mag) cand.status = 'complexK';
      else {
        var K0 = Kc.re;
        cand.K = K0;
        if (Math.abs(K0) < 1e-9 * mag) cand.status = 'start';
        else if (K0 < 0) cand.status = 'negativeK';
        else if (g.s.im !== 0) cand.status = 'complexBreak';
        else if (g.mult >= 2) { cand.status = 'multiple'; cand.meeting = g.mult + 1; }
        else {
          // K(σ)의 굽은 방향: K″ = −B′/N². 음수면 언덕 꼭대기(이탈점), 양수면 골짜기 바닥(진입점)
          var Kpp = -P.evalReal(dB, g.s.re) / Math.pow(P.evalReal(N, g.s.re), 2);
          cand.status = Kpp < 0 ? 'breakaway' : 'breakin';
          cand.Kpp = Kpp;
        }
        if (g.s.im === 0 && K0 > 0) cand.onRealLocus = onRealLocus(ra, g.s.re);
      }
      out.push(cand);
    });
    out.sort(function (a, b) { return b.s.re - a.s.re; });
    return { B: B, candidates: out };
  }

  // ── 6 출발각·도착각: θ = 180° + Σ(영점에서 온 각) − Σ(다른 극점에서 온 각) ──
  function angleItems(poles, zeros) {
    var items = [];
    function build(kind, at, mult, plusSet, minusSet) {
      var plus = [], minus = [];
      plusSet.forEach(function (e) {
        var v = C.sub(at.s, e.s); plus.push({ from: e.s, mult: e.mult, dx: v.re, dy: v.im, angle: angDeg(v) });
      });
      minusSet.forEach(function (e) {
        if (e === at) return;
        var v = C.sub(at.s, e.s); minus.push({ from: e.s, mult: e.mult, dx: v.re, dy: v.im, angle: angDeg(v) });
      });
      var sp = plus.reduce(function (s, t) { return s + t.angle * t.mult; }, 0);
      var sm = minus.reduce(function (s, t) { return s + t.angle * t.mult; }, 0);
      var base = 180 + sp - sm, angs = [], k;
      for (k = 0; k < mult; k++) angs.push(normDeg((base + 360 * k) / mult));
      angs.sort(function (a, b) { return b - a; });
      items.push({ kind: kind, at: at.s, mult: mult, plus: plus, minus: minus, sumPlus: sp, sumMinus: sm, base: base, angles: angs });
    }
    poles.forEach(function (p) {
      if (p.s.im > 0 || (p.s.im === 0 && p.mult >= 2)) build('departure', p, p.mult, zeros, poles);
    });
    zeros.forEach(function (z) {
      if (z.s.im > 0 || (z.s.im === 0 && z.mult >= 2)) build('arrival', z, z.mult, poles, zeros);
    });
    return items;
  }

  // ── 그래프 범위: 극점·영점·점근선 중심·이탈점·교차점이 모두 보이게 ──
  function viewBox(res) {
    var xs = [0], ys = [0];
    function addPt(z) { xs.push(z.re); ys.push(z.im); ys.push(-z.im); }
    res.poles.forEach(function (p) { addPt(p.s); });
    res.zeros.forEach(function (z) { addPt(z.s); });
    if (res.asymptotes) xs.push(res.asymptotes.centroid);
    res.breaks.candidates.forEach(function (b) { if (b.status === 'breakaway' || b.status === 'breakin' || b.status === 'multiple' || b.status === 'complexBreak') addPt(b.s); });
    res.stability.crossings.forEach(function (c) { ys.push(c.omega); ys.push(-c.omega); });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs), ymax = Math.max.apply(null, ys.map(Math.abs));
    var span = Math.max(xmax - xmin, 2 * ymax, 2), cx = (xmin + xmax) / 2;
    span *= 1.5;
    return { xmin: cx - span / 2, xmax: cx + span / 2, ymin: -span / 2, ymax: span / 2 };
  }

  // ── 8·9 가지 계산: K를 0부터 키우며 폐루프 극점을 구하고, 가까운 것끼리 이어 가지를 만듭니다 ──
  var permCache = {};
  function perms(n) {
    if (permCache[n]) return permCache[n];
    var out = [];
    (function rec(arr, k) {
      if (k === arr.length) { out.push(arr.slice()); return; }
      for (var i = k; i < arr.length; i++) {
        var t = arr[k]; arr[k] = arr[i]; arr[i] = t;
        rec(arr, k + 1);
        t = arr[k]; arr[k] = arr[i]; arr[i] = t;
      }
    })(Array.from({ length: n }, function (_, i) { return i; }), 0);
    permCache[n] = out;
    return out;
  }
  // 이전 근들과 새 근들의 짝을, 이동 거리 합이 가장 작게 되도록 정합니다 (4차면 24가지 모두 비교)
  function match(prev, next) {
    var best = null, bestCost = Infinity;
    perms(prev.length).forEach(function (pm) {
      var cost = 0;
      for (var i = 0; i < pm.length && cost < bestCost; i++) cost += C.dist(prev[i], next[pm[i]]);
      if (cost < bestCost) { bestCost = cost; best = pm; }
    });
    return best.map(function (j) { return next[j]; });
  }

  function computeBranches(N, D, view, notableK, q) {
    var n = D.length - 1, span = Math.hypot(view.xmax - view.xmin, view.ymax - view.ymin), maxStep = 0.006 * span;
    var center = C.c((view.xmin + view.xmax) / 2, 0), farR = 1.2 * span;
    var pos = notableK.filter(function (k) { return k > 0 && isFinite(k); }).sort(function (a, b) { return a - b; });
    var Kref = pos.length ? Math.sqrt(pos[0] * pos[pos.length - 1]) : Math.max(1e-3, C.abs(P.evalC(D, C.c(span, 0))) / Math.max(1e-9, C.abs(P.evalC(N, C.c(span, 0)))));
    var Kmax = Kref * 1e4, i, guard = 0;
    function poles(K) { return P.roots(P.add(D, P.scale(N, K))); }
    while (q > 0 && guard++ < 40) { // 무한대로 가는 가지가 화면 밖으로 충분히 나갈 때까지 K를 키움
      var far = poles(Kmax).filter(function (z) { return C.dist(z, center) > farR; }).length;
      if (far >= q) break;
      Kmax *= 10;
    }
    var grid = [0], M = 160;
    for (i = 0; i <= M; i++) grid.push(Kref * Math.pow(10, -6 + (Math.log10(Kmax / Kref) + 6) * i / M));
    pos.forEach(function (k) { if (k < Kmax) grid.push(k); });
    grid.sort(function (a, b) { return a - b; });

    var branches = [], cur = P.roots(D);
    for (i = 0; i < n; i++) branches.push([{ K: 0, re: cur[i].re, im: cur[i].im }]);
    function push(K, rs) { rs.forEach(function (z, b) { branches[b].push({ K: K, re: z.re, im: z.im }); }); }
    var budget = 30000; // 점 개수 상한 (휴대폰에서도 부드럽게 그리기 위해)
    function step(K0, r0, K1, depth) {
      var r1 = match(r0, poles(K1)), md = 0;
      // 화면 근처에 있는 가지만 따져서 간격을 좁힙니다 (멀리 간 가지는 화면에 안 보이므로)
      for (var b = 0; b < n; b++) {
        if (C.dist(r0[b], center) < farR || C.dist(r1[b], center) < farR) md = Math.max(md, C.dist(r0[b], r1[b]));
      }
      if (md > maxStep && depth < 18 && budget > 0) {
        budget--;
        var Km = K0 > 0 ? Math.sqrt(K0 * K1) : K1 / 2;
        var rm = step(K0, r0, Km, depth + 1);
        return step(Km, rm, K1, depth + 1);
      }
      push(K1, r1);
      return r1;
    }
    for (i = 1; i < grid.length; i++) if (grid[i] > grid[i - 1] * (1 + 1e-12)) cur = step(grid[i - 1], cur, grid[i], 0);
    return { branches: branches, Kmax: Kmax };
  }

  // ── 전체 분석 ──
  function analyze(Nin, Din, opts) {
    opts = opts || {};
    var N = P.trim(Nin), D = P.trim(Din);
    if (P.isZero(D)) return fail('zeroDen', '분모가 0입니다. 식을 다시 확인해 주세요.');
    if (P.isZero(N)) return fail('zeroNum', '분자가 0이라 근궤적이 생기지 않습니다.');
    var n = D.length - 1, m = N.length - 1;
    if (n < 1) return fail('noPole', '분모에 s가 없어 극점이 없습니다. 근궤적을 그릴 수 없습니다.');
    if (m > n) return fail('improper', '분자 차수(' + m + '차)가 분모 차수(' + n + '차)보다 높습니다. 이런 식은 지원하지 않습니다.');
    if (n > MAX_ORDER) return fail('order', '분모가 ' + n + '차입니다. 1차 버전은 분모 ' + MAX_ORDER + '차까지만 지원합니다.');
    if (N[0] * D[0] < 0) return fail('negativeGain', '분자와 분모의 최고차항 부호가 달라서, K ≥ 0으로 두면 실제로는 음의 이득이 됩니다. 이 경우(K ≤ 0 근궤적)는 아직 지원하지 않습니다.');

    var poles = P.groupedRoots(D), zeros = m > 0 ? P.groupedRoots(N) : [], i, j;
    for (i = 0; i < poles.length; i++) for (j = 0; j < zeros.length; j++) {
      if (C.dist(poles[i].s, zeros[j].s) < 1e-6 * Math.max(1, C.abs(poles[i].s))) {
        return fail('cancel', '극점과 영점이 s = ' + F.cnum(poles[i].s) + '에서 겹쳐 서로 지워집니다(상쇄). 상쇄된 극점은 폐루프에도 남을 수 있어서, 지금 버전에서는 계산하지 않습니다. 약분한 식으로 다시 입력하거나 문제 조건을 확인해 주세요.');
      }
    }

    var res = { ok: true, N: N, D: D, n: n, m: m, poles: poles, zeros: zeros };
    res.charCoef = R.charCoefficients(N, D);                // 1 특성방정식
    res.branchCount = n;                                     // 2 가지 수
    res.toZeros = m; res.toInfinity = n - m;
    res.realAxis = realAxis(poles, zeros);                   // 3
    res.asymptotes = asymptotes(N, D);                       // 4
    res.breaks = breakPoints(N, D, res.realAxis);            // 5
    res.angles = angleItems(poles, zeros);                   // 6
    res.stability = R.stability(N, D);                       // 7
    res.view = viewBox(res);
    if (opts.branches !== false) {                            // 8·9
      var notable = res.breaks.candidates.filter(function (b) { return typeof b.K === 'number' && b.K > 0; }).map(function (b) { return b.K; })
        .concat(res.stability.crossings.map(function (c) { return c.K; }));
      var br = computeBranches(N, D, res.view, notable, n - m);
      res.branches = br.branches; res.Kmax = br.Kmax;
    }
    return res;
  }

  RL.locus = { analyze: analyze, realAxis: realAxis, asymptotes: asymptotes, breakPoints: breakPoints, angleItems: angleItems, computeBranches: computeBranches, MAX_ORDER: MAX_ORDER };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
