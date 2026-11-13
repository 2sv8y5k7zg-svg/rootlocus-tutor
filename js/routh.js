/*
 * routh.js — Routh 표, 허수축 교차점, 안정한 K 범위
 *
 * 특성방정식 D(s) + K·N(s) = 0의 계수는 K에 대한 식입니다(예: 8 + K).
 * 그래서 Routh 표의 칸을 'K에 대한 분수식'으로 계산합니다.
 *   한 칸 = n(K) / d(K)   (n, d는 K에 대한 다항식)
 *
 * 안정 범위는 두 가지 방법으로 구해 서로 대조합니다.
 *   ① Routh 표 첫 열의 부호
 *   ② 각 구간의 대표 K에서 폐루프 극점을 직접 계산
 * 둘이 다르면 결과에 '불일치'를 표시합니다 (정상이라면 일어나지 않아야 함).
 */
(function (RL) {
  'use strict';
  var P = RL.poly, C = RL.complex, F = RL.format;

  // ── K에 대한 분수식 ─────────────────────────────────
  function maxAbs(p) { return p.reduce(function (m, v) { return Math.max(m, Math.abs(v)); }, 0); }
  function rk(n, d) { return { n: P.trim(n), d: P.trim(d || [1]) }; }
  function isZeroRk(r) { return P.isZero(r.n, Math.max(1, maxAbs(r.d))); }
  function nearInt(v) { return Math.abs(v - Math.round(v)) < 1e-9 * Math.max(1, Math.abs(v)); }

  function normalize(r) {
    var n = r.n.slice(), d = r.d.slice();
    if (d[0] < 0) { n = n.map(function (v) { return -v; }); d = d.map(function (v) { return -v; }); }
    var all = n.concat(d);
    if (all.every(nearInt)) { // 정수 계수면 최대공약수로 약분해 보기 좋게
      n = n.map(Math.round); d = d.map(Math.round);
      var g = 0;
      all.forEach(function (v) { g = F.gcd(g, Math.round(Math.abs(v))); });
      if (g > 1) { n = n.map(function (v) { return v / g; }); d = d.map(function (v) { return v / g; }); }
    }
    if (d.length === 1 && d[0] !== 1 && n.every(function (v) { return nearInt(v / d[0]); })) {
      n = n.map(function (v) { return Math.round(v / d[0]); }); d = [1];
    }
    return rk(n, d);
  }

  function simplify(r) {
    var n = P.trim(r.n), d = P.trim(r.d);
    if (P.isZero(n, Math.max(1, maxAbs(d)))) return rk([0], [1]);
    if (d.length > 1) {
      var dm = P.divmod(n, d);
      if (P.isZero(dm.r, Math.max(1, maxAbs(n)))) return normalize(rk(dm.q, [1]));
      // 분모의 근이 분자의 근이기도 하면 그 인수로 약분
      P.groupedRoots(d).forEach(function (g) {
        if (g.s.im < 0) return;
        var f = g.s.im === 0 ? [1, -g.s.re] : [1, -2 * g.s.re, g.s.re * g.s.re + g.s.im * g.s.im];
        for (var t = 0; t < g.mult; t++) {
          var a = P.divmod(n, f), b = P.divmod(d, f);
          if (P.isZero(a.r, Math.max(1, maxAbs(n))) && P.isZero(b.r, Math.max(1, maxAbs(d)))) { n = a.q; d = b.q; }
        }
      });
    }
    return normalize(rk(n, d));
  }
  function mulRk(a, b) { return simplify(rk(P.mul(a.n, b.n), P.mul(a.d, b.d))); }
  function subRk(a, b) { return simplify(rk(P.sub(P.mul(a.n, b.d), P.mul(b.n, a.d)), P.mul(a.d, b.d))); }
  function divRk(a, b) { return simplify(rk(P.mul(a.n, b.d), P.mul(a.d, b.n))); }
  function evalRk(r, K) { return P.evalReal(r.n, K) / P.evalReal(r.d, K); }
  function fmtRk(r) {
    var top = F.kpoly(r.n);
    if (r.d.length === 1 && r.d[0] === 1) return top;
    var bot = F.kpoly(r.d), topWrap = r.n.length > 1 ? '(' + top + ')' : top, botWrap = r.d.length > 1 ? '(' + bot + ')' : bot;
    return topWrap + '/' + botWrap;
  }

  // 특성방정식 계수: s의 각 차수마다 (D계수 + K·N계수)를 K 다항식 [N_i, D_i]로
  function charCoefficients(N, D) {
    var n = D.length - 1, Np = N.slice();
    while (Np.length < D.length) Np.unshift(0);
    var out = [], i;
    for (i = 0; i <= n; i++) out.push(P.trim([Np[i], D[i]]));
    return out; // out[i]는 s^(n−i)의 계수
  }

  // ── Routh 표 (K를 문자로 둔 채) ───────────────────────
  function routhTable(N, D) {
    var coef = charCoefficients(N, D), n = coef.length - 1, width = Math.floor(n / 2) + 1;
    var rows = [[], []], special = [], i, j;
    for (j = 0; j < width; j++) {
      rows[0].push(rk(coef[2 * j] || [0]));
      rows[1].push(rk(coef[2 * j + 1] || [0]));
    }
    for (i = 2; i <= n; i++) {
      var prev = rows[i - 1], prev2 = rows[i - 2], row = [];
      for (j = 0; j < width; j++) {
        var B = prev2[j + 1] || rk([0]), Dd = prev[j + 1] || rk([0]);
        // (A·B − C·D)/A 에서 D가 0이면 그대로 B
        row.push(isZeroRk(Dd) ? B : subRk(B, divRk(mulRk(prev2[0], Dd), prev[0])));
      }
      if (row.every(isZeroRk)) { // 한 행 전체가 항상 0 → 보조방정식의 미분으로 대체
        var pw = n - (i - 1);
        row = prev.map(function (e, k) { return mulRk(e, rk([pw - 2 * k])); });
        special.push({ row: i, type: 'zeroRow' });
      } else if (isZeroRk(row[0])) { // 첫 열만 항상 0 → ε 방법 (이후 칸은 구간별 수치 계산)
        rows.push(row);
        special.push({ row: i, type: 'firstColZero' });
        break;
      }
      rows.push(row);
    }
    var powers = rows.map(function (_, k) { return n - k; });
    return { powers: powers, rows: rows, special: special, degree: n };
  }

  // 특정 K 값에서 숫자로 계산한 Routh 첫 열 (ε 처리 포함)
  function routhNumericFirstColumn(coeffs) {
    var n = coeffs.length - 1, width = Math.floor(n / 2) + 1, scale = maxAbs(coeffs) || 1, eps = 1e-9 * scale;
    var r0 = [], r1 = [], rows, i, j;
    for (j = 0; j < width; j++) { r0.push(coeffs[2 * j] || 0); r1.push(coeffs[2 * j + 1] || 0); }
    rows = [r0, r1];
    for (i = 2; i <= n; i++) {
      var prev = rows[i - 1], prev2 = rows[i - 2], row = [];
      if (prev.every(function (v) { return Math.abs(v) < 1e-12 * scale; })) break;
      if (Math.abs(prev[0]) < 1e-12 * scale) prev[0] = eps;
      for (j = 0; j < width; j++) row.push(((prev[0] * (prev2[j + 1] || 0)) - (prev2[0] * (prev[j + 1] || 0))) / prev[0]);
      if (row.every(function (v) { return Math.abs(v) < 1e-12 * scale; })) {
        var pw = n - (i - 1);
        row = prev.map(function (e, k) { return e * (pw - 2 * k); });
      }
      rows.push(row);
    }
    var col = rows.map(function (r) { return Math.abs(r[0]) < 1e-12 * scale ? eps : r[0]; });
    var changes = 0;
    for (i = 1; i < col.length; i++) if (col[i] * col[i - 1] < 0) changes++;
    return { column: col, signChanges: changes };
  }

  // ── 허수축 교차: s = jω를 대입해 실수부·허수부가 모두 0이 되는 (ω, K) ──
  function splitJw(p) { // p(jω) = R(ω) + j·I(ω)
    var n = p.length - 1, R = new Array(n + 1).fill(0), I = new Array(n + 1).fill(0), i;
    for (i = 0; i <= n; i++) {
      var pw = n - i, a = p[i], m = pw % 4;
      if (m === 0) R[i] = a; else if (m === 1) I[i] = a; else if (m === 2) R[i] = -a; else I[i] = -a;
    }
    return { R: P.trim(R), I: P.trim(I) };
  }

  function jwCrossings(N, D) {
    var d = splitJw(D), nn = splitJw(N), out = [];
    var E = P.sub(P.mul(d.R, nn.I), P.mul(d.I, nn.R)); // K를 소거한 식
    if (!P.isZero(E, maxAbs(D) * maxAbs(N))) {
      P.groupedRoots(E).forEach(function (g) {
        var w = g.s.re;
        if (g.s.im !== 0 || w <= 1e-9) return;
        var nr = P.evalReal(nn.R, w), ni = P.evalReal(nn.I, w), K;
        K = Math.abs(nr) > Math.abs(ni) ? -P.evalReal(d.R, w) / nr : -P.evalReal(d.I, w) / ni;
        if (!(K > 1e-9)) return;
        var chk = C.abs(C.add(P.evalC(D, C.c(0, w)), C.scale(P.evalC(N, C.c(0, w)), K)));
        if (chk > 1e-7 * Math.max(1, C.abs(P.evalC(D, C.c(0, w))))) return;
        out.push({ omega: w, K: K });
      });
    }
    // ω = 0: 실수 근이 원점을 지나는 경우
    var N0 = P.evalReal(N, 0), D0 = P.evalReal(D, 0);
    if (Math.abs(N0) > 1e-12) {
      var K0 = -D0 / N0;
      if (K0 > 1e-9) out.push({ omega: 0, K: K0 });
    }
    out.sort(function (a, b) { return a.K - b.K || a.omega - b.omega; });
    return out;
  }

  // 교차 K에서 보조방정식: 다음 행 첫 칸이 0이 되는 행을 그 K로 계산
  function auxEquation(table, K) {
    for (var i = 1; i < table.rows.length; i++) {
      var v = evalRk(table.rows[i][0], K), ref = Math.max(1, Math.abs(evalRk(table.rows[i - 1][0], K)));
      if (Math.abs(v) < 1e-7 * ref && i - 1 >= 0) {
        var row = table.rows[i - 1], pw = table.powers[i - 1], coef = [];
        for (var k = 0; k < row.length && pw - 2 * k >= 0; k++) {
          coef.push(evalRk(row[k], K));
          if (pw - 2 * k > 0) coef.push(0);
        }
        return { fromRow: i - 1, power: pw, poly: P.trim(coef) };
      }
    }
    return null;
  }

  // ── 안정한 K 범위 ───────────────────────────────────
  function closedLoopPoles(N, D, K) { return P.roots(P.add(D, P.scale(N, K))); }
  function maxRe(rs) { return rs.reduce(function (m, z) { return Math.max(m, z.re); }, -Infinity); }
  function scaleOf(rs) { return rs.reduce(function (m, z) { return Math.max(m, C.abs(z)); }, 1); }
  function classify(rs) {
    var tol = 1e-7 * scaleOf(rs), mr = maxRe(rs);
    if (mr > tol) return 'unstable';
    // A repeated pole on the imaginary axis gives t^q exp(jωt), q >= 1.
    // Simple axis poles can be marginal; repeated axis poles are unbounded.
    for (var i = 0; i < rs.length; i++) {
      if (Math.abs(rs[i].re) > tol) continue;
      for (var j = i + 1; j < rs.length; j++) {
        if (Math.abs(rs[j].re) <= tol && C.dist(rs[i], rs[j]) <= tol) return 'unstable';
      }
    }
    if (mr >= -tol) return 'marginal';
    return 'stable';
  }
  function countRHP(rs) { var tol = 1e-7 * scaleOf(rs); return rs.filter(function (z) { return z.re > tol; }).length; }

  function stability(N, D) {
    var table = routhTable(N, D), cross = jwCrossings(N, D), crit = [];
    cross.forEach(function (c) { if (c.K > 0) crit.push(c.K); });
    if (!table.special.length) {
      table.rows.forEach(function (row) {
        [row[0].n, row[0].d].forEach(function (p) {
          if (p.length > 1) P.groupedRoots(p).forEach(function (g) { if (g.s.im === 0 && g.s.re > 1e-9) crit.push(g.s.re); });
        });
      });
    }
    crit.sort(function (a, b) { return a - b; });
    var uniq = [];
    crit.forEach(function (k) { if (!uniq.length || Math.abs(k - uniq[uniq.length - 1]) > 1e-7 * Math.max(1, k)) uniq.push(k); });

    var bounds = [0].concat(uniq), intervals = [], points = [], disagree = false, i;
    for (i = 0; i < bounds.length; i++) {
      var lo = bounds[i], hi = i + 1 < bounds.length ? bounds[i + 1] : Infinity;
      var sample = hi === Infinity ? (lo === 0 ? 1 : lo * 2 + 1) : (lo + hi) / 2;
      var rs = closedLoopPoles(N, D, sample), status = classify(rs), rhp = countRHP(rs);
      var coeffs = P.add(D, P.scale(N, sample)), rn = routhNumericFirstColumn(coeffs);
      var agree = rn.signChanges === rhp;
      if (!agree) disagree = true;
      var routhSigns = table.special.length ? null : table.rows.map(function (row) { return Math.sign(evalRk(row[0], sample)); });
      intervals.push({ lo: lo, hi: hi, sampleK: sample, status: status, rhpCount: rhp, routhSignChanges: rn.signChanges, routhSigns: routhSigns, agree: agree });
    }
    bounds.forEach(function (k) {
      var rs = closedLoopPoles(N, D, k);
      points.push({ K: k, status: classify(rs), roots: rs });
    });

    // 안정한 구간 모으기 (경계 포함 여부까지)
    var stableSet = [];
    intervals.forEach(function (iv, idx) {
      if (iv.status !== 'stable') return;
      var loPt = points[idx], hiPt = points[idx + 1];
      var item = { lo: iv.lo, hi: iv.hi, loIncl: loPt.status === 'stable', hiIncl: hiPt ? hiPt.status === 'stable' : false };
      var last = stableSet[stableSet.length - 1];
      if (last && last.hi === item.lo && last.hiIncl) { last.hi = item.hi; last.hiIncl = item.hiIncl; }
      else stableSet.push(item);
    });

    return {
      table: table, crossings: cross, criticalK: uniq, intervals: intervals, points: points, stableSet: stableSet,
      basis: table.special.length ? 'numeric' : 'routh', consistent: !disagree
    };
  }

  RL.routh = {
    rk: rk, fmtRk: fmtRk, evalRk: evalRk, isZeroRk: isZeroRk, charCoefficients: charCoefficients, routhTable: routhTable,
    routhNumericFirstColumn: routhNumericFirstColumn, jwCrossings: jwCrossings, auxEquation: auxEquation,
    closedLoopPoles: closedLoopPoles, classify: classify, stability: stability
  };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
