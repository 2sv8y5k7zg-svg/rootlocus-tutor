/*
 * ai.js — AI 연결부
 *
 * 미리보기(claude.ai 아티팩트)에서는 Claude를, 대회용 공개 홈페이지에서는 Gemini 무료 등급을 쓸 예정입니다.
 * 어느 쪽이든 이 파일의 ask()만 바꾸면 되도록 나눠 두었습니다.
 * AI 연결이 없으면(인터넷 없음, 로컬 파일 등) 화면은 팀이 쓴 정적 힌트로 그대로 동작합니다.
 *
 * 안전장치: AI 답 속 숫자를 엔진이 검증한 숫자와 대조해서, 목록에 없는 숫자가 나오면 경고합니다.
 */
(function (RL) {
  'use strict';
  var state = { sample: null, images: false, ready: false, disabled: '', provider: '' };

  function init() {
    return new Promise(function (resolve) {
      var done = function () { state.ready = true; resolve(state); };
      if (typeof window === 'undefined' || !window.claude || !window.claude.use) { done(); return; }
      window.claude.use('sample').then(function (s) {
        state.sample = s || null;
        if (!s) { done(); return; }
        state.provider = 'Claude';
        s.limits().then(function (lim) { state.images = !!(lim && lim.images); }).catch(function () {}).then(done);
      }).catch(done);
    });
  }
  function available() { return !!state.sample && !state.disabled; }

  var HIDE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
  function errMsg(e) {
    var code = e && e.code ? e.code : 'upstream_error';
    if (HIDE.indexOf(code) >= 0) { state.disabled = code; return 'AI 사용이 허용되지 않아 정적 힌트로 계속합니다.'; }
    if (code === 'images_unavailable') { state.images = false; return '이 화면에서는 사진을 보낼 수 없습니다. 식을 직접 입력해 주세요.'; }
    if (code === 'rate_limited') return 'AI 요청이 너무 많습니다. 잠시 뒤에 다시 눌러 주세요.';
    if (code === 'session_expired') return 'claude.ai에 다시 로그인해야 합니다.';
    if (code === 'image_rejected') return '사진을 읽을 수 없습니다. 다른 사진(JPG·PNG, 20MB 이하)을 골라 주세요.';
    if (code === 'refused') return 'AI가 이 요청에 답하지 않았습니다. 질문을 바꿔 다시 해 주세요.';
    if (code === 'cancelled') return '';
    return 'AI 연결이 잠시 끊겼습니다. 다시 눌러 주세요. 정적 힌트는 그대로 쓸 수 있습니다.';
  }

  var LEVEL = { 1: '1단계(개념만)', 2: '2단계(방향 힌트)', 3: '3단계(공식과 대입)', 4: '4단계(전체 풀이와 답)' };

  function buildPrompt(ctx) {
    var lines = [
      '너는 대학 제어공학 수업의 근궤적 학습 도우미다. 학생이 스스로 풀도록 돕는다.',
      '[규칙]',
      '1. 숫자는 아래 [검증된 계산 결과]와 [학생 입력]에 있는 값만 쓴다. 새로 계산하거나 지어내지 않는다. 필요한 값이 목록에 없으면 "그 값은 화면의 계산 결과를 확인해 주세요"라고 한다.',
      '2. 요청한 힌트 단계만큼만 알려 준다. 1단계는 개념만, 2단계는 방향 힌트, 3단계는 공식과 대입, 4단계는 전체 풀이와 답.',
      '3. 학생 답이 틀렸는데 어느 과정에서 틀렸는지 확실하지 않으면 원인을 단정하지 말고, 어떻게 계산했는지 물어본다.',
      '4. 한국어 존댓말로 3~5문장. 수식은 s^2 + 2s + 2처럼 일반 글자로 쓴다. 제목, 표, 목록 기호는 쓰지 않는다.',
      '5. 수업에서 쓰는 방식을 따른다: 실수축은 시험점 오른쪽 개수의 홀짝, 이탈점은 D′N − DN′ = 0을 풀고 K = −D/N의 부호 확인, 출발각은 θ = 180° + Σ영점각 − Σ다른 극점각.',
      '[문제] 개루프 전달함수 G(s)H(s) = ' + ctx.tf + ', 음의 피드백, K ≥ 0',
      '[현재 단계] ' + ctx.stepNum + '단계 ' + ctx.stepTitle,
      '[검증된 계산 결과]',
      JSON.stringify(ctx.facts),
      '[요청한 힌트 단계] ' + LEVEL[ctx.level || 2]
    ];
    if (ctx.check) lines.push('[학생 답 채점 결과(프로그램이 판정함)] 학생 답: ' + ctx.check.answer + ', 판정: ' + (ctx.check.ok ? '맞음' : '틀림'));
    lines.push('[학생 입력] ' + (ctx.question || '이 단계를 어떻게 풀어야 할지 모르겠어요.'));
    return lines.join('\n');
  }

  function ask(ctx, onText, signal) {
    if (!available()) return Promise.reject({ code: 'not_granted' });
    var opts = { modelTier: 'quick', onText: onText };
    if (signal) opts.signal = signal;
    return state.sample(buildPrompt(ctx), opts);
  }

  // 사진 속 손글씨 전달함수 읽기 → 한 줄 식
  function readPhoto(file, signal) {
    if (!available() || !state.images) return Promise.reject({ code: 'images_unavailable' });
    var prompt = '이 사진에는 손으로 쓴 제어공학 개루프 전달함수가 있습니다. 식을 한 줄로 옮겨 적으세요. ' +
      '형식 예: K(s+2)/((s+3)(s^2+2s+2)). 거듭제곱은 ^로, 분모 전체는 괄호로 감쌉니다. ' +
      '사진에 없는 내용을 추측하지 말고, 읽을 수 없으면 "읽을 수 없음"이라고만 답하세요. 식 말고 다른 말은 쓰지 마세요.';
    var opts = { images: [file] };
    if (signal) opts.signal = signal;
    return state.sample(prompt, opts).then(function (r) { return r.text.trim().split('\n')[0].replace(/^`+|`+$/g, '').trim(); });
  }

  // ── 숫자 검사 ─────────────────────────────
  function numbersIn(text) {
    var t = String(text).replace(/−/g, '-'), out = [], m;
    // 2√3/9, √(61/11), √2 같은 꼴을 먼저 값으로 바꿈
    t = t.replace(/(\d+(?:\.\d+)?)?\s*√\s*\(?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?\s*\)?(?:\s*\/\s*(\d+))?/g, function (all, a, b, c, d) {
      var v = (a ? parseFloat(a) : 1) * Math.sqrt(parseFloat(b) / (c ? parseFloat(c) : 1)) / (d ? parseFloat(d) : 1);
      out.push(v);
      return ' ';
    });
    var re = /(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/g;
    while ((m = re.exec(t))) out.push(m[2] ? parseFloat(m[1]) / parseFloat(m[2]) : parseFloat(m[1]));
    return out;
  }
  function checkNumbers(text, allowed, extra) {
    var nums = numbersIn(text), bad = [], i, j;
    var pool = allowed.concat(extra ? numbersIn(extra) : []);
    for (i = 0; i < nums.length; i++) {
      var v = Math.abs(nums[i]), ok = false;
      if (v <= 12 && Math.abs(v - Math.round(v)) < 1e-9) ok = true;          // 개수, 단계 번호 같은 작은 정수
      if ([90, 180, 270, 360].indexOf(v) >= 0) ok = true;                     // 각도 기준값
      for (j = 0; j < pool.length && !ok; j++) {
        var a = Math.abs(pool[j]);
        if (Math.abs(v - a) <= Math.max(0.006 * a, 0.0051)) ok = true;     // 반올림 허용
      }
      if (!ok) bad.push(nums[i]);
    }
    return { ok: bad.length === 0, bad: bad, count: nums.length };
  }

  RL.ai = { init: init, available: available, state: state, ask: ask, readPhoto: readPhoto, errMsg: errMsg, checkNumbers: checkNumbers, numbersIn: numbersIn, buildPrompt: buildPrompt };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
