/*
 * dump-branches.js — 엔진이 계산한 가지(곡선)와 핵심 점을 JSON으로 내보냅니다.
 * tools/overlay.py가 이 파일을 읽어 python-control 결과와 겹쳐 그립니다.
 * 실행: node tools/dump-branches.js
 */
'use strict';
var fs = require('fs'), path = require('path');
['complex', 'poly', 'format', 'routh', 'locus'].forEach(function (f) { require(path.join(__dirname, '..', 'js', f + '.js')); });
var RL = globalThis.RL, P = RL.poly;
var problems = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'problems.json'), 'utf8')).problems;
var out = [];
problems.forEach(function (pr) {
  if (pr.expectError) return;
  var res = RL.locus.analyze(P.fromFactors(pr.num), P.fromFactors(pr.den));
  out.push({
    id: pr.id, title: pr.title, N: res.N, D: res.D, view: res.view,
    branches: res.branches.map(function (b) { return b.map(function (p) { return [p.re, p.im]; }); }),
    poles: res.poles.map(function (p) { return [p.s.re, p.s.im, p.mult]; }),
    zeros: res.zeros.map(function (p) { return [p.s.re, p.s.im, p.mult]; }),
    keyPoints: res.breaks.candidates.filter(function (c) { return ['breakaway', 'breakin', 'multiple', 'complexBreak'].indexOf(c.status) >= 0; })
      .map(function (c) { return [c.s.re, c.s.im]; })
      .concat(res.stability.crossings.filter(function (c) { return c.omega > 0; }).map(function (c) { return [0, c.omega]; })),
    asymptotes: res.asymptotes
  });
});
fs.writeFileSync(path.join(__dirname, '..', 'tests', 'branches.json'), JSON.stringify(out));
console.log('저장: tests/branches.json (' + out.length + '문제)');
