// landing.js — 랜딩 페이지 연출
// 장면 구성
//   Scene 1 Hero      빛의 곡선 묶음(추상 조형물)이 천천히 돌고, 커서를 따라 빛과 기울기가 미세하게 반응
//   Scene 2 Morph     스크롤에 맞춰 곡선 묶음이 s평면(축·격자·가지 모양)으로 '형태 자체가' 바뀜 (교차 페이드 아님)
//   Scene 3 Story     화면 고정. Recognize → Understand → Verify 에 맞춰 곡선이 스캔 → 그려짐 → 하나로 수렴
//   Scene 4 Reveal    배경이 어두움 → 밝음. 실제 학습 화면(엔진이 계산한 근궤적과 채점 결과)이 나타남
//   Scene 5 CTA       시작 버튼 하나
// 주의: 여기서 움직이는 곡선은 '장식용 추상 오브젝트'입니다. 실제 근궤적은 Scene 4의 그래프(Python 계산값)뿐입니다.
// 스크롤 연출은 브라우저에서만 처리하고, 프레임마다 서버에 요청하지 않습니다.

(function () {
  const cv = document.getElementById('stage');
  const ctx = cv.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 저사양 판단: 화면이 작거나 CPU 코어가 적으면 곡선 수를 줄이고 빛 번짐 효과를 끕니다
  const lowPower = reduced || (navigator.hardwareConcurrency || 8) <= 4 || Math.min(innerWidth, innerHeight) < 500;
  const M = lowPower ? 26 : 54;   // 곡선(가닥) 수
  const P = lowPower ? 90 : 140;  // 가닥 하나의 점 수

  // 스크롤·시간에 따라 바뀌는 연출 상태. GSAP이 이 값들을 바꾸고, 그리기 함수는 읽기만 합니다.
  const S = { intro: reduced ? 1 : 0, morph: 0, story: 0, fade: 1, mx: 0, my: 0, tx: 0, ty: 0 };
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 1.75);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize);
  resize();

  // 커서 위치(-1~1)를 목표값으로만 저장하고, 그릴 때 천천히 따라가게(감쇠) 해서 과하게 흔들리지 않게 합니다
  addEventListener('pointermove', (e) => { S.tx = e.clientX / W * 2 - 1; S.ty = e.clientY / H * 2 - 1; });

  // ── 형태 A: 추상 조형물 (3차원 리본 묶음) ─────────────────────────
  // 가닥 i, 위치 u(0~1)에 대한 3차원 좌표. 시간 t에 따라 천천히 숨 쉬듯 변합니다.
  function shapeA(i, u, t) {
    const ph = (i / M) * Math.PI * 2;
    const th = u * Math.PI * 2;
    const r = 1 + 0.32 * Math.cos(3 * th + ph * 0.5 + t * 0.25);
    return [
      r * Math.cos(th),
      r * Math.sin(th) * 0.62 + 0.22 * Math.sin(2 * th + ph),
      0.5 * Math.sin(3 * th + ph + t * 0.2),
    ];
  }

  // ── 형태 B: 좌표 구조 (평면, z = 0) ──────────────────────────────
  // 가닥마다 역할을 나눕니다: 0 실수축, 1 허수축, 2~9 격자선, 나머지는 네 갈래 곡선(가지 모양)
  // offset: 같은 갈래에 모인 가닥들의 간격. Verify 장면에서 0이 되며 한 줄로 겹칩니다(두 계산이 일치하는 모습).
  function shapeB(i, u, offset, drawFrac) {
    if (i === 0) return [-2.3 + 3.6 * u, 0, 0];
    if (i === 1) return [0, -1.6 + 3.2 * u, 0];
    if (i < 10) {
      const k = i - 2;
      return k < 4 ? [-2 + k, -1.6 + 3.2 * u, 0] : [-2.3 + 3.6 * u, -1.5 + (k - 4) * 0.75, 0];
    }
    const j = (i - 10) % 4;               // 네 갈래 중 하나
    const lane = Math.floor((i - 10) / 4); // 같은 갈래 안에서 몇 번째 가닥인지
    const off = (lane - 5) * 0.018 * offset;
    const v = Math.min(u, drawFrac);      // 그려지는 정도 (Understand 장면)
    // 장식용 곡선 (실제 계산값 아님): 갈래 0·1은 실수축의 한 점에서 위·아래로 갈라져 왼쪽으로 휘고,
    // 갈래 2·3은 복소 극점 자리에서 출발해 오른쪽 위·아래로 뻗습니다.
    if (j < 2) {
      const sy = j === 0 ? 1 : -1;
      return [-1.25 - 0.55 * v * v + off, sy * 1.55 * v + off * sy, 0];
    }
    const sy = j === 2 ? 1 : -1;
    return [-0.5 + 1.5 * v * v * 0.8 + off, sy * (0.5 + 1.05 * v) + off * sy, 0];
  }

  // 3차원 회전 후 원근 투영 → 화면 좌표
  function project(p, yaw, pitch, cx, cy, scale) {
    let [x, y, z] = p;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    [x, z] = [x * cyw + z * syw, -x * syw + z * cyw];
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    [y, z] = [y * cp - z * sp, y * sp + z * cp];
    const f = 3.2 / (3.2 + z);           // 가까운 것은 크게, 먼 것은 작게
    return [cx + x * scale * f, cy - y * scale * f];
  }

  const ease = (x) => x * x * (3 - 2 * x);   // 부드러운 시작·끝 (smoothstep)
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ICE = [177, 203, 230], VIO = [180, 169, 213], WHITE = [245, 244, 240];

  function frame(now) {
    const t = now / 1000;
    S.mx += (S.tx - S.mx) * 0.05; S.my += (S.ty - S.my) * 0.05;
    ctx.clearRect(0, 0, W, H);
    if (S.fade <= 0.01) { requestAnimationFrame(frame); return; }   // 밝은 화면에서는 그리지 않음(배터리 절약)

    const m = ease(clamp(S.morph));
    const st = S.story;
    // Scene 3 세부 진행률: 0~1/3 인식(스캔), 1/3~2/3 이해(그려짐), 2/3~1 검증(수렴)
    const scan = clamp(st * 3), draw = clamp(st * 3 - 1), verify = clamp(st * 3 - 2);
    const wide = W > 900;
    const cx = wide ? W * (0.62 - 0.04 * m) : W * 0.5;
    const cy = H * (wide ? 0.48 : 0.42);
    const scale = Math.min(W, H) * (wide ? 0.25 : 0.27) * (1 + 0.15 * m);
    // 조형물일 때는 돌고, 좌표 구조가 될수록 정면(회전 0)으로 맞춰 그래프가 왜곡되지 않게 합니다
    const yaw = (1 - m) * (t * 0.12 + S.mx * 0.35);
    const pitch = (1 - m) * (0.35 + S.my * 0.25);
    const intro = ease(clamp(S.intro));

    // 커서를 따라가는 은은한 빛 (Scene 1). 글로우는 절제합니다.
    if (!lowPower) {
      const gx = W * (0.5 + S.mx * 0.25), gy = H * (0.45 + S.my * 0.2);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.55);
      g.addColorStop(0, `rgba(177,203,230,${0.07 * S.fade * (1 - m * 0.6)})`);
      g.addColorStop(1, 'rgba(16,20,29,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    ctx.globalCompositeOperation = lowPower ? 'source-over' : 'lighter';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < M; i++) {
      const isAxis = i < 2, isGrid = i >= 2 && i < 10;
      // 가닥 색: 얼음색 ↔ 보라색 사이를 가닥마다 조금씩. 축은 흰색 계열
      const k = i / M;
      const base = isAxis ? WHITE : ICE.map((c, n) => Math.round(c + (VIO[n] - c) * k));
      let alpha = 0.32 * S.fade * intro;
      if (isGrid) alpha *= 0.25 + 0.75 * (1 - m) ;            // 격자는 좌표가 될수록 흐리게
      if (isGrid && m > 0.5) alpha = 0.06 * S.fade;
      if (!isAxis && !isGrid) alpha *= 1 + 0.6 * verify;      // 검증 장면에서 곡선이 또렷해짐
      ctx.strokeStyle = `rgba(${base[0]},${base[1]},${base[2]},${alpha})`;
      ctx.beginPath();
      const offset = 1 - verify;
      const drawFrac = 0.25 + 0.75 * (st > 0 ? draw : 1);
      for (let p = 0; p < P; p++) {
        const u = p / (P - 1);
        const a = shapeA(i, u, t);
        // 가닥마다 시작 시점을 조금씩 늦춰(물결처럼) 형태가 순서대로 바뀌게 합니다
        const mi = ease(clamp(S.morph * 1.7 - (i / M) * 0.5 - u * 0.2));
        const b = shapeB(i, u, offset, drawFrac);
        // 인트로: 흩어진 상태에서 모이기
        const spread = (1 - intro) * 1.4;
        const pt = [a[0] * (1 - mi) + b[0] * mi + spread * Math.sin(i * 7.1 + u * 3),
          a[1] * (1 - mi) + b[1] * mi + spread * Math.cos(i * 3.3 + u * 5),
          a[2] * (1 - mi) + b[2] * mi];
        // 인식 장면: 스캔선이 지나가기 전의 곡선은 살짝 흔들리는 '손글씨' 느낌
        if (st > 0 && st < 0.34 && !isAxis && !isGrid) {
          const before = (pt[0] + 2.3) / 3.6 > scan;   // 아직 스캔되지 않은 부분
          if (before) pt[1] += 0.03 * Math.sin(u * 40 + i);
        }
        const [x, y] = project(pt, yaw, pitch, cx, cy, scale);
        if (p === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 인식 장면의 스캔선
    if (st > 0.01 && st < 0.34) {
      const xw = -2.3 + 3.6 * scan;
      const [x0, y0] = project([xw, -1.7, 0], 0, 0, cx, cy, scale);
      const [x1, y1] = project([xw, 1.7, 0], 0, 0, cx, cy, scale);
      ctx.strokeStyle = `rgba(177,203,230,${0.5 * S.fade})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    // 검증 장면: 핵심 점에 작은 고리 (두 계산이 일치한 자리)
    if (verify > 0.2) {
      const pts = [[-1.25, 0], [-0.5, 0.5], [-0.5, -0.5]];   // 갈래가 시작하는 자리
      for (const q of pts) {
        const [x, y] = project([q[0], q[1], 0], 0, 0, cx, cy, scale);
        ctx.strokeStyle = `rgba(245,244,240,${0.7 * verify * S.fade})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, 6 + 4 * (1 - verify), 0, Math.PI * 2); ctx.stroke();
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ── 스크롤 연출 (GSAP ScrollTrigger) ─────────────────────────────
  // scrub: 스크롤 위치와 애니메이션 진행률을 묶어서, 위·아래 어느 방향으로 스크롤해도 같은 장면이 재생됩니다.
  // 스크롤을 강제로 가로채거나 자동으로 넘기는 효과(snap)는 쓰지 않습니다.
  const words = document.querySelectorAll('.story-words li');
  function setWord(p) {
    const i = Math.min(2, Math.floor(p * 3));
    words.forEach((li, n) => li.classList.toggle('on', n === i));
    document.getElementById('meter').style.width = (p * 100) + '%';
  }

  if (!window.gsap || !window.ScrollTrigger || reduced) {
    // GSAP을 못 불러왔거나 움직임 줄이기 설정: 정적인 완성 상태로 보여 줍니다
    S.intro = 1; S.morph = reduced ? 1 : 0; S.story = 1; setWord(0.99);
    document.body.style.setProperty('--bg', 'var(--obsidian)');
    initDemo(null);
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  // 첫 화면: 곡선이 모이고 제목이 아래에서 떠오릅니다 (한 번만 재생)
  gsap.to(S, { intro: 1, duration: 2.4, ease: 'power2.out' });
  gsap.from('.hero-copy > *', { y: 28, opacity: 0, duration: 1.2, stagger: 0.12, ease: 'power3.out', delay: 0.3 });

  // Scene 2: 조형물 → 좌표 구조. 문장도 함께 천천히 떠오름
  gsap.to(S, { morph: 1, ease: 'none', scrollTrigger: { trigger: '#s2', start: 'top bottom', end: 'bottom 60%', scrub: 1 } });
  gsap.fromTo('#morphLine', { opacity: 0, y: 40 }, { opacity: 1, y: 0, ease: 'none',
    scrollTrigger: { trigger: '#s2', start: 'top 70%', end: 'center center', scrub: 1 } });
  gsap.to('.hero-copy', { opacity: 0, y: -40, ease: 'none', scrollTrigger: { trigger: '#s2', start: 'top bottom', end: 'top 30%', scrub: 1 } });

  // Scene 3: 화면 고정(pin) 후 스크롤 2.4화면 길이 동안 세 단어가 차례로
  ScrollTrigger.create({
    trigger: '#s3', start: 'top top', end: '+=240%', pin: true, scrub: 1,
    onUpdate: (self) => { S.story = Math.max(0.001, self.progress); setWord(self.progress); },
  });

  // Scene 4: 배경을 밝은 학습 공간으로. CSS 변수 --bg, --fg 를 스크롤에 맞춰 바꿉니다
  gsap.timeline({ scrollTrigger: { trigger: '#s4', start: 'top 85%', end: 'top 25%', scrub: 1 } })
    .to(document.body, { '--bg': '#F5F4F0', '--fg': '#10141D', ease: 'none' }, 0)
    .to(S, { fade: 0, ease: 'none' }, 0);
  // 화면 카드가 살짝 기울어진 상태에서 정면으로 일어섭니다
  gsap.fromTo('#device', { y: 90, scale: 0.94, rotateX: 10, opacity: 0.2 },
    { y: 0, scale: 1, rotateX: 0, opacity: 1, ease: 'none',
      scrollTrigger: { trigger: '#s4', start: 'top 80%', end: 'top 10%', scrub: 1 } });

  initDemo(true);

  // ── Scene 4의 실제 데이터 ──────────────────────────────────────
  // 서버(Python 엔진)에 실제로 계산을 요청해 그래프와 채점 결과를 보여 줍니다.
  async function initDemoInner(animated) {
    const problem = { text: 'K/(s(s+3)(s^2+2s+2))' };
    const g = new PlaneGraph(document.getElementById('demoPlane'));
    let res;
    try { res = await API.analyze(problem); } catch (e) { res = null; }
    if (!res || !res.ok) {
      document.getElementById('demoVerdict').textContent = '서버에 연결되지 않아 예시를 불러오지 못했습니다.';
      return;
    }
    g.step = 8; g.progress = animated ? 0 : 1; g.resize(); g.setData(res.graph);
    const stepsEl = document.getElementById('demoSteps');
    stepsEl.innerHTML = res.steps.map((s) => `<li>${s.title}</li>`).join('');
    document.getElementById('demoTf').textContent = res.input.text;
    document.getElementById('demoCaption').textContent =
      `Python 엔진 계산 · 자체 검증 ${res.verification.verified}/9 단계 · 안정 범위 ${res.steps[6].result.stableText}`;
    if (animated) {
      // 그래프 곡선이 스크롤에 맞춰 극점에서 뻗어 나가고, 왼쪽 단계 목록도 함께 진행
      ScrollTrigger.create({
        trigger: '#device', start: 'top 75%', end: 'bottom 60%', scrub: 1,
        onUpdate: (self) => {
          g.progress = Math.max(0.02, self.progress); g.draw();
          const k = Math.min(8, Math.floor(self.progress * 9));
          stepsEl.querySelectorAll('li').forEach((li, n) => li.classList.toggle('on', n === k));
        },
      });
    }
    // 손글씨 채점 예시: 학생이 쓴 값(예시)을 실제 채점 API에 보내 받은 결과
    const samples = [['centroid', '-1', '점근선 중심'], ['angles', '-71.6', '출발각'], ['stableRange', '0<K≤8.16', '안정 범위']];
    const rows = [];
    for (const [field, ans, name] of samples) {
      const v = await API.check(problem, field, ans);
      const good = v.status === 'correct' || v.status === 'approx';
      // 답에 들어 있는 '<' 같은 기호가 HTML로 해석되지 않도록 글자로 바꿔 넣습니다
      const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      rows.push(`<div class="row ${good ? 'good' : 'bad'}"><small>${name} · 학생 답</small><span class="mono">${esc(ans)}</span>
        <small>${good ? '정답' : '엔진 결과 ' + esc(v.expected)}${v.diagnosis ? ' · ' + esc(v.diagnosis) : ''}</small></div>`);
    }
    document.getElementById('demoVerdict').innerHTML = rows.join('');
  }
  function initDemo(animated) { initDemoInner(animated); }
})();
