/* Decorative parametric surface, never root-locus data.
 * One bounded canvas, no assets/network. Only the visible intro animates.
 * Scroll uses native document flow; reduced motion renders a still surface.
 */
(function (RL) {
  'use strict';
  var sync = function () {};
  function init() {
    document.body.classList.add('scene-ready');
    var scene = document.getElementById('atmosphere');
    var canvas = document.getElementById('math-field'), ctx = canvas.getContext('2d');
    var hero = document.getElementById('screen-welcome');
    var input = document.getElementById('screen-start');
    var media = window.matchMedia('(prefers-reduced-motion: reduce)');
    var frame = 0, tick = 0, time = 0, w = 0, h = 0, px = 0, py = 0, progress = 0;
    var reduced = function () { return media.matches || document.documentElement.dataset.motion === 'reduced'; };
    // Precompute the surface: a toroidal sheet with a three-fold twist.
    var curves = [], rows = 32, samples = 144;
    for (var j = 0; j < rows; j++) {
      var points = [], v = j / rows * Math.PI * 2;
      for (var i = 0; i <= samples; i++) {
        var u = i / samples * Math.PI * 2, tube = v + 3 * u;
        var radius = 1 + 0.32 * Math.cos(tube);
        points.push([radius * Math.cos(u), radius * Math.sin(u), 0.32 * Math.sin(tube)]);
      }
      curves.push(points);
    }
    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      var scale = Math.min(w * 0.32, h * 0.34, 315);
      var ax = 0.96 + Math.sin(time * 0.17) * 0.24 + py * 0.09;
      var az = -0.38 + time * 0.045 + px * 0.07;
      var ca = Math.cos(ax), sa = Math.sin(ax), cz = Math.cos(az), sz = Math.sin(az);
      function project(p) {
        var y = p[1] * ca - p[2] * sa, z = p[1] * sa + p[2] * ca;
        var x = p[0] * cz - y * sz; y = p[0] * sz + y * cz;
        var perspective = 3.8 / (3.8 - z);
        return [w * 0.5 + x * scale * perspective, h * 0.43 + y * scale * perspective, z];
      }
      for (var r = 0; r < curves.length; r++) {
        ctx.beginPath();
        for (var q = 0; q < curves[r].length; q++) {
          var p = project(curves[r][q]);
          if (!q) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
        }
        var gleam = 0.12 + 0.14 * (0.5 + 0.5 * Math.sin(r * 0.35 + time * 0.3));
        ctx.strokeStyle = 'rgba(195,226,174,' + gleam + ')';
        ctx.lineWidth = r % 8 === 0 ? 1 : 0.65; ctx.stroke();
      }
      // Sparse travelling points suggest trajectories, without axes or numerical claims.
      for (var s = 0; s < 5; s++) {
        var index = Math.floor(((time * 0.018 + s / 5) % 1) * samples);
        var dot = project(curves[s * 6][index]);
        ctx.beginPath(); ctx.arc(dot[0], dot[1], 1.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(226,247,208,0.8)'; ctx.fill();
      }
    }
    function active() { return ctx && !document.hidden && !hero.hidden && progress < 0.98 && !reduced(); }
    function animate(now) {
      frame = 0;
      if (!active()) return;
      // Cap expensive drawing at about 30Hz; never catch up after tab suspension.
      if (!tick || now - tick >= 32) {
        time += tick ? Math.min(64, now - tick) / 1000 : 0;
        tick = now; draw();
      }
      frame = requestAnimationFrame(animate);
    }
    function wake() {
      if (active()) { if (!frame) { tick = 0; frame = requestAnimationFrame(animate); } }
      else { cancelAnimationFrame(frame); frame = 0; tick = 0; }
    }
    function update() {
      var startY = input.getBoundingClientRect().top + window.scrollY;
      progress = Math.max(0, Math.min(1, window.scrollY / Math.max(1, startY - 36)));
      scene.style.setProperty('--journey', progress.toFixed(4));
      scene.style.setProperty('--drift-x', (px * 12).toFixed(1) + 'px');
      scene.style.setProperty('--drift-y', (py * 8).toFixed(1) + 'px');
      var visible = !input.hidden && input.getBoundingClientRect().top < h * 0.82;
      if (visible || reduced()) input.classList.add('is-revealed');
      else if (progress < 0.08 && !input.contains(document.activeElement)) input.classList.remove('is-revealed');
      wake();
    }
    var scrollFrame = 0;
    function schedule() {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(function () { scrollFrame = 0; update(); });
    }
    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      var ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
      if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(); update();
    }
    sync = function () {
      cancelAnimationFrame(scrollFrame); scrollFrame = 0;
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; tick = 0; return; }
      if (reduced()) { px = 0; py = 0; draw(); input.classList.add('is-revealed'); }
      update();
    };
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch' || reduced()) return;
      px = e.clientX / w - 0.5; py = e.clientY / h - 0.5; schedule();
    }, { passive: true });
    hero.addEventListener('pointerleave', function () { px = 0; py = 0; schedule(); });
    input.addEventListener('focusin', function () {
      if (input.getBoundingClientRect().top < h * 0.9) input.classList.add('is-revealed');
    });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', sync);
    media.addEventListener('change', sync);
    resize(); sync();
  }
  RL.atmosphere = { init: init, sync: function () { sync(); } };
})(window.RL = window.RL || {});
