/* Engine-generated example tour. Each scene takes 20s; user input takes priority.
 * Pause, reduced motion, offscreen and hidden-page states share one clock.
 */
(function (RL) {
  'use strict';
  function PreviewTour(graph, examples) {
    var self = this, svg = graph.svg, panel = document.querySelector('.start-right');
    var caption = document.getElementById('preview-caption'), equation = document.getElementById('preview-equation');
    var phaseText = document.getElementById('preview-phase'), play = document.getElementById('preview-play');
    var tour = document.getElementById('preview-tour'), media = matchMedia('(prefers-reduced-motion: reduce)');
    var mode = 'tour', paused = false, frame = 0, previous = 0, elapsed = 0, phase = -1, current = null;
    var bag = [], last = -1, fade = false, lastK = 0, lastReduced = null, inputResult = null;
    function reduced() { return media.matches || document.documentElement.dataset.motion === 'reduced'; }
    function visible() {
      var rect = panel.getBoundingClientRect();
      return !document.hidden && !document.getElementById('screen-start').hidden && rect.bottom > 0 && rect.top < innerHeight;
    }
    function animations(run) {
      svg.getAnimations({subtree:true}).forEach(function (a) { if (run) a.play(); else a.pause(); });
    }
    function cancel() { cancelAnimationFrame(frame); frame = 0; previous = 0; animations(false); }
    function controls() {
      play.hidden = mode !== 'tour'; tour.hidden = mode === 'tour';
      play.textContent = reduced() ? '다음 예제' : paused ? '계속 보기' : '잠시 멈춤';
      play.setAttribute('aria-pressed', String(paused));
      panel.dataset.previewMode = mode;
    }
    function nextIndex() {
      if (!bag.length) {
        for (var i = 0; i < examples.length; i++) bag.push(i);
        for (var j = bag.length - 1; j > 0; j--) {
          var k = Math.floor(Math.random() * (j + 1)), tmp = bag[j]; bag[j] = bag[k]; bag[k] = tmp;
        }
        if (bag[bag.length - 1] === last && bag.length > 1) { var swap = bag[0]; bag[0] = bag[bag.length - 1]; bag[bag.length - 1] = swap; }
      }
      last = bag.pop(); return last;
    }
    function scene() {
      var ex = examples[nextIndex()], parsed = RL.parser.parse(ex.input);
      current = RL.locus.analyze(parsed.N, parsed.D);
      graph.stop(); graph.setProblem(current);
      caption.textContent = '예제 둘러보기 · ' + ex.label;
      equation.textContent = ex.input;
      svg.setAttribute('aria-label', ex.label + ' 근궤적 예제 (입력한 식과 별개)');
      elapsed = 0; phase = -1; lastK = 0; fade = false; panel.classList.remove('preview-fading');
      if (reduced()) { graph.show(8, false); phaseText.textContent = '완성된 근궤적 · 움직임 줄이기'; }
      else showPhase(0);
    }
    function showPhase(next) {
      phase = next;
      var steps = [2, 4, 8, 9], labels = ['극점과 영점에서 시작합니다.', '점근선으로 향하는 방향을 살펴봅니다.', '계산된 가지를 천천히 이어 봅니다.', 'K 변화에 따라 폐루프 극점이 이동합니다.'];
      graph.show(steps[next], next !== 3);
      svg.getAnimations({subtree:true}).forEach(function (a) { a.playbackRate = 0.55; });
      phaseText.textContent = labels[next];
    }
    function tick(now) {
      frame = 0;
      if (mode !== 'tour' || paused || reduced() || !visible()) { cancel(); return; }
      if (!current) scene();
      elapsed += previous ? Math.min(80, now - previous) : 0; previous = now;
      var next = elapsed < 3500 ? 0 : elapsed < 7500 ? 1 : elapsed < 13000 ? 2 : 3;
      if (phase !== next) showPhase(next);
      if (phase === 3 && now - lastK > 50) {
        var notable = RL.content.notableK(current), upper = notable.length ? notable[notable.length - 1].K * 1.25 : 8;
        var t = Math.min(1, (elapsed - 13000) / 5000), eased = t * t * (3 - 2 * t), K = upper * eased;
        graph.setK(K, true); phaseText.textContent = 'K = ' + RL.format.numShort(K) + ' · 폐루프 극점의 이동'; lastK = now;
      }
      if (elapsed >= 18500 && !fade) { fade = true; panel.classList.add('preview-fading'); }
      if (elapsed >= 20000) scene();
      frame = requestAnimationFrame(tick);
    }
    this.sync = function () {
      controls();
      var r = reduced();
      if (r !== lastReduced) {
        lastReduced = r;
        if (mode === 'tour' && current) {
          graph.show(8, false); phaseText.textContent = r ? '완성된 근궤적 · 움직임 줄이기' : '완성된 근궤적';
          elapsed = 18500; phase = 3; fade = false; panel.classList.remove('preview-fading');
        }
      }
      if (mode !== 'tour' || paused || r || !visible()) {
        cancel();
        if (r && mode === 'tour' && !current && visible()) scene();
        return;
      }
      if (!frame) { previous = 0; animations(true); frame = requestAnimationFrame(tick); }
    };
    this.follow = function () {
      mode = 'input'; cancel(); graph.stop(); panel.classList.remove('preview-fading'); controls();
    };
    this.input = function (res) {
      inputResult = res;
      if (mode !== 'input') return;
      caption.textContent = '입력한 식 · 극점과 영점'; equation.textContent = '';
      svg.setAttribute('aria-label', '입력한 식의 극점과 영점');
      graph.stop();
      if (!res) { graph.res = null; svg.innerHTML = ''; phaseText.textContent = '식을 확인하면 미리보기가 나타납니다.'; return; }
      graph.setProblem(res); graph.show(2, false); phaseText.textContent = '입력한 식을 확인하고 탐구를 시작해 보세요.';
    };
    this.resize = function () {
      if (mode === 'input') { self.input(inputResult); return; }
      if (current) { graph.setProblem(current); graph.show(8, false); elapsed = 18500; phase = 3; }
    };
    play.onclick = function () { if (reduced()) scene(); else paused = !paused; self.sync(); };
    tour.onclick = function () { mode = 'tour'; paused = false; current = null; bag = []; self.sync(); };
    new IntersectionObserver(function () { self.sync(); }, {threshold:[0,0.1]}).observe(panel);
    document.addEventListener('visibilitychange', self.sync);
    media.addEventListener('change', self.sync);
    controls();
  }
  RL.PreviewTour = PreviewTour;
})(window.RL = window.RL || {});
