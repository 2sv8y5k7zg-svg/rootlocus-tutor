/*
 * main.js — 화면 흐름
 *   시작 화면: 식 입력 → 수식 미리보기 → 확인·수정 → 학습 시작
 *   학습 화면: 1~9단계 (설명 + 그래프), 힌트·질문·내 답 확인, 간단한 예시, 학습 기록
 */
(function (RL) {
  'use strict';
  var M = RL.mv, F = RL.format, CT = RL.content, AI = RL.ai, ST = RL.store;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var S = { parsed: null, prev: null, res: null, steps: null, cur: 0, recId: '', K: null, paused: false, tfText: '', thread: {} };
  var graph, previewGraph, previewTour, inspector, exGraph, resetWelcomeMotion = function () {};
  var EXAMPLE_INPUTS = [
    { label: '노트 예제', input: 'K(s+2)/((s+3)(s^2+2s+2))' },
    { label: '허수축 교차', input: 'K/(s(s+1)(s+2))' },
    { label: '원 궤적', input: 'K(s+2)/(s(s+1))' },
    { label: '복소 이탈점', input: 'K/(s(s+4)(s^2+4s+20))' },
    { label: '세 가지가 만남', input: 'K(s+1)/(s^2(s+9))' },
    { label: '우반면 영점', input: 'K(s-3)(s-5)/((s+1)(s+2))' }
  ];
  var STATUS_KO = { stable: '안정', marginal: '임계 안정', unstable: '불안정' };

  function tfHTML(res) {
    var num = res.m > 0 ? M.factorsH(res.zeros, res.N[0]) : M.n(res.N[0]);
    var den = M.factorsH(res.poles);
    return M.mv('K') + '·' + M.frac(num, den);
  }
  function tfText(res) {
    var num = res.m > 0 ? CT.strip(M.factorsH(res.zeros, res.N[0])) : F.numShort(res.N[0]);
    return 'K' + (res.m > 0 ? num : '·' + num) + '/(' + CT.strip(M.factorsH(res.poles)) + ')';
  }
  function recIdOf(res) { return res.N.map(function (v) { return +v.toFixed(6); }).join(',') + '|' + res.D.map(function (v) { return +v.toFixed(6); }).join(','); }
  function nowText() {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 첫 화면과 입력은 같은 문서의 세로 공간. 학습만 별도 화면으로 전환한다.
  function showScreen(id) {
    var lesson = id === 'screen-lesson';
    document.body.dataset.scene = lesson ? 'lesson' : 'journey';
    $('#screen-welcome').hidden = lesson;
    $('#screen-start').hidden = lesson;
    $('#screen-lesson').hidden = !lesson;
    $('#screen-lesson').classList.remove('screen-arrive');
    if (lesson) {
      window.scrollTo(0, 0);
      void $('#screen-lesson').offsetWidth;
      $('#screen-lesson').classList.add('screen-arrive');
    } else {
      var top = id === 'screen-start' ? $('#screen-start').getBoundingClientRect().top + window.scrollY - 36 : 0;
      window.scrollTo({ top: top, behavior: reducedMotion() ? 'instant' : 'smooth' });
    }
    resetWelcomeMotion();
    if (previewTour) previewTour.sync();
  }
  function enterInput() {
    graph.stop();
    showScreen('screen-start');
    $('#btn-home').hidden = true;
    onInput();
    var target = window.matchMedia('(pointer: coarse)').matches ? $('#screen-start h1') : $('#tf-input');
    if (target.tagName === 'H1') target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  function welcome() {
    graph.stop();
    if (photoCtl) photoCtl.abort();
    showScreen('screen-welcome');
    $('#btn-home').hidden = true;
    $('#welcome-title').focus({ preventScroll: true });
  }
  function reducedMotion() {
    return document.documentElement.getAttribute('data-motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function setMotion(reduce) {
    document.documentElement.setAttribute('data-motion', reduce ? 'reduced' : 'auto');
    $('#btn-motion').setAttribute('aria-pressed', String(reduce));
    ST.setPref('reduce-motion', reduce);
    resetWelcomeMotion();
    if (previewTour) previewTour.sync();
    if (reduce && S.steps && !$('#screen-lesson').hidden) go(S.cur, false);
  }
  function bindWelcomeMotion() {
    RL.atmosphere.init();
    resetWelcomeMotion = RL.atmosphere.sync;
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function () {
      if (reducedMotion() && S.steps && !$('#screen-lesson').hidden) go(S.cur, false);
    });
  }

  // ── 시작 화면 ───────────────────────────────
  function onInput() {
    var raw = $('#tf-input').value, msg = $('#tf-msg'), pv = $('#tf-preview'), btn = $('#btn-start');
    var p = RL.parser.parse(raw);
    S.parsed = null;
    btn.disabled = true;
    if (!p.ok) {
      pv.innerHTML = '<span class="muted">식을 해석하면 여기에 수식으로 보여 드립니다.</span>';
      $('#tf-input').setAttribute('aria-invalid', 'true');
      msg.className = 'msg bad';
      msg.textContent = p.message;
      previewTour.input(null);
      return;
    }
    var res = RL.locus.analyze(p.N, p.D, { branches: false });
    var warn = /\/\s*[^(\s][^+\-]*\(/.test(RL.parser.clean(raw)) ? ' 분모 전체를 괄호로 감쌌는지 확인해 주세요. 예: K/(s(s+1)).' : '';
    if (!res.ok) {
      pv.innerHTML = M.mv('K') + '·' + M.frac(M.polyH(p.N), M.polyH(p.D));
      $('#tf-input').setAttribute('aria-invalid', 'true');
      msg.className = 'msg bad';
      msg.textContent = res.error.message;
      previewTour.input(null);
      return;
    }
    $('#tf-input').setAttribute('aria-invalid', 'false');
    S.parsed = p;
    pv.innerHTML = '<div class="pv-main">' + M.mv('G') + '(' + M.mv('s') + ')' + M.mv('H') + '(' + M.mv('s') + ') = ' + tfHTML(res) + '</div>' +
      '<div class="pv-sub">' + M.mv('N') + '(' + M.mv('s') + ') = ' + M.polyH(res.N) + ' &ensp;·&ensp; ' + M.mv('D') + '(' + M.mv('s') + ') = ' + M.polyH(res.D) + '</div>';
    msg.className = 'msg' + (warn ? ' warn' : '');
    msg.textContent = p.note + warn + ' 분자·분모·괄호·부호가 맞으면 학습을 시작하세요.';
    btn.disabled = false;
    previewTour.input(res);
  }

  function setExample(input, initial) { if (!initial) previewTour.follow(); $('#tf-input').value = input; onInput(); }

  // ── 사진으로 입력 ───────────────────────────
  var photoCtl = null, photoURL = null;
  function onPhotoPicked(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024) {
      $('#photo-help').textContent = 'JPG·PNG·WebP, 20MB 이하 사진을 선택해 주세요.'; return;
    }
    if (photoCtl) photoCtl.abort();
    if (photoURL) URL.revokeObjectURL(photoURL);
    var panel = $('#photo-panel');
    panel.hidden = false;
    var url = photoURL = URL.createObjectURL(file);
    panel.innerHTML = '<img src="' + url + '" alt="올린 사진" class="thumb">' +
      '<div class="photo-body"><p><b>사진은 AI(' + (AI.state.provider || 'AI') + ')로 전송됩니다.</b> 개인정보가 찍혀 있지 않은지 확인해 주세요. 읽은 식은 바로 계산하지 않고 먼저 보여 드립니다.</p>' +
      '<div class="row"><button id="photo-send" class="primary sm">사진 보내서 읽기</button><button id="photo-cancel" class="ghost sm">취소</button></div><p id="photo-status" class="muted"></p></div>';
    if (!AI.available() || !AI.state.images) {
      panel.querySelector('.photo-body p').textContent = '사진은 이 기기에서만 표시됩니다. 현재 자동 인식 연결이 없어 사진을 보며 식을 직접 입력해 주세요.';
      $('#photo-send').hidden = true;
    }
    $('#photo-cancel').onclick = function () { if (photoCtl) photoCtl.abort(); panel.hidden = true; panel.innerHTML = ''; URL.revokeObjectURL(url); };
    $('#photo-send').onclick = function () {
      var st = $('#photo-status');
      $('#photo-send').disabled = true;
      st.textContent = '읽는 중… (몇 초~수십 초)';
      photoCtl = new AbortController();
      var request = photoCtl;
      AI.readPhoto(file, request.signal).then(function (text) {
        if (request.signal.aborted || request !== photoCtl) return;
        if (/읽을 수 없음/.test(text)) { st.textContent = 'AI가 식을 읽지 못했습니다. 더 밝고 가까운 사진으로 다시 시도하거나 직접 입력해 주세요.'; $('#photo-send').disabled = false; return; }
        $('#tf-input').value = text;
        previewTour.follow();
        onInput();
        st.textContent = 'AI가 읽은 식을 입력칸에 넣었습니다. 분자·분모·괄호·부호·지수를 확인하고 고쳐 주세요.';
        $('#tf-input').focus();
      }, function (e) { if (request.signal.aborted || request !== photoCtl) return; st.textContent = AI.errMsg(e); $('#photo-send').disabled = false; });
    };
  }

  // ── 학습 시작 ───────────────────────────────
  function startLesson(fromStep) {
    // 시작 시 현재 입력을 다시 검증해 이전 식으로 시작하지 않도록 한다.
    onInput();
    if (!S.parsed) return;
    var res = RL.locus.analyze(S.parsed.N, S.parsed.D);
    if (!res.ok) return;
    S.res = res;
    S.steps = CT.build(res);
    S.tfText = tfText(res);
    S.recId = recIdOf(res);
    S.thread = {};
    S.K = null;
    S.allNums = CT.allNumbers(res);
    showScreen('screen-lesson');
    $('#btn-home').hidden = false;
    $('#stage-tf').innerHTML = M.mv('G') + M.mv('H') + ' = ' + tfHTML(res);
    renderStepper();
    graph.setProblem(res);
    go(fromStep || 0, true);
    $('#stepper button').focus({ preventScroll: true });
  }

  function renderStepper() {
    var nav = $('#stepper'), h = '', i;
    for (i = 0; i < S.steps.length; i++) h += '<button class="st" data-i="' + i + '" aria-label="' + (i + 1) + '단계 ' + S.steps[i].title + '"><span class="st-n">' + (i + 1) + '</span><span class="st-t">' + S.steps[i].short + '</span></button>';
    nav.innerHTML = h;
    $$('.st', nav).forEach(function (b) { b.onclick = function () { go(+b.getAttribute('data-i'), true); }; });
  }

  // ── 단계 이동 ───────────────────────────────
  function go(i, animate) {
    if (!S.steps) return;
    i = Math.max(0, Math.min(S.steps.length - 1, i));
    S.cur = i;
    S.paused = false;
    $('#btn-pause').textContent = '일시정지';
    var step = S.steps[i];
    $$('#stepper .st').forEach(function (b, k) { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    $('#btn-prev').disabled = i === 0;
    $('#btn-next').disabled = i === S.steps.length - 1;
    $('#btn-next').textContent = i === S.steps.length - 1 ? '마지막 단계' : '다음';
    renderStep(step, animate);
    renderPractice(step);
    $('#stage-note').textContent = step.graphNote;
    graph.show(step.num, animate);
    inspector.reset(); inspector.bind();
    if (step.num === 9) setK(S.K === null ? defaultK() : S.K);
    ST.upsert({ id: S.recId, input: $('#tf-input').value, tf: S.tfText, date: nowText(), lastStep: i + 1, done: i === S.steps.length - 1 });
    var rail = $('#rail');
    if (rail.scrollTop) rail.scrollTop = 0;
  }

  function blockHTML(b, idx, step) {
    var d = 'style="--d:' + (120 + idx * 90) + 'ms"';
    switch (b.t) {
      case 'goal': return '<p class="b-goal enter" ' + d + '>' + b.h + '</p>';
      case 'formula': return '<div class="b-formula enter" ' + d + '><span class="tag">공식</span><div>' + b.h + '</div></div>';
      case 'calc': return '<div class="b-calc enter" ' + d + '>' + b.h + '</div>';
      case 'text': return '<p class="b-text enter" ' + d + '>' + b.h + '</p>';
      case 'sub': return '<h4 class="b-sub enter" ' + d + '>' + b.h + '</h4>';
      case 'result': return '<div class="b-result enter" ' + d + '><span class="tag">결과</span><div>' + b.h + '</div></div>';
      case 'none': return '<div class="b-none enter" ' + d + '>' + b.h + '</div>';
      case 'note': return '<p class="b-note enter" ' + d + '>' + b.h + '</p>';
      case 'why': return '<details class="b-why enter" ' + d + '><summary>왜 그런가요?</summary><p>' + b.h + '</p></details>';
      case 'list': return '<ul class="b-list enter" ' + d + '>' + b.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
      case 'table': {
        var rows = b.rows.map(function (r, k) {
          var rd = step.num === 3 ? 500 + k * 1800 + 650 : 200 + k * 120;
          return '<tr class="enter' + (r.on ? ' on' : '') + '" style="--d:' + rd + 'ms" data-ref="' + r.ref + '">' + r.cells.map(function (c, j) { return j === 0 ? '<th scope="row">' + c + '</th>' : '<td>' + c + '</td>'; }).join('') + '</tr>';
        }).join('');
        return '<div class="tbl-wrap enter" ' + d + '><table class="b-table"><thead><tr>' + b.head.map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
      case 'routh': {
        var rr = b.rows.map(function (r, k) {
          var cells = r.cells.map(function (c, j) { return '<td class="' + (j === 0 ? 'c1' : '') + '">' + c + '</td>'; }).join('');
          return '<tr class="enter" style="--d:' + (450 + k * 420) + 'ms"><th scope="row">' + M.mv('s') + '<sup>' + r.pw + '</sup></th>' + cells + '</tr>';
        }).join('');
        return '<div class="tbl-wrap enter" ' + d + '><table class="b-routh"><caption>Routh 표 <span class="sm">(첫 열 강조)</span></caption><tbody>' + rr + '</tbody></table></div>';
      }
      case 'kchart': return '<div class="b-kchart enter" ' + d + ' id="kchart-slot"></div>';
      case 'slider': return ''; // 조작부는 그래프 바로 아래 하나만 둔다.
    }
    return '';
  }

  function renderStep(step, animate) {
    var body = $('#step-body');
    var h = '<header class="sh"><span class="sh-n">' + String(step.num).padStart(2, '0') + '<small>/09</small></span><h2>' + step.title + '</h2></header>';
    for (var i = 0; i < step.blocks.length; i++) h += blockHTML(step.blocks[i], i, step);
    body.innerHTML = h;
    var controls = $('#k-controls');
    controls.hidden = step.num !== 9;
    controls.innerHTML = step.num === 9 ? sliderHTML() : '';
    body.classList.toggle('still', !animate);
    var slot = $('#kchart-slot');
    if (slot && !RL.kChart(slot, S.res, S.res.view)) slot.remove();
    if (step.num === 9) bindSlider();
  }

  // ── 9단계 슬라이더 ──────────────────────────
  function kRange() {
    var ks = CT.notableK(S.res).map(function (x) { return x.K; }).filter(function (k) { return k > 0; });
    var ref = ks.length ? Math.sqrt(ks[0] * ks[ks.length - 1]) : 1;
    return { lo: ref / 1000, hi: ref * 1000 };
  }
  function kFromT(t) { var r = kRange(); return t <= 0 ? 0 : r.lo * Math.pow(r.hi / r.lo, t / 1000); }
  function tFromK(K) { var r = kRange(); return K <= 0 ? 0 : Math.max(1, Math.min(1000, 1000 * Math.log(K / r.lo) / Math.log(r.hi / r.lo))); }
  function defaultK() { var ks = CT.notableK(S.res); return ks.length ? ks[0].K * 0.6 : 1; }
  function kText(K) { return K === 0 ? '0' : (K < 0.01 || K >= 1e5 ? K.toExponential(2) : (+K.toPrecision(3)).toString()); }
  function sliderHTML() {
    var chips = CT.notableK(S.res).map(function (x) { return '<button class="chip kq" data-k="' + x.K + '">' + x.label + ' K = ' + F.numShort(x.K) + '</button>'; }).join('');
    return '<div class="b-slider">' +
      '<label for="k-slider" class="k-lab">K = <b id="k-val">0</b> <span id="k-status" class="pill"></span></label>' +
      '<input type="range" id="k-slider" min="0" max="1000" step="1" value="0" aria-describedby="k-poles" aria-valuetext="K = 0">' +
      '<div class="k-scale"><span>0</span><span>작게</span><span>크게 →</span></div>' +
      '<div class="chips"><button class="chip kq" data-k="0">K = 0</button>' + chips + '</div>' +
      '<div id="k-poles" class="k-poles"></div><div id="k-zeta" class="k-zeta"></div></div>';
  }
  function bindSlider() {
    var sl = $('#k-slider');
    sl.value = tFromK(S.K === null ? defaultK() : S.K);
    sl.oninput = function () { setK(kFromT(+sl.value)); };
    $$('.kq').forEach(function (b) { b.onclick = function () { var K = +b.getAttribute('data-k'); sl.value = tFromK(K); setK(K, true); inspector.dominant(); }; });
  }
  function setK(K, resetTrail) {
    S.K = K;
    var out = graph.setK(K, resetTrail);
    if (!out) return;
    inspector.bind(); inspector.refresh();
    var st = RL.routh.classify(out.poles);
    var v = $('#k-val'); if (v) v.textContent = kText(K);
    var slider = $('#k-slider'); if (slider) slider.setAttribute('aria-valuetext', 'K = ' + kText(K) + ', ' + STATUS_KO[st]);
    var pill = $('#k-status'); if (pill) { pill.textContent = (st === 'stable' ? '✓ ' : st === 'marginal' ? '△ ' : '! ') + STATUS_KO[st]; pill.className = 'pill ' + st; }
    var pl = $('#k-poles');
    if (pl) pl.innerHTML = '폐루프 극점: ' + out.poles.map(function (z) { return '<button type="button" class="pole-value" data-point="cl' + out.poles.indexOf(z) + '">' + F.cnum(z, 3) + '</button>'; }).join(', ');
    var zt = $('#k-zeta');
    if (zt) zt.innerHTML = out.info ? '주된 복소 극점: ' + M.mv('ω') + '<sub>n</sub> = ' + F.dec(out.info.wn, 3) + ', &ensp;' + M.mv('ζ') + ' = ' + F.dec(out.info.zeta, 3) + (out.info.zeta <= 0 ? ' (감쇠 없음 또는 음수 → 불안정 쪽)' : '') : '복소 극점이 없어 진동하지 않습니다 (실수 극점만).';
  }

  // Optional local practice remains compact; no AI hint/chat panel.
  function renderPractice(step) {
    if (!step.check && !step.example) return;
    var h = '<details class="practice"><summary>직접 확인하기</summary>';
    if (step.check) h += '<form id="check-form" class="check"><label for="check-in">' + step.check.prompt + '</label><div class="row"><input id="check-in" inputmode="decimal" autocomplete="off"><button class="ghost sm" type="submit">내 답 확인</button></div><div id="check-out" aria-live="polite"></div></form>';
    if (step.example) h += '<button id="btn-example" class="ghost sm">간단한 예시 보기</button>';
    $('#step-body').insertAdjacentHTML('beforeend', h + '</details>');
    var form = $('#check-form'); if (form) form.onsubmit = function (e) { e.preventDefault(); gradeAnswer(step); };
    var ex = $('#btn-example'); if (ex) ex.onclick = function () { openExample(step.example, step); };
  }

  function parseAnswer(s) {
    var t = String(s).replace(/[−–]/g, '-').replace(/\s/g, '').replace(/°/g, '');
    var m = /^(-?\d*\.?\d+)\/(\d*\.?\d+)$/.exec(t);
    if (m) return parseFloat(m[1]) / parseFloat(m[2]);
    var v = parseFloat(t);
    return isFinite(v) && /^-?\d*\.?\d+$/.test(t) ? v : NaN;
  }
  function gradeAnswer(step) {
    var c = step.check, raw = $('#check-in').value, v = parseAnswer(raw), out = $('#check-out');
    if (!isFinite(v)) { out.className = 'check-out warn'; out.textContent = '숫자로 입력해 주세요. 분수는 −3/2처럼 쓸 수 있습니다.'; return; }
    var ok = c.values.some(function (x) { return c.tol ? Math.abs(v - x) <= c.tol * Math.max(1, Math.abs(x)) : v === x; });
    S.lastCheck = { answer: raw, ok: ok };
    if (ok) { out.className = 'check-out ok'; out.innerHTML = '맞습니다. 그래프에서 같은 값을 찾아 확인해 보세요.'; return; }
    out.className = 'check-out bad';
    out.textContent = '계산 결과와 다릅니다. 위의 공식과 대입 과정을 다시 확인해 보세요.';
  }

  // ── 간단한 예시 → 원래 문제로 복귀 ──────────
  function openExample(id, fromStep) {
    var ex = CT.EXAMPLES[id], p = RL.parser.parse(ex.input), res = RL.locus.analyze(p.N, p.D, { branches: false });
    var steps = CT.build(res), st = steps[ex.focus - 1], sheet = $('#example');
    var keep = st.blocks.filter(function (b) { return ['formula', 'calc', 'result', 'table', 'routh', 'sub'].indexOf(b.t) >= 0; });
    sheet.hidden = false;
    $('#ex-title').textContent = ex.title;
    $('#ex-tf').innerHTML = M.mv('G') + M.mv('H') + ' = ' + tfHTML(res) + ' <span class="sm muted">(미리 검증한 예시)</span>';
    $('#ex-body').innerHTML = keep.map(function (b, k) { return blockHTML(b, k, { num: 0 }); }).join('');
    $$('#ex-body .ref').forEach(function (r) { r.removeAttribute('data-ref'); });
    document.body.classList.add('sheet-open');
    exGraph.setProblem(res);
    exGraph.show(ex.focus, true);
    $('#ex-back').onclick = function () { closeExample(fromStep); };
    $('#ex-back').focus();
  }
  function closeExample(step) {
    exGraph.stop();
    $('#example').hidden = true;
    document.body.classList.remove('sheet-open');
    var target = $('#btn-example') || $('#step-body');
    target.focus({ preventScroll: true });
  }

  // ── 학습 기록 ───────────────────────────────
  function closeRecords() { $('#records').hidden = true; $('#btn-records').focus({ preventScroll: true }); }

  function openRecords() {
    var list = ST.load(), box = $('#records-list');
    if (!list.length) box.innerHTML = '<p class="muted">아직 기록이 없습니다. 학습을 시작하면 단계마다 자동으로 저장됩니다.</p>';
    else box.innerHTML = list.map(function (r, k) {
      return '<li class="rec"><div class="rec-tf">' + M.esc(r.tf) + '</div><div class="rec-meta"><span>' + M.esc(r.date) + '</span><span>' + r.lastStep + '/9단계</span>' + (r.done ? '<span class="pill stable">완료</span>' : '') + '</div>' +
        '<div class="row"><button class="ghost sm" data-act="resume" data-k="' + k + '">이어서 보기</button><button class="ghost sm" data-act="restart" data-k="' + k + '">처음부터</button><button class="ghost sm" data-act="result" data-k="' + k + '">결과 바로 보기</button></div></li>';
    }).join('');
    $('#records').hidden = false;
    $$('#records-list button').forEach(function (b) {
      b.onclick = function () {
        var r = list[+b.getAttribute('data-k')], act = b.getAttribute('data-act');
        $('#records').hidden = true;
        $('#tf-input').value = r.input;
        previewTour.follow();
        onInput();
        if (!S.parsed) { enterInput(); return; }
        startLesson(act === 'resume' ? Math.max(0, r.lastStep - 1) : act === 'result' ? 7 : 0);
      };
    });
    $('#records-close').focus();
  }

  function goHome() { enterInput(); }

  // 글자와 그래프 연결 강조
  function light(ref, on) {
    if (!ref) return;
    $$('[data-ref="' + ref + '"]').forEach(function (n) { n.classList.toggle('lit', on); });
  }

  function togglePause() {
    var list = graph.svg.getAnimations ? graph.svg.getAnimations({ subtree: true }) : [];
    S.paused = !S.paused;
    for (var i = 0; i < list.length; i++) { if (S.paused) list[i].pause(); else list[i].play(); }
    $('#btn-pause').textContent = S.paused ? '계속 재생' : '일시정지';
  }

  function applyTheme(t) {
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.setAttribute('data-theme', 'dark');
  }

  function init() {
    applyTheme(ST.getPref('theme', ''));
    graph = new RL.Graph($('#main-graph'));
    previewGraph = new RL.Graph($('#preview-graph'));
    previewTour = new RL.PreviewTour(previewGraph, EXAMPLE_INPUTS);
    var copy = RL.welcomeCopy.choose(new Date().getHours(), ST.load().length > 0);
    $('#input-greeting').textContent = copy.greeting;
    $('#input-title').textContent = copy.prompt;
    exGraph = new RL.Graph($('#ex-graph'));
    graph.onRef = light;
    inspector = new RL.PointInspector(graph);
    $('#examples').innerHTML = EXAMPLE_INPUTS.map(function (e) { return '<button class="chip ex" data-in="' + M.esc(e.input) + '">' + e.label + '</button>'; }).join('');
    $$('#examples .ex').forEach(function (b) { b.onclick = function () { setExample(b.getAttribute('data-in')); }; });
    var inp = $('#tf-input'), timer = 0;
    inp.addEventListener('input', function () {
      previewTour.follow(); previewTour.input(null);
      clearTimeout(timer);
      S.parsed = null;
      $('#btn-start').disabled = true;
      timer = setTimeout(onInput, 140);
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !$('#btn-start').disabled) startLesson(0); });
    $('#btn-start').onclick = function () { startLesson(0); };
    $('#btn-prev').onclick = function () { go(S.cur - 1, true); };
    $('#btn-next').onclick = function () { go(S.cur + 1, true); };
    $('#btn-replay').onclick = function () { go(S.cur, true); };
    $('#btn-pause').onclick = togglePause;
    $('#btn-all').onclick = function () { go(7, false); };
    $('#btn-home').onclick = goHome;
    $('#brand').onclick = function (e) { e.preventDefault(); welcome(); };
    $('#btn-begin').onclick = enterInput;
    $('#btn-welcome').onclick = welcome;
    bindWelcomeMotion();
    setMotion(ST.getPref('reduce-motion', 'false') === 'true');
    $('#btn-motion').onclick = function () { setMotion(document.documentElement.getAttribute('data-motion') !== 'reduced'); };
    $('#btn-records').onclick = openRecords;
    $('#records-close').onclick = closeRecords;
    $('#btn-theme').onclick = function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var dark = cur ? cur === 'dark' : !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
      var next = dark ? 'light' : 'dark';
      applyTheme(next); ST.setPref('theme', next);
      if (S.steps && !$('#screen-lesson').hidden) go(S.cur, false);
    };
    $('#btn-photo').onclick = function () { $('#photo-file').click(); };
    $('#photo-file').onchange = function (e) { onPhotoPicked(e.target.files && e.target.files[0]); e.target.value = ''; };
    document.addEventListener('pointerover', function (e) { var t = e.target.closest && e.target.closest('.ref[data-ref], tr[data-ref]'); if (t) light(t.getAttribute('data-ref'), true); });
    document.addEventListener('pointerout', function (e) { var t = e.target.closest && e.target.closest('.ref[data-ref], tr[data-ref]'); if (t) light(t.getAttribute('data-ref'), false); });
    document.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('.ref[data-ref]'); if (t) light(t.getAttribute('data-ref'), true); });
    document.addEventListener('focusout', function (e) { var t = e.target.closest && e.target.closest('.ref[data-ref]'); if (t) light(t.getAttribute('data-ref'), false); });
    document.addEventListener('keydown', function (e) {
      var modal = !$('#records').hidden ? $('#records') : !$('#example').hidden ? $('#example') : null;
      if (modal && e.key === 'Tab') {
        var focusable = $$('button:not(:disabled), input, textarea, summary, a[href], [tabindex="0"]', modal).filter(function (n) { return n.getClientRects().length > 0; });
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
      if (e.key === 'Escape' && modal) { if (modal.id === 'records') closeRecords(); else closeExample(S.steps[S.cur]); return; }
      if (!$('#records').hidden || !$('#example').hidden || $('#screen-lesson').hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowRight') go(S.cur + 1, true);
      if (e.key === 'ArrowLeft') go(S.cur - 1, true);
      if (e.key === 'Escape') { if (!$('#example').hidden) closeExample(S.steps[S.cur]); $('#records').hidden = true; }
    });
    var rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (S.steps && !$('#screen-lesson').hidden) { graph.fit(); graph.show(S.cur + 1, false); if (S.cur === 8) setK(S.K); inspector.bind(); inspector.refresh(); }
        else { previewTour.resize(); previewTour.sync(); }
      }, 160);
    });
    setExample(EXAMPLE_INPUTS[0].input, true);
    AI.init().then(function () {
      $('#photo-help').textContent = AI.available() && AI.state.images ? '사진을 선택한 뒤 전송에 동의하면 식으로 옮겨 드립니다.' : '현재 사진 자동 인식은 연결되어 있지 않습니다. 사진을 띄워 놓고 직접 입력할 수 있습니다.';

    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.RL = window.RL || {});
