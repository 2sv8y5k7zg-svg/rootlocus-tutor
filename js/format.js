/*
 * format.js — 숫자·수식을 사람이 읽기 좋은 글자로 바꿉니다.
 * 정확한 값(정수, 분수, 제곱근)으로 쓸 수 있으면 그렇게 쓰고, 아니면 소수로 씁니다.
 *   -1.5 → "−3/2",  1.4142135… → "√2",  2.8284… → "2√2"
 */
(function (RL) {
  'use strict';
  var MINUS = '−';
  var SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a; }

  // 연분수로 분수 찾기. 오차가 아주 작을 때만 분수로 인정합니다.
  function toFraction(x, maxDen) {
    maxDen = maxDen || 1000;
    if (!isFinite(x)) return null;
    var sign = x < 0 ? -1 : 1, v = Math.abs(x), h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = v, i;
    for (i = 0; i < 40; i++) {
      var a = Math.floor(b), h2 = a * h1 + h0, k2 = a * k1 + k0;
      if (k2 > maxDen) break;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (Math.abs(v - h1 / k1) <= 1e-9 * Math.max(1, v)) return { num: sign * h1, den: k1 };
      if (b - a < 1e-15) break;
      b = 1 / (b - a);
    }
    return null;
  }

  function trimZeros(str) { return str.indexOf('.') >= 0 ? str.replace(/0+$/, '').replace(/\.$/, '') : str; }
  // 소수 표기(기본 유효숫자 4자리 수준), 음수는 수학 기호 '−'
  function dec(x, digits) {
    digits = digits === undefined ? 3 : digits;
    if (Math.abs(x) < 0.5 * Math.pow(10, -digits)) x = 0;
    var s = trimZeros(x.toFixed(digits));
    return s.charAt(0) === '-' ? MINUS + s.slice(1) : s;
  }

  // √n 을 a√b 꼴로 정리
  function sqrtSimplify(n) {
    var a = 1, b = n, f;
    for (f = 2; f * f <= b; f++) while (b % (f * f) === 0) { b /= f * f; a *= f; }
    if (b === 1) return String(a);
    return (a === 1 ? '' : a) + '√' + b;
  }

  // 정확한 꼴(정수·분수·제곱근)로 쓸 수 있으면 문자열, 아니면 null
  function exact(x) {
    var f = toFraction(x, 1000);
    if (f) {
      var s = (f.num < 0 ? MINUS : '') + Math.abs(f.num) + (f.den === 1 ? '' : '/' + f.den);
      return s;
    }
    var ax = Math.abs(x);
    if (ax > 0) {
      var g = toFraction(ax * ax, 100), sgn = x < 0 ? MINUS : '';
      if (g && g.den === 1 && g.num < 100000) return sgn + sqrtSimplify(g.num);
      if (g && g.num * g.den < 100000) {
        // √(p/q) = √(pq)/q 를 a√b/c 꼴로 정리 (예: √(4/27) → 2√3/9)
        var a = 1, b = g.num * g.den, f;
        for (f = 2; f * f <= b; f++) while (b % (f * f) === 0) { b /= f * f; a *= f; }
        var c = g.den, d = gcd(a, c);
        a /= d; c /= d;
        var top = (a === 1 ? '' : a) + (b === 1 ? (a === 1 ? '1' : '') : '√' + b);
        return sgn + top + (c === 1 ? '' : '/' + c);
      }
    }
    return null;
  }

  // 화면용 숫자: 정확한 꼴이 있으면 그것, 소수와 다르면 "≈ 소수"도 붙임
  function num(x, digits) {
    var e = exact(x), d = dec(x, digits);
    if (e === null) return d;
    if (e === d) return e;
    if (/^[−]?\d+$/.test(e) || /^[−]?\d+\/\d+$/.test(e)) return e.length <= 7 ? e : d;
    return e + ' ≈ ' + d;
  }

  // 복소수 안에서는 '≈ 소수'를 붙이지 않고 정확한 꼴이 짧으면 그것, 아니면 소수
  function numShort(x, digits) { var e = exact(x); return e !== null && e.length <= 7 ? e : dec(x, digits); }

  function cnum(z, digits) {
    var re = Math.abs(z.re) < 1e-12 ? 0 : z.re, im = Math.abs(z.im) < 1e-12 ? 0 : z.im;
    if (im === 0) return numShort(re, digits);
    var imS = Math.abs(Math.abs(im) - 1) < 1e-12 ? 'j' : 'j' + numShort(Math.abs(im), digits);
    if (re === 0) return (im < 0 ? MINUS : '') + imS;
    return numShort(re, digits) + (im < 0 ? ' ' + MINUS + ' ' : ' + ') + imS;
  }

  function sup(n) { return String(n).split('').map(function (ch) { return SUP[ch]; }).join(''); }

  // 다항식 → "s³ + 9s² + 27s + 27" (내림차순 계수 배열)
  function poly(p, v) {
    v = v || 's';
    var n = p.length - 1, out = '', i;
    for (i = 0; i <= n; i++) {
      var a = p[i], pw = n - i;
      if (Math.abs(a) < 1e-12) continue;
      var mag = Math.abs(a), coef = (mag === 1 && pw > 0) ? '' : num(mag);
      var term = coef + (pw > 0 ? v + (pw > 1 ? sup(pw) : '') : '');
      if (out === '') out = (a < 0 ? MINUS : '') + term;
      else out += (a < 0 ? ' ' + MINUS + ' ' : ' + ') + term;
    }
    return out === '' ? '0' : out;
  }

  // K 다항식은 상수항부터: [−1, 6] (= −K + 6) → "6 − K"
  function kpoly(p) {
    var n = p.length - 1, out = '', i;
    for (i = n; i >= 0; i--) {
      var a = p[i], pw = n - i;
      if (Math.abs(a) < 1e-12) continue;
      var mag = Math.abs(a), coef = (mag === 1 && pw > 0) ? '' : num(mag);
      var term = coef + (pw > 0 ? 'K' + (pw > 1 ? sup(pw) : '') : '');
      if (out === '') out = (a < 0 ? MINUS : '') + term;
      else out += (a < 0 ? ' ' + MINUS + ' ' : ' + ') + term;
    }
    return out === '' ? '0' : out;
  }

  function deg(x) { return dec(x, 1) + '°'; }

  RL.format = { gcd: gcd, toFraction: toFraction, dec: dec, exact: exact, num: num, numShort: numShort, cnum: cnum, poly: poly, kpoly: kpoly, deg: deg, MINUS: MINUS };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
