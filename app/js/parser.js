/*
 * parser.js — 사용자가 입력한 전달함수 글자를 다항식 N(s), D(s)로 바꿉니다.
 *
 *   "K(s+2)/((s+3)(s^2+2s+2))"  →  N = [1, 2],  D = [1, 5, 8, 6]
 *
 * 문법(위가 우선순위 낮음):
 *   식   := 항 (('+' | '-') 항)*
 *   항   := 부호 (('*' | '/' | 생략된 곱) 부호)*
 *   부호 := ('-' | '+') 부호 | 거듭
 *   거듭 := 기본 ('^' 정수)?
 *   기본 := 숫자 | s | K | '(' 식 ')'
 *
 * K는 '식 전체에 한 번 곱해진 꼴'만 받습니다. 식에 K가 없으면 전체에 K를 곱한 것으로 봅니다.
 */
(function (RL) {
  'use strict';
  var P = RL.poly;

  function ParseError(message, pos) { this.message = message; this.pos = pos; }

  // 입력을 계산하기 쉬운 글자로 정리
  function clean(src) {
    var s = String(src || '');
    var eq = s.lastIndexOf('=');
    if (eq >= 0) s = s.slice(eq + 1);                    // "G(s)H(s) = ..." 앞부분 제거
    s = s.replace(/[−–—]/g, '-');          // 여러 가지 빼기 기호
    s = s.replace(/[×·∙⋅]/g, '*');    // 곱하기 기호
    s = s.replace(/\*\*/g, '^');
    s = s.replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁴/g, '^4');
    s = s.replace(/[\[{]/g, '(').replace(/[\]}]/g, ')');
    return s;
  }

  function tokenize(s) {
    var tokens = [], i = 0, ch, m;
    while (i < s.length) {
      ch = s.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
      m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (m) {
        var number = Number(m[0]);
        if (!isFinite(number) || (number === 0 && /[1-9]/.test(m[0].split(/[eE]/)[0]))) throw new ParseError('숫자가 계산 가능한 크기를 벗어났습니다. 단위와 계수를 조정해 주세요.', i);
        tokens.push({ t: 'num', v: number, pos: i }); i += m[0].length; continue;
      }
      if (ch === 's' || ch === 'S') { tokens.push({ t: 's', pos: i }); i++; continue; }
      if (ch === 'K' || ch === 'k') { tokens.push({ t: 'K', pos: i }); i++; continue; }
      if ('+-*/^()'.indexOf(ch) >= 0) { tokens.push({ t: ch, pos: i }); i++; continue; }
      throw new ParseError('알 수 없는 글자 "' + ch + '"가 있습니다. s, K, 숫자, + − × / ^ 괄호만 쓸 수 있습니다.', i);
    }
    return tokens;
  }

  // 값 = { n: 분자 다항식, d: 분모 다항식, k: K의 거듭제곱 }
  function val(n, d, k) {
    d = d || [1];
    if (n.length > 65 || d.length > 65) throw new ParseError('중간 전개식이 너무 큽니다. 식을 정리해서 입력해 주세요.', -1);
    if (!n.concat(d).every(Number.isFinite)) throw new ParseError('계수 계산이 수치 범위를 벗어났습니다. 단위와 계수를 조정해 주세요.', -1);
    return { n: n, d: d, k: k || 0 };
  }
  function isZeroVal(a) { return a.n.every(function (x) { return x === 0; }); }
  // Check before poly.trim: an overflowing leading coefficient must not disappear.
  function checkedPoly(p) {
    if (!p.every(Number.isFinite)) throw new ParseError('계수 계산이 수치 범위를 벗어났습니다. 단위와 계수를 조정해 주세요.', -1);
    var nonzero = p.filter(function (x) { return x !== 0; }).map(Math.abs);
    if (nonzero.length && Math.min.apply(null, nonzero) < Math.max.apply(null, nonzero) * 1e-12) throw new ParseError('계수 크기 차이가 현재 수치 정밀도 범위를 벗어납니다. 단위를 바꾸거나 식을 정리해 주세요.', -1);
    return P.trim(p);
  }
  function product(a, b) {
    if (a.length + b.length > 66) throw new ParseError('중간 전개식이 너무 큽니다. 식을 정리해서 입력해 주세요.', -1);
    var p = new Array(a.length + b.length - 1).fill(0);
    for (var i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) p[i + j] += a[i] * b[j];
    return checkedPoly(p);
  }
  function sum(a, b, sign) {
    var n = Math.max(a.length, b.length), p = [];
    for (var i = 0; i < n; i++) p.push((a[i - n + a.length] || 0) + sign * (b[i - n + b.length] || 0));
    return checkedPoly(p);
  }
  function add(a, b, sign, pos) {
    if (isZeroVal(a)) return sign > 0 ? b : val(P.scale(b.n, -1), b.d, b.k);
    if (isZeroVal(b)) return a;
    if (a.k !== b.k) throw new ParseError('K는 식 전체에 한 번만 곱해진 꼴이어야 합니다. 예: K(s+2)/(s(s+1))', pos);
    var n = sum(product(a.n, b.d), product(b.n, a.d), sign);
    return val(n, product(a.d, b.d), a.k);
  }
  function mul(a, b) { return val(product(a.n, b.n), product(a.d, b.d), a.k + b.k); }
  function div(a, b, pos) {
    if (isZeroVal(b)) throw new ParseError('0으로 나누는 부분이 있습니다.', pos);
    return val(product(a.n, b.d), product(a.d, b.n), a.k - b.k);
  }

  function Parser(tokens) { this.tk = tokens; this.i = 0; }
  Parser.prototype.peek = function () { return this.tk[this.i]; };
  Parser.prototype.next = function () { return this.tk[this.i++]; };
  Parser.prototype.expr = function () {
    var left = this.term(), t;
    while ((t = this.peek()) && (t.t === '+' || t.t === '-')) {
      this.next();
      left = add(left, this.term(), t.t === '+' ? 1 : -1, t.pos);
    }
    return left;
  };
  Parser.prototype.term = function () {
    var left = this.unary(), t;
    while ((t = this.peek())) {
      if (t.t === '*') { this.next(); left = mul(left, this.unary()); }
      else if (t.t === '/') { this.next(); left = div(left, this.unary(), t.pos); }
      else if (t.t === 'num' || t.t === 's' || t.t === 'K' || t.t === '(') { left = mul(left, this.unary()); } // 생략된 곱: 2s, (s+1)(s+2)
      else break;
    }
    return left;
  };
  Parser.prototype.unary = function () {
    var t = this.peek();
    if (t && (t.t === '-' || t.t === '+')) {
      this.next();
      var v = this.unary();
      return t.t === '-' ? val(P.scale(v.n, -1), v.d, v.k) : v;
    }
    return this.power();
  };
  Parser.prototype.power = function () {
    var base = this.primary(), t = this.peek();
    if (t && t.t === '^') {
      this.next();
      var e = this.next();
      if (!e || e.t !== 'num' || e.v !== Math.floor(e.v) || e.v > 12) throw new ParseError('거듭제곱(^)에는 0~12의 정수만 쓸 수 있습니다.', t.pos);
      var out = val([1], [1], 0), i;
      for (i = 0; i < e.v; i++) out = mul(out, base);
      return out;
    }
    return base;
  };
  Parser.prototype.primary = function () {
    var t = this.next();
    if (!t) throw new ParseError('식이 중간에 끝났습니다. 괄호나 연산자를 확인해 주세요.', -1);
    if (t.t === 'num') return val([t.v]);
    if (t.t === 's') return val([1, 0]);
    if (t.t === 'K') return val([1], [1], 1);
    if (t.t === '(') {
      var v = this.expr(), c = this.next();
      if (!c || c.t !== ')') throw new ParseError('닫는 괄호 ")"가 빠졌습니다.', t.pos);
      return v;
    }
    throw new ParseError('"' + t.t + '" 자리에 숫자나 s, 괄호가 와야 합니다.', t.pos);
  };

  // 반환: { ok, N, D, kMode: 'explicit' | 'implicit', note } 또는 { ok: false, message, pos }
  function parse(src) {
    if (String(src || '').length > 2048) return { ok: false, message: '식이 너무 깁니다. 2048자 이내로 정리해 주세요.', pos: -1 };
    var s = clean(src);
    if (!/\S/.test(s)) return { ok: false, message: '전달함수를 입력해 주세요.', pos: -1 };
    try {
      var tokens = tokenize(s);
      if (tokens.length > 512) throw new ParseError('식이 너무 복잡합니다. 괄호와 항을 정리해 주세요.', -1);
      var p = new Parser(tokens);
      var v = p.expr();
      if (p.i < p.tk.length) throw new ParseError('"' + p.tk[p.i].t + '" 근처를 해석하지 못했습니다. 괄호 짝을 확인해 주세요.', p.tk[p.i].pos);
      if (v.k > 1) return { ok: false, message: 'K가 두 번 이상 곱해져 있습니다. K는 식 전체에 한 번만 곱해 주세요.', pos: -1 };
      if (v.k < 0) return { ok: false, message: 'K가 분모에 있습니다. 이 프로그램은 K가 분자 쪽에 곱해진 꼴만 다룹니다.', pos: -1 };
      var N = checkedPoly(v.n), D = checkedPoly(v.d);
      if (D.every(function (x) { return x === 0; })) return { ok: false, message: '분모가 0입니다.', pos: -1 };
      // 분모 최고차항을 1로 맞춥니다 (그 상수는 분자로 옮겨 K와 함께 곱해짐)
      var lead = D[0], i;
      if (lead !== 1) {
        for (i = 0; i < D.length; i++) D[i] = D[i] / lead;
        for (i = 0; i < N.length; i++) N[i] = N[i] / lead;
      }
      if (!N.concat(D).every(Number.isFinite)) throw new ParseError('계수 정규화가 수치 범위를 벗어났습니다. 단위와 계수를 조정해 주세요.', -1);
      if (N.some(function (x) { return x !== 0; }) && P.isZero(N)) throw new ParseError('정규화한 분자 계수가 현재 수치 정밀도보다 작습니다. 단위와 이득 크기를 조정해 주세요.', -1);
      return {
        ok: true, N: N, D: D, kMode: v.k === 1 ? 'explicit' : 'implicit',
        note: v.k === 1 ? '식에 있는 K를 이득 K로 보고, 나머지를 N(s)/D(s)로 나눴습니다.' : '식에 K가 없어서, 식 전체에 K를 곱한 것으로 봅니다.'
      };
    } catch (e) {
      if (e instanceof ParseError) return { ok: false, message: e.message, pos: e.pos };
      throw e;
    }
  }

  RL.parser = { parse: parse, clean: clean };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
