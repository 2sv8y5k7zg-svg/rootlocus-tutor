/*
 * mathview.js — 수식을 화면용 HTML로 만듭니다.
 * 변수 s, K는 교과서처럼 기울인 세리프 글꼴로, 거듭제곱은 위첨자로 씁니다.
 * data-ref가 붙은 글자는 그래프의 같은 점과 연결되어, 가리키면 둘 다 빛납니다.
 */
(function (RL) {
  'use strict';
  var F = RL.format, P = RL.poly;
  var MINUS = '−';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function mv(name) { return '<i class="mv">' + name + '</i>'; }
  function sup(n) { return n > 1 ? '<sup>' + n + '</sup>' : ''; }
  function n(x) { return F.numShort(x); }

  // 다항식 (내림차순 계수) → s³ + 5s² + 8s + 6
  function polyH(p, v) {
    v = v || 's';
    var deg = p.length - 1, out = '', i;
    for (i = 0; i <= deg; i++) {
      var a = p[i], pw = deg - i;
      if (Math.abs(a) < 1e-12) continue;
      var mag = Math.abs(a), coef = (Math.abs(mag - 1) < 1e-12 && pw > 0) ? '' : n(mag);
      var term = coef + (pw > 0 ? mv(v) + sup(pw) : '');
      if (out === '') out = (a < 0 ? MINUS : '') + term;
      else out += (a < 0 ? ' ' + MINUS + ' ' : ' + ') + term;
    }
    return out === '' ? '0' : out;
  }

  // K 다항식 (내림차순 계수, 표시는 상수항부터) → 8 + K
  function kpolyH(p) {
    var deg = p.length - 1, out = '', i;
    for (i = deg; i >= 0; i--) {
      var a = p[i], pw = deg - i;
      if (Math.abs(a) < 1e-12) continue;
      var mag = Math.abs(a), coef = (Math.abs(mag - 1) < 1e-12 && pw > 0) ? '' : n(mag);
      var term = coef + (pw > 0 ? mv('K') + sup(pw) : '');
      if (out === '') out = (a < 0 ? MINUS : '') + term;
      else out += (a < 0 ? ' ' + MINUS + ' ' : ' + ') + term;
    }
    return out === '' ? '0' : out;
  }

  function frac(top, bot) { return '<span class="frac"><span class="ft">' + top + '</span><span class="fb">' + bot + '</span></span>'; }

  // Routh 표 한 칸 (K에 대한 분수식)
  function rkH(r) {
    if (r.d.length === 1 && Math.abs(r.d[0] - 1) < 1e-12) return kpolyH(r.n);
    return frac(kpolyH(r.n), kpolyH(r.d));
  }

  function cnumH(z) { return '<span class="nm">' + F.cnum(z) + '</span>'; }

  // 그래프와 연결되는 글자
  function ref(id, cls, html) {
    return '<span class="ref ' + cls + '" data-ref="' + id + '" tabindex="0">' + html + '</span>';
  }

  // 근 목록으로 인수분해 꼴 만들기: (s + 3)(s² + 2s + 2)
  function factorsH(groups, lead) {
    var origin = [], linear = [], quad = [], used = [], i, j;
    var parts = { push: function (s) { if (s.indexOf('(') !== 0) origin.push(s); else if (s.indexOf('<sup>2</sup>') > 0 && s.indexOf(mv('s') + '<sup>2</sup>') === 1) quad.push(s); else linear.push(s); } };
    for (i = 0; i < groups.length; i++) used.push(false);
    for (i = 0; i < groups.length; i++) {
      if (used[i]) continue;
      var g = groups[i], z = g.s;
      if (z.im < 0) { used[i] = true; continue; }          // 켤레쌍은 위쪽에서 한 번에
      if (z.im > 0) {
        var b = -2 * z.re, c = z.re * z.re + z.im * z.im;
        parts.push('(' + polyH([1, b, c]) + ')' + sup(g.mult));
        used[i] = true;
        continue;
      }
      if (z.re === 0) { parts.push(mv('s') + sup(g.mult)); used[i] = true; continue; }
      if (F.exact(z.re) === null) {                         // 무리수 실근이면 짝을 찾아 2차식으로
        var paired = -1;
        for (j = i + 1; j < groups.length; j++) {
          if (used[j] || groups[j].s.im !== 0 || groups[j].mult !== g.mult) continue;
          var sm = z.re + groups[j].s.re, pr = z.re * groups[j].s.re;
          if (F.toFraction(sm, 100) && F.toFraction(pr, 100)) { paired = j; break; }
        }
        if (paired >= 0) {
          var q = [1, -(z.re + groups[paired].s.re), z.re * groups[paired].s.re];
          parts.push('(' + polyH(q) + ')' + sup(g.mult));
          used[i] = used[paired] = true;
          continue;
        }
      }
      parts.push('(' + polyH([1, -z.re]) + ')' + sup(g.mult));
      used[i] = true;
    }
    var head = (lead !== undefined && Math.abs(lead - 1) > 1e-12) ? n(lead) : '';
    var body = origin.join('') + linear.join('') + quad.join(''); // s → (s + a) → (s² + bs + c) 순서
    if (body === '') return head || '1';
    return head + body;
  }

  // 특성방정식 D(s) + K·N(s)을 s의 차수별로 묶어서: s³ + 5s² + (8 + K)s + (6 + 2K)
  function charPolyH(coef) {
    var deg = coef.length - 1, out = '', i;
    for (i = 0; i <= deg; i++) {
      var kp = P.trim(coef[i]), pw = deg - i;
      if (P.isZero(kp)) continue;
      var single = kp.length === 1, body, neg = false;
      if (single) {
        var a = kp[0];
        neg = a < 0;
        body = (Math.abs(Math.abs(a) - 1) < 1e-12 && pw > 0) ? '' : n(Math.abs(a));
      } else if (Math.abs(kp[1]) < 1e-12) { // a·K 하나만
        neg = kp[0] < 0;
        body = (Math.abs(Math.abs(kp[0]) - 1) < 1e-12 ? '' : n(Math.abs(kp[0]))) + mv('K');
      } else {
        body = '(' + kpolyH(kp) + ')';
      }
      var term = body + (pw > 0 ? mv('s') + sup(pw) : '');
      if (term === '') term = '1';
      if (out === '') out = (neg ? MINUS : '') + term;
      else out += (neg ? ' ' + MINUS + ' ' : ' + ') + term;
    }
    return out;
  }

  function deg(x) { return '<span class="nm">' + F.deg(x) + '</span>'; }

  RL.mv = { esc: esc, mv: mv, sup: sup, n: n, polyH: polyH, kpolyH: kpolyH, frac: frac, rkH: rkH, cnumH: cnumH, ref: ref, factorsH: factorsH, charPolyH: charPolyH, deg: deg };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
