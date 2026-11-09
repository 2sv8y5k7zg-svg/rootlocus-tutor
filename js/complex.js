/*
 * complex.js — 복소수 계산
 * 복소수 하나를 {re: 실수부, im: 허수부} 객체로 나타냅니다.
 * 근궤적의 극점·영점·폐루프 극점은 모두 복소수라서 가장 밑바탕이 되는 파일입니다.
 */
(function (RL) {
  'use strict';

  function c(re, im) { return { re: re, im: im || 0 }; }
  function add(a, b) { return c(a.re + b.re, a.im + b.im); }
  function sub(a, b) { return c(a.re - b.re, a.im - b.im); }
  function mul(a, b) { return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
  function scale(a, k) { return c(a.re * k, a.im * k); }
  function div(a, b) {
    // (a / b) = a * conj(b) / |b|^2
    var d = b.re * b.re + b.im * b.im;
    return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function abs(a) { return Math.hypot(a.re, a.im); }
  // 각도(라디안). atan2를 써서 사분면까지 정확히 구합니다. 결과 범위는 (-π, π].
  function arg(a) { return Math.atan2(a.im, a.re); }
  function conj(a) { return c(a.re, -a.im); }
  function dist(a, b) { return Math.hypot(a.re - b.re, a.im - b.im); }

  RL.complex = { c: c, add: add, sub: sub, mul: mul, scale: scale, div: div, abs: abs, arg: arg, conj: conj, dist: dist };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
