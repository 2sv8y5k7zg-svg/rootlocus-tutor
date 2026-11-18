// flow.js — 랜딩과 학습 화면이 함께 쓰는 '배경 오브젝트'입니다.
// 화면 뒤에 고정된 캔버스 하나에 빛의 가닥(선) 묶음을 그리고, 세 가지 형태 사이를 오갑니다(조형물이 감긴 실처럼 풀려 가지런한 평행선으로 정리된 뒤 다음 형태가 됨).
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
  let cv, ctx, W = 0, H = 0, dpr = 1, M = 54, P = 72, lowPower = false, touch = false, MAXPX = 1.5e6;
  // 프레임 시간 측정용: 기기가 버거워할 때만 그리는 빈도를 낮춥니다 (아래 pace 참고)
  let lastT = 0, ema = 16.7, stride = 1, tick = 0, slowFor = 0, okFor = 0, probeWait = 4000, q = 0, rest = 0, lastProgress = -1;

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
  // performance 시계는 1ms보다 촘촘해서, 화면 주사율이 높은 기기(120Hz)에서도 회전이 프레임마다 고르게 나아갑니다.
  const now = () => (performance.timeOrigin + performance.now() - 1.7e12) / 1000;

  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    touch = matchMedia('(pointer: coarse)').matches;
    // 저사양 판단: 화면이 작거나(휴대폰) CPU 코어가 아주 적으면 가닥 수를 줄이고 가벼운 합성으로 그립니다.
    // 그 밖의 기기는 일단 온전하게 그리고, 실제로 프레임이 밀릴 때만 아래 pace()가 단계를 낮춥니다.
    lowPower = reduced || (navigator.hardwareConcurrency || 8) <= 2 || Math.min(innerWidth, innerHeight) < 500;
    M = lowPower ? 30 : 54;    // 가닥 수
    P = 72;                    // 가닥 하나의 점 수 (점 사이를 곡선으로 이으므로 이 정도로 충분히 매끄럽습니다)
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

  const PC = 36;             // 흐름선 가닥 하나의 점 수 (완만한 물결이라 적어도 매끄럽습니다)

  // 가닥 하나를 그립니다 (PX, PY에 담긴 n개의 점).
  // 점과 점을 직선으로 이으면 굽은 곳에서 꺾인 자국이 보입니다. 이웃한 두 점의 가운데를 지나는 2차 곡선으로 이어
  // 꺾임 없이 매끈한 선이 되게 합니다(점 수를 늘리는 것보다 가볍습니다).
  function strokeLine(n, r, g, b, alpha) {
    ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
    ctx.beginPath(); ctx.moveTo(PX[0], PY[0]);
    for (let p = 1; p < n - 1; p++) ctx.quadraticCurveTo(PX[p], PY[p], (PX[p] + PX[p + 1]) / 2, (PY[p] + PY[p + 1]) / 2);
    ctx.lineTo(PX[n - 1], PY[n - 1]);
    ctx.stroke();
  }

  // 기기에 맞춰 스스로 무게를 조절합니다. 기본은 '온전한 품질로 매 프레임'입니다.
  // 실제 프레임 간격(ema: 최근 평균)이 계속 길면 한 단계씩 가볍게 합니다. 끊김보다 '조금 단순한 그림'이 낫기 때문에
  // 그리는 빈도는 마지막에만 낮춥니다.
  //   q 1  겹친 선을 밝게 더하는 합성을 끔   q 2  가닥을 절반만 그림   그다음  두세 프레임에 한 번 그림
  // 한동안 여유가 있으면 빈도는 다시 매 프레임으로 돌아가 봅니다(다시 밀리면 더 오래 기다렸다가 시도).
  // 돌려주는 값: 이번 프레임을 건너뛸지 여부. dt는 직전 프레임과의 간격(ms).
  function pace(dt) {
    ema += (dt - ema) * 0.12;
    if (ema > 23) { slowFor += dt; okFor = 0; } else { okFor += dt; slowFor = 0; }
    if (slowFor > 450) {
      slowFor = 0; ema = 16.7;
      if (q < 2) q++;
      else if (stride < 3) { stride++; probeWait = Math.min(probeWait * 2, 30000); }
    } else if (stride > 1 && okFor > probeWait) { okFor = 0; stride--; }
    tick = (tick + 1) % stride;
    return tick !== 0;
  }

  // 형태가 바뀌는 방식 (풀렸다가 정리되는 전환):
  //   ① 조형물의 가닥들이 회전을 멈추며 함께 풀려, 느슨하게 일렁이는 리본이 됩니다.
  //   ② 일렁임이 가라앉아 가지런한 평행선 묶음으로 정리됩니다.
  //   ③ 평행선이 가운데 한 줄(실수축)로 모이며 좌표 구조가 떠오르거나(B), 화면 전체로 퍼져 흐름선이 됩니다(C).
  //   모든 가닥이 같은 방향·같은 박자로 움직이고 목표도 서로 닮은 평행선이라, 중간 모양이 엉키지 않습니다.
  //   되돌아갈 때는 같은 길을 거꾸로 갑니다.
  function frame() {
    if (!ctx) return;
    // 감쇠는 '지난 시간' 기준으로 계산합니다 → 주사율이 60Hz든 120Hz든 같은 속도로 따라가고 가라앉습니다.
    const tn = performance.now();
    const dt = lastT ? Math.min(tn - lastT, 100) : 16.7; lastT = tn;
    const kf = dt / 16.7;
    const follow = 1 - Math.pow(0.95, kf);
    S.mx += (S.tx - S.mx) * follow; S.my += (S.ty - S.my) * follow;
    if (S.energy > 0.002) S.energy *= Math.pow(0.955, kf); else S.energy = 0;
    if (pace(dt)) return;
    const flowOnly = S.flow >= 1;
    // 프레임이 밀린 적이 있는 기기(q > 0)에서는, 흐름선만 남은 조용한 배경이 그래프·카드 움직임에 시간을 양보합니다:
    // 배경에 변화가 없으면 네 프레임에 한 번, 밝아지는 중이면 두 프레임에 한 번만 그립니다. 여유 있는 기기는 매 프레임 그립니다.
    if (flowOnly && q > 0) {
      const busy = S.energy > 0 || S.progress !== lastProgress;
      rest = (rest + 1) % (busy ? 2 : 4);
      if (rest) return;
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
    const base = wide ? Math.min(H * 0.25, W * 0.125) : Math.min(W, H) * 0.25;
    const intro = ease5(clamp(S.intro));
    const glowK = (1 + S.energy * 1.6) * S.dim * intro;
    const mm = clamp(S.morph), ff = clamp(S.flow);
    const away = Math.max(mm, ff);                       // 조형물에서 벗어난 정도
    const merge = ease5(clamp((mm - 0.62) / 0.3));       // ③ 평행선이 한 줄(실수축)로 모인 정도
    const reopen = ease(clamp(ff * 2.5));                // 좌표 구조에서 흐름선으로 갈 때: 모였던 줄이 다시 벌어짐
    const toC = ease5(clamp((ff - 0.45) / 0.55));        // 평행선이 화면 전체 흐름선으로 퍼진 정도
    const wB = ease5(clamp((mm - 0.6) / 0.4)) * (1 - ease(clamp(ff * 2.5)));   // 좌표 구조가 보이는 정도
    const offset = 1 - verify;
    const drawFrac = 0.03 + 0.97 * draw;                 // 갈래는 한 점(극점 자리)에 모여 있다가 뻗어 나갑니다

    // 'lighter': 겹친 선이 더 밝아지는 합성(빛 느낌). 저사양 기기에서는 무거워서 일반 합성으로 그립니다
    ctx.globalCompositeOperation = lowPower || q > 0 || flowOnly ? 'source-over' : 'lighter';
    const step = q >= 2 && !lowPower ? 2 : 1;          // 가닥을 절반만 그릴 때는 그만큼 진하게 그려 밝기를 맞춥니다
    const thick = step === 2 ? 1.5 : 1;
    ctx.lineWidth = lowPower ? 1 : 1.1;

    // ── 가닥 묶음: 조형물(A) → 풀림 → 평행선 → (실수축으로 모임 | 흐름선 C) ──
    const scaleB = base * 1.12;
    const lineVis = 1 - merge * (1 - reopen);            // 실수축으로 완전히 모이면 좌표 구조의 축이 자리를 이어받습니다
    if (flowOnly) {
      // 흐름선만 남은 상태: 가장 가벼운 경로
      const last = Math.min(PC - 1, Math.floor(S.progress * 1.1 * (PC - 1)));   // 학습이 진행된 만큼 왼쪽부터 밝아짐
      for (let i = 0; i < M; i += step) {
        const k = i / M;
        const r = ICE[0] + (VIO[0] - ICE[0]) * k, g = ICE[1] + (VIO[1] - ICE[1]) * k, b = ICE[2] + (VIO[2] - ICE[2]) * k;
        for (let p = 0; p < PC; p++) { shapeC(i, p / (PC - 1), t, C); PX[p] = C[0]; PY[p] = C[1]; }
        strokeLine(PC, r, g, b, 0.12 * glowK * thick);
        if (last > 0) strokeLine(last + 1, r, g, b, 0.2 * glowK * thick);
      }
    } else if (lineVis > 0.004) {
      const scaleA = base * (0.86 + 0.14 * intro);       // 처음 등장할 때는 조금 작게 시작해 제자리로 커집니다
      const spanY = 2.5 * scaleB * (1 - merge * (1 - reopen));   // 평행선 묶음의 높이 (모일수록 0)
      const x0 = cx - 2.3 * scaleB, spanX = 3.6 * scaleB;        // 좌표 구조의 실수축과 같은 자리·길이
      const litLast = Math.floor(S.progress * 1.1 * (P - 1));
      // 회전은 모든 가닥이 함께 멈춥니다. 돌던 각도는 -180°~180° 범위로 접어서, 가까운 쪽으로 조용히 정면을 향하게 합니다
      // (접지 않으면 그동안 쌓인 회전을 한꺼번에 되감느라 빠르게 돌아 버립니다).
      const still = ease5(clamp(away * 1.12 / 0.6));
      let turn = (t * 0.12) % (2 * Math.PI); if (turn > Math.PI) turn -= 2 * Math.PI;
      const yaw = (turn + S.mx * 0.35) * (1 - still), pitch = (0.35 + S.my * 0.25) * (1 - still);
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      for (let i = 0; i < M; i += step) {
        const k = i / M;
        // 가닥마다 아주 조금씩 늦게 풀립니다 (한꺼번에 '툭' 바뀌지 않고 결을 따라 흘러가도록)
        const e = ease5(clamp((away * 1.12 - 0.12 * k) / 0.6));
        const live = 1 - e;                              // 고리가 아직 말려 있는 정도 (1: 닫힌 고리, 0: 곧은 선)
        const detail = 1 - ease(clamp(e * 1.7));         // 조형물의 굴곡·입체감이 남은 정도 (풀리기 시작하면 먼저 가라앉음)
        const loose = Math.sin(Math.PI * e) * scaleB * 0.1;       // 풀리는 도중에만 생기는 잔잔한 일렁임 (처음과 끝은 0)
        // 고리의 반지름(px): 다 펴졌을 때 선의 길이가 좌표 구조의 실수축 길이와 같아지도록 맞춥니다
        const rho = scaleA + (spanX / (2 * Math.PI) - scaleA) * e;
        const ox = cx + (x0 + spanX / 2 - cx) * e;       // 펴지면서 실수축의 가운데로 옮겨 감
        const oy = cy + (k - 0.5) * spanY * e;           // 펴지면서 가닥마다 제 줄로 벌어짐
        for (let p = 0; p < P; p++) {
          const u = p / (P - 1);
          // '감긴 실을 푸는' 모양: 고리의 굽은 정도(live)를 줄여 가면, 닫힌 원이 위쪽에서 열리며 점점 펴져 곧은 선이 됩니다.
          // s는 고리를 따라 잰 위치(-π ~ π). 굽은 정도가 0이면 그냥 직선입니다.
          const s = (u - 0.5) * 2 * Math.PI;
          let x, y, z = 0;
          if (live > 0.002) {
            x = Math.sin(s * live) / live;
            // 열리는 동안 모양이 화면 위로 치우치지 않도록, 호의 위아래 가운데를 기준점에 맞춥니다
            y = (1 - Math.cos(s * live)) / live - live - ((1 - Math.cos(Math.PI * live)) / live - 2 * live) / 2;
          } else { x = s; y = 0; }
          if (detail > 0.001) {
            // 조형물 고유의 굴곡: 원에서 벗어난 만큼만 더합니다 (shapeA와 같은 고리 위치가 되도록 u를 3/4바퀴 옮김)
            shapeA(i, u + 0.25, t, A);
            x += (A[0] - Math.sin(s)) * detail; y += (A[1] + Math.cos(s)) * detail; z = A[2] * detail;
          }
          // 3차원 회전 후 원근 투영 → 화면 좌표
          const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
          const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
          const f = 3.2 / (3.2 + z2);
          let px = ox + x1 * rho * f, py = oy - y2 * rho * f + loose * Math.sin(u * 4.2 + k * 5 + t * 0.35);
          // 흐름선으로 갈 때는 가지런한 평행선이 화면 전체로 퍼집니다
          if (toC > 0) { shapeC(i, u, t, C); px += (C[0] - px) * toC; py += (C[1] - py) * toC; }
          PX[p] = px; PY[p] = py;
        }
        const r = ICE[0] + (VIO[0] - ICE[0]) * k, g = ICE[1] + (VIO[1] - ICE[1]) * k, b = ICE[2] + (VIO[2] - ICE[2]) * k;
        // 밝기: 조형물 0.32 → 평행선 0.2 → 흐름선 0.12. 한 줄로 모일 때는 겹쳐서 밝아지므로 더 옅게.
        const a0 = 0.32 + (0.2 - 0.32) * e + (0.12 - 0.2) * toC;
        strokeLine(P, r, g, b, a0 * lineVis * (1 - 0.8 * merge * (1 - reopen)) * glowK * thick);
        if (toC > 0.5 && litLast > 0) strokeLine(Math.min(P, litLast + 1), r, g, b, 0.2 * (toC - 0.5) * 2 * glowK * thick);
      }
    }

    // ── 형태 B: 좌표 구조 (원점에서 뻗어 나옴) ──
    if (!flowOnly && wB > 0.005) {
      const scale = scaleB;
      const grow = 0.35 + 0.65 * wB;                     // 축과 격자가 원점에서 바깥으로 자랍니다
      const nB = 40;
      for (let i = 0; i < M; i++) {
        const isAxis = i < 2, isGrid = i >= 2 && i < 10;
        if (!isAxis && !isGrid && drawFrac < 0.04) continue;   // 아직 그려지지 않은 갈래는 건너뜀
        const k = i / M;
        let alpha = (isAxis ? 0.5 : isGrid ? 0.09 : 0.2 * (1 + 0.6 * verify)) * wB * glowK;
        for (let p = 0; p < nB; p++) {
          shapeB(i, p / (nB - 1), offset, drawFrac, B);
          const gk = i > 0 && (isAxis || isGrid) ? grow : 1;
          PX[p] = cx + B[0] * gk * scale; PY[p] = cy - B[1] * gk * scale;
        }
        if (isAxis || isGrid) strokeLine(nB, WHITE[0], WHITE[1], WHITE[2], alpha);
        else strokeLine(nB, ICE[0] + (VIO[0] - ICE[0]) * k, ICE[1] + (VIO[1] - ICE[1]) * k, ICE[2] + (VIO[2] - ICE[2]) * k, alpha);
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    const scale = scaleB;
    // B 형태에서만 보이는 것들 (흐름선으로 넘어가면 함께 사라짐)
    const bOnly = wB * S.dim;
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
