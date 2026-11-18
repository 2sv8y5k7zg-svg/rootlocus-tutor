// api_offline.js — 서버 없이 여는 '오프라인 미리보기'용 API입니다.
// 진짜 api.js와 똑같은 함수 이름을 갖지만, 서버에 묻는 대신
// tools/build_offline.py가 Python 서버에 미리 물어서 저장해 둔 응답(window.PREVIEW_DATA)을 꺼내 줍니다.
// 그래서 화면에 나오는 숫자는 모두 실제 Python 엔진의 응답 그대로입니다.
// 저장해 두지 않은 문제·답은 계산하지 않고 "미리보기에서는 안 됨"이라고 알려 줍니다.

const PREVIEW = window.PREVIEW_DATA;
const OFFLINE_MSG = '오프라인 미리보기 파일에는 예시 문제만 들어 있습니다. 노트북에서 python run.py로 실행하면 어떤 식이든 계산합니다.';

// 객체를 항상 같은 글자로 바꿉니다 (키 순서 정렬). Python json.dumps(sort_keys=True)와 같은 모양.
function stableKey(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(typeof o === 'string' ? o.trim() : o);
  if (Array.isArray(o)) return '[' + o.map(stableKey).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableKey(o[k])).join(',') + '}';
}
// 학생 답 비교용: 공백 제거, 여러 가지 마이너스 기호를 하나로
function normAnswer(a) { return String(a ?? '').replace(/\s+/g, '').replace(/[−–]/g, '-'); }
const later = (v) => new Promise((ok) => setTimeout(() => ok(v), 60));   // 서버 응답처럼 아주 조금 늦게

// 식 비교용: 공백·곱셈 기호·위첨자 차이는 같은 식으로 봅니다 (예: 'K/(s (s+1))' = 'K/(s(s+1))')
function normExpr(t) {
  const sup = { '²': '^2', '³': '^3', '⁴': '^4' };
  return String(t ?? '').replace(/[²³⁴]/g, (c) => sup[c]).replace(/[\s*·]/g, '').replace(/[−–]/g, '-');
}
// 저장된 응답 표에서 문제를 찾습니다. 글자가 똑같지 않아도 normExpr로 같은 식이면 찾습니다.
function findStored(table, problem) {
  const k = stableKey(problem);
  if (table[k]) return table[k];
  const want = stableKey(Object.fromEntries(Object.entries(problem).map(([a, b]) => [a, normExpr(b)])));
  for (const key of Object.keys(table)) {
    let p; try { p = JSON.parse(key); } catch (e) { continue; }
    const norm = stableKey(Object.fromEntries(Object.entries(p).map(([a, b]) => [a, normExpr(b)])));
    if (norm === want) return table[key];
  }
  return null;
}

const API = {
  offline: true,
  health() { return later(PREVIEW.health); },
  fields() { return later(PREVIEW.fields); },

  analyze(problem) {
    const r = findStored(PREVIEW.analyze, problem);
    return later(r || { ok: false, error: { code: 'offline', message: OFFLINE_MSG } });
  },

  // 채점: 미리 채점해 둔 답이면 그 결과, 아니면 '검증 불가'로 표시 (오답 처리하지 않음)
  check(problem, field, answer, K) {
    const tbl = (findStored(PREVIEW.check, problem) || {})[field] || {};
    const r = tbl[normAnswer(answer) + (K !== undefined && K !== null ? '|K=' + K : '')] || tbl[normAnswer(answer)];
    return later(r || { status: 'unverifiable', diagnosis: '이 답은 미리보기 파일에서 채점할 수 없습니다. 입력 칸 아래 예시 답을 눌러 보거나, 노트북에서 python run.py로 실행하면 어떤 답이든 채점합니다.' });
  },

  // K 하나에서 폐루프 극점: 미리 계산한 K 목록 중 가장 가까운 값의 결과
  poles(problem, K) {
    const Ks = findStored(PREVIEW.analyze, problem)?.graph.K, list = findStored(PREVIEW.poles, problem);
    if (!Ks || !list) return later({});
    let best = 0;
    for (let i = 1; i < Ks.length; i++) if (Math.abs(Ks[i] - K) < Math.abs(Ks[best] - K)) best = i;
    return later({ ...list[best], usedK: Ks[best] });
  },

  // 그래프 위 한 점의 K: 미리 계산한 근궤적 점 중 아주 가까운 점이 있으면 그 점의 K
  gain(problem, re, im) {
    const res = findStored(PREVIEW.analyze, problem);
    if (!res) return later({ K: null });
    const g = res.graph, v = g.view;
    const tol = 0.015 * Math.hypot(v.xmax - v.xmin, v.ymax - v.ymin);
    let best = null, bd = Infinity;
    for (const br of g.branches) for (let i = 0; i < br.length; i++) {
      const d = Math.hypot(br[i][0] - re, br[i][1] - im);
      if (d < bd) { bd = d; best = i; }
    }
    if (bd > tol) return later({ K: null });
    return later({ K: g.K[best], onLocus: true });
  },

  diagram(G, H) {
    const r = findStored(PREVIEW.diagram, { G, H });
    return later(r || { ok: false, error: { code: 'offline', message: OFFLINE_MSG + ' (예: G(s) = K/(s(s+1)), H(s) = 1)' } });
  },

  // AI 힌트: 미리보기에서는 실제 AI를 부르지 않고, 시연 모드(모의 AI) 응답만 들어 있습니다
  hint(problem, step, level, student, verdict, demo) {
    const r = demo && findStored(PREVIEW.hint, problem)?.[`${step}|${level}`];
    return later(r || { ok: false });
  },

  // 사진 업로드
  //  - 시연 모드: 모의 AI가 저장해 둔 예시 답 (사진을 읽지 않음)
  //  - 시연 모드가 아니면: claude.ai 미리보기 링크 안에서만 Claude가 실제로 사진을 읽습니다 (recognizeWithClaude).
  //    본선 앱(python run.py)에서는 같은 지시문으로 Gemini가 읽습니다. 계산은 어느 쪽이든 Python 엔진 결과만 씁니다.
  async upload(path, file, fields) {
    if (fields.demo) {
      if (path.endsWith('/recognize')) return later(PREVIEW.recognize);
      const r = findStored(PREVIEW.handwriting, JSON.parse(fields.problem));
      return later(r || { ok: false, error: { message: OFFLINE_MSG } });
    }
    if (path.endsWith('/recognize')) return recognizeWithClaude(file);
    return later({ ok: false, error: { message: '미리보기 파일에서는 손글씨 풀이 사진을 실제 AI로 보내지 않습니다.' }, fallback: '오른쪽 위 시연 모드를 켜면 모의 AI 흐름을 볼 수 있습니다.' });
  },

  // 사진 탭 안내문: 지금 사진을 누가 읽는지 알려 줍니다
  async photoReader() {
    const sample = await claudeSample();
    const lim = sample && await sample.limits().catch(() => null);
    return lim?.images ? 'claude' : null;
  },
};

// ───────────── 미리보기 링크에서 Claude로 사진 읽기 ─────────────
// claude.ai 아티팩트는 window.claude.use('sample')로 Claude에게 사진을 보여 줄 수 있습니다(보는 사람의 동의 후).
// 그 밖의 곳(Chrome으로 연 파일)에서는 null이 되어, 실제 인식 대신 안내만 합니다.
let samplePromise = null;
function claudeSample() {
  if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
  if (!samplePromise) samplePromise = window.claude.use('sample').catch(() => null);
  return samplePromise;
}

const JSON_SHAPE = `
답은 아래 모양의 JSON 객체 하나만 쓴다. 설명 문장은 쓰지 않는다.
{"kind": "transferFunction" | "blockDiagram" | "unknown",
 "tf": "개루프 전달함수 K·G(s)H(s) 한 줄 (알 수 있을 때, 없으면 빈 글자)",
 "G": "앞먹임 G(s) (단순 구조일 때, 없으면 빈 글자)", "H": "되먹임 H(s) (없으면 빈 글자)", "feedbackSign": "-" | "+",
 "diagram": {"input": "R", "outputNode": "출력 블록 id", "blocks": [{"id": "", "tf": "", "in": ""}], "sums": [{"id": "", "inputs": [{"from": "", "sign": "+"}]}]} 또는 null,
 "conditions": ["문제 조건"], "uncertain": ["확실하지 않은 부분"], "confidence": 0~1 사이 숫자}
사진에 제어공학 문제가 없으면 kind를 "unknown"으로, confidence를 0으로 쓴다.`;

// AI 응답에서 쓰는 칸만 골라 글자·숫자 모양을 맞춥니다 (Python 서버의 응답 검사와 같은 역할)
function cleanAi(a) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : []);
  const conf = Number(a?.confidence);
  return {
    kind: ['transferFunction', 'blockDiagram', 'unknown'].includes(a?.kind) ? a.kind : 'unknown',
    tf: str(a?.tf), G: str(a?.G), H: str(a?.H), feedbackSign: a?.feedbackSign === '+' ? '+' : '-',
    diagram: a?.diagram && Array.isArray(a.diagram.blocks) ? a.diagram : null,
    conditions: list(a?.conditions), uncertain: list(a?.uncertain),
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
  };
}

// 엔진이 미리 계산해 둔 결과가 있는 식이면 확인 패널에 루프·폐루프·특성방정식을 보여 줍니다
function offlinePreview(ai) {
  const out = { loopText: null, T: null, charPoly: null, error: null, problem: null };
  if (ai.G) {
    const d = findStored(PREVIEW.diagram, { G: ai.G, H: ai.H || '1' });
    if (d?.ok) return { ...out, loopText: d.loopText, T: d.T, charPoly: d.charPoly, problem: { G: ai.G, H: ai.H || '1' } };
  }
  const text = ai.tf || (ai.G && (!ai.H || ai.H === '1') ? ai.G : '');
  const r = text && findStored(PREVIEW.analyze, { text });
  if (r?.ok) return { ...out, loopText: r.input.text, charPoly: r.steps[0].result.charPoly || null, problem: { text } };
  out.error = { message: '사진은 읽었지만, 이 식은 미리보기 파일에 계산 결과가 없어 여기서는 풀이를 시작할 수 없습니다. 노트북에서 python run.py로 실행하면 같은 식을 바로 계산합니다.' };
  return out;
}

const SAMPLE_ERR = {
  not_granted: '사진을 Claude에게 보내는 것을 허용하지 않아 읽지 못했습니다.',
  sampling_disabled: '이 계정에서는 Claude 호출을 쓸 수 없습니다.',
  images_unavailable: '이 화면에서는 사진을 Claude에게 보낼 수 없습니다.',
  image_rejected: '이 사진은 보낼 수 없습니다. JPG·PNG 사진으로 다시 골라 주세요.',
  rate_limited: '요청이 많습니다. 잠시 뒤 다시 눌러 주세요.',
  invalid_json: 'AI 응답 형식이 맞지 않았습니다. 다시 한 번 눌러 주세요.',
  refused: 'AI가 이 사진에 답하지 않았습니다.',
};

async function recognizeWithClaude(file) {
  const sample = await claudeSample();
  const lim = sample && await sample.limits().catch(() => null);
  if (!lim?.images) {
    return { ok: false, error: { message: '이 미리보기 파일에서는 실제 AI로 사진을 읽을 수 없습니다. claude.ai 미리보기 링크에서 열거나, 노트북에서 python run.py로 실행해 주세요.' },
             fallback: '오른쪽 위 시연 모드를 켜면 모의 AI 흐름을 볼 수 있습니다.' };
  }
  try {
    const raw = await sample.json(PREVIEW.prompts.extract + '\n' + JSON_SHAPE, { images: file });
    const ai = cleanAi(raw);
    if (ai.kind === 'unknown' && !ai.tf && !ai.G) {
      return { ok: false, error: { message: '사진에서 전달함수나 블록선도를 찾지 못했습니다. 식이 잘 보이게 다시 찍어 주세요.' } };
    }
    return { ok: true, provider: 'claude', providerLabel: 'Claude (미리보기 링크 전용)', ai, preview: offlinePreview(ai), needsConfirm: true,
             message: 'AI가 읽은 내용입니다. 식·부호·연결을 확인하고 고친 뒤 [확정]을 눌러야 계산을 시작합니다.' };
  } catch (e) {
    if (e?.code === 'cancelled') return { ok: false, error: { message: '인식을 멈췄습니다.' } };
    return { ok: false, error: { message: SAMPLE_ERR[e?.code] || 'AI 연결에 실패했습니다. 잠시 뒤 다시 눌러 주세요.' } };
  }
}
