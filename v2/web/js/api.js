// api.js — 브라우저와 Python 서버(FastAPI)의 통신만 담당합니다.
// 이 파일은 수학 계산을 하지 않습니다. 모든 숫자는 서버(Python 엔진)가 만든 값입니다.
// API 키는 브라우저에 없습니다. AI 호출도 서버를 거쳐서만 나갑니다.

const API = {
  // JSON을 보내고 JSON을 받는 공통 함수
  // 입력: 주소(path), 보낼 객체(body) / 출력: 서버가 돌려준 객체
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status >= 500) {
      return { ok: false, error: { code: 'server', message: '서버 오류가 났습니다. 잠시 후 다시 시도해 주세요.' } };
    }
    return res.json();
  },

  // 사진 업로드용 (multipart/form-data). fields에는 consent, demo, problem 같은 글자 값을 넣습니다.
  async upload(path, file, fields) {
    const fd = new FormData();
    fd.append('image', file);
    for (const k in fields) fd.append(k, String(fields[k]));
    const res = await fetch(path, { method: 'POST', body: fd });
    return res.json();
  },

  // 서버·AI 상태 (AI 키가 설정되어 있는지 등)
  health() { return fetch('/api/health').then(r => r.json()); },

  // 단계별 답 입력 칸 목록
  fields() { return fetch('/api/fields').then(r => r.json()); },

  // 문제 → 9단계 풀이 전체 + 그래프 데이터 + 힌트
  // problem 예: {text: 'K(s+2)/(s(s+1))'} 또는 {G: '...', H: '...'}
  analyze(problem) { return this.post('/api/analyze', { problem }); },

  // 학생 답 하나 채점. 응답: {status, expected, student, diagnosis}
  check(problem, field, answer, K) { return this.post('/api/check', { problem, field, answer, K }); },

  // K 하나에서 폐루프 극점 (K 슬라이더를 놓았을 때 정확한 값 확인용)
  poles(problem, K) { return this.post('/api/poles', { problem, K }); },

  // 그래프 위 한 점의 K (크기 조건 |K·G(s)| = 1)
  gain(problem, re, im) { return this.post('/api/gain', { problem, re, im }); },

  // G, H 구조를 계산 전에 미리 해석 (사용자 확인용)
  diagram(G, H) { return this.post('/api/diagram', { G, H }); },

  // AI 힌트 (AI가 꺼져 있거나 숫자 검사에 걸리면 팀 힌트가 대신 옵니다)
  hint(problem, step, level, student, verdict, demo) {
    return this.post('/api/ai/hint', { problem, step, level, student, verdict, demo });
  },
};
