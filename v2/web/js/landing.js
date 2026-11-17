// landing.js — 랜딩 페이지 연출
// 장면 구성
//   Scene 1 Hero      빛의 곡선 묶음(추상 조형물)이 천천히 돌고, 커서를 따라 빛과 기울기가 미세하게 반응
//   Scene 2 Morph     스크롤에 맞춰 곡선 묶음이 s평면(축·격자·가지 모양)으로 '형태 자체가' 바뀜 (교차 페이드 아님)
//   Scene 3 Story     화면 고정. Recognize → Understand → Verify 에 맞춰 곡선이 스캔 → 그려짐 → 하나로 수렴
//   Scene 4 Reveal    밝은 공간이 원으로 퍼지며 화면을 덮고, 실제 학습 화면(엔진이 계산한 근궤적과 채점 결과)이 일어섬
//   Scene 5 CTA       시작 버튼 하나
// 주의: 여기서 움직이는 곡선은 '장식용 추상 오브젝트'입니다. 실제 근궤적은 Scene 4의 그래프(Python 계산값)뿐입니다.
//
// 부드러움을 위해 지키는 것
//   1) 스크롤 값은 한 번 감쇠해서 씁니다(scrub). 마우스 휠은 Lenis가 계단 없이 이어 줍니다. 터치는 기기 기본 스크롤 그대로.
//   2) 장면 사이에 값이 '뚝' 끊기는 곳이 없게, 모든 연출 값은 스크롤 진행률의 연속 함수로만 만듭니다.
//   3) 프레임마다 서버에 요청하지 않고, 배치 계산을 일으키는 CSS 속성은 건드리지 않습니다(transform·opacity·clip-path만).

(function () {
  const cv = document.getElementById('stage');
  const ctx = cv.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;
  // 저사양 판단: 화면이 작거나 CPU 코어가 적으면 곡선 수를 줄입니다
  const lowPower = reduced || (navigator.hardwareConcurrency || 8) <= 4 || Math.min(innerWidth, innerHeight) < 500;
  const M = lowPower ? 30 : 54;   // 곡선(가닥) 수
  const P = lowPower ? 64 : 120;  // 가닥 하나의 점 수

  // 스크롤·시간에 따라 바뀌는 연출 상태. GSAP이 이 값들을 바꾸고, 그리기 함수는 읽기만 합니다.
  const S = { intro: reduced ? 1 : 0, morph: 0, story: 0, fade: 1, mx: 0, my: 0, tx: 0, ty: 0 };
  let W = 0, H = 0, dpr = 1;

  function resize(force) {
    const w = innerWidth, h = cv.clientHeight || innerHeight;
    // 휴대폰에서 주소창이 접히고 펴질 때는 높이만 조금 바뀝니다. 그때마다 캔버스를 다시 만들면 덜컹거리므로 건너뜁니다.
    if (!force && w === W && Math.abs(h - H) < 160) return;
    // 캔버스 픽셀 수가 너무 많으면 매 프레임 그리기가 무거워집니다. 전체 픽셀 수가 약 260만을 넘지 않도록 배율을 정합니다.
    dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2, Math.sqrt(2.6e6 / (w * h)));
    dpr = Math.max(1, dpr);
    W = w; H = h;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', () => resize(false));
  resize(true);

  // 커서 위치(-1~1)를 목표값으로만 저장하고, 그릴 때 천천히 따라가게(감쇠) 해서 과하게 흔들리지 않게 합니다
  if (!touch) addEventListener('pointermove', (e) => { S.tx = e.clientX / W * 2 - 1; S.ty = e.clientY / H * 2 - 1; }, { passive: true });
  const glow = document.getElementById('glow');

  // ── 형태 A: 추상 조형물 (3차원 리본 묶음) ─────────────────────────
  // 가닥 i, 위치 u(0~1)에 대한 3차원 좌표. 시간 t에 따라 천천히 숨 쉬듯 변합니다.
  function shapeA(i, u, t, out) {
    const ph = (i / M) * Math.PI * 2;
    const th = u * Math.PI * 2;
    const r = 1 + 0.32 * Math.cos(3 * th + ph * 0.5 + t * 0.25);
    out[0] = r * Math.cos(th);
    out[1] = r * Math.sin(th) * 0.62 + 0.22 * Math.sin(2 * th + ph);
    out[2] = 0.5 * Math.sin(3 * th + ph + t * 0.2);
  }

  // ── 형태 B: 좌표 구조 (평면, z = 0) ──────────────────────────────
  // 가닥마다 역할을 나눕니다: 0 실수축, 1 허수축, 2~9 격자선, 나머지는 네 갈래 곡선(가지 모양)
  // offset: 같은 갈래에 모인 가닥들의 간격. Verify 장면에서 0이 되며 한 줄로 겹칩니다(두 계산이 일치하는 모습).
  // drawFrac: 갈래가 그려진 정도. Understand 장면에서 1까지 자랍니다.
  function shapeB(i, u, offset, drawFrac, out) {
    out[2] = 0;
    if (i === 0) { out[0] = -2.3 + 3.6 * u; out[1] = 0; return; }
    if (i === 1) { out[0] = 0; out[1] = -1.6 + 3.2 * u; return; }
    if (i < 10) {
      const k = i - 2;
      if (k < 4) { out[0] = -2 + k; out[1] = -1.6 + 3.2 * u; } else { out[0] = -2.3 + 3.6 * u; out[1] = -1.5 + (k - 4) * 0.75; }
      return;
    }
    const j = (i - 10) % 4;               // 네 갈래 중 하나
    const lane = Math.floor((i - 10) / 4); // 같은 갈래 안에서 몇 번째 가닥인지
    const off = (lane - 5) * 0.018 * offset * (0.25 + 0.75 * drawFrac);
    const v = u * drawFrac;
    // 장식용 곡선 (실제 계산값 아님): 갈래 0·1은 실수축의 한 점에서 위·아래로 갈라져 왼쪽으로 휘고,
    // 갈래 2·3은 복소 극점 자리에서 출발해 오른쪽 위·아래로 뻗습니다.
    if (j < 2) {
      const sy = j === 0 ? 1 : -1;
      out[0] = -1.25 - 0.55 * v * v + off; out[1] = sy * 1.55 * v + off * sy;
    } else {
      const sy = j === 2 ? 1 : -1;
      out[0] = -0.5 + 1.2 * v * v + off; out[1] = sy * (0.5 + 1.05 * v) + off * sy;
    }
  }

  const ease = (x) => x * x * (3 - 2 * x);                    // 부드러운 시작·끝 (smoothstep)
  const ease5 = (x) => x * x * x * (x * (x * 6 - 15) + 10);  // 더 부드러운 시작·끝 (가속도까지 연속)
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ICE = [177, 203, 230], VIO = [180, 169, 213], WHITE = [245, 244, 240];
  const A = [0, 0, 0], B = [0, 0, 0];   // 계산용 임시 좌표 (프레임마다 새 배열을 만들지 않도록 재사용)

  // 가닥별 변신 시작 시점: 축 → 격자 → 갈래 순서로 한 가닥씩 풀려나와 제자리에 놓입니다.
  // 한 가닥이 옮겨 가는 시간(SPAN)은 짧게 잡아, 어느 순간에도 '날아가는 중'인 가닥은 몇 개뿐이게 합니다
  // (모두가 한꺼번에 섞이면 중간 모양이 엉킨 실타래처럼 보입니다).
  const SPAN = 0.3;
  const delayOf = (i) => (i < 2 ? i * 0.04 : i < 10 ? 0.08 + (i - 2) * 0.02 : 0.24 + ((i - 10) / (M - 10)) * (1 - SPAN - 0.24));

  function frame(t) {
    S.mx += (S.tx - S.mx) * 0.05; S.my += (S.ty - S.my) * 0.05;
    if (S.fade <= 0.01) { if (cv.dataset.clear !== '1') { ctx.clearRect(0, 0, W, H); cv.dataset.clear = '1'; } return; }   // 밝은 화면에서는 그리지 않음
    cv.dataset.clear = '0';
    ctx.clearRect(0, 0, W, H);

    const m = ease5(clamp(S.morph));
    const st = S.story;
    // Scene 3 세부 진행률: 0~1/3 인식(스캔), 1/3~2/3 이해(그려짐), 2/3~1 검증(수렴)
    const scan = clamp(st * 3), draw = ease(clamp(st * 3 - 1)), verify = ease(clamp(st * 3 - 2));
    const wide = W > 900;
    // 넓은 화면: 글자는 왼쪽, 오브젝트는 오른쪽. 좁은 화면: 오브젝트는 위쪽, 글자는 아래쪽
    const cx = wide ? W * 0.67 : W * 0.5;
    const cy = H * (wide ? 0.48 : 0.36 - 0.03 * m);
    const scale = (wide ? Math.min(H * 0.25, W * 0.125) : Math.min(W, H) * 0.25) * (1 + 0.12 * m);
    // 조형물은 천천히 돕니다. 좌표 구조로 옮겨 간 가닥은 정면(회전 0)을 봅니다 — 회전량을 가닥마다 따로 줍니다
    const yaw = t * 0.12 + S.mx * 0.35;
    const pitch = 0.35 + S.my * 0.25;
    const intro = ease5(clamp(S.intro));
    const spread = (1 - intro) * 1.4;
    const offset = 1 - verify;
    const drawFrac = 0.03 + 0.97 * draw;             // 변신 직후에는 갈래가 한 점(극점 자리)에 모여 있다가 '이해' 장면에서 뻗어 나감
    const jitter = 0.03 * Math.sin(Math.PI * scan);  // 인식 장면: 스캔 전의 선은 손글씨처럼 살짝 흔들림 (처음과 끝은 0)

    if (glow && !touch) glow.style.transform = `translate3d(${W * (0.5 + S.mx * 0.25)}px, ${H * (0.45 + S.my * 0.2)}px, 0)`;

    // 'lighter': 겹친 선이 더 밝아지는 합성(빛 느낌). 저사양 기기에서는 무거워서 일반 합성으로 그립니다
    ctx.globalCompositeOperation = lowPower ? 'source-over' : 'lighter';
    ctx.lineWidth = lowPower ? 1 : 1.1;
    for (let i = 0; i < M; i++) {
      const isAxis = i < 2, isGrid = i >= 2 && i < 10;
      // 가닥 색: 얼음색 ↔ 보라색 사이를 가닥마다 조금씩. 축은 흰색 계열
      const k = i / M;
      const cr = isAxis ? WHITE : [ICE[0] + (VIO[0] - ICE[0]) * k, ICE[1] + (VIO[1] - ICE[1]) * k, ICE[2] + (VIO[2] - ICE[2]) * k];
      const mi = ease5(clamp((S.morph - delayOf(i)) / SPAN));
      const cyw = Math.cos(yaw * (1 - mi)), syw = Math.sin(yaw * (1 - mi)), cp = Math.cos(pitch * (1 - mi)), sp = Math.sin(pitch * (1 - mi));
      let alpha = 0.32 * S.fade * intro;
      if (isGrid) alpha *= 1 - 0.8 * mi;                        // 격자는 좌표가 될수록 흐리게 (연속으로)
      if (!isAxis && !isGrid) alpha *= 1 + 0.6 * verify;        // 검증 장면에서 곡선이 또렷해짐
      ctx.strokeStyle = `rgba(${cr[0] | 0},${cr[1] | 0},${cr[2] | 0},${alpha})`;
      ctx.beginPath();
      for (let p = 0; p < P; p++) {
        const u = p / (P - 1);
        shapeA(i, u, t, A);
        shapeB(i, u, offset, drawFrac, B);
        let x = A[0] + (B[0] - A[0]) * mi + spread * Math.sin(i * 7.1 + u * 3);
        let y = A[1] + (B[1] - A[1]) * mi + spread * Math.cos(i * 3.3 + u * 5);
        let z = A[2] * (1 - mi);
        if (jitter > 0.0005 && !isAxis && !isGrid && (x + 2.3) / 3.6 > scan) y += jitter * Math.sin(u * 40 + i);
        // 3차원 회전 후 원근 투영 → 화면 좌표
        const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const f = 3.2 / (3.2 + z2);           // 가까운 것은 크게, 먼 것은 작게
        const px = cx + x1 * scale * f, py = cy - y2 * scale * f;
        if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 인식 장면의 스캔선 (나타났다 사라지는 것도 연속으로)
    const scanA = Math.sin(Math.PI * scan);
    if (scanA > 0.01 && st < 0.34) {
      const xs = cx + (-2.3 + 3.6 * scan) * scale;
      const g = ctx.createLinearGradient(xs - 60, 0, xs, 0);
      g.addColorStop(0, 'rgba(177,203,230,0)'); g.addColorStop(1, `rgba(177,203,230,${0.10 * scanA * S.fade})`);
      ctx.fillStyle = g; ctx.fillRect(xs - 60, cy - 1.7 * scale, 60, 3.4 * scale);
      ctx.strokeStyle = `rgba(177,203,230,${0.6 * scanA * S.fade})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xs, cy - 1.7 * scale); ctx.lineTo(xs, cy + 1.7 * scale); ctx.stroke();
    }
    // 검증 장면: 핵심 점에 작은 고리 (두 계산이 일치한 자리)
    if (verify > 0.01) {
      const pts = [[-1.25, 0], [-0.5, 0.5], [-0.5, -0.5]];   // 갈래가 시작하는 자리
      for (const q of pts) {
        ctx.strokeStyle = `rgba(245,244,240,${0.7 * verify * S.fade})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cx + q[0] * scale, cy - q[1] * scale, 6 + 10 * (1 - verify), 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // ── 움직임을 쓰지 않는 경우 ─────────────────────────────────────
  if (!window.gsap || !window.ScrollTrigger || reduced) {
    // GSAP을 못 불러왔거나 '움직임 줄이기' 설정: 정적인 완성 상태로 보여 줍니다
    document.body.classList.add('static');
    S.intro = 1; S.morph = 1; S.story = 1;
    splitWords();
    frame(0);
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
  gsap.ticker.add((time) => frame(time));

  const EASE = 'expo.out';
  const SCRUB = touch ? 0.5 : 0.9;     // 스크롤을 따라가는 감쇠 시간(초)

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
  gsap.to(S, { intro: 1, duration: 2.8, ease: 'power2.out' });
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

  // Scene 3: 화면 고정(pin). 스크롤 3화면 길이 동안 세 낱말이 차례로 밝아졌다 어두워집니다.
  // 낱말의 밝기·위치·설명 글이 모두 스크롤 진행률에 묶여 있어, 어느 방향으로 스크롤해도 끊기지 않습니다.
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' },
    scrollTrigger: { trigger: '#s3', start: 'top top', end: '+=300%', pin: true, scrub: SCRUB, anticipatePin: 1 } });
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

  // Scene 4: 밝은 공간이 화면 아래 가운데에서 원으로 퍼집니다. 동시에 어두운 무대의 곡선은 사라집니다.
  gsap.timeline({ scrollTrigger: { trigger: '#s4', start: 'top 95%', end: 'top 20%', scrub: SCRUB } })
    .to('#light', { '--r': '150%', ease: 'power1.in' }, 0)
    .to(S, { fade: 0, ease: 'none' }, 0)
    .to('.story-pin', { opacity: 0, ease: 'none', duration: 0.4 }, 0);
  gsap.from('#s4 .eyebrow, #s4 h2', { y: 50, opacity: 0, stagger: 0.1, ease: 'none',
    scrollTrigger: { trigger: '#s4', start: 'top 60%', end: 'top 15%', scrub: SCRUB } });
  // 화면 카드가 기울어 누운 상태에서 정면으로 일어섭니다
  gsap.fromTo('#device', { y: 120, scale: 0.9, rotateX: 16, opacity: 0 },
    { y: 0, scale: 1, rotateX: 0, opacity: 1, ease: 'power2.out',
      scrollTrigger: { trigger: '#device', start: 'top 100%', end: 'top 35%', scrub: SCRUB } });

  // Scene 5: 마지막 문장이 줄마다 올라오고, 버튼은 커서를 살짝 따라옵니다(자석 효과)
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

  // 학습 화면으로 가는 링크: 어두운 막이 아래에서 올라와 화면을 덮은 뒤 이동합니다 (학습 화면은 그 막을 걷으며 시작)
  const curtain = document.getElementById('curtain');
  document.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    gsap.to(curtain, { scaleY: 1, duration: 0.7, ease: 'expo.inOut', onComplete: () => { location.href = href; } });
  }));
  // 뒤로 가기로 돌아왔을 때 막이 덮인 채 남지 않도록 합니다
  addEventListener('pageshow', (e) => { if (e.persisted) gsap.set(curtain, { scaleY: 0 }); });

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
