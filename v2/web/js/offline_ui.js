// offline_ui.js — 오프라인 미리보기 파일에서만 붙는 작은 화면 보조입니다.
// 1) 화면 위에 '오프라인 미리보기' 표시
// 2) 답 입력 칸 아래에 미리 채점해 둔 예시 답(정답·흔한 실수) 버튼
// 3) K를 직접 입력하면 가장 가까운 계산값을 썼다는 것을 표시

(function () {
  const bar = document.createElement('div');
  bar.className = 'offline-bar';
  bar.textContent = '오프라인 미리보기 · 예시 문제만 · 숫자는 Python 엔진 응답';
  document.body.prepend(bar);

  if (typeof renderAnswers !== 'function') return;   // 랜딩 페이지에는 아래 기능이 필요 없음

  const origRender = renderAnswers;
  renderAnswers = function (n) {
    origRender(n);
    const samples = findStored(PREVIEW.samples, state.problem) || {};
    document.querySelectorAll('#answerForm input[data-field]').forEach((inp) => {
      const list = samples[inp.dataset.field];
      if (!list || !list.length) return;
      const row = document.createElement('div');
      row.className = 'offline-samples';
      row.innerHTML = '<span>예시 답</span>';
      for (const s of list) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'chip small';
        b.textContent = `${s.kind}: ${s.answer}`;
        b.onclick = () => {
          inp.value = s.answer;
          if (n === 9 && s.K !== undefined) document.getElementById('answerK').value = s.K;
          inp.closest('label').querySelector('button[type=submit]').click();
        };
        row.appendChild(b);
      }
      inp.closest('label').after(row);
    });
  };

  exactPoles = async function (K) {
    if (K === undefined) K = parseFloat(document.getElementById('kValue').value) || 0;
    const r = await API.poles(state.problem, K);
    if (!r.poles) return;
    const st = { stable: '안정', marginal: '임계 안정', unstable: '불안정' }[r.status];
    const near = Math.abs(r.usedK - K) > 1e-9 * Math.max(1, K) ? ` (미리보기: 가장 가까운 계산값 K = ${+r.usedK.toPrecision(6)})` : '';
    document.getElementById('kPoles').innerHTML = `K = ${+r.usedK.toPrecision(6)} → ` +
      r.poles.map((p) => esc(p.text)).join(', ') + `<span class="st ${r.status}">${st}</span>` +
      (near ? `<div class="muted small">${esc(near)}</div>` : '');
  };
})();
