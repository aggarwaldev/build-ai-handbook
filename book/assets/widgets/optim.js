/* Chapter 13: three optimisers race across a long, narrow valley,
   L(a, b) = 0.5 a^2 + 12 b^2, from the same start. Plain gradient descent zig-zags across the
   steep direction and crawls along the shallow one; momentum builds speed along the valley;
   Adam scales each direction by its own gradient history. */
(function () {
  'use strict';
  var HB = window.HB;
  function L(p) { return 0.5 * p[0] * p[0] + 12 * p[1] * p[1]; }
  function grad(p) { return [p[0], 24 * p[1]]; }
  HB.ready(function () {
    var host = document.getElementById('w-optim');
    if (!host) return;
    var START = [-4.5, 1.2];
    var lr = 0.03, beta = 0.9;
    var runs;
    var lrIn = HB.el('input', { type: 'range', min: '0.01', max: '0.09', step: '0.005', value: String(lr), 'aria-label': 'learning rate' });
    var lrOut = HB.el('b');
    var stepBtn = HB.el('button', { class: 'btn primary', type: 'button', text: 'Step' });
    var runBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Run 25 steps' });
    var resetBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Reset' });
    var plot = HB.Plot({ xmin: -5, xmax: 1.5, ymin: -1.6, ymax: 1.6, xlabel: 'a', ylabel: 'b', height: 300, label: 'Three optimisers on a narrow valley' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['learning rate (all three) = ', lrOut]), lrIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [stepBtn, runBtn, resetBtn]));
    host.appendChild(plot.svg);
    host.appendChild(HB.el('small', { text: 'Blue: plain gradient descent. Green: momentum (β = 0.9). Orange: Adam (β₁ = 0.9, β₂ = 0.999; its learning rate is the slider value × 5 so its steps are comparable).' }));
    host.appendChild(out);

    function reset() {
      runs = [
        { name: 'plain GD', cls: 'pl-c1', dot: 'pl-f1', p: START.slice(), path: [START.slice()] },
        { name: 'momentum', cls: 'pl-c2', dot: 'pl-f2', p: START.slice(), path: [START.slice()], v: [0, 0] },
        { name: 'Adam', cls: 'pl-c3', dot: 'pl-f3', p: START.slice(), path: [START.slice()], m: [0, 0], s: [0, 0], t: 0 }
      ];
      draw();
    }
    function step() {
      runs.forEach(function (r) {
        var g = grad(r.p);
        if (r.name === 'plain GD') {
          r.p = [r.p[0] - lr * g[0], r.p[1] - lr * g[1]];
        } else if (r.name === 'momentum') {
          r.v = [beta * r.v[0] + g[0], beta * r.v[1] + g[1]];
          r.p = [r.p[0] - lr * r.v[0], r.p[1] - lr * r.v[1]];
        } else {
          r.t++;
          var b1 = 0.9, b2 = 0.999, a = lr * 5;
          r.m = [b1 * r.m[0] + (1 - b1) * g[0], b1 * r.m[1] + (1 - b1) * g[1]];
          r.s = [b2 * r.s[0] + (1 - b2) * g[0] * g[0], b2 * r.s[1] + (1 - b2) * g[1] * g[1]];
          var c1 = 1 - Math.pow(b1, r.t), c2 = 1 - Math.pow(b2, r.t);
          r.p = [0, 1].map(function (k) { return r.p[k] - a * (r.m[k] / c1) / (Math.sqrt(r.s[k] / c2) + 1e-8); });
        }
        r.path.push(r.p.slice());
      });
    }
    function draw() {
      lrOut.textContent = HB.fmt(lr, 3);
      plot.clear();
      [0.5, 2, 5, 10].forEach(function (level) {
        var pts = [];
        for (var i = 0; i <= 120; i++) {
          var th = i / 120 * 2 * Math.PI;
          pts.push([Math.sqrt(2 * level) * Math.cos(th), Math.sqrt(level / 12) * Math.sin(th)]);
        }
        plot.poly(pts, 'pl-cm pl-thin');
      });
      plot.dot(0, 0, 4, 'pl-fm');
      var lines = [];
      runs.forEach(function (r) {
        var shown = r.path.filter(function (q) { return Math.abs(q[0]) < 50 && Math.abs(q[1]) < 50; });
        if (shown.length > 1) plot.poly(shown, r.cls + ' pl-thin');
        var last = shown[shown.length - 1];
        if (last) plot.dot(HB.clamp(last[0], -5, 1.5), HB.clamp(last[1], -1.6, 1.6), 6, r.dot);
        var l = L(r.p);
        lines.push((r.name + ':').padEnd(10) + ' a = ' + HB.fmt(r.p[0], 3).padStart(7) + '  b = ' + HB.fmt(r.p[1], 3).padStart(7) + '  loss = ' + (isFinite(l) && l < 1e6 ? HB.fmt(l, 4) : 'diverged'));
      });
      out.textContent = 'step ' + (runs[0].path.length - 1) + '   (the minimum is at a = 0, b = 0)\n' + lines.join('\n');
    }
    lrIn.addEventListener('input', function () { lr = parseFloat(lrIn.value); reset(); });
    stepBtn.addEventListener('click', function () { step(); draw(); });
    runBtn.addEventListener('click', function () { for (var i = 0; i < 25; i++) step(); draw(); });
    resetBtn.addEventListener('click', reset);
    reset();
  });
})();
