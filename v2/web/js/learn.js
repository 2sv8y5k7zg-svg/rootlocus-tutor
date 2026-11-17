// learn.js — 학습 화면의 흐름을 담당합니다.
// 흐름: 문제 입력 → (사진이면 AI 인식 → 사용자 확인) → Python 9단계 풀이 받기 → 단계마다 답 입력·채점·힌트
// 이 파일은 수학 계산을 하지 않습니다. 화면에 보이는 숫자는 모두 서버 응답에 있는 값입니다.

const $ = (id) => document.getElementById(id);
const state = {
  problem: null,     // 서버에 보낼 문제 객체 ({text} / {G,H} / {diagram})
  result: null,      // /api/analyze 응답 전체
  step: 1,           // 현재 단계 (1~9)
  fields: {},        // 단계별 답 입력 칸 목록 (/api/fields)
  checked: {},       // 단계별 채점 결과 기록 {step: {field: verdict}}
  hintLevel: {},     // 단계별로 연 힌트 단계
  ai: null,          // AI 상태 (/api/health)
};

// 처음 화면의 예시 문제 (수업·교재에서 자주 나오는 꼴)
const EXAMPLES = [
  'K/(s(s+1)(s+2))', 'K(s+2)/(s(s+1))', 'K/(s(s+3)(s^2+2s+2))', 'K(s+1)/(s^2(s+9))',
  'K/(s(s+2)(s^2+2s+5))', 'K(s+1)/(s(s-1))',
];

// 한 단계의 '생각해 볼 질문'은 4단계 힌트 중 1번째(개념 질문)를 씁니다.
// 움직임 설정: GSAP이 있고, 사용자가 '움직임 줄이기'를 켜지 않았을 때만 전환 효과를 씁니다.
const MOTION = !!window.gsap && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'expo.out';      // 빨리 출발해서 길게 감속하는 속도 곡선 (화면 전체에서 하나로 통일)

function esc(t) { return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function demo() { return $('demoMode').checked; }

// ─────────────────────────── 시작 ───────────────────────────
async function init() {
  const graph = new PlaneGraph($('plane'), onPick);
  state.graph = graph;

  // 예시 버튼
  for (const ex of EXAMPLES) {
    const b = document.createElement('button');
    b.className = 'chip'; b.innerHTML = `<span class="mono">${esc(ex)}</span>`;
    b.onclick = () => { $('tfInput').value = ex; start({ text: ex }, $('tfGo')); };
    $('examples').appendChild(b);
  }
  // 랜딩 페이지에서 ?tf=... 로 넘어오면 바로 시작
  const q = new URLSearchParams(location.search).get('tf');
  if (q) { $('tfInput').value = q; }

  // 탭 전환
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t.dataset.tab));
  });

  $('tfGo').onclick = () => start({ text: $('tfInput').value }, $('tfGo'));
  $('tfInput').onkeydown = (e) => { if (e.key === 'Enter') start({ text: $('tfInput').value }, $('tfGo')); };
  $('ghGo').onclick = confirmGH;
  $('newProblem').onclick = backToEntry;
  openPage();
  // 로고(랜딩으로 가는 링크)를 누르면 내용만 사라지고, 배경은 그대로 둔 채 이동합니다
  document.querySelector('.brand').addEventListener('click', (e) => { e.preventDefault(); leaveTo(e.currentTarget.getAttribute('href')); });
  // 화면 크기가 바뀌면 단계 표시 배경의 위치를 다시 맞춥니다
  addEventListener('resize', () => { moveIndicator(true); if (!MOTION) Flow.frame(); });
  // 식을 입력하는 동안 배경 가닥이 살짝 반응합니다
  $('tfInput').addEventListener('input', () => Flow.pulse(0.22));
  $('prevStep').onclick = () => goStep(Math.max(1, state.step - 1));
  $('nextStep').onclick = () => goStep(Math.min(9, state.step + 1));
  setupPhoto();
  setupHandwriting();
  setupK();

  // 서버 상태와 입력 칸 목록을 한 번 받아 둡니다
  try {
    const [h, f] = await Promise.all([API.health(), API.fields()]);
    state.ai = h.ai; state.fields = f;
    showAiStatus();
  } catch (e) {
    $('aiStatus').textContent = '서버 연결 안 됨';
  }
  $('demoMode').onchange = showAiStatus;
  if (q) start({ text: q });
}

// ─────────────────────────── 화면 전환과 배경 ───────────────────────────
// 배경 오브젝트(flow.js)는 랜딩과 같은 것입니다. 학습 화면은 그 상태값(Flow.S)만 바꿉니다.
//   문제 입력 화면  조형물(형태 A)이 옆에 떠 있음
//   풀이 화면       조형물이 흐름선(형태 C)으로 풀리고, 단계가 나아간 만큼 왼쪽부터 밝아짐
// flowTo: 상태값을 목표까지 부드럽게 옮깁니다. 움직임을 끈 환경에서는 바로 바꾸고 한 번만 그립니다.
function flowTo(vars, duration) {
  if (MOTION) gsap.to(Flow.S, { ...vars, duration: duration || 1.6, ease: 'power3.inOut', overwrite: 'auto' });
  else { Object.assign(Flow.S, vars); Flow.frame(); }
}
// 문제 입력 화면에서 조형물이 놓일 자리. 좁은 화면에서는 글자와 겹치지 않도록 아래쪽으로 내리고 조금 어둡게 합니다.
function entryPose() {
  const narrow = innerWidth <= 900;
  return { pos: 0, ox: narrow ? 0 : 0.08, oy: narrow ? 0.5 : 0.02, dim: narrow ? 0.55 : 1, flow: 0, morph: 0, story: 0, progress: 0 };
}

// 페이지가 열릴 때: 랜딩에서 넘어왔으면 배경이 그 자세에서 이어지고, 글자들만 아래에서 차례로 올라옵니다.
function openPage() {
  Flow.init($('flowCanvas'));
  const continued = Flow.takeover();
  if (!MOTION) { Object.assign(Flow.S, entryPose(), { intro: 1 }); Flow.frame(); return; }
  gsap.ticker.add(Flow.frame);                      // 매 프레임 배경 그리기
  if (continued) flowTo(entryPose(), 1.7);          // 랜딩에서 있던 자리 → 입력 화면의 자리로 미끄러져 이동
  else { Object.assign(Flow.S, entryPose(), { intro: 0 }); gsap.to(Flow.S, { intro: 1, duration: 2.2, ease: 'power2.out' }); }
  gsap.from('.topbar', { y: -24, opacity: 0, duration: 1, ease: EASE, delay: 0.1 });
  revealEntry(0.1);
}
function revealEntry(delay) {
  if (!MOTION) return;
  gsap.from('.entry-inner > .in', { y: 40, opacity: 0, duration: 1.2, stagger: 0.08, ease: EASE, delay });
  gsap.from('.tabpane.on .field-row', { y: 30, opacity: 0, duration: 1.1, ease: EASE, delay: delay + 0.35 });
  gsap.from('#examples .chip', { y: 16, opacity: 0, duration: 0.9, stagger: 0.045, ease: EASE, delay: delay + 0.5 });
}
// 다른 페이지로 나갈 때: 글자와 카드만 사라지고 배경은 남습니다. 배경의 지금 상태를 적어 두면 다음 페이지가 이어 받습니다.
function leaveTo(href) {
  if (!MOTION) { location.href = href; return; }
  gsap.to('.topbar, .entry, .studio', { opacity: 0, duration: 0.45, ease: 'power2.in', onComplete: () => { Flow.handoff(); location.href = href; } });
}
// 뒤로 가기로 돌아왔을 때 내용이 사라진 채 남지 않도록 합니다
addEventListener('pageshow', (e) => { if (e.persisted && window.gsap) gsap.set('.topbar, .entry, .studio', { clearProps: 'opacity' }); });

// 풀이 화면 → 문제 입력 화면
async function backToEntry() {
  if (MOTION) await gsap.to('#studio', { opacity: 0, y: 20, duration: 0.35, ease: 'power2.in' });
  $('studio').hidden = true; $('entry').hidden = false;
  if (MOTION) gsap.set('#studio', { clearProps: 'all' });
  $('topProgress').style.transform = 'scaleX(0)';
  state.started = false;
  window.scrollTo(0, 0);
  flowTo(entryPose(), 1.8);      // 흐름선이 다시 조형물로 모입니다
  revealEntry(0);
}

// 단계 목록의 검은 배경을 현재 단계 버튼 자리로 옮깁니다 (instant: 움직임 없이 바로)
function moveIndicator(instant) {
  const ind = $('stepInd'), btn = document.querySelector('.step-btn.on');
  if (!ind || !btn) return;
  const to = { x: btn.offsetLeft, y: btn.offsetTop, width: btn.offsetWidth, height: btn.offsetHeight };
  if (!window.gsap) { ind.style.cssText = `transform:translate(${to.x}px,${to.y}px);width:${to.width}px;height:${to.height}px`; return; }
  if (instant || !MOTION) gsap.set(ind, to); else gsap.to(ind, { ...to, duration: 0.7, ease: EASE, overwrite: true });
}

// K 막대에 안정(푸른색)·불안정(붉은색) 구간을 칠합니다. 구간은 7단계에서 엔진이 구한 안정 범위입니다.
function paintKTrack() {
  const Ks = state.result.graph.K, iv = state.result.steps[6].result.stable || [];
  const ok = (K) => iv.some((r) => K > r.lo && (r.hi === null || r.hi === undefined || K < r.hi));
  const parts = [];
  let from = 0, cur = ok(Ks[1]);
  for (let i = 2; i < Ks.length; i++) {
    const s = ok(Ks[i]);
    if (s !== cur) { parts.push([from, i, cur]); from = i; cur = s; }
  }
  parts.push([from, Ks.length - 1, cur]);
  const pct = (i) => (i / (Ks.length - 1) * 100).toFixed(2) + '%';
  const css = parts.map(([a, b, s]) => `${s ? 'rgba(177,203,230,.9)' : 'rgba(232,164,147,.8)'} ${pct(a)} ${pct(b)}`).join(', ');
  $('kSlider').style.setProperty('--track', `linear-gradient(90deg, ${css})`);
}

function showAiStatus() {
  const ai = state.ai || {};
  const el = $('aiStatus');
  if (demo()) { el.textContent = '모의 AI (시연)'; el.classList.add('on'); }
  else if (ai.available) { el.textContent = `AI: ${ai.label}`; el.classList.add('on'); }
  else { el.textContent = 'AI 꺼짐 · 계산은 정상'; el.classList.remove('on'); }
  $('aiVendor').textContent = demo() ? '모의 AI(전송 없음)' : (ai.label || '외부 AI');
  $('aiPolicy').textContent = (!demo() && ai.sendsDataTo) ? `(${ai.sendsDataTo})` : '';
}

// ─────────────────────────── 문제 입력 ───────────────────────────
function entryError(msg) { const e = $('entryError'); e.hidden = !msg; e.textContent = msg || ''; }

// 문제 객체를 서버에 보내 9단계 결과를 받고 학습 화면을 엽니다.
// btn: 누른 버튼 (계산을 기다리는 동안 빛줄기가 지나가는 표시를 합니다)
async function start(problem, btn) {
  entryError('');
  if (problem.text !== undefined && !problem.text.trim()) { entryError('전달함수를 입력해 주세요.'); return; }
  if (state.busy) return;
  state.busy = true;
  if (btn) btn.classList.add('loading');
  let res;
  try { res = await API.analyze(problem); } catch (e) { res = { ok: false, error: { message: '서버에 연결하지 못했습니다.' } }; }
  if (btn) btn.classList.remove('loading');
  state.busy = false;
  if (!res.ok) { entryError(res.error.message); return; }
  state.problem = problem; state.result = res; state.checked = {}; state.hintLevel = {};

  // 전환: 입력 화면이 위로 사라지고 → 배경 조형물이 흐름선으로 풀리며 → 무대와 좌우 패널이 들어옵니다
  flowTo({ flow: 1, dim: 1, oy: 0, ox: 0 }, 2);
  if (MOTION) await gsap.to('#entry', { opacity: 0, y: -30, duration: 0.4, ease: 'power2.in' });
  $('entry').hidden = true; $('confirm').hidden = true; $('studio').hidden = false;
  if (MOTION) gsap.set('#entry', { clearProps: 'all' });
  window.scrollTo(0, 0);
  state.started = false;
  renderProblem();
  paintKTrack();
  state.graph.resize();
  state.graph.setData(res.graph);     // 축이 원점에서 바깥으로 그려지며 시작
  goStep(1);
  state.started = true;
  if (MOTION) {
    gsap.from('#stage', { y: 48, scale: 0.96, opacity: 0, duration: 1.2, ease: EASE });
    gsap.from('.stage-head > *, .stage-foot', { y: 20, opacity: 0, duration: 1, stagger: 0.08, ease: EASE, delay: 0.3 });
    gsap.from('.col-left > *', { x: -32, opacity: 0, duration: 1, stagger: 0.08, ease: EASE, delay: 0.2 });
    gsap.from('.col-right > *', { x: 32, opacity: 0, duration: 1, stagger: 0.08, ease: EASE, delay: 0.25 });
    gsap.from('.work-card, .step-nav-btns', { y: 24, opacity: 0, duration: 0.9, stagger: 0.07, ease: EASE, delay: 0.45 });
  }
}

// G, H 입력 → 서버가 루프 전달함수와 폐루프 전달함수를 먼저 보여 주고, 확인 후 시작
async function confirmGH() {
  entryError('');
  const G = $('gInput').value.trim(), H = $('hInput').value.trim() || '1';
  if (!G) { entryError('G(s)를 입력해 주세요.'); return; }
  const r = await API.diagram(G, H);
  if (!r.ok) { entryError(r.error.message); return; }
  openConfirm({ tf: '', G, H }, {
    loopText: r.loopText, T: r.T, charPoly: r.charPoly, unity: r.unityFeedback,
  }, 'L(s) = G(s)H(s)와 폐루프 전달함수를 확인한 뒤 시작하세요.', [], []);
}

// 확인 패널: AI 인식 결과나 G·H 해석 결과를 보여 주고 고칠 수 있게 합니다.
function openConfirm(vals, pre, msg, conditions, uncertain) {
  $('confirm').hidden = false;
  $('confirmMsg').textContent = msg;
  $('cTf').value = vals.tf || ''; $('cG').value = vals.G || ''; $('cH').value = vals.H || '';
  const rows = [];
  if (pre.loopText) rows.push(`<div>루프 전달함수 <span class="mono">${esc(pre.loopText)}</span></div>`);
  if (pre.T) rows.push(`<div>폐루프 전달함수 T(s) <span class="mono">${esc(pre.T)}</span></div>`);
  if (pre.charPoly) rows.push(`<div>특성방정식 <span class="mono">${esc(pre.charPoly)} = 0</span></div>`);
  if (pre.unity === false) rows.push('<div>단위 피드백이 아닙니다. H(s)까지 곱한 루프로 그립니다.</div>');
  for (const c of conditions) rows.push(`<div>조건: ${esc(c)}</div>`);
  for (const u of uncertain) rows.push(`<div class="warn">확인 필요: ${esc(u)}</div>`);
  if (pre.error) rows.push(`<div class="warn">${esc(pre.error.message)}</div>`);
  $('confirmInfo').innerHTML = rows.join('');
  $('confirm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('confirmGo').onclick = () => {
    // 사용자가 고친 값을 우선: G가 있으면 G·H 구조, 없으면 전달함수 한 줄
    const G = $('cG').value.trim(), H = $('cH').value.trim();
    if (G) start({ G, H: H || '1' }, $('confirmGo')); else start({ text: $('cTf').value }, $('confirmGo'));
  };
  $('confirmCancel').onclick = () => { $('confirm').hidden = true; };
}

// 문제 사진 업로드 → AI 인식 → 확인 패널
function setupPhoto() {
  const inp = $('photoInput'), drop = $('drop');
  let file = null;
  const ready = () => { $('photoGo').disabled = !(file && ($('consent').checked || demo())); };
  inp.onchange = () => { file = inp.files[0]; drop.querySelector('.drop-title').textContent = file ? file.name : '사진 고르기'; ready(); };
  $('consent').onchange = ready;
  $('demoMode').addEventListener('change', ready);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); file = e.dataTransfer.files[0]; drop.querySelector('.drop-title').textContent = file.name; ready(); };
  $('photoGo').onclick = async () => {
    entryError('');
    $('photoGo').disabled = true; $('photoGo').textContent = '인식 중…';
    const r = await API.upload('/api/ai/recognize', file, { consent: $('consent').checked, demo: demo() });
    $('photoGo').textContent = '사진 인식'; ready();
    if (!r.ok) { entryError(`${r.error.message} ${r.fallback || ''}`); return; }
    const ai = r.ai;
    const label = r.provider === 'mock' ? '[모의 AI 응답] ' : '';
    openConfirm({ tf: ai.tf || '', G: ai.G || '', H: ai.H || '' }, r.preview,
      label + r.message + ` (AI 확신도 ${Math.round((ai.confidence || 0) * 100)}%)`, ai.conditions || [], ai.uncertain || []);
  };
}

// ─────────────────────────── 학습 화면 ───────────────────────────
function renderProblem() {
  const r = state.result;
  $('pTf').textContent = r.input.text;
  const notes = [...(r.input.notes || [])];
  if (r.diagram) notes.push(`폐루프 T(s) = ${r.diagram.T}`);
  $('pNotes').textContent = notes.join(' · ');
  const nav = $('stepNav'); nav.innerHTML = '<i class="step-ind" id="stepInd"></i>';
  for (const st of r.steps) {
    const b = document.createElement('button');
    b.className = 'step-btn'; b.dataset.n = st.n;
    b.innerHTML = `<span class="no">${st.n}</span><span>${esc(st.title)}</span><span class="mark" id="mark${st.n}"></span>`;
    b.onclick = () => goStep(st.n);
    nav.appendChild(b);
  }
  const v = r.verification;
  $('verifySummary').textContent = `Python 엔진 자체 검증 ${v.verified}/${v.total} 단계 통과 · 계산 ${r.elapsedMs} ms`;
}

// 단계 이동: 제목·질문·풀이·입력 칸·힌트·그래프를 그 단계에 맞게 바꿉니다.
function goStep(n) {
  state.step = n;
  const st = state.result.steps[n - 1];
  document.querySelectorAll('.step-btn').forEach((b) => b.classList.toggle('on', +b.dataset.n === n));
  // 좁은 화면에서는 단계 목록이 가로로 스크롤되므로, 현재 단계 버튼이 보이도록 목록만 옮깁니다
  const nav = $('stepNav'), on = nav.querySelector('.on');
  if (on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: on.offsetLeft - nav.clientWidth / 2 + on.clientWidth / 2, behavior: 'smooth' });
  moveIndicator(!state.started);
  $('topProgress').style.transform = `scaleX(${n / 9})`;
  // 배경 흐름선도 같은 비율만큼 왼쪽부터 밝아집니다 (상단 선·단계 목록·배경이 같은 진행을 가리킴)
  flowTo({ progress: n / 9 }, 1.4);
  // 제목·질문 바꾸기: 이전 글자가 위로 빠지고 새 글자가 아래에서 올라옵니다
  const setText = () => { $('stepNo').textContent = n; $('stepTitle').textContent = st.title; $('stepConcept').textContent = st.hints[0].text; };
  const heads = ['#stepNo', '#stepTitle', '#stepConcept'];
  if (MOTION && state.started) {
    gsap.killTweensOf(heads);
    gsap.to(heads, { y: -12, opacity: 0, duration: 0.16, ease: 'power2.in', onComplete: () => {
      setText();
      gsap.fromTo(heads, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.06, ease: EASE });
    } });
  } else setText();
  $('stepFormula').textContent = st.formula;
  $('stepWork').innerHTML = st.work.map((w) => `<li>${esc(w)}</li>`).join('');
  $('workCard').open = false;
  $('prevStep').disabled = n === 1; $('nextStep').disabled = n === 9;

  // 엔진이 이 단계를 어떻게 스스로 검산했는지 보여 줍니다
  const ck = st.check;
  $('engineCheck').innerHTML = `<div class="label">엔진 검산</div>
    <span class="${ck.status === 'verified' ? 'ok' : 'bad'}">${ck.status === 'verified' ? '검증 통과' : '검증 실패 · 결과를 확정하지 않음'}</span>
    <div>${esc(ck.method)}</div><div class="muted">${esc(ck.detail)}</div>`;

  renderAnswers(n);
  renderLadder(n);
  $('hwReport').innerHTML = '';

  if (MOTION && state.started) {
    gsap.fromTo('#answerForm, #ladder, #engineCheck', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.05, ease: EASE });
  }

  // 그래프: 이 단계에서 새로 나오는 요소가 그려지는 움직임은 graph.js가 맡습니다
  const g = state.graph;
  $('kControl').hidden = n < 8;
  if (n >= 8) { if (g.kIndex === null) setKIndex(0); } else g.setK(null);
  g.setStep(n);
  legend(n);
}

function legend(n) {
  // 색은 graph.js의 무대 색과 같습니다. 이 단계에서 새로 나온 항목만 떠오르는 움직임(.new)
  const items = [['극점 ×, 영점 ○', '#F5F4F0', 2], ['실수축 구간', '#B1CBE6', 3], ['점근선', '#B4A9D5', 4],
    ['이탈·진입점', '#B4A9D5', 5], ['출발·도착각', '#B4A9D5', 6], ['허수축 교차', '#E8A493', 7], ['근궤적', '#B1CBE6', 8]];
  $('legend').innerHTML = items.filter((i) => n >= i[2] && !(i[2] === 3 && n >= 8))
    .map((i) => `<span class="${i[2] === n ? 'new' : ''}"><i style="background:${i[1]}"></i>${i[0]}</span>`).join('');
}

// 단계별 답 입력 칸 (서버의 /api/fields 목록으로 만듭니다)
function renderAnswers(n) {
  const form = $('answerForm'); form.innerHTML = ''; $('verdicts').innerHTML = '';
  const list = state.fields[String(n)] || [];
  if (!list.length) { form.innerHTML = '<p class="muted small">이 단계는 그래프를 보며 앞 단계 결과를 이어 보는 단계입니다.</p>'; return; }
  for (const f of list) {
    const lab = document.createElement('label');
    lab.innerHTML = `${esc(f.label)}<div class="row"><input data-field="${f.field}" autocomplete="off" spellcheck="false"><button class="btn ghost small" type="submit" data-for="${f.field}">검사</button></div>`;
    form.appendChild(lab);
  }
  if (n === 9) {
    const lab = document.createElement('label');
    lab.innerHTML = `사용할 K 값<div class="row"><input id="answerK" value="10" class="mono"></div>`;
    form.prepend(lab);
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const field = e.submitter?.dataset.for || list[0].field;
    const inp = form.querySelector(`input[data-field="${field}"]`);
    const K = n === 9 ? parseFloat($('answerK').value) : undefined;
    const v = await API.check(state.problem, field, inp.value, K);
    (state.checked[n] ||= {})[field] = v;
    showVerdict(field, v, inp.value);
    markStep(n);
  };
}

const STATUS_TEXT = { correct: '정답', approx: '정답 (반올림 허용)', incorrect: '다시 확인', unreadable: '읽지 못함', unverifiable: '검증 불가' };

function showVerdict(field, v, answer) {
  const box = document.createElement('div');
  box.className = `verdict ${v.status}`;
  let html = `<b>${STATUS_TEXT[v.status] || v.status}</b>`;
  if (v.status === 'incorrect') {
    html += `<div>내 답: <span class="mono">${esc(v.student)}</span></div>`;
    if (v.diagnosis) html += `<div class="why">${esc(v.diagnosis)}</div>`;
    html += `<button class="btn ghost small" data-explain>AI에게 이유 묻기</button>`;
  } else if (v.status === 'correct' || v.status === 'approx') {
    html += `<div class="mono">${esc(v.expected)}</div>`;
  } else if (v.diagnosis) {
    html += `<div class="why">${esc(v.diagnosis)}</div>`;
  }
  box.innerHTML = html;
  const ex = box.querySelector('[data-explain]');
  if (ex) ex.onclick = () => askHint(Math.max(2, state.hintLevel[state.step] || 2), answer, v);
  $('verdicts').prepend(box);
  if (v.status === 'correct' || v.status === 'approx') Flow.pulse(1);   // 정답이면 배경 전체가 한 번 밝아집니다
}

// 단계 목록에 채점 표시 (모든 칸을 맞히면 ✓)
function markStep(n) {
  const list = state.fields[String(n)] || [];
  const done = list.every((f) => ['correct', 'approx'].includes(state.checked[n]?.[f.field]?.status));
  $('mark' + n).textContent = done ? '✓' : '·';
  $('mark' + n).className = 'mark' + (done ? ' ok' : '');
}

// 힌트 사다리: 1 개념 질문 → 2 공식 → 3 계산 일부 → 4 전체 풀이
function renderLadder(n) {
  const names = ['질문', '공식', '계산 일부', '전체 풀이'];
  $('ladder').innerHTML = names.map((t, i) => `<button class="btn ghost" data-level="${i + 1}">${i + 1}. ${t}</button>`).join('');
  $('hintBox').innerHTML = '';
  $('ladder').querySelectorAll('button').forEach((b) => b.onclick = () => askHint(+b.dataset.level));
  for (let i = 1; i <= (state.hintLevel[n] || 0); i++) $('ladder').children[i - 1].classList.add('used');
}

// 힌트 요청: 서버가 AI 설명을 시도하고, 실패·숫자 검사 탈락 시 팀 힌트를 돌려줍니다.
async function askHint(level, student, verdict) {
  const n = state.step;
  state.hintLevel[n] = Math.max(state.hintLevel[n] || 0, level);
  $('ladder').children[level - 1].classList.add('used');
  if (level === 4) $('workCard').open = true;     // 전체 풀이는 학생이 요청했을 때만 펼칩니다
  const team = state.result.steps[n - 1].hints[level - 1];
  $('hintBox').innerHTML = `${esc(team.text)}<span class="src">팀 힌트 · 엔진 계산값 기반</span>`;
  // AI가 켜져 있으면 AI 설명을 추가로 받습니다 (꺼져 있으면 팀 힌트만으로 충분)
  if (!(state.ai?.available || demo())) return;
  const r = await API.hint(state.problem, n, level, student, verdict, demo());
  if (!r.ok) return;
  if (r.source === 'team') {
    if (r.warning) $('hintBox').innerHTML += `<span class="src">${esc(r.warning)}</span>`;
    return;
  }
  $('hintBox').innerHTML = `${esc(r.text)}<span class="src">${esc(r.providerLabel)} 설명 · 숫자는 엔진 값만 사용했는지 자동 검사됨</span>`;
}

// ─────────────────────────── K 조절 (8·9단계) ───────────────────────────
// 슬라이더는 Python이 미리 계산한 가지 점들 중 몇 번째 점을 보여 줄지만 고릅니다(계산 없음).
// 손을 떼면 그 K에서의 정확한 폐루프 극점을 서버에 다시 물어봅니다.
function setupK() {
  const sl = $('kSlider'), num = $('kValue');
  let timer = null;
  sl.oninput = () => {
    const Ks = state.result.graph.K;
    setKIndex(Math.round(sl.value / 1000 * (Ks.length - 1)));
    clearTimeout(timer); timer = setTimeout(exactPoles, 180);   // 움직임이 멈추면 0.18초 뒤 한 번만 요청
  };
  num.onchange = () => {
    const K = Math.max(0, parseFloat(num.value) || 0);
    const Ks = state.result.graph.K;
    let i = 0; while (i < Ks.length - 1 && Ks[i] < K) i++;     // K 목록에서 가장 가까운 위치 찾기(표시용)
    setKIndex(i, K);
    exactPoles(K);
  };
}

function setKIndex(i, typedK) {
  const Ks = state.result.graph.K;
  state.graph.setK(i);      // 표시는 목표 위치까지 미끄러지듯 이동합니다 (graph.js)
  $('kSlider').value = Math.round(i / (Ks.length - 1) * 1000);
  if (typedK === undefined) $('kValue').value = +Ks[i].toPrecision(5);
}

async function exactPoles(K) {
  if (K === undefined) K = parseFloat($('kValue').value) || 0;
  const r = await API.poles(state.problem, K);
  if (!r.poles) return;
  const st = { stable: '안정', marginal: '임계 안정', unstable: '불안정' }[r.status];
  $('kPoles').innerHTML = `K = ${+K.toPrecision(6)} → ` + r.poles.map((p) => esc(p.text)).join(', ') +
    `<span class="st ${r.status}">${st}</span>`;
}

// 그래프를 누르면 그 점의 K(크기 조건)를 서버가 계산합니다
async function onPick(x, y) {
  const r = await API.gain(state.problem, x, y);
  const pt = `s = ${x.toFixed(3)} ${y >= 0 ? '+' : '−'} j${Math.abs(y).toFixed(3)}`;
  if (r.K === null || r.K === undefined) { $('readout').textContent = pt; return; }
  $('readout').textContent = r.onLocus
    ? `${pt}  →  근궤적 위의 점, K = ${r.K.toPrecision(5)}`
    : `${pt}  →  근궤적 위가 아님 (각 조건 오차 ${r.angleError.toFixed(1)}°)`;
}

// ─────────────────────────── 손글씨 풀이 ───────────────────────────
function setupHandwriting() {
  const ready = () => { $('hwGo').disabled = !($('hwInput').files[0] && ($('hwConsent').checked || demo())); };
  $('hwInput').onchange = ready; $('hwConsent').onchange = ready;
  $('demoMode').addEventListener('change', ready);
  $('hwGo').onclick = async () => {
    $('hwGo').disabled = true; $('hwReport').innerHTML = '<p class="muted small">AI가 읽고, 엔진이 검증하는 중…</p>';
    const r = await API.upload('/api/ai/handwriting', $('hwInput').files[0],
      { consent: $('hwConsent').checked, demo: demo(), problem: JSON.stringify(state.problem) });
    ready();
    if (!r.ok) { $('hwReport').innerHTML = `<p class="error small">${esc(r.error.message)} ${esc(r.fallback || '')}</p>`; return; }
    const rep = r.report;
    let html = r.provider === 'mock' ? '<p class="muted small">[모의 AI 응답: 사진을 실제로 읽지 않은 시연용 결과]</p>' : '';
    if (rep.firstError) html += `<p><b>처음 틀린 단계:</b> ${rep.firstError.step}단계 ${esc(rep.firstError.stepTitle)}</p>`;
    for (const it of rep.items) {
      html += `<div class="hw-row"><span class="tag ${it.outcome}">${esc(it.label)}</span>
        <div>${it.step}단계 ${esc(it.stepTitle)} · ${esc(it.location)}</div>
        <div>학생 답: <span class="mono">${esc(it.student)}</span>${it.engine && it.engine.expected ? ` · 엔진 결과: <span class="mono">${esc(it.engine.expected)}</span>` : ''}</div>
        <div class="why muted">${esc(it.message)}</div>
        ${it.cause ? `<div class="why">오류 원인: ${esc(it.cause)}</div>` : ''}
        ${it.ai.reason && it.cause !== it.ai.reason ? `<div class="why muted">AI 의견: ${esc(it.ai.reason)}</div>` : ''}</div>`;
    }
    for (const u of rep.unreadable || []) html += `<div class="hw-row"><span class="tag recognize">인식 확인 필요</span> ${esc(u.location)} · ${esc(u.note)}</div>`;
    html += `<p class="muted small">${esc(r.note)}</p>`;
    $('hwReport').innerHTML = html;
  };
}

init();
