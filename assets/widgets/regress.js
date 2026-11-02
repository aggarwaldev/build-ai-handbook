/* Chapter 10: fit a straight line y = w x + b to points by gradient descent on the mean squared
   error. Points can be dragged; "Solve exactly" jumps to the least-squares answer so the
   descent can be compared with it. The vertical dashed lines are the errors being squared. */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-regress');
    if (!host) return;
    var r = HB.rng(11);
    var START = [];
    for (var i = 0; i < 8; i++) {
      var x = 0.3 + i * 0.62;
      START.push({ x: x, y: 1.5 * x + 0.7 + (r() - 0.5) * 1.6 });
    }
    var pts = START.map(function (p) { return { x: p.x, y: p.y }; });
    var w = 0, b = 0, steps = 0, lr = 0.02;
    var plot = HB.Plot({ xmin: 0, xmax: 5.5, ymin: -1, ymax: 10, label: 'Points and a fitted line' });
    var lrIn = HB.el('input', { type: 'range', min: '0.002', max: '0.08', step: '0.002', value: '0.02', 'aria-label': 'learning rate' });
    var lrOut = HB.el('b');
    var stepBtn = HB.el('button', { class: 'btn primary', type: 'button', text: 'Step' });
    var runBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Run 50 steps' });
    var solveBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Solve exactly' });
    var resetBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Reset' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['learning rate = ', lrOut]), lrIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [stepBtn, runBtn, solveBtn, resetBtn]));
    host.appendChild(plot.svg);
    host.appendChild(out);

    function mse() {
      return pts.reduce(function (a, p) { var e = w * p.x + b - p.y; return a + e * e; }, 0) / pts.length;
    }
    function grads() {
      var n = pts.length, gw = 0, gb = 0;
      pts.forEach(function (p) { var e = w * p.x + b - p.y; gw += 2 * e * p.x / n; gb += 2 * e / n; });
      return { w: gw, b: gb };
    }
    function step() { var g = grads(); w -= lr * g.w; b -= lr * g.b; steps++; }
    function solve() {
      var n = pts.length;
      var mx = pts.reduce(function (a, p) { return a + p.x; }, 0) / n;
      var my = pts.reduce(function (a, p) { return a + p.y; }, 0) / n;
      var sxy = 0, sxx = 0;
      pts.forEach(function (p) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); });
      return { w: sxx ? sxy / sxx : 0, b: sxx ? my - (sxy / sxx) * mx : my };
    }
    var dragging = -1;
    function draw() {
      lrOut.textContent = HB.fmt(lr, 3);
      plot.clear();
      pts.forEach(function (p) { plot.line(p.x, p.y, p.x, w * p.x + b, 'pl-c3 pl-thin pl-dash'); });
      plot.fn(function (x) { return w * x + b; }, 'pl-c1');
      pts.forEach(function (p, i) {
        var d = plot.dot(p.x, p.y, 8, 'pl-f2 drag');
        d.addEventListener('pointerdown', function (e) { dragging = i; plot.svg.setPointerCapture(e.pointerId); e.preventDefault(); });
      });
      var g = grads(), best = solve();
      var bestW = w, bestB = b; w = best.w; b = best.b; var bestLoss = mse(); w = bestW; b = bestB;
      out.textContent =
        'steps taken: ' + steps + '\n' +
        'line: y = ' + HB.fmt(w, 3) + 'x + ' + HB.fmt(b, 3) + '\n' +
        'mean squared error = ' + HB.fmt(mse(), 4) + '   (best possible: ' + HB.fmt(bestLoss, 4) + ' at w = ' + HB.fmt(best.w, 3) + ', b = ' + HB.fmt(best.b, 3) + ')\n' +
        'gradient: dL/dw = ' + HB.fmt(g.w, 3) + ', dL/db = ' + HB.fmt(g.b, 3) +
        (Math.abs(w) > 1e3 || !isFinite(w) ? '\nDiverged: lower the learning rate and press Reset.' : '');
    }
    plot.svg.addEventListener('pointermove', function (e) {
      if (dragging < 0) return;
      var p = plot.toData(e);
      pts[dragging] = { x: HB.clamp(p.x, 0.05, 5.4), y: HB.clamp(p.y, -0.9, 9.9) };
      draw();
    });
    function stop() { dragging = -1; }
    plot.svg.addEventListener('pointerup', stop);
    plot.svg.addEventListener('pointercancel', stop);
    lrIn.addEventListener('input', function () { lr = parseFloat(lrIn.value); draw(); });
    stepBtn.addEventListener('click', function () { step(); draw(); });
    runBtn.addEventListener('click', function () { for (var k = 0; k < 50; k++) step(); draw(); });
    solveBtn.addEventListener('click', function () { var s = solve(); w = s.w; b = s.b; draw(); });
    resetBtn.addEventListener('click', function () { w = 0; b = 0; steps = 0; pts = START.map(function (p) { return { x: p.x, y: p.y }; }); draw(); });
    draw();
  });
})();
