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
  addEventListener('resize', () => { moveIndicator(true); layoutStage(true); if (!MOTION) Flow.frame(); });
  // 식을 입력하는 동안 배경 가닥이 살짝 반응합니다
  $('tfInput').addEventListener('input', () => Flow.pulse(0.22));
  $('prevStep').onclick = () => stepBy(-1);
  $('nextStep').onclick = () => stepBy(1);
  setupPhoto();
  setupHandwriting();
  setupK();
  Sheets.init();
  setupTimeline();
  state.graph.onTip = placeTip;
  state.graph.onFrame = drawLinks;

  // 서버 상태와 입력 칸 목록을 한 번 받아 둡니다
  try {
    const [h, f] = await Promise.all([API.health(), API.fields()]);
    state.ai = h.ai; state.fields = f;
    showAiStatus();
    setupPhoto.refresh?.();
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
  document.body.classList.remove('studying');
  hideTip();
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
  flowTo({ flow: 1, dim: 0.38, oy: 0, ox: 0 }, 2);   // 풀이 중에는 배경 흐름선을 흐리게 해서 그래프·수식이 먼저 보이게 합니다
  if (MOTION) await gsap.to('#entry', { opacity: 0, y: -30, duration: 0.4, ease: 'power2.in' });
  $('entry').hidden = true; $('confirm').hidden = true; $('studio').hidden = false;
  document.body.classList.add('studying');      // 페이지 스크롤을 멈추고 화면 높이에 딱 맞춥니다
  if (MOTION) gsap.set('#entry', { clearProps: 'all' });
  window.scrollTo(0, 0);
  state.started = false;
  renderProblem();
  paintKTrack();
  hideTip();
  state.graph.resize();
  state.graph.setData(res.graph);     // 축이 원점에서 바깥으로 그려지며 시작
  state.graph.setAnchors(buildAnchors(res));
  layoutStage(true);
  goStep(1);
  state.started = true;
  if (MOTION) {
    gsap.from('#plane', { opacity: 0, scale: 0.97, duration: 1.4, ease: EASE });
    gsap.from('.problem-line, .stage-head > *, .hud-foot', { y: 20, opacity: 0, duration: 1, stagger: 0.07, ease: EASE, delay: 0.25 });
    gsap.from('.dock-btn', { x: 24, opacity: 0, duration: 0.9, stagger: 0.05, ease: EASE, delay: 0.35 });
    gsap.from('.timeline', { y: 40, opacity: 0, duration: 1, ease: EASE, delay: 0.2 });
    gsap.from('.step-btn', { y: 12, opacity: 0, duration: 0.8, stagger: 0.035, ease: EASE, delay: 0.4 });
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
function openConfirm(vals, pre, msg, conditions, uncertain, photo) {
  $('confirm').hidden = false;
  $('confirmMsg').textContent = msg;
  const img = $('confirmPhoto');
  if (img.dataset.url) { URL.revokeObjectURL(img.dataset.url); delete img.dataset.url; }
  img.hidden = !photo;
  if (photo) { img.dataset.url = URL.createObjectURL(photo); img.src = img.dataset.url; }
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
    const G = $('cG').value.trim(), H = $('cH').value.trim(), tf = $('cTf').value.trim();
    // 고친 곳이 없고 엔진이 미리 해석한 구조(블록선도 등)가 있으면 그 구조 그대로 계산합니다.
    // (예전에는 블록선도도 G·H 칸만 보고 계산해서, 칸이 비면 다른 식이 될 수 있었습니다)
    const untouched = tf === (vals.tf || '') && G === (vals.G || '') && H === (vals.H || '');
    if (untouched && pre.problem) { start(pre.problem, $('confirmGo')); return; }
    // 사용자가 고친 값을 우선: G가 있으면 G·H 구조, 없으면 전달함수 한 줄
    if (G) start({ G, H: H || '1' }, $('confirmGo')); else start({ text: tf }, $('confirmGo'));
  };
  $('confirmCancel').onclick = () => { $('confirm').hidden = true; };
}

// 문제 사진 업로드 → AI 인식 → 확인 패널
// 시연 모드의 모의 AI는 사진을 읽지 않고 늘 같은 예시를 돌려줍니다. 그래서 사진 탭에 그 사실을 분명히 적고,
// 버튼 이름도 '예시 결과 보기'로 바꿉니다. (예전에는 이 안내가 없어 "사진을 바꿔도 같은 식만 나온다"고 보였습니다)
// 사진을 외부 AI로 보내기 전에 준비합니다 (Gemini 약관: 무료 등급에는 개인정보를 보내지 말 것).
//  1) 캔버스에 다시 그려 저장하므로, 휴대폰 사진 속 위치(GPS)·기기 정보(EXIF)가 빠집니다
//  2) 긴 변을 1600px 이하로 줄입니다 (전송 시간·AI 토큰 절약, 서버 6MB 제한 대비)
//  3) 원본 사진의 지문(SHA-256)을 함께 보내, 서버가 같은 사진을 알아보게 합니다 (시연 백업용)
// 이 브라우저가 그 형식을 그리지 못하면(예: 일부 브라우저의 HEIC) 원본을 그대로 보냅니다.
async function prepPhoto(file) {
  let id = '';
  try {
    if (window.crypto && crypto.subtle) {
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
      id = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { id = ''; }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);   // 투명한 PNG도 흰 종이 위 글씨처럼
    cx.drawImage(img, 0, 0, w, h);                    // 최신 브라우저는 사진의 회전 정보(EXIF)를 반영해 그립니다
    const png = file.type === 'image/png';
    const blob = await new Promise((r) => cv.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.9));
    if (blob && blob.size > 0) return { file: new File([blob], png ? 'photo.png' : 'photo.jpg', { type: blob.type }), id };
  } catch (e) { /* 그리지 못한 형식: 원본을 보냄 */ } finally { URL.revokeObjectURL(url); }
  return { file, id };
}

function setupPhoto() {
  const inp = $('photoInput'), drop = $('drop');
  let file = null, reader = null;
  const ready = () => { $('photoGo').disabled = !(file && ($('consent').checked || demo())); };
  const showMode = () => {
    const el = $('photoMode'), go = $('photoGo');
    el.hidden = false;
    el.classList.toggle('demo', demo());
    if (demo()) {
      el.textContent = '시연 모드에서는 사진을 읽지 않습니다. 어떤 사진을 올려도 정해 둔 예시 결과 하나를 보여 줍니다. 실제로 읽으려면 오른쪽 위 시연 모드를 끄세요.';
      go.textContent = '예시 결과 보기';
    } else {
      go.textContent = '사진 인식';
      if (reader === 'claude') el.textContent = '이 미리보기 링크에서는 Claude가 사진을 읽습니다(본선 앱은 Gemini). 계산은 Python 엔진 결과만 씁니다.';
      else if (API.offline) el.textContent = '이 미리보기 파일에서는 실제 AI로 사진을 읽을 수 없습니다. 노트북에서 python run.py로 실행하면 Gemini가 읽습니다.';
      else if (state.ai && !state.ai.available) el.textContent = 'AI 키가 설정되지 않아 사진 인식이 꺼져 있습니다. 식을 직접 입력하거나 시연 모드로 흐름만 볼 수 있습니다.';
      else el.hidden = true;
    }
  };
  const pick = (f) => {
    file = f || null;
    drop.querySelector('.drop-title').textContent = file ? file.name : '사진을 끌어 놓거나 눌러서 고르기';
    $('confirm').hidden = true;   // 새 사진을 고르면 이전 사진의 인식 결과는 닫습니다
    ready();
  };
  inp.onchange = () => pick(inp.files[0]);
  $('consent').onchange = ready;
  $('demoMode').addEventListener('change', () => { ready(); showMode(); });
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); };
  showMode();
  if (API.photoReader) API.photoReader().then((r) => { reader = r; showMode(); });
  setupPhoto.refresh = showMode;   // 서버 상태(AI 키 유무)를 받은 뒤 다시 그립니다
  $('photoGo').onclick = async () => {
    entryError('');
    const label = $('photoGo').textContent;
    $('photoGo').disabled = true; $('photoGo').textContent = demo() ? '불러오는 중…' : '인식 중…';
    const prep = demo() ? { file, id: '' } : await prepPhoto(file);
    const r = await API.upload('/api/ai/recognize', prep.file, { consent: $('consent').checked, demo: demo(), photoId: prep.id });
    $('photoGo').textContent = label; ready();
    // 같은 사진을 다시 골라도 change가 일어나도록 비웁니다 (고른 파일은 file에 남아 있음)
    inp.value = '';
    if (!r.ok) { entryError(`${r.error.message} ${r.fallback || ''}`); return; }
    const ai = r.ai;
    const msg = r.provider === 'mock'
      ? '[시연 모드: 사진을 읽지 않은 예시 결과입니다] ' + r.message
      : `${r.providerLabel ? r.providerLabel + ' · ' : ''}${r.message} (AI 확신도 ${Math.round((ai.confidence || 0) * 100)}%)`;
    openConfirm({ tf: ai.tf || '', G: ai.G || '', H: ai.H || '' }, r.preview, msg, ai.conditions || [], ai.uncertain || [],
      r.provider === 'mock' ? null : file);
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
    b.title = `${st.n}. ${st.title}`;
    b.innerHTML = `<span class="no">${st.n}</span><span class="t">${esc(st.title)}</span><span class="mark" id="mark${st.n}"></span>`;
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
  document.querySelectorAll('.step-btn').forEach((b) => { b.classList.toggle('on', +b.dataset.n === n); b.classList.toggle('past', +b.dataset.n < n); });
  $('tlFill').style.transform = `scaleX(${(n - 1) / 8})`;
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
  const kWas = !$('kControl').hidden;
  $('kControl').hidden = n < 8;
  if (n >= 8) { if (g.kIndex === null) { setKIndex(0); exactPoles(0); } } else g.setK(null);
  legend(n);
  // 누른 점의 말풍선은 단계가 바뀌면 닫습니다. 카메라·조명은 이 단계의 주인공 쪽으로, 수식의 숫자는 그래프로.
  hideTip();
  stageStep(n);
  if (kWas !== !$('kControl').hidden || !state.started) layoutStage(!state.started);
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
  if (level === 4) Sheets.show('work');           // 전체 풀이는 학생이 요청했을 때만 펼칩니다
  const team = state.result.steps[n - 1].hints[level - 1];
  // 전체 풀이는 정답 베끼기에 쓰이지 않도록 '학습 확인용'임을 함께 알립니다 (예선 PPT 5장 대응)
  const note = level === 4 ? '<span class="src">학습 확인용 풀이입니다. 먼저 1~3번 힌트로 직접 풀어 본 뒤 비교해 보세요.</span>' : '';
  $('hintBox').innerHTML = `${esc(team.text)}<span class="src">팀 힌트 · 엔진 계산값 기반</span>${note}`;
  // AI가 켜져 있으면 AI 설명을 추가로 받습니다 (꺼져 있으면 팀 힌트만으로 충분)
  if (!(state.ai?.available || demo())) return;
  const r = await API.hint(state.problem, n, level, student, verdict, demo());
  if (!r.ok) return;
  if (r.source === 'team') {
    if (r.warning) $('hintBox').innerHTML += `<span class="src">${esc(r.warning)}</span>`;
    return;
  }
  $('hintBox').innerHTML = `${esc(r.text)}<span class="src">${esc(r.providerLabel)} 설명 · 숫자는 엔진 값만 사용했는지 자동 검사됨</span>${note}`;
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

// ─────────────────────────── 그래프의 점 값 ───────────────────────────
// 누를 수 있는 점 목록을 엔진 결과로 만듭니다. 말풍선에 들어가는 글자·숫자는 모두 서버가 보낸 값입니다
// (각도·K는 엔진이 계산한 수를 소수 둘째 자리까지 줄여 보여 주기만 합니다).
const fmtDeg = (d) => `${(Math.round(d * 100) / 100).toString().replace('-', '−')}°`;
const conjText = (t) => (t.includes('+ j') ? t.replace('+ j', '− j') : t.replace('− j', '+ j'));
function buildAnchors(res) {
  const A = [], st = res.steps, g = res.graph;
  const items = st[5].result.items || [];
  const angleLines = (re, im, kind) => () => {
    if (state.step < 6) return [];
    const it = items.find((x) => x.kind === kind && Math.abs(x.at[0] - re) < 1e-9 && Math.abs(Math.abs(x.at[1]) - Math.abs(im)) < 1e-9);
    if (!it) return [];
    const sgn = im < 0 && it.at[1] > 0 ? -1 : 1;     // 아래쪽 켤레 점은 각의 부호만 바뀝니다
    return [`${kind === 'departure' ? '출발각' : '도착각'} ${it.angles.map((a) => fmtDeg(sgn * a)).join(', ')}`];
  };
  for (const p of st[1].result.poles) {
    A.push({ x: p.re, y: p.im, layer: 'pz', title: p.mult > 1 ? `극점 (${p.mult}중근)` : '극점', main: `s = ${p.text}`, more: angleLines(p.re, p.im, 'departure') });
  }
  for (const z of st[1].result.zeros || []) {
    A.push({ x: z.re, y: z.im, layer: 'pz', title: z.mult > 1 ? `영점 (${z.mult}중근)` : '영점', main: `s = ${z.text}`, more: angleLines(z.re, z.im, 'arrival') });
  }
  const r4 = st[3].result;
  if (g.asymptotes && g.asymptotes.showCentroid && r4.centroid) {
    const c = r4.centroid, approx = c.approxText && c.approxText !== c.text ? ` ≈ ${c.approxText}` : '';
    A.push({ x: g.asymptotes.centroid, y: 0, layer: 'asym', title: '점근선 중심', main: `σ = ${c.text}${approx}`,
      more: () => [`각도 ${r4.angles.map(fmtDeg).join(', ')}`] });
  }
  for (const b of st[4].result.valid || []) {
    const name = b.status === 'breakaway' ? '이탈점' : b.status === 'breakin' ? '진입점' : '이탈·진입점';
    A.push({ x: b.s[0], y: b.s[1], layer: 'brk', title: name, main: `s = ${b.sText}`, more: () => [`K = ${b.KText}`] });
    if (Math.abs(b.s[1]) > 1e-12) A.push({ x: b.s[0], y: -b.s[1], layer: 'brk', title: name, main: `s = ${conjText(b.sText)}`, more: () => [`K = ${b.KText}`] });
  }
  for (const c of st[6].result.crossings || []) {
    const w = c.omegaText || String(c.omega);
    const approx = c.omegaExact && w !== c.omega.toFixed(4) ? ` ≈ ${c.omega.toFixed(4)}` : '';
    const more = () => [`K = ${c.KText}${String(c.K) !== c.KText ? ` ≈ ${+c.K.toPrecision(6)}` : ''}`];
    if (c.omega > 1e-12) {
      A.push({ x: 0, y: c.omega, layer: 'cross', title: '허수축 교차', main: `s = +j${w}${approx}`, more });
      A.push({ x: 0, y: -c.omega, layer: 'cross', title: '허수축 교차', main: `s = −j${w}${approx}`, more });
    } else A.push({ x: 0, y: 0, layer: 'cross', title: '허수축 교차', main: 's = 0', more });
  }
  return A;
}

// 단계별 자동 카메라: 그 단계에서 꼭 보여야 하는 점을 모두 담는 영역을 돌려줍니다 (graph.frame에 넘김).
//   1·8·9단계  전체 보기 (Python이 정한 범위: 근궤적 전체)
//   2·3·6단계  극점·영점 전부
//   4단계      + 점근선 중심        5단계  + 이탈·진입점        7단계  + 허수축 교차점(±jω)
// 점들이 좁게 모여 있으면 다가가고, 멀리 퍼져 있으면 물러납니다. 실수축은 늘 화면 안에 둡니다.
function boxFor(n) {
  const g = state.result.graph, v = g.view;
  if (n === 1 || n >= 8) return null;
  const pts = [...(g.poles || []), ...(g.zeros || [])].map((p) => [p[0], p[1]]);
  if (n === 4 && g.asymptotes && g.asymptotes.showCentroid) pts.push([g.asymptotes.centroid, 0]);
  if (n === 5) for (const b of g.breakpoints || []) pts.push([b[0], b[1]], [b[0], -b[1]]);
  if (n === 7) for (const c of g.crossings || []) pts.push([c[0], c[1]], [c[0], -c[1]]);
  if (!pts.length) return null;
  const b = { xmin: Infinity, xmax: -Infinity, ymin: 0, ymax: 0 };   // y 범위에 0을 넣어 실수축이 늘 보이게
  for (const [x, y] of pts) {
    b.xmin = Math.min(b.xmin, x); b.xmax = Math.max(b.xmax, x);
    b.ymin = Math.min(b.ymin, y); b.ymax = Math.max(b.ymax, y);
  }
  // 너무 좁으면(점 하나, 한 줄로 늘어선 극점) 전체 보기의 40%보다 작아지지 않게 넓힙니다 → 지나친 확대 방지
  const grow = (lo, hi, min) => { const c = (b[lo] + b[hi]) / 2, h = Math.max(b[hi] - b[lo], min) / 2; b[lo] = c - h; b[hi] = c + h; };
  grow('xmin', 'xmax', (v.xmax - v.xmin) * 0.4);
  grow('ymin', 'ymax', (v.ymax - v.ymin) * 0.4);
  return b;
}

// 그 단계의 주인공 점 (조명이 비추는 곳). 없으면 null.
function keyPoint(n) {
  const r = focusRaw(n);
  return r[0] || null;
}
function focusRaw(n) {
  const g = state.result.graph, st = state.result.steps;
  if (n === 5) { const b = (st[4].result.valid || [])[0]; if (b) return [[b.s[0], b.s[1]], 1.5]; }
  if (n === 6) { const it = (st[5].result.items || [])[0]; if (it) return [[it.at[0], it.at[1]], 1.5]; }
  if (n === 7) { const c = (g.crossings || [])[0]; if (c) return [[0, c[1]], 1.45]; }
  return [null];
}

// 그래프를 눌렀을 때: 표시된 점이면 그 점의 값을 말풍선으로, 빈 곳이면 닫기
function onPick(a) {
  const tip = $('pointTip');
  if (!a) { hideTip(); return; }
  const more = a.more ? a.more() : [];
  tip.innerHTML = `<b>${esc(a.title)}</b><div class="mono">${esc(a.main)}</div>` + more.map((m) => `<div class="mono muted">${esc(m)}</div>`).join('');
  tip.hidden = false;
  tip.classList.remove('show'); void tip.offsetWidth; tip.classList.add('show');
}
// 말풍선 위치: graph.js가 매 프레임 점의 화면 위치를 알려 줍니다(카메라가 움직여도 점을 따라감)
function placeTip(px, py) {
  const tip = $('pointTip');
  if (tip.hidden) return;
  tip.style.left = px + 'px'; tip.style.top = py + 'px';
  tip.classList.toggle('below', py < 110);
}
function hideTip() { $('pointTip').hidden = true; if (state.graph) state.graph.clearPick(); }

// ─────────────────────────── 수식이 그림이 되는 연출 ───────────────────────────
// 단계마다 핵심 수식을 크게 보여 주고, 그래프의 점·선과 이어진 숫자(hot)는 그 자리로 날아가 앉습니다.
// 날아간 숫자와 점은 가는 선으로 계속 이어져 "이 점은 이 계산에서 나왔다"를 보여 줍니다.
// 수식의 글자와 숫자는 모두 서버(엔진) 결과의 글자 그대로입니다. 여기서는 배치만 합니다.
// 토큰: { t: 글자, a: [re, im] 이 숫자가 가리키는 점 (없으면 null), c: 'dim' | 'res' 같은 모양 }
function formulaFor(n) {
  const st = state.result.steps, g = state.result.graph;
  const T = (t, a, c) => ({ t, a: a || null, c: c || '' });
  const out = [];
  if (n === 1) {
    out.push(T('1 + K·G(s)H(s) = 0', null, 'dim'), T('\n'), T(`${st[0].result.charPoly} = 0`, null, 'res'));
  } else if (n === 2) {
    const r = st[1].result;
    out.push(T('극점  ', null, 'dim'));
    r.poles.forEach((p, i) => { if (i) out.push(T(',  ', null, 'dim')); out.push(T(p.text + (p.mult > 1 ? ` (×${p.mult})` : ''), [p.re, p.im])); });
    if ((r.zeros || []).length) {
      out.push(T('\n'), T('영점  ', null, 'dim'));
      r.zeros.forEach((z, i) => { if (i) out.push(T(',  ', null, 'dim')); out.push(T(z.text + (z.mult > 1 ? ` (×${z.mult})` : ''), [z.re, z.im])); });
    }
    out.push(T('\n'), T(`가지 수 n = ${r.branches}`, null, 'dim'));
  } else if (n === 3) {
    const v = g.view, segs = st[2].result.segments || [];
    out.push(T('근궤적 구간  ', null, 'dim'));
    segs.forEach((sg, i) => {
      if (i) out.push(T(' ∪ ', null, 'dim'));
      const lo = sg.lo === null ? Math.max(v.xmin, sg.hi - (v.xmax - v.xmin) * 0.3) : sg.lo;
      const hi = sg.hi === null ? Math.min(v.xmax, sg.lo + (v.xmax - v.xmin) * 0.3) : sg.hi;
      out.push(T(`[${sg.loText}, ${sg.hiText}]`, [(lo + hi) / 2, 0]));
    });
    if (!segs.length) out.push(T('없음', null, 'dim'));
  } else if (n === 4) {
    const r = st[3].result;
    if (r.centroid && g.asymptotes && g.asymptotes.showCentroid) {
      out.push(T('σa = (Σp − Σz)/(n − m) = ', null, 'dim'), T(r.centroid.text, [g.asymptotes.centroid, 0], 'res'));
      out.push(T('\n'), T(`θ = ${r.angles.map(fmtDeg).join(', ')}`, null, 'dim'));
    } else out.push(T(st[3].formula, null, 'dim'));
  } else if (n === 5) {
    const r = st[4].result;
    out.push(T(`${r.equation} = 0`, null, 'dim'));
    (r.valid || []).forEach((b) => { out.push(T('\n'), T('s = ', null, 'dim'), T(b.sText, [b.s[0], b.s[1]], 'res'), T(`   K = ${b.KText}`, null, 'dim')); });
    if (!(r.valid || []).length) out.push(T('\n'), T('근궤적 위의 이탈·진입점 없음', null, 'dim'));
  } else if (n === 6) {
    const r = st[5].result, pts = {};
    for (const p of st[1].result.poles) pts[p.text] = [p.re, p.im];
    for (const z of st[1].result.zeros || []) pts[z.text] = [z.re, z.im];
    const it = (r.items || [])[0];
    if (it) {
      out.push(T(`θ${it.kind === 'departure' ? 'd' : 'a'} = 180°`, null, 'dim'));
      for (const c of it.contributions) out.push(T(` ${c.sign} `, null, 'dim'), T(`${c.mult > 1 ? c.mult + '×' : ''}${fmtDeg(c.angle)}`, pts[c.from] || null));
      out.push(T(' = ', null, 'dim'), T(it.angles.map(fmtDeg).join(', '), it.at, 'res'));
    } else out.push(T('복소 극점·영점이 없어 구할 각이 없습니다', null, 'dim'));
  } else if (n === 7) {
    const r = st[6].result;
    out.push(T(`안정  ${r.stableText}`, null, 'dim'));
    for (const c of r.crossings || []) {
      out.push(T('\n'), T('s = ', null, 'dim'), T(c.omega > 1e-12 ? `±j${c.omegaText}` : '0', c.omega > 1e-12 ? [[0, c.omega], [0, -c.omega]] : [0, 0], 'res'), T(`   K = ${c.KText}`, null, 'dim'));
    }
  } else if (n === 8) {
    out.push(T('K = 0 → ∞', null, 'dim'), T('   극점에서 출발해 영점·점근선으로', null, 'dim'));
  } else if (n === 9) {
    out.push(T('D(s) + K·N(s) = 0 의 근 = 폐루프 극점', null, 'dim'));
  }
  return out;
}

const Fx = { tokens: [], links: [] };   // 지금 화면의 토큰(점과 이어진 것만)과 연결선
// 수식을 그리고, 점과 이어진 숫자의 개수를 돌려줍니다
function renderFormula(n) {
  const box = $('bigFormula');
  const parts = formulaFor(n);
  box.innerHTML = parts.map((p, i) => p.t === '\n' ? '<br>' :
    `<span class="tok ${p.a ? 'hot' : ''} ${p.c}" data-i="${i}">${esc(p.t)}</span>`).join('');
  // 한 숫자가 여러 점을 가리킬 수 있습니다(예: ±jω는 위·아래 두 교차점). pts는 항상 점의 목록입니다.
  Fx.tokens = parts.map((p, i) => ({ ...p, pts: p.a ? (Array.isArray(p.a[0]) ? p.a : [p.a]) : [], el: box.querySelector(`[data-i="${i}"]`) }))
    .filter((p) => p.pts.length && p.el);
  Fx.links = [];
  $('links').innerHTML = '';
  $('flyLayer').innerHTML = '';
  return Fx.tokens.length;
}

// 숫자가 수식에서 떨어져 나와 그래프의 점으로 날아갑니다. 점이 카메라와 함께 움직여도 도착 지점을 매 프레임 다시 잽니다.
// 도착하면 그 점에서 빛이 번지고, 수식의 숫자와 점 사이에 가는 선이 남습니다.
// 2026-11-17 주영님 요청: 눈으로 따라갈 수 있게 조금 느리게(0.95초 → 1.2초).
// 속도 곡선도 sine.inOut으로 바꿔, 가운데 구간의 최고 속도를 낮췄습니다(power2보다 덜 급하게 가속).
const FLY = 1.2;     // 초
const FLY_GAP = 0.13; // 숫자 여러 개가 차례로 떠나는 간격(초)
function flyTokens(stepAtStart) {
  const stage = $('stage').getBoundingClientRect(), layer = $('flyLayer'), g = state.graph;
  let k = 0;
  Fx.tokens.forEach((tk) => tk.pts.forEach((pt) => {
    const i = k++;
    const r = tk.el.getBoundingClientRect();
    const sx = r.left - stage.left + r.width / 2, sy = r.top - stage.top + r.height / 2;
    const fly = document.createElement('span');
    fly.className = 'fly'; fly.textContent = tk.t;
    fly.style.fontSize = getComputedStyle(tk.el).fontSize;
    layer.appendChild(fly);
    const w = fly.offsetWidth, h = fly.offsetHeight;
    const o = { p: 0 };
    gsap.to(o, { p: 1, duration: FLY, delay: 0.1 + i * FLY_GAP, ease: 'sine.inOut',
      onStart: () => tk.el.classList.add('sent'),
      onUpdate: () => {
        if (state.step !== stepAtStart) return;
        const [tx, ty] = g.toPx(pt[0], pt[1]);
        const u = o.p, cx = sx + (tx - sx) * 0.15, cy = Math.min(sy, ty) - 60;   // 살짝 위로 휘는 곡선
        const x = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * tx;
        const y = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * ty;
        fly.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) scale(${1 - 0.55 * u})`;
        fly.style.opacity = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
      },
      onComplete: () => {
        fly.remove();
        if (state.step !== stepAtStart) return;
        g.pulse(pt[0], pt[1]);
        addLink(tk, pt);
      } });
  }));
}

// 수식의 숫자 ↔ 그래프의 점 연결선. 위치는 graph.js가 그릴 때마다 맞춥니다(onFrame → drawLinks).
function addLink(tk, pt) {
  const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  if (tk.c === 'res') ln.setAttribute('class', 'res');
  $('links').appendChild(ln);
  const L = { tk, pt, ln, a: 0 };
  Fx.links.push(L);
  if (MOTION) gsap.to(L, { a: 1, duration: 0.6, ease: 'power2.out', onUpdate: drawLinks }); else L.a = 1;
  drawLinks();
}
function drawLinks() {
  if (!Fx.links.length) return;
  const stage = $('stage').getBoundingClientRect(), g = state.graph;
  for (const L of Fx.links) {
    const r = L.tk.el.getBoundingClientRect();
    const sx = r.left - stage.left + r.width / 2, sy = r.bottom - stage.top + 2;
    const [tx, ty] = g.toPx(L.pt[0], L.pt[1]);
    // 선은 숫자에서 출발해 점까지 자라납니다 (a: 0 → 1)
    L.ln.setAttribute('x1', sx); L.ln.setAttribute('y1', sy);
    L.ln.setAttribute('x2', sx + (tx - sx) * L.a); L.ln.setAttribute('y2', sy + (ty - sy) * L.a);
  }
}

// 조명: 이 단계의 주인공 자리. 8·9단계는 무대 전체를 밝힙니다.
function lightFor(n) {
  const f = keyPoint(n);
  if (f) return [f, 1];
  if (n >= 8) return [null, 0.2];
  if (n === 4) { const g = state.result.graph; if (g.asymptotes) return [[g.asymptotes.centroid, 0], 1]; }
  if (n === 2 || n === 3) {
    const ps = state.result.steps[1].result.poles;
    return [[ps.reduce((a, p) => a + p.re, 0) / ps.length, 0], 0.85];
  }
  return [null, 0.7];
}

// 단계에 들어설 때의 연출 전체: 수식 → (숫자가 날아감) → 그래프 요소가 그 자리에서 나타남
function stageStep(n) {
  const g = state.graph, hot = renderFormula(n);
  const animate = MOTION && state.started;
  g.setLight(...lightFor(n));
  g.frame(boxFor(n));
  if (animate) {
    gsap.fromTo('#bigFormula .tok', { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.025, ease: EASE, delay: 0.18 });
    requestAnimationFrame(() => layoutStage());     // 수식 높이가 바뀌면 그래프 자리도 함께 옮깁니다
    // 숫자가 날아가 닿는 순간에 맞춰 그래프 요소가 나오도록 늦춥니다
    g.setStep(n, { delay: hot ? (0.1 + FLY * 0.8) * 1000 + 450 : 0 });
    if (hot) setTimeout(() => { if (state.step === n) { layoutStage(); flyTokens(n); } }, 450);
  } else {
    g.setStep(n);
    // 움직임 없이: 연결선만 바로 그립니다
    requestAnimationFrame(() => { layoutStage(true); Fx.tokens.forEach((tk) => { tk.el.classList.add('sent'); tk.pts.forEach((pt) => addLink(tk, pt)); }); });
  }
}

// ─────────────────────────── 한 화면 배치 ───────────────────────────
// 떠 있는 패널(제목·도크·시트·K 막대)에 가리지 않도록 그래프가 쓸 여백을 재서 graph.js에 알려 줍니다.
// 시트를 열고 닫으면 이 값이 바뀌고, 그래프는 남은 자리 가운데로 미끄러져 갑니다.
function layoutStage(instant) {
  if ($('studio').hidden || !state.graph) return;
  const stage = $('stage').getBoundingClientRect(), mobile = innerWidth <= 760;
  const head = $('hudHead').getBoundingClientRect(), kc = $('kControl'), kH = kc.hidden ? 0 : kc.offsetHeight;
  const dock = $('dock').getBoundingClientRect(), sheets = $('sheets');
  const ins = { t: head.bottom - stage.top + 12, l: 20, r: 20, b: 20 };
  // K 막대가 보이면 범례는 그 위로 올라갑니다 (겹치지 않게)
  $('hudFoot').style.bottom = kH && !mobile ? (kH + 22) + 'px' : '';
  if (mobile) {
    sheets.style.bottom = (stage.bottom - dock.top + 10 + (kH ? kH + 8 : 0)) + 'px';
    ins.b = stage.bottom - dock.top + 12 + (kH ? kH + 10 : 0);
    if (Sheets.open.length) ins.b += sheets.offsetHeight + 8;
  } else {
    sheets.style.bottom = '';
    ins.r = Sheets.open.length ? stage.right - sheets.getBoundingClientRect().left + 16 : stage.right - dock.left + 16;
    ins.b = $('hudFoot').offsetHeight + 26 + (kH ? kH + 10 : 0);
  }
  state.graph.setInsets(ins, instant);
}

// ─────────────────────────── 도크와 시트 ───────────────────────────
// 아이콘을 누르면 그 아이콘 자리에서 시트가 커지며 펼쳐집니다(FLIP: 처음 위치·크기에서 최종 위치·크기로 이어서 움직임).
// 넓은 화면은 최대 2장, 휴대폰은 1장. 더 열면 가장 오래된 시트가 닫힙니다.
const Sheets = {
  open: [],
  el(name) { return document.querySelector(`.sheet[data-sheet="${name}"]`); },
  btn(name) { return document.querySelector(`.dock-btn[data-sheet="${name}"]`); },
  max() { return innerWidth <= 760 ? 1 : 2; },
  init() {
    document.querySelectorAll('.dock-btn').forEach((b) => { b.onclick = () => this.toggle(b.dataset.sheet); });
    document.querySelectorAll('.sheet-x').forEach((x) => { x.onclick = () => this.close(x.closest('.sheet').dataset.sheet); });
  },
  toggle(name) { if (this.open.includes(name)) this.close(name); else this.show(name); },
  rects() { return this.open.map((n) => [n, this.el(n).getBoundingClientRect()]); },
  // 다른 시트의 자리가 바뀔 때도 뚝 옮겨지지 않게: 바뀌기 전 위치에서 새 위치로 미끄러지게 합니다
  flipOthers(before, skip) {
    if (!MOTION) return;
    for (const [n, r] of before) {
      if (n === skip || !this.open.includes(n)) continue;
      const dy = r.top - this.el(n).getBoundingClientRect().top;
      if (Math.abs(dy) > 1) gsap.fromTo(this.el(n), { y: dy }, { y: 0, duration: 0.7, ease: EASE, overwrite: 'auto' });
    }
  },
  show(name) {
    if (this.open.includes(name)) { if (MOTION) gsap.fromTo(this.el(name), { scale: 0.98 }, { scale: 1, duration: 0.5, ease: EASE }); return; }
    while (this.open.length >= this.max()) this.close(this.open[0], true);
    const before = this.rects();
    this.open.push(name);
    const el = this.el(name), btn = this.btn(name);
    el.hidden = false; btn.classList.add('on');
    if (MOTION) {
      const r = el.getBoundingClientRect(), b = btn.getBoundingClientRect();
      gsap.fromTo(el, { x: b.left + b.width / 2 - (r.left + r.width / 2), y: b.top + b.height / 2 - (r.top + r.height / 2),
        scaleX: b.width / r.width, scaleY: b.height / r.height, opacity: 0, transformOrigin: '50% 50%' },
      { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1, duration: 0.75, ease: EASE, overwrite: 'auto' });
      gsap.fromTo(el.querySelectorAll('.sheet-head, .sheet-body'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, delay: 0.22, ease: EASE });
    }
    this.flipOthers(before, name);
    hideTip();
    layoutStage();
  },
  close(name, quick) {
    const i = this.open.indexOf(name);
    if (i < 0) return;
    this.open.splice(i, 1);
    const el = this.el(name), btn = this.btn(name);
    btn.classList.remove('on');
    const done = () => {
      const before = this.rects();
      el.hidden = true;
      if (MOTION) gsap.set(el, { clearProps: 'transform,opacity' });
      this.flipOthers(before);
      layoutStage();
    };
    if (!MOTION) { done(); return; }
    const r = el.getBoundingClientRect(), b = btn.getBoundingClientRect();
    if (quick) gsap.to(el, { opacity: 0, scale: 0.96, duration: 0.2, ease: 'power2.in', overwrite: 'auto', onComplete: done });
    else gsap.to(el, { x: b.left + b.width / 2 - (r.left + r.width / 2), y: b.top + b.height / 2 - (r.top + r.height / 2),
      scaleX: b.width / r.width, scaleY: b.height / r.height, opacity: 0, duration: 0.45, ease: 'power3.in', overwrite: 'auto', onComplete: done });
  },
};

// ─────────────────────────── 타임라인 ───────────────────────────
// 단계 이동: 번호 누르기, 화살표, 타임라인을 좌우로 밀기, 무대·타임라인 위에서 휠 한 번, 키보드 ←/→.
// 휠·트랙패드는 한 번 굴리는 동안 신호가 여러 번 오므로, 신호가 0.24초 끊길 때까지는 한 단계만 움직입니다(오작동 방지).
function stepBy(d) { if (state.result) goStep(Math.max(1, Math.min(9, state.step + d))); }
function setupTimeline() {
  const tl = $('timeline');
  let sw = null, swiped = false;
  tl.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY }; swiped = false; });
  tl.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
    if (Math.abs(dx) > 44 && Math.abs(dx) > 1.5 * Math.abs(dy)) { swiped = true; stepBy(dx < 0 ? 1 : -1); }
  });
  // 밀기로 단계를 옮겼으면, 손을 뗀 자리의 버튼 누르기는 무시합니다
  tl.addEventListener('click', (e) => { if (swiped) { e.stopPropagation(); e.preventDefault(); swiped = false; } }, true);

  let acc = 0, locked = false, quiet = 0;
  const wheel = (e) => {
    if (!state.started || e.target.closest('.sheet, .k-control')) return;
    e.preventDefault();
    clearTimeout(quiet); quiet = setTimeout(() => { locked = false; acc = 0; }, 240);
    if (locked) return;
    acc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(acc) > 60) { locked = true; stepBy(Math.sign(acc)); acc = 0; }
  };
  $('stage').addEventListener('wheel', wheel, { passive: false });
  tl.addEventListener('wheel', wheel, { passive: false });
  addEventListener('keydown', (e) => {
    if ($('studio').hidden || e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight') stepBy(1); else if (e.key === 'ArrowLeft') stepBy(-1); else if (e.key === 'Escape') hideTip();
  });
}

// ─────────────────────────── 손글씨 풀이 ───────────────────────────
function setupHandwriting() {
  const ready = () => { $('hwGo').disabled = !($('hwInput').files[0] && ($('hwConsent').checked || demo())); };
  $('hwInput').onchange = ready; $('hwConsent').onchange = ready;
  $('demoMode').addEventListener('change', ready);
  $('hwGo').onclick = async () => {
    $('hwGo').disabled = true; $('hwReport').innerHTML = '<p class="muted small">AI가 읽고, 엔진이 검증하는 중…</p>';
    const raw = $('hwInput').files[0];
    const prep = demo() ? { file: raw } : await prepPhoto(raw);
    const r = await API.upload('/api/ai/handwriting', prep.file,
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
