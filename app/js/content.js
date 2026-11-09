/*
 * content.js — 엔진 결과로 9단계 학습 내용을 만듭니다.
 * 각 단계: 지금 구하는 것 → 공식 → 이 문제 대입 → 계산 → 결과 → 왜 그런지
 * 그리고 힌트 사다리(개념 → 힌트 → 공식·대입 → 전체 풀이), 생각해 볼 질문, 내 답 확인을 붙입니다.
 * 화면에 나오는 숫자는 전부 엔진(js/)이 계산한 값입니다.
 */
(function (RL) {
  'use strict';
  var M = RL.mv, F = RL.format, P = RL.poly, R = RL.routh;
  var MI = '−';

  function blk(t, h, extra) { var o = { t: t, h: h }; if (extra) { for (var k in extra) o[k] = extra[k]; } return o; }
  function strip(html) { return String(html).replace(/<sup>(\d+)<\/sup>/g, '^$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'); }

  function poleRef(res, i) {
    var p = res.poles[i];
    return M.ref('p' + i, 'pole', F.cnum(p.s) + (p.mult > 1 ? ' (×' + p.mult + ')' : ''));
  }
  function zeroRef(res, i) {
    var z = res.zeros[i];
    return M.ref('z' + i, 'zero', F.cnum(z.s) + (z.mult > 1 ? ' (×' + z.mult + ')' : ''));
  }
  function joinRefs(res, kind) {
    var out = [], i, list = kind === 'pole' ? res.poles : res.zeros;
    for (i = 0; i < list.length; i++) out.push(kind === 'pole' ? poleRef(res, i) : zeroRef(res, i));
    return out.join(', ');
  }
  function nStr(x) { return F.numShort(x); }

  // 실수축 구간 이름
  function ivLabel(iv) {
    if (iv.hi === Infinity && iv.lo === -Infinity) return '실수축 전체';
    if (iv.hi === Infinity) return M.mv('s') + ' &gt; ' + nStr(iv.lo);
    if (iv.lo === -Infinity) return M.mv('s') + ' &lt; ' + nStr(iv.hi);
    return nStr(iv.lo) + ' &lt; ' + M.mv('s') + ' &lt; ' + nStr(iv.hi);
  }
  function segText(iv) {
    return iv.lo === -Infinity ? '(' + MI + '∞, ' + nStr(iv.hi) + ']' : '[' + nStr(iv.lo) + ', ' + nStr(iv.hi) + ']';
  }
  function onSegments(res) {
    var out = [], i, ivs = res.realAxis.intervals;
    for (i = 0; i < ivs.length; i++) if (ivs[i].onLocus) out.push(ivs[i]);
    return out;
  }

  // K 집합을 부등식 글로: [0, 6) → "0 ≤ K < 6"
  function setText(set) {
    if (!set.length) return '만족하는 K 없음';
    var parts = [], i;
    for (i = 0; i < set.length; i++) {
      var s = set[i], K = M.mv('K');
      if (s.hi === Infinity) parts.push(s.lo === 0 ? (s.loIncl ? '모든 ' + K + ' ≥ 0' : K + ' &gt; 0') : K + (s.loIncl ? ' ≥ ' : ' &gt; ') + F.num(s.lo));
      else parts.push(F.num(s.lo) + (s.loIncl ? ' ≤ ' : ' &lt; ') + K + (s.hiIncl ? ' ≤ ' : ' &lt; ') + F.num(s.hi));
    }
    return parts.join(', 또는 ');
  }

  // Routh 첫 열 한 칸이 양수인 K 범위 (안정 분석에서 나눈 구간마다 부호 확인)
  function positiveSet(entry, st) {
    var set = [], i, ivs = st.intervals;
    for (i = 0; i < ivs.length; i++) {
      var iv = ivs[i], pos = R.evalRk(entry, iv.sampleK) > 0;
      if (!pos) continue;
      var loVal = R.evalRk(entry, iv.lo), loIncl = isFinite(loVal) && loVal > 1e-12;
      var last = set[set.length - 1];
      if (last && last.hi === iv.lo && last.hiIncl) { last.hi = iv.hi; last.hiIncl = false; }
      else set.push({ lo: iv.lo, hi: iv.hi, loIncl: loIncl, hiIncl: false });
      if (iv.hi !== Infinity) { var hv = R.evalRk(entry, iv.hi); set[set.length - 1].hiIncl = isFinite(hv) && hv > 1e-12; }
    }
    return set;
  }

  function breakLabel(c) {
    return { breakaway: '이탈점', breakin: '진입점', multiple: '여러 가지가 만나는 점', complexBreak: '복소 이탈점' }[c.status] || '';
  }
  function validBreaks(res) {
    var out = [], i, c = res.breaks.candidates;
    for (i = 0; i < c.length; i++) if (['breakaway', 'breakin', 'multiple', 'complexBreak'].indexOf(c[i].status) >= 0) out.push({ c: c[i], i: i });
    return out;
  }
  function crossingsPos(res) {
    var out = [], i, cr = res.stability.crossings;
    for (i = 0; i < cr.length; i++) if (cr[i].omega > 0) out.push({ c: cr[i], i: i });
    return out;
  }
  function notableK(res) {
    var ks = [], i, vb = validBreaks(res), cp = res.stability.crossings;
    for (i = 0; i < vb.length; i++) ks.push({ K: vb[i].c.K, label: breakLabel(vb[i].c) });
    for (i = 0; i < cp.length; i++) ks.push({ K: cp[i].K, label: cp[i].omega > 0 ? '허수축 교차' : '원점 통과' });
    ks.sort(function (a, b) { return a.K - b.K; });
    return ks;
  }

  // ── 1 특성방정식 ─────────────────────────────
  function step1(res) {
    var Nh = M.polyH(res.N), Dh = M.polyH(res.D), ch = M.charPolyH(res.charCoef);
    var blocks = [
      blk('goal', '폐루프 극점이 만족해야 하는 식(특성방정식)을 세웁니다.'),
      blk('formula', '1 + ' + M.mv('K') + '·' + M.mv('G') + '(' + M.mv('s') + ')' + M.mv('H') + '(' + M.mv('s') + ') = 0'),
      blk('text', '개루프 전달함수를 ' + M.mv('K') + '·' + M.frac(M.mv('N') + '(' + M.mv('s') + ')', M.mv('D') + '(' + M.mv('s') + ')') + '로 나눠 씁니다.'),
      blk('calc', M.mv('N') + '(' + M.mv('s') + ') = ' + Nh + ',&ensp; ' + M.mv('D') + '(' + M.mv('s') + ') = ' + Dh),
      blk('calc', '1 + ' + M.mv('K') + '·' + M.frac(M.mv('N'), M.mv('D')) + ' = 0 &ensp;→&ensp; 양변에 ' + M.mv('D') + ' 곱하기 &ensp;→&ensp; ' + M.mv('D') + ' + ' + M.mv('K') + '·' + M.mv('N') + ' = 0'),
      blk('calc', '(' + Dh + ') + ' + M.mv('K') + '(' + Nh + ') = 0'),
      blk('result', ch + ' = 0'),
      blk('why', '음의 피드백 폐루프 전달함수의 분모가 1 + KG(s)H(s)입니다. 분모가 0이 되는 s가 폐루프 극점이고, K를 0부터 키울 때 이 근들이 움직인 자취가 근궤적입니다.')
    ];
    return {
      num: 1, key: 'char', title: '특성방정식', short: '특성식', blocks: blocks,
      graphNote: 's평면을 준비합니다. 가로축은 실수부 σ, 세로축은 허수부 jω입니다.',
      questions: [
        { q: '왜 1 + KG(s)H(s) = 0을 쓰나요?', a: '음의 피드백 폐루프 전달함수는 T(s) = KG(s) / (1 + KG(s)H(s))입니다. 폐루프 극점은 분모가 0이 되는 s라서 1 + KG(s)H(s) = 0을 풉니다.' },
        { q: 'K = 0이면 이 식의 근은 무엇인가요?', a: 'K = 0이면 D(s) = 0만 남습니다. 그래서 근이 개루프 극점과 같고, 근궤적은 개루프 극점에서 출발합니다.' }
      ],
      ladder: [
        '폐루프 전달함수의 분모가 0이 되는 s가 폐루프 극점입니다.',
        '1 + K·N(s)/D(s) = 0의 양변에 D(s)를 곱해 보세요.',
        'D(s) + K·N(s) = 0에 D(s) = ' + strip(Dh) + ', N(s) = ' + strip(Nh) + '를 넣습니다.',
        '(' + strip(Dh) + ') + K(' + strip(Nh) + ') = 0을 s의 차수별로 묶으면 ' + strip(ch) + ' = 0입니다.'
      ],
      check: null, example: null,
      facts: { 특성방정식: strip(ch) + ' = 0', 'N(s)': strip(Nh), 'D(s)': strip(Dh) }
    };
  }

  // ── 2 극점·영점·가지 수 ──────────────────────
  function step2(res) {
    var pl = joinRefs(res, 'pole'), zl = res.zeros.length ? joinRefs(res, 'zero') : '없음';
    var hasDouble = false, i;
    for (i = 0; i < res.poles.length; i++) if (res.poles[i].mult > 1) hasDouble = true;
    var blocks = [
      blk('goal', '근궤적이 어디서 출발하고 어디로 가는지 정합니다.'),
      blk('formula', '극점: ' + M.mv('D') + '(' + M.mv('s') + ') = 0 &ensp;→&ensp; ' + M.mv('K') + ' = 0일 때 출발점<br>영점: ' + M.mv('N') + '(' + M.mv('s') + ') = 0 &ensp;→&ensp; ' + M.mv('K') + ' → ∞일 때 도착점'),
      blk('calc', M.factorsH(res.poles) + ' = 0 &ensp;→&ensp; 극점 ' + M.mv('s') + ' = ' + pl),
      blk('calc', res.m > 0 ? M.factorsH(res.zeros, res.N[0]) + ' = 0 &ensp;→&ensp; 영점 ' + M.mv('s') + ' = ' + zl : '분자가 상수라 영점이 없습니다.'),
      blk('result', '가지 수 = 분모 차수 ' + M.mv('n') + ' = ' + res.n + '개 &ensp;(영점으로 ' + res.m + '개, 무한대로 ' + (res.n - res.m) + '개)')
    ];
    if (hasDouble) blocks.push(blk('note', '겹친 극점은 그래프에 ×2로 표시하고, 개수도 겹친 만큼 셉니다.'));
    blocks.push(blk('why', '특성방정식이 n차라서 근이 항상 n개입니다. 근 하나가 가지 하나를 그립니다. K가 아주 커지면 D(s)/K + N(s) = 0에서 N(s) = 0만 남아 근이 영점에 다가가고, 영점이 모자란 만큼은 무한대로 갑니다.'));
    return {
      num: 2, key: 'pz', title: '극점 · 영점 · 가지 수', short: '극·영점', blocks: blocks,
      graphNote: '× 극점(출발점), ○ 영점(도착점)이 하나씩 나타납니다.',
      questions: [
        { q: '가지 수는 왜 분모 차수인가요?', a: '특성방정식 D(s) + K·N(s) = 0은 분모 차수 n과 같은 차수의 다항식이라, 어떤 K에서든 근이 n개 있습니다. 근 하나가 K를 따라 움직이며 가지 하나를 그립니다.' },
        { q: 'K가 커지면 왜 영점으로 가나요?', a: '식을 K로 나누면 D(s)/K + N(s) = 0입니다. K → ∞이면 첫 항이 사라져 N(s) = 0, 즉 영점이 남습니다. 영점이 n개보다 적으면 나머지 가지는 무한대로 갑니다.' }
      ],
      ladder: [
        '극점은 분모 D(s)의 근, 영점은 분자 N(s)의 근입니다.',
        'D(s)와 N(s)를 인수분해해서 0이 되는 s를 찾아보세요.',
        'D(s) = ' + strip(M.factorsH(res.poles)) + ', N(s) = ' + (res.m > 0 ? strip(M.factorsH(res.zeros, res.N[0])) : '상수') + '입니다.',
        '극점 ' + strip(pl) + ', 영점 ' + strip(zl) + '. 가지는 ' + res.n + '개이고 영점으로 ' + res.m + '개, 무한대로 ' + (res.n - res.m) + '개 갑니다.'
      ],
      check: { prompt: '가지는 몇 개인가요?', values: [res.n], tol: 0 }, example: null,
      facts: { 극점: strip(pl), 영점: strip(zl), '가지 수': res.n, '영점으로 가는 가지': res.m, '무한대로 가는 가지': res.n - res.m }
    };
  }

  // ── 3 실수축 구간 ───────────────────────────
  function step3(res) {
    var ivs = res.realAxis.intervals, rows = [], i, segs = onSegments(res);
    function endName(type) { return type === 'pole' ? '극점' : (type === 'zero' ? '영점' : '∞'); }
    for (i = 0; i < ivs.length; i++) {
      var iv = ivs[i], ends = '';
      if (iv.onLocus) {
        if (iv.hiType === 'pole' && iv.loType === 'pole') ends = '극점–극점 → 사이에 이탈점';
        else if (iv.hiType === 'zero' && iv.loType === 'zero') ends = '영점–영점 → 사이에 진입점';
        else if (iv.loType === 'inf') ends = endName(iv.hiType) + '–(' + MI + '∞)';
        else ends = endName(iv.hiType) + '–' + endName(iv.loType);
      }
      rows.push({ ref: 'r' + i, cells: [ivLabel(iv), String(iv.rightCount), iv.rightCount % 2 ? '홀수 ✓' : '짝수 ✗', ends], on: iv.onLocus });
    }
    var segList = [];
    for (i = 0; i < ivs.length; i++) if (ivs[i].onLocus) segList.push(M.ref('r' + i, 'seg', segText(ivs[i])));
    var blocks = [
      blk('goal', '실수축의 어느 구간이 근궤적인지 찾습니다.'),
      blk('formula', '시험점 <b>오른쪽</b>에 있는 실수 극점·영점 개수가 <b>홀수</b>면 근궤적, 짝수면 아님<br><span class="sm">중근은 겹친 수만큼 세고, 복소 극점·영점은 세지 않습니다.</span>'),
      blk('table', '', { head: ['구간', '오른쪽 개수', '판정', '양 끝'], rows: rows }),
      blk('result', segList.length ? '근궤적인 실수축 구간: ' + segList.join(', ') : '실수축 위에는 근궤적이 없습니다.'),
      blk('why', '실수축 위의 시험점에서 보면, 오른쪽 실수 극점·영점은 각각 180°, 왼쪽 것은 0°, 복소 쌍은 위아래 각이 서로 지워져 0°를 줍니다. 그래서 오른쪽 개수가 홀수일 때만 각 조건(180°의 홀수 배)을 만족합니다.')
    ];
    var check = null;
    if (segs.length) check = { prompt: '가장 오른쪽 근궤적 구간에서, 그 구간 오른쪽에 있는 실수 극점·영점은 몇 개인가요?', values: [segs[0].rightCount], tol: 0 };
    return {
      num: 3, key: 'real', title: '실수축 구간', short: '실수축', blocks: blocks,
      graphNote: '시험점이 오른쪽부터 구간을 하나씩 지나며, 오른쪽에 있는 극점·영점을 셉니다.',
      questions: [
        { q: '왜 오른쪽의 극점과 영점 개수를 세나요?', a: '실수축 위 시험점에서 왼쪽에 있는 실수 극점·영점은 각이 0°라 각 조건에 영향을 주지 않습니다. 오른쪽에 있는 것만 각각 180°를 더하므로 오른쪽 개수만 세면 됩니다.' },
        { q: '홀수인 구간이 근궤적에 속하는 이유는 무엇인가요?', a: '근궤적 위의 점은 각의 합이 180°의 홀수 배여야 합니다(각 조건). 오른쪽 개수가 홀수면 합이 180° × 홀수가 되어 조건을 만족하고, 짝수면 360°의 배수가 되어 만족하지 않습니다.' },
        { q: '이중 극점은 몇 개로 세나요?', a: '겹친 수만큼, 즉 2개로 셉니다. 같은 자리에서 180°가 두 번 들어가 360°(= 0°)가 되기 때문에, 이중 극점 바로 왼쪽 구간은 근궤적이 아닙니다.' }
      ],
      ladder: [
        '근궤적 위의 점은 각의 합이 180°의 홀수 배여야 합니다. 실수축에서는 이것이 "오른쪽 개수 홀짝"으로 바뀝니다.',
        '실수 극점·영점을 오른쪽부터 늘어놓고, 각 구간에서 오른쪽에 몇 개가 있는지 세어 보세요.',
        '구간마다 오른쪽 개수: ' + rows.map(function (r) { return strip(r.cells[0]) + ' → ' + r.cells[1] + '개'; }).join(', ') + '.',
        '홀수인 구간만 근궤적입니다: ' + (segList.length ? strip(segList.join(', ')) : '없음') + '.'
      ],
      check: check, example: 'ex-real',
      facts: { 구간별_오른쪽_개수: rows.map(function (r) { return strip(r.cells[0]) + ': ' + r.cells[1]; }), 근궤적_구간: segList.length ? strip(segList.join(', ')) : '없음' }
    };
  }

  // ── 4 점근선 ────────────────────────────────
  function step4(res) {
    var A = res.asymptotes;
    if (!A) {
      return {
        num: 4, key: 'asym', title: '점근선', short: '점근선',
        blocks: [
          blk('goal', '무한대로 가는 가지가 따라가는 직선을 구합니다.'),
          blk('none', M.mv('n') + ' = ' + M.mv('m') + ' = ' + res.n + '이라 무한대로 가는 가지가 없습니다.<br><b>이 문제에서는 해당하지 않음</b> — 모든 가지가 영점에 도착합니다.')
        ],
        graphNote: '점근선이 없습니다.',
        questions: [{ q: '점근선이 없으면 가지는 어디로 가나요?', a: '분자와 분모 차수가 같으면 영점 수가 극점 수와 같아서, 모든 가지가 K → ∞일 때 영점에 도착합니다.' }],
        ladder: ['점근선 개수는 n − m입니다.', 'n과 m을 비교해 보세요.', 'n = m = ' + res.n + '입니다.', 'n − m = 0이라 점근선이 없습니다.'],
        check: null, example: 'ex-asym', facts: { 점근선: '없음 (n = m = ' + res.n + ')' }
      };
    }
    var angs = [], k;
    for (k = 0; k < A.q; k++) angs.push(M.mv('k') + ' = ' + k + ' → ' + F.deg(A.angles[k]) + (A.angles[k] > 180 ? ' (= ' + F.deg(A.angles[k] - 360) + ')' : ''));
    var sp = [], sz = [], i, hasComplex = false;
    for (i = 0; i < res.poles.length; i++) {
      var p = res.poles[i];
      if (p.s.im !== 0) hasComplex = true;
      sp.push((p.mult > 1 ? p.mult + '×' : '') + '(' + F.cnum(p.s) + ')');
    }
    for (i = 0; i < res.zeros.length; i++) { var z = res.zeros[i]; if (z.s.im !== 0) hasComplex = true; sz.push((z.mult > 1 ? z.mult + '×' : '') + '(' + F.cnum(z.s) + ')'); }
    var cen = M.ref('c', 'asym', F.num(A.centroid));
    var blocks = [
      blk('goal', '무한대로 가는 가지가 따라가는 직선(점근선)을 구합니다.'),
      blk('formula', '개수 = ' + M.mv('n') + ' ' + MI + ' ' + M.mv('m') + '<br>각도 = ' + M.frac('(2' + M.mv('k') + ' + 1)·180°', M.mv('n') + ' ' + MI + ' ' + M.mv('m')) + ',&ensp; ' + M.mv('k') + ' = 0, 1, …, ' + M.mv('n') + ' ' + MI + ' ' + M.mv('m') + ' ' + MI + ' 1<br>중심 ' + M.mv('σ') + ' = ' + M.frac('Σ극점 ' + MI + ' Σ영점', M.mv('n') + ' ' + MI + ' ' + M.mv('m'))),
      blk('calc', M.mv('n') + ' ' + MI + ' ' + M.mv('m') + ' = ' + res.n + ' ' + MI + ' ' + res.m + ' = ' + A.q + '개'),
      blk('calc', '각도: ' + angs.join(',&ensp; ')),
      blk('calc', 'Σ극점 = ' + sp.join(' + ') + ' = ' + F.num(A.sumPoles) + '<br>Σ영점 = ' + (sz.length ? sz.join(' + ') + ' = ' + F.num(A.sumZeros) : '0 (영점 없음)')),
      blk('calc', M.mv('σ') + ' = ' + M.frac('(' + F.num(A.sumPoles) + ') ' + MI + ' (' + F.num(A.sumZeros) + ')', String(A.q)) + ' = ' + cen),
      blk('result', '중심 ' + cen + '에서 ' + A.angles.map(function (a) { return F.deg(a > 180 ? a - 360 : a); }).join(', ') + ' 방향'),
      blk('note', (hasComplex ? '복소 극점·영점은 켤레쌍의 허수부가 서로 지워져 실수부만 더해집니다. ' : '') + '각도 식의 소문자 ' + M.mv('k') + '는 0, 1, 2…를 차례로 넣는 정수이고, 이득 ' + M.mv('K') + '와 다릅니다.'),
      blk('why', '|s|가 아주 크면 G(s)H(s)가 1/(s − σ)^(n−m)처럼 보여서, 무한대로 가는 가지가 σ에서 뻗은 직선을 따라갑니다. 점근선은 먼 곳의 방향만 정하는 보조선이라, 가까운 곳에서는 가지가 점근선을 가로지를 수도 있습니다.')
    ];
    return {
      num: 4, key: 'asym', title: '점근선', short: '점근선', blocks: blocks,
      graphNote: '중심 σ가 찍힌 뒤 각도대로 점근선이 하나씩 뻗습니다.',
      questions: [
        { q: '점근선 중심은 왜 극점 합에서 영점 합을 빼나요?', a: '아주 먼 곳에서 보면 극점 n개와 영점 m개가 한 점 σ에 모여 있는 것처럼 보입니다. 특성방정식의 sⁿ⁻¹ 계수를 비교하면 그 점이 (Σ극점 − Σ영점)/(n − m)으로 나옵니다.' },
        { q: '점근선은 근궤적이 반드시 지나는 선인가요?', a: '아닙니다. 아주 먼 곳에서의 방향만 정해 줍니다. 가까운 곳에서는 가지가 점근선 한쪽에 있거나 한 번 가로지를 수 있어서, 그림에서는 계산으로 구한 점을 정확히 지나게 그리는 것이 우선입니다.' },
        { q: '(2k + 1)·180°에서 k는 무슨 뜻인가요?', a: '각 조건은 180°의 홀수 배를 요구합니다. k는 그 홀수 배를 차례로 고르는 정수(0, 1, 2, …)이고, k 하나마다 점근선이 하나 생깁니다.' }
      ],
      ladder: [
        '점근선은 무한대로 가는 가지의 방향입니다. 개수, 각도, 중심 세 가지를 구합니다.',
        '극점의 합과 영점의 합을 먼저 구해 보세요. 복소쌍은 실수부만 남습니다.',
        'σ = (Σ극점 − Σ영점)/(n − m) = (' + F.dec(A.sumPoles) + ' − (' + F.dec(A.sumZeros) + '))/' + A.q + ', 각도 = (2k + 1)·180°/' + A.q + '.',
        '중심 σ = ' + F.num(A.centroid) + ', 각도 ' + A.angles.map(function (a) { return F.deg(a); }).join(', ') + '.'
      ],
      check: { prompt: '점근선 중심 σ는? (분수나 소수)', values: [A.centroid], tol: 0.01 }, example: 'ex-asym',
      facts: { '점근선 개수': A.q, Σ극점: A.sumPoles, Σ영점: A.sumZeros, '중심 σ': A.centroid, '각도(도)': A.angles }
    };
  }

  // ── 5 이탈점 · 진입점 ───────────────────────
  function step5(res) {
    var B = res.breaks.B, cands = res.breaks.candidates, i;
    var Dp = P.deriv(res.D), Np = P.deriv(res.N);
    // 보기 좋게: 계수 공약수로 나누기
    var Bn = B.slice(), g = 0;
    if (Bn.every(function (v) { return Math.abs(v - Math.round(v)) < 1e-9; })) {
      for (i = 0; i < Bn.length; i++) g = F.gcd(g, Math.round(Math.abs(Bn[i])));
      if (g > 1) Bn = Bn.map(function (v) { return Math.round(v) / g; });
    }
    var lines = [], vb = validBreaks(res);
    for (i = 0; i < cands.length; i++) {
      var c = cands[i], sTxt = (c.conjugate ? F.cnum(c.s).replace(' + ', ' ± ') : F.cnum(c.s)), line;
      if (c.status === 'complexK') line = M.mv('s') + ' = ' + sTxt + ' &ensp;→&ensp; ' + M.mv('K') + '가 복소수 &ensp;→&ensp; 근궤적 위의 점이 아님';
      else if (c.status === 'negativeK') line = M.mv('s') + ' = ' + sTxt + ' &ensp;→&ensp; ' + M.mv('K') + ' = ' + F.num(c.K) + ' &lt; 0 &ensp;→&ensp; ' + M.mv('K') + ' ≥ 0 근궤적 위의 점이 아님';
      else if (c.status === 'start') line = M.mv('s') + ' = ' + sTxt + ' &ensp;→&ensp; ' + M.mv('K') + ' = 0인 겹친 극점 자리 &ensp;→&ensp; 출발점이라 이탈점으로 쓰지 않음';
      else {
        var lbl = breakLabel(c), why = '';
        if (c.status === 'breakaway') why = ' (그 구간에서 K가 가장 큰 점, 언덕 꼭대기)';
        else if (c.status === 'breakin') why = ' (그 구간에서 K가 가장 작은 점, 골짜기 바닥)';
        else if (c.status === 'multiple') why = ' (' + c.meeting + '개 가지가 한 점에서 만남)';
        else if (c.status === 'complexBreak') why = ' (실수축 밖에서 가지가 만났다가 갈라짐)';
        var idx = 0, j;
        for (j = 0; j < vb.length; j++) if (vb[j].i === i) idx = j;
        line = M.mv('s') + ' = ' + M.ref('b' + idx, 'key', sTxt) + ' &ensp;→&ensp; ' + M.mv('K') + ' = ' + F.num(c.K) + ' &gt; 0 &ensp;→&ensp; <b>' + lbl + '</b>' + why;
      }
      lines.push(line);
    }
    var result;
    if (vb.length) result = vb.map(function (v, k) { return breakLabel(v.c) + ' ' + M.ref('b' + k, 'key', F.cnum(v.c.s)) + ' (' + M.mv('K') + ' = ' + F.num(v.c.K) + ')'; }).join(',&ensp; ');
    else result = '<b>이 문제에서는 해당하지 않음</b> — K ≥ 0 근궤적 위의 이탈점·진입점이 없습니다.';
    var blocks = [
      blk('goal', '가지가 실수축에서 갈라지거나(이탈점) 합쳐지는(진입점) 점을 찾습니다.'),
      blk('formula', M.mv('K') + ' = ' + MI + M.frac(M.mv('D') + '(' + M.mv('s') + ')', M.mv('N') + '(' + M.mv('s') + ')') + ' &ensp;→&ensp; ' + M.frac('d' + M.mv('K'), 'd' + M.mv('s')) + ' = 0 &ensp;⇔&ensp; ' + M.mv('D') + '′' + M.mv('N') + ' ' + MI + ' ' + M.mv('D') + M.mv('N') + '′ = 0'),
      blk('calc', M.mv('D') + '′(' + M.mv('s') + ') = ' + M.polyH(Dp) + ',&ensp; ' + M.mv('N') + '′(' + M.mv('s') + ') = ' + M.polyH(Np)),
      blk('calc', (P.degree(B) < 1 ? '식이 상수라 해가 없습니다.' : M.polyH(Bn) + ' = 0' + (g > 1 ? ' &ensp;<span class="sm">(공약수 ' + g + '로 나눔)</span>' : '')))
    ];
    if (P.degree(B) >= 3) blocks.push(blk('note', '3차 이상이면 공학용 계산기의 방정식 기능이나 구간 대입으로 근을 찾습니다.'));
    if (lines.length) blocks.push(blk('calc', '후보를 ' + M.mv('K') + ' = ' + MI + M.mv('D') + '/' + M.mv('N') + '에 넣어 확인:<br>' + lines.join('<br>')));
    blocks.push(blk('result', result));
    blocks.push(blk('kchart', '', {}));
    blocks.push(blk('why', '실수축에서 마주 오는 두 가지는 K가 그 구간에서 가장 큰 점에서 만나 갈라지고, 실수축으로 들어오는 두 가지는 K가 가장 작은 점에서 합쳐집니다. dK/ds = 0은 K < 0 근궤적의 점도 함께 내놓으니, 후보를 K 식에 넣어 부호를 꼭 확인합니다.'));
    var realValid = vb.filter(function (v) { return v.c.s.im === 0; });
    return {
      num: 5, key: 'break', title: '이탈점 · 진입점', short: '이탈점', blocks: blocks,
      graphNote: '후보가 표시되고, K가 양수인 점만 남습니다.',
      questions: [
        { q: '이탈점은 왜 K가 가장 큰 점인가요?', a: '두 극점 사이 구간에서는 양쪽 극점에서 K = 0으로 출발한 두 근이 K가 커질수록 서로 다가옵니다. 실수축 위에서 K가 가장 커지는 지점에서 두 근이 만나고, 그보다 큰 K에서는 실수축을 떠나 복소수가 됩니다.' },
        { q: '후보를 왜 K에 대입해 확인하나요?', a: 'dK/ds = 0의 근에는 K < 0인 근궤적(양의 피드백) 위의 점이나 K가 복소수인 점도 섞여 나옵니다. K = −D/N이 양의 실수인 후보만 K ≥ 0 근궤적 위의 이탈점·진입점입니다.' }
      ],
      ladder: [
        '이탈점·진입점은 실수축 위에서 K가 최대·최소가 되는 점입니다. 그래서 dK/ds = 0을 풉니다.',
        'K = −D(s)/N(s)를 미분하는 대신 D′N − DN′ = 0을 풀면 됩니다.',
        'D′(s) = ' + strip(M.polyH(Dp)) + ', N′(s) = ' + strip(M.polyH(Np)) + '이고, D′N − DN′ = ' + strip(M.polyH(Bn)) + ' = 0입니다.',
        vb.length ? '후보 중 K > 0인 점: ' + vb.map(function (v) { return breakLabel(v.c) + ' s = ' + F.cnum(v.c.s) + ' (K = ' + F.num(v.c.K) + ')'; }).join(', ') + '.' : '후보는 모두 K < 0이거나 K가 복소수라, 이 문제에는 이탈점·진입점이 없습니다.'
      ],
      check: realValid.length ? { prompt: '실수축 위 ' + breakLabel(realValid[0].c) + '의 s 값은? (소수 둘째 자리까지)', values: realValid.map(function (v) { return v.c.s.re; }), tol: 0.02 } : null,
      example: 'ex-break',
      facts: { '이탈점 방정식 D′N − DN′': strip(M.polyH(Bn)) + ' = 0', 후보: cands.map(function (c) { return { s: F.cnum(c.s), K: typeof c.K === 'number' ? c.K : F.cnum(c.K), 판정: c.status }; }) }
    };
  }

  // ── 6 출발각 · 도착각 ───────────────────────
  function step6(res) {
    var items = res.angles, i, j;
    if (!items.length) {
      return {
        num: 6, key: 'angle', title: '출발각 · 도착각', short: '출발각',
        blocks: [
          blk('goal', '복소 극점에서 가지가 떠나는 방향(출발각), 복소 영점으로 들어오는 방향(도착각)을 구합니다.'),
          blk('none', '복소 극점·영점이나 겹친 극점이 없습니다.<br><b>이 문제에서는 해당하지 않음</b> — 실수축 위 단순 극점은 실수축을 따라 출발합니다.')
        ],
        graphNote: '구할 각이 없습니다.',
        questions: [{ q: '실수 극점에서는 왜 출발각을 안 구하나요?', a: '실수축 위의 단순 극점에서는 가지가 실수축 구간을 따라 출발하므로 방향이 이미 정해져 있습니다. 복소 극점이나 겹친 극점처럼 방향이 정해지지 않은 경우에만 구합니다.' }],
        ladder: ['출발각은 복소 극점(또는 겹친 극점)에서만 구합니다.', '극점·영점 목록에서 복소수가 있는지 보세요.', '복소 극점·영점이 없습니다.', '이 문제에는 출발각·도착각이 없습니다.'],
        check: null, example: 'ex-angle', facts: { 출발각_도착각: '해당 없음' }
      };
    }
    var blocks = [
      blk('goal', '복소 극점에서 가지가 떠나는 방향(출발각), 복소 영점으로 들어오는 방향(도착각)을 구합니다.'),
      blk('formula', M.mv('θ') + '<sub>출발</sub> = 180° + Σ(영점 → 그 극점 각) ' + MI + ' Σ(다른 극점 → 그 극점 각)<br>' + M.mv('θ') + '<sub>도착</sub> = 180° + Σ(극점 → 그 영점 각) ' + MI + ' Σ(다른 영점 → 그 영점 각)'),
      blk('note', '벡터 = (그 점) ' + MI + ' (다른 점), 각 = arctan(세로/가로). 가로가 음수면 180°에서 빼서 사분면을 맞춥니다.')
    ];
    var facts = [];
    for (i = 0; i < items.length; i++) {
      var it = items[i], dep = it.kind === 'departure', lines = [];
      var plusName = dep ? '영점' : '극점', minusName = dep ? '극점' : '영점';
      for (j = 0; j < it.plus.length; j++) { var t = it.plus[j]; lines.push(plusName + ' ' + F.cnum(t.from) + ' → (' + F.numShort(t.dx) + ', ' + F.numShort(t.dy) + '): ' + F.deg(t.angle) + (t.mult > 1 ? ' ×' + t.mult : '')); }
      for (j = 0; j < it.minus.length; j++) { var u = it.minus[j]; lines.push(minusName + ' ' + F.cnum(u.from) + ' → (' + F.numShort(u.dx) + ', ' + F.numShort(u.dy) + '): ' + F.deg(u.angle) + (u.mult > 1 ? ' ×' + u.mult : '')); }
      var plusSum = it.plus.length ? it.plus.map(function (t) { return (t.mult > 1 ? t.mult + '×' : '') + F.deg(t.angle); }).join(' + ') : '0°';
      var minusSum = it.minus.length ? it.minus.map(function (t) { return (t.mult > 1 ? t.mult + '×' : '') + F.deg(t.angle); }).join(' + ') : '0°';
      var head = '180° + (' + plusSum + ') ' + MI + ' (' + minusSum + ')';
      var res1 = M.ref('a' + i, 'angle', F.deg(it.angles[0]));
      blocks.push(blk('sub', (dep ? '출발각' : '도착각') + ' · ' + M.mv('s') + ' = ' + F.cnum(it.at) + (it.mult > 1 ? ' (×' + it.mult + ')' : '')));
      blocks.push(blk('calc', lines.join('<br>')));
      if (it.mult === 1) blocks.push(blk('result', M.mv('θ') + ' = ' + head + ' = ' + res1 + (it.at.im > 0 ? ' &ensp;<span class="sm">아래쪽 켤레는 ' + F.deg(-it.angles[0]) + '</span>' : '')));
      else blocks.push(blk('result', M.mv('θ') + ' = ' + M.frac(head, String(it.mult)) + ' = ' + F.deg(normalize(it.base / it.mult)) + ', 그리고 360°/' + it.mult + '씩 더해 &ensp;→&ensp; ' + it.angles.map(function (a, k) { return k === 0 ? res1 : F.deg(a); }).join(', ')));
      facts.push({ 종류: dep ? '출발각' : '도착각', 위치: F.cnum(it.at), 각도: it.angles, 더하는_각: it.plus.map(function (t) { return t.angle; }), 빼는_각: it.minus.map(function (t) { return t.angle; }) });
    }
    blocks.push(blk('note', '교재 표기 ' + M.mv('θ') + ' = Σ영점각 ' + MI + ' Σ극점각 ' + MI + ' (2' + M.mv('k') + ' + 1)·180°와 같은 값입니다.'));
    blocks.push(blk('why', '극점 바로 옆의 점도 근궤적 위에 있으려면 각 조건(전체 각 = 180°의 홀수 배)을 만족해야 합니다. 그 조건을 떠나는 방향 θ에 대해 풀면 위 공식이 됩니다.'));
    var first = items[0];
    return {
      num: 6, key: 'angle', title: '출발각 · 도착각', short: '출발각', blocks: blocks,
      graphNote: '다른 극점·영점에서 그 점으로 벡터를 긋고 각을 잰 뒤, 떠나는 방향을 화살표로 보여 줍니다.',
      questions: [
        { q: '출발각 공식에 180°가 왜 들어가나요?', a: '근궤적 위의 점은 각의 합이 180°의 홀수 배여야 합니다. 극점 바로 옆의 점에 이 조건을 쓰고 출발 방향 θ만 남기면 θ = 180° + Σ영점각 − Σ다른 극점각이 됩니다.' },
        { q: 'arctan을 계산기로 구하면 왜 틀릴 때가 있나요?', a: '계산기의 arctan은 −90°~90°만 돌려줍니다. 벡터의 가로 성분이 음수(2·3사분면)이면 180°를 보정해야 맞는 각이 나옵니다. 예: (−2, 2)는 arctan 값 −45°가 아니라 135°입니다.' }
      ],
      ladder: [
        '출발각은 극점 바로 옆에서도 각 조건(180°의 홀수 배)을 만족하도록 정해집니다.',
        '다른 극점·영점에서 ' + F.cnum(first.at) + '까지의 벡터를 그리고 각각의 각을 재 보세요.',
        'θ = 180° + Σ(' + (first.kind === 'departure' ? '영점' : '극점') + ' 각) − Σ(다른 ' + (first.kind === 'departure' ? '극점' : '영점') + ' 각)' + (first.mult > 1 ? ', 겹친 수 ' + first.mult + '로 나눕니다.' : '에 잰 각을 넣습니다.'),
        items.map(function (it) { return (it.kind === 'departure' ? '출발각' : '도착각') + ' ' + F.cnum(it.at) + ': ' + it.angles.map(function (a) { return F.deg(a); }).join(', '); }).join(' / ') + '.'
      ],
      check: { prompt: (first.kind === 'departure' ? '출발각' : '도착각') + ' (' + F.cnum(first.at) + ')은 몇 도인가요?', values: first.angles, tol: 0.6, unit: '°' },
      example: 'ex-angle', facts: { 각: facts }
    };
  }
  function normalize(a) { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; }

  // ── 7 Routh 표 · 허수축 교차 ────────────────
  function step7(res) {
    var st = res.stability, tb = st.table, rows = [], i, j;
    for (i = 0; i < tb.rows.length; i++) {
      var cells = [];
      for (j = 0; j < tb.rows[i].length; j++) cells.push(M.rkH(tb.rows[i][j]));
      rows.push({ pw: tb.powers[i], cells: cells });
    }
    var special = tb.special.length ? tb.special[0] : null;
    var blocks = [
      blk('goal', '근궤적이 허수축을 넘는 K를 찾아, 안정한 K 범위를 정합니다.'),
      blk('formula', '특성방정식 계수로 Routh 표를 만들고, <b>첫 열이 모두 양수</b>일 때 안정<br><span class="sm">첫 열 부호가 바뀌는 횟수 = 우반면 극점 수</span>'),
      blk('routh', '', { rows: rows, special: special })
    ];
    if (special && special.type === 'firstColZero') {
      blocks.push(blk('note', M.mv('s') + '<sup>' + tb.powers[special.row] + '</sup> 행 첫 칸이 K와 상관없이 0이 됩니다. 0을 아주 작은 양수 ε로 바꿔 계속 계산하는 방법(ε 방법)을 씁니다. 이 경우 표는 여기까지만 보여 주고, 안정 판정은 각 K에서 폐루프 극점을 직접 계산해 확인했습니다.'));
    } else {
      var conds = [];
      for (i = 0; i < tb.rows.length; i++) {
        var e = tb.rows[i][0];
        if (e.n.length === 1 && e.d.length === 1) continue; // 상수는 생략
        conds.push(M.rkH(e) + ' &gt; 0 &ensp;→&ensp; ' + setText(positiveSet(e, st)));
      }
      if (conds.length) blocks.push(blk('calc', '첫 열이 양수인 조건:<br>' + conds.join('<br>')));
      else blocks.push(blk('calc', '첫 열에 K가 들어간 칸이 없습니다.'));
    }
    var stable = setText(st.stableSet);
    blocks.push(blk('result', '안정한 K 범위: ' + stable));
    var hasOriginPole = false;
    for (i = 0; i < res.poles.length; i++) if (Math.abs(res.poles[i].s.re) < 1e-12) hasOriginPole = true;
    if (hasOriginPole && st.stableSet.length && st.stableSet[0].lo === 0 && !st.stableSet[0].loIncl) {
      blocks.push(blk('note', M.mv('K') + ' = 0이면 허수축 위(원점)의 개루프 극점이 그대로 남아 임계 안정이므로 범위에 넣지 않습니다.'));
    }
    var cp = crossingsPos(res), crossLines = [];
    for (i = 0; i < cp.length; i++) {
      var c = cp[i].c, aux = R.auxEquation(tb, c.K), auxTxt = '';
      if (aux && !special) auxTxt = M.mv('K') + ' = ' + F.num(c.K) + '이면 ' + M.mv('s') + '<sup>' + tb.powers[aux.fromRow + 1] + '</sup> 행이 0 &ensp;→&ensp; 바로 위 ' + M.mv('s') + '<sup>' + aux.power + '</sup> 행으로 보조방정식: ' + M.polyH(aux.poly) + ' = 0 &ensp;→&ensp; ';
      crossLines.push(auxTxt + M.mv('s') + ' = ±' + M.ref('x' + i, 'key', 'j' + F.num(c.omega)) + ' &ensp;(' + M.mv('K') + ' = ' + F.num(c.K) + ')');
    }
    if (crossLines.length) blocks.push(blk('calc', '허수축 교차: <br>' + crossLines.join('<br>')));
    else blocks.push(blk('none', '허수축 교차 없음 &ensp;→&ensp; ' + (st.stableSet.length ? '근궤적이 허수축을 넘지 않습니다.' : 'K > 0에서 항상 우반면 극점이 있습니다.')));
    blocks.push(blk('why', '경계의 K에서는 폐루프 극점이 허수축 위에 있어 출력이 줄지도 늘지도 않는 진동(임계 안정)이 됩니다. 그래서 경계 K는 안정 범위에 넣지 않습니다.'));
    return {
      num: 7, key: 'routh', title: 'Routh 표 · 허수축 교차', short: 'Routh', blocks: blocks,
      graphNote: 'Routh 표가 한 행씩 채워지고, 허수축을 지나는 점이 표시됩니다.',
      questions: [
        { q: 'Routh 표에서 첫 열만 보는 이유는?', a: 'Routh 판별법에서 첫 열의 부호가 바뀌는 횟수가 우반면 극점 수와 같습니다. 그래서 첫 열이 모두 같은 부호(양수)면 우반면 극점이 없어 안정합니다.' },
        { q: '경계 K에서는 안정인가요?', a: '아닙니다. 경계 K에서는 폐루프 극점이 허수축 위에 있어 계속 진동하는 임계 안정입니다. 안정 범위는 경계를 빼고 씁니다.' }
      ],
      ladder: [
        '근궤적이 허수축을 넘는 순간이 안정과 불안정의 경계입니다. Routh 표의 첫 열로 찾습니다.',
        '특성방정식 ' + strip(M.charPolyH(res.charCoef)) + ' = 0의 계수로 Routh 표를 채워 보세요.',
        '첫 열: ' + rows.map(function (r) { return 's^' + r.pw + ': ' + strip(r.cells[0]); }).join(', ') + '. 모두 양수인 K를 찾습니다.',
        '안정한 K 범위는 ' + strip(stable) + '. ' + (cp.length ? '허수축 교차: ' + cp.map(function (x) { return 's = ±j' + F.num(x.c.omega) + ' (K = ' + F.num(x.c.K) + ')'; }).join(', ') + '.' : '허수축 교차는 없습니다.')
      ],
      check: cp.length ? { prompt: '허수축을 지나는 K는?', values: cp.map(function (x) { return x.c.K; }), tol: 0.02 } : null,
      example: 'ex-routh',
      facts: { 'Routh 첫 열': rows.map(function (r) { return 's^' + r.pw + ': ' + strip(r.cells[0]); }), '안정한 K 범위': strip(stable), '허수축 교차': cp.map(function (x) { return { omega: x.c.omega, K: x.c.K }; }), '특수 경우': special ? special.type : '없음' }
    };
  }

  // ── 8 근궤적 완성 ───────────────────────────
  function step8(res) {
    var segs = onSegments(res).map(segText), vb = validBreaks(res), cp = crossingsPos(res), A = res.asymptotes;
    var items = [
      '출발: 극점 ' + joinRefs(res, 'pole') + ' &ensp;(' + M.mv('K') + ' = 0)',
      '도착: ' + (res.m ? '영점 ' + joinRefs(res, 'zero') : '') + (res.m && res.n - res.m ? ' 그리고 ' : '') + (res.n - res.m ? '무한대 ' + (res.n - res.m) + '개' : ''),
      '실수축 구간: ' + (segs.length ? segs.join(', ') : '없음'),
      '점근선: ' + (A ? '중심 ' + F.num(A.centroid) + ', ' + A.angles.map(function (a) { return F.deg(a > 180 ? a - 360 : a); }).join(', ') : '없음'),
      '이탈점·진입점: ' + (vb.length ? vb.map(function (v) { return breakLabel(v.c) + ' ' + F.cnum(v.c.s); }).join(', ') : '없음'),
      '출발각·도착각: ' + (res.angles.length ? res.angles.map(function (it) { return F.cnum(it.at) + ' ' + it.angles.map(function (a) { return F.deg(a); }).join('/'); }).join(', ') : '없음'),
      '허수축 교차: ' + (cp.length ? cp.map(function (x) { return '±j' + F.num(x.c.omega) + ' (' + M.mv('K') + ' = ' + F.num(x.c.K) + ')'; }).join(', ') : '없음'),
      '안정한 K 범위: ' + setText(res.stability.stableSet)
    ];
    return {
      num: 8, key: 'full', title: '근궤적 완성', short: '완성',
      blocks: [
        blk('goal', '지금까지 구한 것을 모아 근궤적을 그립니다.'),
        blk('list', '', { items: items }),
        blk('note', '화살표는 K가 커지는 방향입니다. 가지는 극점에서 출발해 영점이나 무한대로 갑니다.')
      ],
      graphNote: '극점에서 출발한 가지가 K를 따라 그려집니다.',
      questions: [
        { q: '가지는 어느 방향으로 움직이나요?', a: 'K = 0에서 극점에 있던 근이 K가 커질수록 움직여, K → ∞에서 영점에 도착하거나 점근선을 따라 무한대로 갑니다. 그림의 화살표가 K가 커지는 방향입니다.' },
        { q: '가지가 점근선을 넘어가도 되나요?', a: '됩니다. 점근선은 먼 곳의 방향만 정해 줍니다. 그림에서는 출발각, 이탈점, 허수축 교차점처럼 계산한 점을 정확히 지나게 그리는 것이 우선입니다.' }
      ],
      ladder: ['1~7단계 결과를 모두 모아 그립니다.', '극점에서 출발해 실수축 구간, 이탈점, 출발각 방향을 차례로 이어 보세요.', '무한대로 가는 가지는 점근선 쪽으로 휘어 가게 그립니다.', '정리: ' + items.map(strip).join(' / ')],
      check: null, example: null, facts: { 요약: items.map(strip) }
    };
  }

  // ── 9 K 변화 ────────────────────────────────
  function step9(res) {
    return {
      num: 9, key: 'kslide', title: 'K 변화와 안정성', short: 'K 변화',
      blocks: [
        blk('goal', 'K를 바꾸며 폐루프 극점이 실제로 어디 있는지 확인합니다.'),
        blk('slider', ''),
        blk('note', '× 개루프 극점은 고정이고, ● 폐루프 극점이 K에 따라 가지 위를 움직입니다. 복소 극점 쌍이 있으면 원점에서 그 극점까지의 원(ωn 일정)과 감쇠비 ζ를 함께 보여 줍니다.')
      ],
      graphNote: '슬라이더를 움직이면 계산된 폐루프 극점이 가지를 따라 움직입니다.',
      questions: [
        { q: 'K를 키우면 왜 불안정해질 수 있나요?', a: '가지가 허수축을 넘어 우반면으로 가면, 그 극점은 시간이 갈수록 커지는 응답을 만듭니다. 근궤적이 허수축을 넘는 K가 안정의 경계입니다.' },
        { q: '감쇠비 ζ와 극점 위치는 어떤 관계인가요?', a: '복소 극점 s = −ζωn ± jωn√(1 − ζ²)에서, 원점에서 극점까지의 거리가 ωn이고 음의 실수축과 이루는 각 θ에 대해 ζ = cos θ입니다. 극점이 허수축에 가까워질수록 ζ가 작아져 진동이 커집니다.' }
      ],
      ladder: ['K마다 특성방정식의 근이 폐루프 극점입니다.', '슬라이더로 K를 바꾸며 극점이 허수축에 다가가는지 보세요.', '허수축 교차 K와 이탈점 K 버튼을 눌러 그 순간의 극점을 확인하세요.', '안정한 K 범위: ' + strip(setText(res.stability.stableSet)) + '.'],
      check: null, example: null, facts: { '특별한 K': notableK(res).map(function (x) { return x.label + ' K = ' + x.K; }) }
    };
  }

  function build(res) { return [step1(res), step2(res), step3(res), step4(res), step5(res), step6(res), step7(res), step8(res), step9(res)]; }

  // 미리 검증한 간단한 예시 (tests/problems.json에 들어 있는 문제)
  var EXAMPLES = {
    'ex-real': { title: '실수축 구간 예시', input: 'K(s+2)/(s(s+1))', focus: 3, test: 'T03' },
    'ex-asym': { title: '점근선 예시', input: 'K/(s(s+1)(s+2))', focus: 4, test: 'T02' },
    'ex-break': { title: '이탈점 예시', input: 'K/(s(s+2))', focus: 5, test: 'T01' },
    'ex-angle': { title: '출발각 예시', input: 'K/(s^2+2s+2)', focus: 6, test: 'T15' },
    'ex-routh': { title: 'Routh 예시', input: 'K/(s(s+1)(s+2))', focus: 7, test: 'T02' }
  };

  // AI 답변의 숫자 검사용: 이 문제의 검증된 숫자 모음
  function allNumbers(res) {
    var out = [], i, j;
    function add(x) { if (typeof x === 'number' && isFinite(x)) { out.push(x); out.push(Math.abs(x)); } }
    function addZ(z) { add(z.re); add(z.im); }
    res.N.forEach(add); res.D.forEach(add);
    for (i = 0; i < res.charCoef.length; i++) res.charCoef[i].forEach(add);
    res.poles.forEach(function (p) { addZ(p.s); add(p.mult); });
    res.zeros.forEach(function (p) { addZ(p.s); add(p.mult); });
    add(res.n); add(res.m); add(res.n - res.m);
    if (res.asymptotes) { add(res.asymptotes.centroid); add(res.asymptotes.sumPoles); add(res.asymptotes.sumZeros); res.asymptotes.angles.forEach(function (a) { add(a); add(a - 360); }); }
    res.breaks.B.forEach(add);
    res.breaks.candidates.forEach(function (c) { addZ(c.s); if (typeof c.K === 'number') add(c.K); else addZ(c.K); });
    res.angles.forEach(function (it) { it.angles.forEach(add); add(it.base); add(it.sumPlus); add(it.sumMinus); it.plus.concat(it.minus).forEach(function (t) { add(t.angle); add(t.dx); add(t.dy); }); });
    var st = res.stability;
    st.crossings.forEach(function (c) { add(c.omega); add(c.omega * c.omega); add(c.K); });
    st.stableSet.forEach(function (s) { add(s.lo); add(s.hi); });
    for (i = 0; i < st.table.rows.length; i++) for (j = 0; j < st.table.rows[i].length; j++) { st.table.rows[i][j].n.forEach(add); st.table.rows[i][j].d.forEach(add); }
    st.criticalK.forEach(add);
    return out;
  }

  RL.content = { build: build, setText: setText, notableK: notableK, validBreaks: validBreaks, crossingsPos: crossingsPos, onSegments: onSegments, segText: segText, EXAMPLES: EXAMPLES, allNumbers: allNumbers, strip: strip, breakLabel: breakLabel };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
