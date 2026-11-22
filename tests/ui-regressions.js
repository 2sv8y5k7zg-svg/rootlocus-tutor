/* 화면 계산·표시 회귀 검사. 실제 브라우저 점검을 대체하지 않습니다. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
for (const name of ['complex', 'poly', 'format', 'routh', 'locus']) require('../js/' + name);
for (const name of ['mathview', 'content', 'graph']) require('../app/js/' + name);
const RL = globalThis.RL;
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function node() { return { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild() {}, innerHTML: '' }; }
globalThis.document = { createElementNS: node };
function graph() {
  const g = Object.create(RL.Graph.prototype);
  g.res = RL.locus.analyze([1], [1, 2, 0]);
  g.w = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
  g.scale = 10; g.k = 1; g.VW = 200; g.VH = 200;
  g.L = { cl: node() }; g.initCL();
  return g;
}
check('특성방정식·질문에 K 중복 없음', () => {
  const s = RL.content.build(RL.locus.analyze([1], [1, 2, 0]))[0];
  assert.equal(RL.content.strip(s.blocks.find(b => b.t === 'formula').h), '1 + G(s)H(s) = 0');
  assert.ok(s.questions.every(q => !JSON.stringify(q).includes('KG(s)')));
});
check('점근선 1개에 출발점 오해 방지 안내', () => {
  const s = RL.content.build(RL.locus.analyze([1, 2], [1, 1, 0]))[3];
  assert.ok(s.graphNote.includes('중심 점은 표시하지 않'));
  assert.ok(s.blocks.some(b => b.h && b.h.includes('실제 출발점은 개루프 극점')));
});
check('K=0 극점은 개루프 극점', () => {
  const g = graph(); const rs = g.setK(0).poles;
  assert.deepEqual(rs.map(z => z.re).sort((a,b) => a-b), [-2, 0]);
});
check('작은 K 변화는 잔상 유지', () => {
  const g = graph(); g.setK(0); g.setK(0.01);
  assert.ok(g.trails.every(t => t.pts.length === 2));
});
check('큰 K 변화는 직선 잔상 초기화', () => {
  const g = graph(); g.setK(0); g.setK(100);
  assert.ok(g.trails.every(t => t.pts.length === 1));
});
check('빠른 버튼은 작은 변화도 잔상 초기화', () => {
  const g = graph(); g.setK(0); g.setK(0.01, true);
  assert.ok(g.trails.every(t => t.pts.length === 1));
});
console.log('화면 회귀 검사: ' + passed + '/' + passed);
