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

const API = {
  offline: true,
  health() { return later(PREVIEW.health); },
  fields() { return later(PREVIEW.fields); },

  analyze(problem) {
    const r = PREVIEW.analyze[stableKey(problem)];
    return later(r || { ok: false, error: { code: 'offline', message: OFFLINE_MSG } });
  },

  // 채점: 미리 채점해 둔 답이면 그 결과, 아니면 '검증 불가'로 표시 (오답 처리하지 않음)
  check(problem, field, answer, K) {
    const tbl = (PREVIEW.check[stableKey(problem)] || {})[field] || {};
    const r = tbl[normAnswer(answer) + (K !== undefined && K !== null ? '|K=' + K : '')] || tbl[normAnswer(answer)];
    return later(r || { status: 'unverifiable', diagnosis: '이 답은 미리보기 파일에서 채점할 수 없습니다. 입력 칸 아래 예시 답을 눌러 보거나, 노트북에서 python run.py로 실행하면 어떤 답이든 채점합니다.' });
  },

  // K 하나에서 폐루프 극점: 미리 계산한 K 목록 중 가장 가까운 값의 결과
  poles(problem, K) {
    const key = stableKey(problem);
    const Ks = PREVIEW.analyze[key]?.graph.K, list = PREVIEW.poles[key];
    if (!Ks || !list) return later({});
    let best = 0;
    for (let i = 1; i < Ks.length; i++) if (Math.abs(Ks[i] - K) < Math.abs(Ks[best] - K)) best = i;
    return later({ ...list[best], usedK: Ks[best] });
  },

  // 그래프 위 한 점의 K: 미리 계산한 근궤적 점 중 아주 가까운 점이 있으면 그 점의 K
  gain(problem, re, im) {
    const res = PREVIEW.analyze[stableKey(problem)];
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
    const r = PREVIEW.diagram[stableKey({ G, H })];
    return later(r || { ok: false, error: { code: 'offline', message: OFFLINE_MSG + ' (예: G(s) = K/(s(s+1)), H(s) = 1)' } });
  },

  // AI 힌트: 미리보기에서는 실제 AI를 부르지 않고, 시연 모드(모의 AI) 응답만 들어 있습니다
  hint(problem, step, level, student, verdict, demo) {
    const r = demo && PREVIEW.hint[stableKey(problem)]?.[`${step}|${level}`];
    return later(r || { ok: false });
  },

  // 사진 업로드: 시연 모드(모의 AI)일 때만. 모의 AI는 사진을 실제로 읽지 않습니다.
  upload(path, file, fields) {
    if (!fields.demo) {
      return later({ ok: false, error: { message: '미리보기 파일에서는 실제 AI로 사진을 보내지 않습니다.' }, fallback: '오른쪽 위 시연 모드를 켜면 모의 AI 흐름을 볼 수 있습니다.' });
    }
    if (path.endsWith('/recognize')) return later(PREVIEW.recognize);
    const r = PREVIEW.handwriting[stableKey(JSON.parse(fields.problem))];
    return later(r || { ok: false, error: { message: OFFLINE_MSG } });
  },
};
