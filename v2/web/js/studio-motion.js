// studio-motion.js — 그래프 도구의 재생·집중 보기·움직임 줄이기를 담당합니다.
// 입력: PlaneGraph, 계산된 K의 인덱스를 선택할 함수, 재생 종료 후 검산할 함수.
// 동작: Python이 준 K 배열을 순서대로 선택 → 화면 갱신 → 종료할 때만 검산 요청.
// 이 파일은 근·전달함수·안정성을 계산하거나 프레임마다 서버에 요청하지 않습니다.
class StudioMotion {
  constructor(graph, onSample, onSettled) {
    this.graph = graph;
    this.onSample = onSample;
    this.onSettled = onSettled;
    this.playing = false;
    this.raf = null;
    this.panelAnimations = [];
    this.card = document.querySelector('.graph-card');
    this.playButton = document.getElementById('playK');
    this.replayButton = document.getElementById('replayGraph');
    this.focusButton = document.getElementById('focusGraph');
    this.motionInput = document.getElementById('reduceMotion');
    this.media = matchMedia('(prefers-reduced-motion: reduce)');
    this.motionInput.checked = this.media.matches;
    graph.onProgress = (value) => {
      document.getElementById('traceProgress').style.transform = 'scaleX(' + value + ')';
    };
    this.replayButton.onclick = () => { this.stopK(false); graph.animateStep(); };
    this.playButton.onclick = () => {
      if (this.playing) this.stopK(true); else this.playK();
    };
    this.focusButton.onclick = () => {
      const focused = document.body.classList.toggle('focus-mode');
      this.focusButton.setAttribute('aria-pressed', String(focused));
      this.focusButton.textContent = focused ? '학습 화면 복귀' : '그래프 집중';
      // ResizeObserver가 새 크기에 맞춰 가로·세로를 동일 축척으로 다시 그립니다.
    };
    this.motionInput.onchange = () => this.applyMotionPreference();
    this.media.addEventListener('change', () => {
      if (this.media.matches) this.motionInput.checked = true;
      this.applyMotionPreference();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopK(false);
        graph.stopAnimation(); graph.draw();
        this.cancelPanelAnimations();
      }
    });
    this.applyMotionPreference();
  }

  applyMotionPreference() {
    this.graph.reducedMotion = this.media.matches || this.motionInput.checked;
    this.motionInput.checked = this.graph.reducedMotion;
    this.playButton.disabled = this.graph.reducedMotion;
    this.replayButton.disabled = this.graph.reducedMotion || this.graph.step < 2 || this.graph.step > 8;
    this.playButton.title = this.graph.reducedMotion ? '움직임 줄이기 설정에서는 슬라이더와 직접 입력을 이용하세요.' : '';
    if (this.graph.reducedMotion) {
      this.stopK(false);
      this.graph.stopAnimation(); this.graph.draw();
      this.cancelPanelAnimations();
    }
  }

  setStep(n) {
    this.stopK(false);
    const titles = [
      '좌표에서 시작하기', '출발점과 도착점', '실수축 위의 길', '무한대로 향하는 방향',
      '갈라지고 만나는 지점', '극점에서 떠나는 각도', '안정의 경계', '하나의 근궤적으로', 'K가 만드는 움직임',
    ];
    document.getElementById('graphScene').textContent = titles[n - 1];
    this.replayButton.disabled = n < 2 || n > 8 || this.graph.reducedMotion;
    this.graph.setStep(n);
    this.cancelPanelAnimations();
    if (!this.graph.reducedMotion && !document.hidden) {
      // 제목과 풀이 패널만 짧게 이동합니다. 수학 그래프 전체는 이동·회전시키지 않습니다.
      for (const node of document.querySelectorAll('.step-head, .col-right > .card')) {
        if (typeof node.animate !== 'function') continue;
        this.panelAnimations.push(node.animate(
          [{ opacity: .45, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 280, easing: 'cubic-bezier(.2,.7,.3,1)' }
        ));
      }
    }
  }

  cancelPanelAnimations() {
    for (const animation of this.panelAnimations) animation.cancel();
    this.panelAnimations = [];
  }

  // 입력: 없음. 출력: onSample(index). 표본 사이 가짜 극점은 만들지 않습니다.
  // 재생 시간은 시연용 시간이며, 실제 물리 시간이나 K의 선형 변화율을 뜻하지 않습니다.
  playK() {
    const g = this.graph, count = g.data?.K.length || 0;
    if (this.playing || count < 2 || g.step < 8 || g.reducedMotion || document.hidden) return;
    g.stopAnimation();
    const first = g.kIndex === null || g.kIndex >= count - 1 ? 0 : g.kIndex;
    let started = null, previous = -1;
    this.playing = true;
    this.playButton.textContent = '일시 정지';
    this.playButton.setAttribute('aria-pressed', 'true');
    this.card.classList.add('is-playing');
    const tick = (now) => {
      if (!this.playing) return;
      if (document.hidden || g.reducedMotion) { this.stopK(false); return; }
      if (started === null) started = now;
      const u = Math.min(1, (now - started) / 8000);
      const index = Math.min(count - 1, first + Math.floor(u * (count - 1 - first)));
      if (index !== previous) { this.onSample(index); previous = index; }
      if (u < 1) this.raf = requestAnimationFrame(tick);
      else this.stopK(true);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopK(verify = false) {
    const wasPlaying = this.playing;
    this.playing = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.playButton.textContent = 'K 재생';
    this.playButton.setAttribute('aria-pressed', 'false');
    this.card.classList.remove('is-playing');
    if (wasPlaying && verify) this.onSettled();
  }

  reset() {
    this.stopK(false);
    this.graph.stopAnimation();
    this.cancelPanelAnimations();
    document.body.classList.remove('focus-mode');
    this.focusButton.setAttribute('aria-pressed', 'false');
    this.focusButton.textContent = '그래프 집중';
  }
}
