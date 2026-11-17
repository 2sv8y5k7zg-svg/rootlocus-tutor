// flow.js — 랜딩과 학습 화면이 함께 쓰는 '배경 오브젝트'입니다.
// 화면 뒤에 고정된 캔버스 하나에 빛의 가닥(선) 묶음을 그리고, 이 가닥들이 세 가지 형태 사이를 오갑니다.
//   형태 A  조형물      3차원 리본 묶음. 천천히 돕니다 (랜딩 첫 화면, 학습의 문제 입력 화면)
//   형태 B  좌표 구조   축·격자·네 갈래 곡선 (랜딩 중간 장면)
//   형태 C  흐름선      화면 전체를 가로지르는 잔잔한 물결선 (랜딩의 실제 화면 소개, 학습의 풀이 화면)
// 두 페이지가 같은 모듈·같은 시계를 쓰기 때문에, 페이지를 넘어가도 오브젝트가 같은 자세에서 이어집니다.
// 주의: 이 가닥들은 '장식용 추상 오브젝트'입니다. 실제 근궤적은 graph.js가 Python 계산값으로 그립니다.
//
// 쓰는 법: 페이지 코드가 Flow.S 의 값만 바꿉니다(GSAP으로 부드럽게). 그리기는 Flow.frame()이 값을 읽어서 합니다.
//   Flow.init(canvas)  준비
//   Flow.frame()       한 프레임 그리기 (페이지가 매 프레임 불러 줌)
//   Flow.pulse()       가닥이 한 번 밝아졌다 가라앉음 (정답을 맞혔을 때 등)

const Flow = (function () {
  let cv, ctx, W = 0, H = 0, dpr = 1, M = 54, P = 120, lowPower = false, touch = false, skip = 0, lastProgress = -1, MAXPX = 1.5e6;

  // 연출 상태. 0~1 사이 값들이며, 페이지 코드가 스크롤이나 학습 진행에 맞춰 바꿉니다.
  const S = {
    intro: 1,      // 처음 등장 (0: 흩어짐 → 1: 모임)
    morph: 0,      // A 조형물 → B 좌표 구조
    story: 0,      // B 안에서의 진행: 스캔 → 갈래가 그려짐 → 하나로 수렴
    flow: 0,       // (A 또는 B) → C 흐름선
    progress: 0,   // C에서 왼쪽부터 밝아진 정도 (학습 단계 n/9)
    pos: 0,        // 오브젝트 자리: 0 옆(넓은 화면은 오른쪽, 좁은 화면은 위) ↔ 1 화면 가운데
    oy: 0,         // 세로로 더 옮기기 (화면 높이의 비율)
    ox: 0,         // 가로로 더 옮기기 (화면 너비의 비율)
    dim: 1,        // 전체 밝기
    energy: 0,     // 순간적으로 밝아지는 정도 (pulse)
    mx: 0, my: 0, tx: 0, ty: 0,   // 커서 위치(감쇠 후 / 목표)
  };

  // 두 페이지가 같은 시계를 쓰도록 '컴퓨터 시계'로 시간을 잽니다 → 페이지를 넘어가도 회전 각도가 이어집니다.
  const now = () => (Date.now() - 1.7e12) / 1000;

  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    touch = matchMedia('(pointer: coarse)').matches;
    // 저사양 판단: 화면이 작거나 CPU 코어가 적으면 가닥 수를 줄이고 가벼운 합성으로 그립니다
    lowPower = reduced || (navigator.hardwareConcurrency || 8) <= 4 || Math.min(innerWidth, innerHeight) < 500;
    M = lowPower ? 30 : 54;    // 가닥 수
    P = lowPower ? 64 : 120;   // 가닥 하나의 점 수
    addEventListener('resize', () => resize(false));
    resize(true);
    // 커서 위치(-1~1)는 목표값으로만 저장하고, 그릴 때 천천히 따라가게 해서 과하게 흔들리지 않게 합니다
    if (!touch) addEventListener('pointermove', (e) => { S.tx = e.clientX / W * 2 - 1; S.ty = e.clientY / H * 2 - 1; }, { passive: true });
  }

  function resize(force) {
    const w = innerWidth, h = cv.clientHeight || innerHeight;
    // 휴대폰에서 주소창이 접히고 펴질 때는 높이만 조금 바뀝니다. 그때마다 캔버스를 다시 만들면 덜컹거리므로 건너뜁니다.
    if (!force && w === W && Math.abs(h - H) < 160) return;
    // 캔버스 픽셀 수가 너무 많으면 매 프레임 그리기가 무거워집니다. 전체 픽셀 수가 약 150만(MAXPX)을 넘지 않도록 배율을 정합니다.
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2, Math.sqrt(MAXPX / (w * h))));
    W = w; H = h;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── 형태 A: 추상 조형물 ─────────────────────────────────────────
  // 가닥 i, 위치 u(0~1)에 대한 3차원 좌표. 시간 t에 따라 천천히 숨 쉬듯 변합니다.
  function shapeA(i, u, t, out) {
    const ph = (i / M) * Math.PI * 2, th = u * Math.PI * 2;
    const r = 1 + 0.32 * Math.cos(3 * th + ph * 0.5 + t * 0.25);
    out[0] = r * Math.cos(th);
    out[1] = r * Math.sin(th) * 0.62 + 0.22 * Math.sin(2 * th + ph);
    out[2] = 0.5 * Math.sin(3 * th + ph + t * 0.2);
  }

  // ── 형태 B: 좌표 구조 (평면) ────────────────────────────────────
  // 가닥마다 역할을 나눕니다: 0 실수축, 1 허수축, 2~9 격자선, 나머지는 네 갈래 곡선
  // offset: 같은 갈래에 모인 가닥들의 간격(수렴하면 0). drawFrac: 갈래가 그려진 정도.
  function shapeB(i, u, offset, drawFrac, out) {
    if (i === 0) { out[0] = -2.3 + 3.6 * u; out[1] = 0; return; }
    if (i === 1) { out[0] = 0; out[1] = -1.6 + 3.2 * u; return; }
    if (i < 10) {
      const k = i - 2;
      if (k < 4) { out[0] = -2 + k; out[1] = -1.6 + 3.2 * u; } else { out[0] = -2.3 + 3.6 * u; out[1] = -1.5 + (k - 4) * 0.75; }
      return;
    }
    const j = (i - 10) % 4, lane = Math.floor((i - 10) / 4);
    const off = (lane - 5) * 0.018 * offset * (0.25 + 0.75 * drawFrac);
    const v = u * drawFrac, sy = j % 2 === 0 ? 1 : -1;
    // 장식용 곡선 (실제 계산값 아님)
    if (j < 2) { out[0] = -1.25 - 0.55 * v * v + off; out[1] = sy * 1.55 * v + off * sy; }
    else { out[0] = -0.5 + 1.2 * v * v + off; out[1] = sy * (0.5 + 1.05 * v) + off * sy; }
  }

  // ── 형태 C: 흐름선 ─────────────────────────────────────────────
  // 화면 전체를 왼쪽에서 오른쪽으로 가로지르는 물결선. 가닥마다 높이가 다르고, 시간에 따라 천천히 일렁입니다.
  // 화면 픽셀 기준으로 계산합니다(오브젝트 크기와 무관하게 항상 화면을 채우도록).
  function shapeC(i, u, t, out) {
    const k = (i + 0.5) / M - 0.5;                       // -0.5 ~ 0.5 : 가닥의 세로 자리
    const amp = H * (0.035 + 0.05 * Math.abs(k));
    out[0] = (u * 1.24 - 0.12) * W;
    out[1] = H * (0.5 + k * 1.05)
      + amp * Math.sin(u * 5.2 + i * 0.47 + t * 0.16)
      + amp * 0.6 * Math.sin(u * 2.1 - i * 0.21 - t * 0.11);
  }

  const ease = (x) => x * x * (3 - 2 * x);                    // 부드러운 시작·끝
  const ease5 = (x) => x * x * x * (x * (x * 6 - 15) + 10);  // 더 부드러운 시작·끝 (가속도까지 연속)
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ICE = [177, 203, 230], VIO = [180, 169, 213], WHITE = [245, 244, 240];
  const A = [0, 0, 0], B = [0, 0], C = [0, 0];   // 계산용 임시 좌표 (프레임마다 새 배열을 만들지 않도록 재사용)
  const PX = new Float32Array(256), PY = new Float32Array(256);

  // 가닥별 변신 시작 시점. 한 가닥이 옮겨 가는 시간(SPAN)은 짧게 잡아, 어느 순간에도 '날아가는 중'인 가닥은 몇 개뿐이게 합니다
  // (모두가 한꺼번에 섞이면 중간 모양이 엉킨 실타래처럼 보입니다).
  const SPAN = 0.3;
  const delayB = (i) => (i < 2 ? i * 0.04 : i < 10 ? 0.08 + (i - 2) * 0.02 : 0.24 + ((i - 10) / (M - 10)) * (1 - SPAN - 0.24));
  // 흐름선으로 갈 때는 위쪽 가닥부터 차례로 풀려 나갑니다
  const PC = 36;             // 흐름선만 남았을 때 가닥 하나의 점 수
  const SPAN_C = 0.45;
  const delayC = (i) => (i / (M - 1)) * (1 - SPAN_C);

  function frame() {
    if (!ctx) return;
    S.mx += (S.tx - S.mx) * 0.05; S.my += (S.ty - S.my) * 0.05;
    if (S.energy > 0.002) S.energy *= 0.955; else S.energy = 0;
    // 흐름선만 남은 뒤에는 움직임이 아주 느립니다. 풀이 화면의 그래프·카드 움직임에 계산 시간을 양보하도록
    // 평소에는 네 프레임에 한 번, 밝아지는 중이거나 진행 정도가 바뀌는 중에는 두 프레임에 한 번만 그립니다.
    const flowOnly = S.flow >= 1;
    if (flowOnly) {
      const busy = S.energy > 0 || S.progress !== lastProgress;
      skip = (skip + 1) % (busy ? 2 : 4);
      if (skip) return;
      lastProgress = S.progress;
    }
    ctx.clearRect(0, 0, W, H);
    if (S.dim <= 0.01) return;

    const t = now();
    const st = S.story;
    const scan = clamp(st * 3), draw = ease(clamp(st * 3 - 1)), verify = ease(clamp(st * 3 - 2));
    const wide = W > 900;
    const pos = ease(clamp(S.pos));
    // 자리: 옆(넓은 화면은 오른쪽, 좁은 화면은 위) ↔ 가운데
    const cx = W * ((wide ? 0.67 : 0.5) * (1 - pos) + 0.5 * pos + S.ox);
    const cy = H * ((wide ? 0.48 : 0.36) * (1 - pos) + 0.46 * pos + S.oy);
    const m = ease5(clamp(S.morph));
    const scale = (wide ? Math.min(H * 0.25, W * 0.125) : Math.min(W, H) * 0.25) * (1 + 0.12 * m);
    const yaw = t * 0.12 + S.mx * 0.35, pitch = 0.35 + S.my * 0.25;
    const intro = ease5(clamp(S.intro));
    const spread = (1 - intro) * 1.4;
    const offset = 1 - verify;
    const drawFrac = 0.03 + 0.97 * draw;               // 갈래는 한 점(극점 자리)에 모여 있다가 뻗어 나갑니다
    const jitter = 0.03 * Math.sin(Math.PI * scan);    // 스캔 전의 선은 손글씨처럼 살짝 흔들림 (처음과 끝은 0)
    const glowK = (1 + S.energy * 1.6) * S.dim * intro;
    const litEdge = S.progress * 1.1;                  // 흐름선에서 여기까지가 밝은 부분 (u 기준)

    // 'lighter': 겹친 선이 더 밝아지는 합성(빛 느낌). 저사양 기기에서는 무거워서 일반 합성으로 그립니다
    ctx.globalCompositeOperation = lowPower || flowOnly ? 'source-over' : 'lighter';
    ctx.lineWidth = lowPower ? 1 : 1.1;
    for (let i = 0; i < M; i++) {
      const isAxis = i < 2, isGrid = i >= 2 && i < 10;
      const k = i / M;
      const r = isAxis ? WHITE[0] : ICE[0] + (VIO[0] - ICE[0]) * k, g = isAxis ? WHITE[1] : ICE[1] + (VIO[1] - ICE[1]) * k, b = isAxis ? WHITE[2] : ICE[2] + (VIO[2] - ICE[2]) * k;
      const mi = ease5(clamp((S.morph - delayB(i)) / SPAN));           // 이 가닥이 B로 간 정도
      const ci = ease5(clamp((S.flow - delayC(i)) / SPAN_C));          // 이 가닥이 C로 간 정도
      const rot = (1 - mi) * (1 - ci);                                 // 조형물일 때만 회전
      const cyw = Math.cos(yaw * rot), syw = Math.sin(yaw * rot), cp = Math.cos(pitch * rot), sp = Math.sin(pitch * rot);
      let alpha = 0.32;
      if (isGrid) alpha *= 1 - 0.8 * mi * (1 - ci);
      if (!isAxis && !isGrid) alpha *= 1 + 0.6 * verify * (1 - ci);
      alpha *= 1 - 0.62 * ci;                                          // 흐름선은 배경이므로 훨씬 조용하게
      alpha *= glowK;

      // 흐름선은 완만한 물결이라 점이 적어도 매끄럽습니다. 흐름선만 남았을 때는 점 수를 줄이고 3차원 계산을 건너뜁니다.
      const n = flowOnly ? PC : P;
      if (flowOnly) {
        for (let p = 0; p < n; p++) { shapeC(i, p / (n - 1), t, C); PX[p] = C[0]; PY[p] = C[1]; }
      } else for (let p = 0; p < P; p++) {
        const u = p / (P - 1);
        shapeA(i, u, t, A);
        let x = A[0], y = A[1], z = A[2];
        if (mi > 0) {
          shapeB(i, u, offset, drawFrac, B);
          x += (B[0] - x) * mi; y += (B[1] - y) * mi; z *= 1 - mi;
          if (jitter > 0.0005 && !isAxis && !isGrid && (x + 2.3) / 3.6 > scan) y += jitter * Math.sin(u * 40 + i);
        }
        x += spread * Math.sin(i * 7.1 + u * 3); y += spread * Math.cos(i * 3.3 + u * 5);
        // 3차원 회전 후 원근 투영 → 화면 좌표
        const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const f = 3.2 / (3.2 + z2 * (1 - ci));
        let px = cx + x1 * scale * f, py = cy - y2 * scale * f;
        if (ci > 0) { shapeC(i, u, t, C); px += (C[0] - px) * ci; py += (C[1] - py) * ci; }
        PX[p] = px; PY[p] = py;
      }
      ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
      ctx.beginPath(); ctx.moveTo(PX[0], PY[0]);
      for (let p = 1; p < n; p++) ctx.lineTo(PX[p], PY[p]);
      ctx.stroke();
      // 흐름선의 밝은 부분: 학습이 진행된 만큼 왼쪽부터 빛이 차오릅니다
      if (ci > 0.5 && litEdge > 0.01) {
        const last = Math.min(n - 1, Math.floor(litEdge * (n - 1)));
        if (last > 0) {
          ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.2 * (ci - 0.5) * 2 * glowK})`;
          ctx.beginPath(); ctx.moveTo(PX[0], PY[0]);
          for (let p = 1; p <= last; p++) ctx.lineTo(PX[p], PY[p]);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // B 형태에서만 보이는 것들 (흐름선으로 넘어가면 함께 사라짐)
    const bOnly = m * (1 - ease(clamp(S.flow * 2.5))) * S.dim;
    const scanA = Math.sin(Math.PI * scan) * bOnly;
    if (scanA > 0.01 && st < 0.34) {       // 스캔선
      const xs = cx + (-2.3 + 3.6 * scan) * scale;
      const g = ctx.createLinearGradient(xs - 60, 0, xs, 0);
      g.addColorStop(0, 'rgba(177,203,230,0)'); g.addColorStop(1, `rgba(177,203,230,${0.10 * scanA})`);
      ctx.fillStyle = g; ctx.fillRect(xs - 60, cy - 1.7 * scale, 60, 3.4 * scale);
      ctx.strokeStyle = `rgba(177,203,230,${0.6 * scanA})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xs, cy - 1.7 * scale); ctx.lineTo(xs, cy + 1.7 * scale); ctx.stroke();
    }
    if (verify * bOnly > 0.01) {           // 갈래가 시작하는 자리의 작은 고리 (두 계산이 일치한 자리)
      for (const q of [[-1.25, 0], [-0.5, 0.5], [-0.5, -0.5]]) {
        ctx.strokeStyle = `rgba(245,244,240,${0.7 * verify * bOnly})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cx + q[0] * scale, cy - q[1] * scale, 6 + 10 * (1 - verify), 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // 가닥이 한 번 밝아졌다 서서히 가라앉습니다
  function pulse(amount) { S.energy = Math.max(S.energy, amount || 1); }

  // 다른 페이지로 넘어가기 직전에 지금 상태를 적어 두고, 다음 페이지가 그대로 이어 받습니다.
  // sessionStorage: 같은 탭 안에서만 유지되는 브라우저 저장소. 3초가 지난 기록은 쓰지 않습니다.
  function handoff() {
    try { sessionStorage.setItem('rl-flow', JSON.stringify({ at: Date.now(), pos: S.pos, oy: S.oy, ox: S.ox, dim: S.dim, morph: S.morph, flow: S.flow })); } catch (e) { /* 저장 불가여도 동작에는 지장 없음 */ }
  }
  function takeover() {
    try {
      const v = JSON.parse(sessionStorage.getItem('rl-flow') || 'null');
      sessionStorage.removeItem('rl-flow');
      if (v && Date.now() - v.at < 3000) { S.pos = v.pos; S.oy = v.oy; S.ox = v.ox || 0; S.dim = v.dim === undefined ? 1 : v.dim; S.morph = v.morph; S.flow = v.flow; S.intro = 1; return true; }
    } catch (e) { /* 무시 */ }
    return false;
  }

  return { S, init, frame, pulse, handoff, takeover, isTouch: () => touch };
})();
