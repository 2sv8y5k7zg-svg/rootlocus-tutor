/*
 * poly.js — 다항식 계산과 근 찾기
 * 다항식은 '내림차순 계수 배열'로 나타냅니다 (MATLAB과 같은 방식).
 *   [1, 3, 2]  →  s² + 3s + 2
 * 근궤적에서 특성방정식 D(s) + K·N(s) = 0의 근(= 폐루프 극점)을 구하는 핵심 도구입니다.
 */
(function (RL) {
  'use strict';
  var C = RL.complex;

  // 맨 앞의 0 계수를 지웁니다. [0, 0, 1, 2] → [1, 2]
  function trim(p) {
    var max = 0, i;
    for (i = 0; i < p.length; i++) max = Math.max(max, Math.abs(p[i]));
    if (max === 0) return [0];
    i = 0;
    while (i < p.length - 1 && Math.abs(p[i]) <= 1e-13 * max) i++;
    return p.slice(i);
  }
  function degree(p) { return trim(p).length - 1; }

  // 모든 계수가 (기준 크기 대비) 0이면 '항등적으로 0'인 다항식으로 봅니다.
  function isZero(p, ref) {
    var r = ref || 1, i;
    for (i = 0; i < p.length; i++) if (Math.abs(p[i]) > 1e-10 * r) return false;
    return true;
  }

  function pad(p, len) { var out = p.slice(); while (out.length < len) out.unshift(0); return out; }
  function add(p, q) {
    var n = Math.max(p.length, q.length), a = pad(p, n), b = pad(q, n), out = [], i;
    for (i = 0; i < n; i++) out.push(a[i] + b[i]);
    return trim(out);
  }
  function scale(p, k) { return trim(p.map(function (v) { return v * k; })); }
  function sub(p, q) { return add(p, scale(q, -1)); }
  function mul(p, q) {
    var out = new Array(p.length + q.length - 1).fill(0), i, j;
    for (i = 0; i < p.length; i++) for (j = 0; j < q.length; j++) out[i + j] += p[i] * q[j];
    return trim(out);
  }
  function deriv(p) {
    var n = p.length - 1, out = [], i;
    if (n < 1) return [0];
    for (i = 0; i < n; i++) out.push(p[i] * (n - i));
    return trim(out);
  }
  function evalReal(p, x) { var v = 0, i; for (i = 0; i < p.length; i++) v = v * x + p[i]; return v; }
  function evalC(p, z) {
    var v = C.c(0, 0), i;
    for (i = 0; i < p.length; i++) v = C.add(C.mul(v, z), C.c(p[i], 0));
    return v;
  }
  function fromFactors(factors) {
    var p = [1], i;
    for (i = 0; i < factors.length; i++) p = mul(p, factors[i]);
    return p;
  }

  // 다항식 나눗셈: p = q·d + r
  function divmod(p, d) {
    p = trim(p); d = trim(d);
    var out = [], rem = p.slice(), i, k, coef;
    if (d.length > p.length) return { q: [0], r: p };
    for (i = 0; i <= p.length - d.length; i++) {
      coef = rem[i] / d[0];
      out.push(coef);
      for (k = 0; k < d.length; k++) rem[i + k] -= coef * d[k];
    }
    return { q: trim(out), r: trim(rem.slice(p.length - d.length + 1)) };
  }

  // ── 근 찾기 ──────────────────────────────────────────────
  // 1·2차는 근의 공식으로 정확하게, 3차 이상은 Aberth 반복법으로 모든 근을 동시에 구합니다.
  function quadRoots(b, c0) { // s² + b·s + c0 = 0
    var disc = b * b - 4 * c0, q, r;
    if (disc >= 0) {
      q = -(b + (b >= 0 ? 1 : -1) * Math.sqrt(disc)) / 2; // 상쇄 오차를 피하는 형태
      if (q === 0) return [C.c(0, 0), C.c(0, 0)];
      return [C.c(q, 0), C.c(c0 / q, 0)];
    }
    r = Math.sqrt(-disc) / 2;
    return [C.c(-b / 2, r), C.c(-b / 2, -r)];
  }

  function aberth(a) { // a는 최고차 계수가 1인 다항식, 차수 3 이상
    var n = a.length - 1, dp = deriv(a), z = [], r = 0, i, k, j, iter;
    for (i = 1; i <= n; i++) r = Math.max(r, Math.pow(Math.abs(a[i]), 1 / i));
    r = Math.max(2 * r, 1e-3);
    for (k = 0; k < n; k++) {
      var ang = 2 * Math.PI * k / n + 0.4;
      z.push(C.c(r * Math.cos(ang), r * Math.sin(ang)));
    }
    for (iter = 0; iter < 800; iter++) {
      var maxCorr = 0;
      for (k = 0; k < n; k++) {
        var pz = evalC(a, z[k]);
        if (pz.re === 0 && pz.im === 0) continue;
        var ratio = C.div(pz, evalC(dp, z[k])), sum = C.c(0, 0);
        for (j = 0; j < n; j++) if (j !== k) sum = C.add(sum, C.div(C.c(1, 0), C.sub(z[k], z[j])));
        var w = C.div(ratio, C.sub(C.c(1, 0), C.mul(ratio, sum)));
        if (!isFinite(w.re) || !isFinite(w.im)) continue;
        z[k] = C.sub(z[k], w);
        maxCorr = Math.max(maxCorr, C.abs(w) / Math.max(1, C.abs(z[k])));
      }
      if (maxCorr < 1e-15) break;
    }
    return z;
  }

  // 실수 계수 다항식이므로 복소근은 켤레쌍으로 나와야 합니다. 작은 수치 오차를 정리합니다.
  function tidyRoots(rs) {
    var out = rs.map(function (z) {
      return Math.abs(z.im) < 1e-11 * Math.max(1, Math.abs(z.re)) ? C.c(z.re, 0) : C.c(z.re, z.im);
    });
    var used = new Array(out.length).fill(false), i, j;
    for (i = 0; i < out.length; i++) {
      if (used[i] || out[i].im <= 0) continue;
      var best = -1, bd = Infinity;
      for (j = 0; j < out.length; j++) {
        if (j === i || used[j] || out[j].im >= 0) continue;
        var d = C.dist(out[j], C.conj(out[i]));
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) {
        var re = (out[i].re + out[best].re) / 2, im = (out[i].im - out[best].im) / 2;
        out[i] = C.c(re, im); out[best] = C.c(re, -im);
        used[i] = used[best] = true;
      }
    }
    return out;
  }

  function roots(p) {
    p = trim(p);
    var n = p.length - 1, res = [], a;
    if (n < 1) return [];
    while (n > 0 && p[n] === 0) { res.push(C.c(0, 0)); p = p.slice(0, n); n--; } // 원점 근은 정확히 0으로
    if (n === 0) return res;
    a = p.map(function (v) { return v / p[0]; });
    if (n === 1) res.push(C.c(-a[1], 0));
    else if (n === 2) res = res.concat(quadRoots(a[1], a[2]));
    else res = res.concat(aberth(a));
    return tidyRoots(res);
  }

  // k번 미분한 다항식
  function derivN(p, k) { var q = p, i; for (i = 0; i < k; i++) q = deriv(q); return q; }
  // 값의 크기 대비 잔차(상대 오차)
  function relResidual(p, z) {
    var v = C.abs(evalC(p, z)), ref = 0, az = Math.max(1, C.abs(z)), i, n = p.length - 1;
    for (i = 0; i <= n; i++) ref += Math.abs(p[i]) * Math.pow(az, n - i);
    return ref === 0 ? 0 : v / ref;
  }

  // 겹친 근(중근)을 하나로 묶어 {s, mult}로 돌려줍니다.
  // 가까운 근 무리의 평균을 구하고, 그 점에서 p, p′, … p^(k-1)이 모두 0인지 확인해야 중근으로 인정합니다.
  function groupedRoots(p) {
    p = trim(p);
    var rs = roots(p), used = new Array(rs.length).fill(false), out = [], i, j;
    for (i = 0; i < rs.length; i++) {
      if (used[i]) continue;
      var cluster = [i], rad = 1e-4 * Math.max(1, C.abs(rs[i]));
      for (j = i + 1; j < rs.length; j++) if (!used[j] && C.dist(rs[i], rs[j]) < rad) cluster.push(j);
      var accepted = false;
      if (cluster.length > 1) {
        var m = C.c(0, 0);
        cluster.forEach(function (idx) { m = C.add(m, rs[idx]); });
        m = C.scale(m, 1 / cluster.length);
        if (Math.abs(m.im) < 1e-9 * Math.max(1, Math.abs(m.re))) m = C.c(m.re, 0);
        var ok = true;
        for (var k = 0; k < cluster.length; k++) if (relResidual(derivN(p, k), m) > 1e-8) { ok = false; break; }
        if (ok) {
          cluster.forEach(function (idx) { used[idx] = true; });
          out.push({ s: m, mult: cluster.length });
          accepted = true;
        }
      }
      if (!accepted) { used[i] = true; out.push({ s: rs[i], mult: 1 }); }
    }
    // 실수부 큰 순(오른쪽부터), 같으면 허수부 큰 순
    out.sort(function (x, y) { return (y.s.re - x.s.re) || (y.s.im - x.s.im); });
    return out;
  }

  RL.poly = {
    trim: trim, degree: degree, isZero: isZero, add: add, sub: sub, scale: scale, mul: mul,
    deriv: deriv, derivN: derivN, evalReal: evalReal, evalC: evalC, fromFactors: fromFactors,
    divmod: divmod, roots: roots, groupedRoots: groupedRoots, relResidual: relResidual
  };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
