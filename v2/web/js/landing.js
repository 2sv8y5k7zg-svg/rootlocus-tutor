// landing.js — 랜딩 페이지 연출 (배경 오브젝트 자체는 flow.js가 그립니다. 여기서는 스크롤에 맞춰 Flow.S 값만 바꿉니다)
// 장면 구성 — 처음부터 끝까지 같은 어두운 공간이며, 이 공간이 학습 화면까지 그대로 이어집니다.
//   Scene 1 Hero      빛의 곡선 묶음(조형물)이 천천히 돌고, 커서를 따라 미세하게 반응
//   Scene 2 Morph     가닥이 하나씩 풀려 s평면(축·격자)으로 '형태 자체가' 바뀜
//   Scene 3 Story     화면 고정. Recognize → Understand → Verify 에 맞춰 스캔 → 그려짐 → 하나로 수렴
//   Scene 4 Reveal    좌표 구조가 화면 전체의 흐름선으로 풀리고, 그 위로 실제 학습 화면(엔진 계산값)이 일어섬
//   Scene 5 CTA       흐름선이 다시 조형물로 모여 화면 가운데에 놓임 → 버튼을 누르면 그 조형물이 학습 화면으로 이어짐
// 주의: 움직이는 가닥은 '장식용 추상 오브젝트'입니다. 실제 근궤적은 Scene 4의 그래프(Python 계산값)뿐입니다.
//
// 부드러움을 위해 지키는 것
//   1) 스크롤 값은 한 번 감쇠해서 씁니다(scrub). 마우스 휠은 Lenis가 계단 없이 이어 줍니다. 터치는 기기 기본 스크롤 그대로.
//   2) 장면 사이에 값이 '뚝' 끊기는 곳이 없게, 모든 연출 값은 스크롤 진행률의 연속 함수로만 만듭니다.
//   3) 프레임마다 서버에 요청하지 않고, 배치 계산을 일으키는 CSS 속성은 건드리지 않습니다(transform·opacity만).

(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = Flow.S;
  Flow.init(document.getElementById('flowCanvas'));
  const touch = Flow.isTouch();
  // 학습 화면에서 돌아온 경우: 그 화면의 오브젝트 상태를 이어 받아 첫 화면 상태로 부드럽게 돌아옵니다
  const continued = Flow.takeover();
  if (!continued) S.intro = reduced ? 1 : 0;
  const glow = document.getElementById('glow');

  // ── 움직임을 쓰지 않는 경우 ─────────────────────────────────────
  if (!window.gsap || !window.ScrollTrigger || reduced) {
    // GSAP을 못 불러왔거나 '움직임 줄이기' 설정: 정적인 완성 상태로 보여 줍니다
    document.body.classList.add('static');
    S.intro = 1; S.morph = 0; S.flow = 0; S.pos = 0; S.oy = 0;
    splitWords();
    Flow.frame();
    initDemo(false);
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });   // 휴대폰 주소창 때문에 생기는 높이 변화는 무시

  // 마우스 휠 스크롤을 부드럽게 (Lenis). 터치 기기는 기본 스크롤이 이미 부드러우므로 그대로 둡니다.
  if (window.Lenis && !touch) {
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  // 그리기는 GSAP의 시계 하나에 맞춥니다 (스크롤 계산과 그리기가 같은 프레임에 일어나도록)
  gsap.ticker.add(() => {
    Flow.frame();
    if (glow && !touch) glow.style.transform = `translate3d(${innerWidth * (0.5 + S.mx * 0.25)}px, ${innerHeight * (0.45 + S.my * 0.2)}px, 0)`;
  });

  const EASE = 'expo.out';
  const SCRUB = touch ? 0.7 : 0.9;     // 스크롤을 따라가는 감쇠 시간(초)

  // 문장을 낱말 단위로 나눕니다 (Scene 2에서 낱말이 하나씩 밝아지도록)
  function splitWords() {
    const el = document.getElementById('morphLine');
    const wrap = (node) => {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 3) {
          const frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach((w) => {
            if (!w.trim()) { frag.appendChild(document.createTextNode(w)); return; }
            const s = document.createElement('span'); s.className = 'wd'; s.textContent = w; frag.appendChild(s);
          });
          ch.replaceWith(frag);
        } else if (ch.nodeName !== 'BR') wrap(ch);
      }
    };
    wrap(el);
    return el.querySelectorAll('.wd');
  }

  // Scene 1: 곡선이 모이고, 제목이 줄마다 가림막 아래에서 올라옵니다 (한 번만 재생)
  if (continued) gsap.to(S, { pos: 0, oy: 0, ox: 0, flow: 0, morph: 0, progress: 0, dim: 1, duration: 1.6, ease: 'power3.inOut' });
  else gsap.to(S, { intro: 1, duration: 2.8, ease: 'power2.out' });
  gsap.from('.hero .eyebrow', { opacity: 0, y: 16, duration: 1.2, ease: EASE, delay: 0.25 });
  gsap.from('.hero h1 .ln > span', { yPercent: 115, duration: 1.5, stagger: 0.12, ease: EASE, delay: 0.35 });
  gsap.from('.hero .sub', { opacity: 0, y: 24, duration: 1.4, ease: EASE, delay: 0.8 });
  gsap.from('.lnav', { opacity: 0, y: -16, duration: 1.2, ease: EASE, delay: 0.6 });
  gsap.from('.scroll-cue', { opacity: 0, duration: 1.2, delay: 1.6 });

  // Scene 2: 조형물 → 좌표 구조. 문장은 낱말이 하나씩 밝아짐
  gsap.to(S, { morph: 1, ease: 'none', scrollTrigger: { trigger: '#s2', start: 'top bottom', end: 'bottom 55%', scrub: SCRUB } });
  gsap.to(splitWords(), { opacity: 1, stagger: 0.12, ease: 'none',
    scrollTrigger: { trigger: '#s2', start: 'top 45%', end: 'bottom 125%', scrub: SCRUB } });
  gsap.to('.hero-copy', { opacity: 0, y: -60, ease: 'none', scrollTrigger: { trigger: '#s1', start: 'top top', end: 'bottom 45%', scrub: SCRUB } });
  gsap.to('#morphLine', { opacity: 0, y: -40, ease: 'none', scrollTrigger: { trigger: '#s2', start: 'bottom 115%', end: 'bottom 75%', scrub: SCRUB } });

  // Scene 3: 화면 고정(CSS sticky). 스크롤 3화면 길이 동안 세 낱말이 차례로 밝아졌다 어두워집니다.
  // 낱말의 밝기·위치·설명 글이 모두 스크롤 진행률에 묶여 있어, 어느 방향으로 스크롤해도 끊기지 않습니다.
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' },
    scrollTrigger: { trigger: '#s3', start: 'top top', end: 'bottom bottom', scrub: SCRUB } });
  tl.to(S, { story: 1, ease: 'none', duration: 3 }, 0);
  tl.to('#meter', { scaleX: 1, ease: 'none', duration: 3 }, 0);
  document.querySelectorAll('.story-words li').forEach((li, i) => {
    const k = li.querySelector('.k');
    tl.fromTo(li, { opacity: 0.14, x: 0 }, { opacity: 1, x: 14, duration: 0.35 }, i + 0.02);
    tl.fromTo(k, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35 }, i + 0.1);
    if (i < 2) {
      tl.to(li, { opacity: 0.14, x: 0, duration: 0.3, ease: 'power2.in' }, i + 0.75);
      tl.to(k, { opacity: 0, duration: 0.2, ease: 'power2.in' }, i + 0.75);
    }
  });

  // Scene 4: 좌표 구조가 화면 전체의 흐름선으로 풀립니다(가닥이 위에서부터 차례로). 그 위로 실제 화면 카드가 일어섭니다.
  // 흐름선이 된 뒤에는 보이지 않는 동안 morph를 0으로 돌려놓아, 다음 장면에서 조형물로 돌아갈 준비를 합니다.
  gsap.timeline({ scrollTrigger: { trigger: '#s4', start: 'top 95%', end: 'top 5%', scrub: SCRUB } })
    .to(S, { flow: 1, ease: 'none', duration: 0.7 }, 0)
    .to(S, { dim: 0.32, ease: 'none', duration: 0.7 }, 0)   // 실제 화면 카드를 읽는 동안 배경 흐름선은 뒤로 물러납니다
    .to('.story-pin', { opacity: 0, ease: 'none', duration: 0.3 }, 0)
    .to(S, { morph: 0, ease: 'none', duration: 0.3 }, 0.7);
  gsap.from('#s4 .eyebrow, #s4 h2', { y: 50, opacity: 0, stagger: 0.1, ease: 'none',
    scrollTrigger: { trigger: '#s4', start: 'top 60%', end: 'top 15%', scrub: SCRUB } });
  // 화면 카드가 기울어 누운 상태에서 정면으로 일어섭니다
  gsap.fromTo('#device', { y: 120, scale: 0.9, rotateX: 16, opacity: 0 },
    { y: 0, scale: 1, rotateX: 0, opacity: 1, ease: 'power2.out',
      scrollTrigger: { trigger: '#device', start: 'top 100%', end: 'top 35%', scrub: SCRUB } });

  // Scene 5: 흐름선이 다시 조형물로 모여 화면 가운데에 놓입니다. 문장이 줄마다 올라오고, 버튼은 커서를 살짝 따라옵니다.
  gsap.to(S, { flow: 0, pos: 1, ease: 'none', scrollTrigger: { trigger: '#s5', start: 'top 90%', end: 'top 10%', scrub: SCRUB } });
  // 배경 밝기는 실제 화면 카드가 화면 위로 거의 빠져나간 뒤에야 돌아옵니다 (카드를 읽는 동안 조형물이 겹쳐 밝게 보이지 않게)
  gsap.to(S, { dim: 1, ease: 'none', scrollTrigger: { trigger: '#device', start: 'bottom 35%', end: 'bottom top', scrub: SCRUB } });
  gsap.from('.cta-line .ln > span', { yPercent: 115, duration: 1.4, stagger: 0.12, ease: EASE,
    scrollTrigger: { trigger: '#s5', start: 'top 55%' } });
  gsap.from('.cta-btn, .cta-foot', { y: 30, opacity: 0, duration: 1.2, stagger: 0.1, ease: EASE, delay: 0.25,
    scrollTrigger: { trigger: '#s5', start: 'top 55%' } });
  const btn = document.querySelector('.cta-btn');
  if (!touch) {
    const xTo = gsap.quickTo(btn, 'x', { duration: 0.6, ease: 'power3.out' }), yTo = gsap.quickTo(btn, 'y', { duration: 0.6, ease: 'power3.out' });
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * 0.25); yTo((e.clientY - r.top - r.height / 2) * 0.35);
    });
    btn.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  }

  // 학습 화면으로 가는 링크: 글자만 위로 사라지고 배경 오브젝트는 그대로 남습니다.
  // 지금 상태를 적어 두면(Flow.handoff) 학습 화면이 같은 자세의 오브젝트로 시작해 한 화면처럼 이어집니다.
  let leaving = false;
  document.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || leaving) return;
    e.preventDefault(); leaving = true;
    const href = a.getAttribute('href');
    gsap.to('.scene > *, .lnav', { opacity: 0, y: -24, duration: 0.5, ease: 'power2.in', overwrite: true,
      onComplete: () => { Flow.handoff(); location.href = href; } });
  }));
  // 뒤로 가기로 돌아왔을 때 글자가 사라진 채 남지 않도록 합니다
  addEventListener('pageshow', (e) => { if (e.persisted) { leaving = false; gsap.set('.scene > *, .lnav', { clearProps: 'opacity,transform' }); ScrollTrigger.refresh(); } });

  initDemo(true);

  // ── Scene 4의 실제 데이터 ──────────────────────────────────────
  // 서버(Python 엔진)에 실제로 계산을 요청해 그래프와 채점 결과를 보여 줍니다.
  async function initDemo(animated) {
    const problem = { text: 'K/(s(s+3)(s^2+2s+2))' };
    const g = new PlaneGraph(document.getElementById('demoPlane'));
    let res;
    try { res = await API.analyze(problem); } catch (e) { res = null; }
    if (!res || !res.ok) {
      document.getElementById('demoVerdict').textContent = '서버에 연결되지 않아 예시를 불러오지 못했습니다.';
      return;
    }
    g.resize(); g.setData(res.graph); g.setStep(8, { instant: true });
    g.setBranchProgress(animated ? 0 : 1);
    const stepsEl = document.getElementById('demoSteps');
    stepsEl.innerHTML = res.steps.map((s) => `<li>${s.title}</li>`).join('');
    document.getElementById('demoTf').textContent = res.input.text;
    document.getElementById('demoCaption').textContent =
      `Python 엔진 계산 · 자체 검증 ${res.verification.verified}/9 단계 · 안정 범위 ${res.steps[6].result.stableText}`;
    if (animated) {
      // 그래프 곡선이 스크롤에 맞춰 극점에서 뻗어 나가고, 왼쪽 단계 목록도 함께 진행
      let last = -1;
      ScrollTrigger.create({
        trigger: '#device', start: 'top 60%', end: 'bottom 75%', scrub: SCRUB,
        onUpdate: (self) => {
          g.setBranchProgress(self.progress);
          const k = Math.min(8, Math.floor(self.progress * 9));
          if (k !== last) { last = k; stepsEl.querySelectorAll('li').forEach((li, n) => li.classList.toggle('on', n === k)); }
        },
      });
      ScrollTrigger.refresh();
    }
    // 손글씨 채점 예시: 학생이 쓴 값(예시)을 실제 채점 API에 보내 받은 결과
    const samples = [['centroid', '-1', '점근선 중심'], ['angles', '-71.6', '출발각'], ['stableRange', '0<K≤8.16', '안정 범위']];
    const rows = [];
    // 답에 들어 있는 '<' 같은 기호가 HTML로 해석되지 않도록 글자로 바꿔 넣습니다
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    for (const [field, ans, name] of samples) {
      const v = await API.check(problem, field, ans);
      const good = v.status === 'correct' || v.status === 'approx';
      rows.push(`<div class="row ${good ? 'good' : 'bad'}"><small>${name} · 학생 답</small><span class="mono">${esc(ans)}</span>
        <small>${good ? '정답' : '엔진 결과 ' + esc(v.expected)}${v.diagnosis ? ' · ' + esc(v.diagnosis) : ''}</small></div>`);
    }
    document.getElementById('demoVerdict').innerHTML = rows.join('');
    if (animated) {
      gsap.from('#demoVerdict .row', { x: 30, opacity: 0, duration: 1, stagger: 0.12, ease: EASE,
        scrollTrigger: { trigger: '#device', start: 'top 45%' } });
    }
  }
})();
