/*
 * run-tests.js — 엔진(js/) 결과를 기준 정답(tests/expected.json)과 대조합니다.
 * 실행: node tests/run-tests.js
 * 기준 정답은 tools/reference.py(sympy·numpy)가 엔진과 독립적으로 계산한 값입니다.
 */
'use strict';
var fs = require('fs'), path = require('path');
['complex', 'poly', 'format', 'routh', 'locus'].forEach(function (f) { require(path.join(__dirname, '..', 'js', f + '.js')); });
var RL = globalThis.RL, P = RL.poly, C = RL.complex;

var problems = JSON.parse(fs.readFileSync(path.join(__dirname, 'problems.json'), 'utf8')).problems;
var expected = {};
JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8')).results.forEach(function (r) { expected[r.id] = r; });

function cx(a) { return C.c(a[0], a[1]); }
function close(a, b, tol) { return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)); }
// 두 근 목록이 (순서와 무관하게) 같은지: 가까운 것끼리 하나씩 지워 가며 비교
function sameMultiset(a, b, tol) {
  if (a.length !== b.length) return false;
  var rest = b.slice();
  return a.every(function (z) {
    var best = -1, bd = Infinity;
    rest.forEach(function (w, i) { var d = C.dist(z, w); if (d < bd) { bd = d; best = i; } });
    if (best < 0 || bd > tol * Math.max(1, C.abs(z))) return false;
    rest.splice(best, 1);
    return true;
  });
}
function expand(groups) { var out = []; groups.forEach(function (g) { for (var i = 0; i < g.mult; i++) out.push(g.s); }); return out; }

var report = [], allPass = true;
problems.forEach(function (pr) {
  var N = P.fromFactors(pr.num), D = P.fromFactors(pr.den), exp = expected[pr.id], checks = [];
  function check(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail || '' }); }
  var res = RL.locus.analyze(N, D);

  if (pr.expectError) {
    check('지원 밖 입력 안내', !res.ok && res.error.code === pr.expectError, res.ok ? '계산해 버림' : res.error.code);
  } else if (!res.ok) {
    check('분석 성공', false, res.error.message);
  } else {
    check('극점', sameMultiset(expand(res.poles), expand(exp.poles.map(function (p) { return { s: cx(p.s), mult: p.mult }; })), 1e-8));
    check('영점', sameMultiset(expand(res.zeros), expand(exp.zeros.map(function (p) { return { s: cx(p.s), mult: p.mult }; })), 1e-8));

    var segs = res.realAxis.intervals.filter(function (iv) { return iv.onLocus; });
    var segOk = segs.length === exp.realAxisSegments.length && segs.every(function (iv, i) {
      var e = exp.realAxisSegments[i];
      var hiOk = e.hi === null ? iv.hi === Infinity : close(iv.hi, e.hi, 1e-9);
      var loOk = e.lo === null ? iv.lo === -Infinity : close(iv.lo, e.lo, 1e-9);
      return hiOk && loOk;
    });
    check('실수축 구간', segOk);

    if (exp.asymptotes === null) check('점근선 없음', res.asymptotes === null);
    else check('점근선 중심·각도', res.asymptotes && close(res.asymptotes.centroid, exp.asymptotes.centroid, 1e-12) &&
      res.asymptotes.angles.length === exp.asymptotes.angles.length &&
      res.asymptotes.angles.every(function (a, i) { return close(a, exp.asymptotes.angles[i], 1e-12); }));

    var bc = res.breaks.candidates, eb = exp.breakCandidates;
    var bOk = bc.length === eb.length && bc.every(function (c) {
      var e = eb.reduce(function (best, x) { return C.dist(c.s, cx(x.s)) < C.dist(c.s, cx(best.s)) ? x : best; }, eb[0]);
      if (C.dist(c.s, cx(e.s)) > 1e-6 * Math.max(1, C.abs(c.s))) return false;
      if (c.status !== e.status || c.mult !== e.mult) return false;
      if (typeof e.K === 'number') return close(c.K, e.K, 1e-6);
      return close(c.K.re, e.K[0], 1e-6) && close(Math.abs(c.K.im), Math.abs(e.K[1]), 1e-6);
    });
    check('이탈점·진입점 판정', bOk, bc.map(function (c) { return RL.format.cnum(c.s) + ':' + c.status; }).join(', '));
    check('실수축 이탈점이 궤적 구간 안', bc.every(function (c) { return c.onRealLocus === undefined || c.onRealLocus; }));

    var ea = exp.angles, aOk = res.angles.length === ea.length && res.angles.every(function (it, i) {
      var e = ea[i];
      return it.kind === e.kind && it.mult === e.mult && C.dist(it.at, cx(e.at)) < 1e-8 &&
        it.angles.every(function (a, k) { return Math.abs(a - e.angles[k]) < 1e-7; });
    });
    check('출발각·도착각', aOk, res.angles.map(function (it) { return it.kind + ' ' + it.angles.map(function (a) { return a.toFixed(3); }).join('/'); }).join(', '));

    var cr = res.stability.crossings, ec = exp.crossings;
    check('허수축 교차', cr.length === ec.length && cr.every(function (c, i) { return close(c.omega, ec[i].omega, 1e-8) && close(c.K, ec[i].K, 1e-8); }),
      cr.map(function (c) { return 'ω=' + c.omega.toFixed(4) + ', K=' + c.K.toFixed(4); }).join(' / '));

    var es = exp.stableSetRouth || exp.stableSetNumeric, ss = res.stability.stableSet;
    var sOk = ss.length === es.length && ss.every(function (iv, i) {
      var e = es[i];
      var hiOk = e.hi === null ? iv.hi === Infinity : close(iv.hi, e.hi, 1e-8);
      return close(iv.lo, e.lo, 1e-8) && hiOk && iv.loIncl === e.loIncl && iv.hiIncl === e.hiIncl;
    });
    check('안정한 K 범위' + (exp.stableSetRouth ? '(Routh 부등식 대조)' : '(직접 계산 대조)'), sOk);
    check('Routh 부호 변화 = 우반면 극점 수', res.stability.consistent);
    check('Routh 특수 경우 감지', (exp.routhSpecial === null) === (res.stability.table.special.length === 0));

    var clOk = exp.closedLoop.every(function (cl) {
      return sameMultiset(RL.routh.closedLoopPoles(N, D, cl.K), cl.roots.map(cx), 1e-7);
    });
    check('K별 폐루프 극점(numpy 대조)', clOk);

    // 가지(곡선) 검사
    var br = res.branches, view = res.view, span = Math.hypot(view.xmax - view.xmin, view.ymax - view.ymin);
    check('가지 수 = 분모 차수', br.length === res.n);
    check('K=0에서 극점에서 출발', sameMultiset(br.map(function (b) { return C.c(b[0].re, b[0].im); }), expand(res.poles), 1e-8));
    var maxJump = 0, inView = function (p) { return p.re > view.xmin - span * 0.3 && p.re < view.xmax + span * 0.3 && Math.abs(p.im) < view.ymax + span * 0.3; };
    br.forEach(function (b) {
      for (var i = 1; i < b.length; i++) if (inView(b[i]) && inView(b[i - 1])) maxJump = Math.max(maxJump, Math.hypot(b[i].re - b[i - 1].re, b[i].im - b[i - 1].im));
    });
    check('가지가 끊기거나 건너뛰지 않음', maxJump <= 0.0065 * span, '최대 간격 ' + (maxJump / span * 100).toFixed(2) + '% (기준 0.65%)');
    var ends = br.map(function (b) { return C.c(b[b.length - 1].re, b[b.length - 1].im); });
    var endOk = expand(res.zeros).every(function (z) { return ends.some(function (e) { return C.dist(e, z) < 0.02 * span; }); }) &&
      ends.filter(function (e) { return !inView(e); }).length >= res.n - res.m;
    check('K→∞: 영점 도착 / 나머지는 무한대로', endOk);
    var keyPts = bc.filter(function (c) { return ['breakaway', 'breakin', 'multiple', 'complexBreak'].indexOf(c.status) >= 0; }).map(function (c) { return c.s; })
      .concat(cr.filter(function (c) { return c.omega > 0; }).map(function (c) { return C.c(0, c.omega); }));
    var passOk = keyPts.every(function (k) {
      return br.some(function (b) { return b.some(function (p) { return Math.hypot(p.re - k.re, p.im - k.im) < 1e-3 * span; }); });
    });
    check('가지가 이탈점·교차점을 지남', passOk);
  }
  var pass = checks.every(function (c) { return c.ok; });
  if (!pass) allPass = false;
  report.push({ id: pr.id, title: pr.title, pass: pass, checks: checks });
});

report.forEach(function (r) {
  console.log((r.pass ? 'PASS ' : 'FAIL ') + r.id + '  ' + r.title + '  (' + r.checks.filter(function (c) { return c.ok; }).length + '/' + r.checks.length + ')');
  r.checks.forEach(function (c) { if (!c.ok || process.argv.indexOf('-v') >= 0) console.log('     ' + (c.ok ? 'ok  ' : 'XX  ') + c.name + (c.detail ? '  — ' + c.detail : '')); });
});
var nPass = report.filter(function (r) { return r.pass; }).length;
console.log('\n결과: ' + nPass + '/' + report.length + ' 문제 통과, 검사 항목 ' +
  report.reduce(function (s, r) { return s + r.checks.filter(function (c) { return c.ok; }).length; }, 0) + '/' +
  report.reduce(function (s, r) { return s + r.checks.length; }, 0));
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ date: new Date().toISOString(), report: report }, null, 1));
process.exit(allPass ? 0 : 1);
