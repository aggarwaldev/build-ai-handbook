/* Chapter 6: a ball rolling downhill by gradient descent. Choose a curve and a learning rate,
   click the curve to place the ball, then step. The table shows every update
   w_new = w - rate * slope, so a diverging or stuck run can be read number by number. */
(function () {
  'use strict';
  var HB = window.HB;
  var CURVES = {
    bowl: { label: 'L(w) = (w − 3)² + 1', f: function (w) { return (w - 3) * (w - 3) + 1; }, d: function (w) { return 2 * (w - 3); }, range: { xmin: -2, xmax: 8, ymin: 0, ymax: 26 }, start: 0 },
    bumpy: { label: 'L(w) = 0.1w⁴ − w² + 0.5w + 3', f: function (w) { return 0.1 * Math.pow(w, 4) - w * w + 0.5 * w + 3; }, d: function (w) { return 0.4 * Math.pow(w, 3) - 2 * w + 0.5; }, range: { xmin: -3.6, xmax: 3.6, ymin: -1, ymax: 8 }, start: 3 }
  };
  HB.ready(function () {
    var host = document.getElementById('w-gdescent');
    if (!host) return;
    var key = 'bowl', lr = 0.1, w = CURVES.bowl.start, history = [];
    var sel = HB.el('select', { 'aria-label': 'loss curve' });
    Object.keys(CURVES).forEach(function (k) { sel.appendChild(HB.el('option', { value: k, text: CURVES[k].label })); });
    var RATES = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 0.9, 1, 1.05, 1.1, 1.2];
    var lrIn = HB.el('input', { type: 'range', min: '0', max: String(RATES.length - 1), step: '1', value: '4', 'aria-label': 'learning rate' });
    var lrOut = HB.el('b');
    var stepBtn = HB.el('button', { class: 'btn primary', type: 'button', text: 'Step' });
    var runBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Run 20 steps' });
    var resetBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Reset' });
    var plot = HB.Plot({ xlabel: 'w', ylabel: 'loss', label: 'Gradient descent on a loss curve' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'loss curve' }), sel]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['learning rate = ', lrOut]), lrIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [stepBtn, runBtn, resetBtn]));
    host.appendChild(plot.svg);
    host.appendChild(HB.el('p', { class: 'hint', text: 'Click anywhere on the plot to drop the ball at that w.' }));
    host.appendChild(out);

    function lrFromSlider() { return RATES[parseInt(lrIn.value, 10)]; }
    function reset(startW) {
      var C = CURVES[key];
      w = startW === undefined ? C.start : startW;
      history = [{ w: w, L: C.f(w) }];
      draw();
    }
    function step() {
      var C = CURVES[key];
      var g = C.d(w);
      var nw = w - lr * g;
      history[history.length - 1].g = g;
      history[history.length - 1].step = -lr * g;
      w = nw;
      history.push({ w: w, L: C.f(w) });
      if (history.length > 200) history.shift();
    }
    function draw() {
      var C = CURVES[key];
      lrOut.textContent = HB.fmt(lr, 3);
      plot.clear();
      plot.fn(C.f, 'pl-c1');
      var pts = history.filter(function (p) { return isFinite(p.w) && Math.abs(p.w) < 1e6; });
      pts.forEach(function (p, i) {
        if (i > 0) plot.line(pts[i - 1].w, C.f(pts[i - 1].w), p.w, C.f(p.w), 'pl-c3 pl-thin pl-dash');
      });
      pts.forEach(function (p, i) { plot.dot(p.w, C.f(p.w), i === pts.length - 1 ? 8 : 4, i === pts.length - 1 ? 'pl-f2' : 'pl-fm'); });
      var g = C.d(w);
      var rows = ['step      w        loss      slope    −rate×slope'];
      var shown = history.slice(-8);
      var first = history.length - shown.length;
      shown.forEach(function (p, i) {
        rows.push(String(first + i).padStart(4) + ' ' + fmtCol(p.w) + ' ' + fmtCol(p.L) + ' ' + (p.g === undefined ? fmtCol(g) : fmtCol(p.g)) + ' ' + (p.step === undefined ? '' : fmtCol(p.step)));
      });
      var status;
      if (!isFinite(w) || Math.abs(w) > 1e3) status = 'Diverged: each step overshot by more than the last. Lower the learning rate.';
      else if (Math.abs(g) < 1e-3) status = 'Slope ≈ 0: the ball has settled at w = ' + HB.fmt(w, 3) + (key === 'bumpy' && w > 0 ? '. This is a local minimum; the deeper valley is on the left.' : '.');
      else if (history.length > 3 && Math.sign(history[history.length - 2].step || 0) !== Math.sign(history[history.length - 3].step || 0)) status = 'The steps change sign: the ball is bouncing across the valley.';
      else status = 'Next update: w = ' + HB.fmt(w, 3) + ' − ' + HB.fmt(lr, 3) + ' × ' + HB.fmt(g, 3) + ' = ' + HB.fmt(w - lr * g, 3);
      out.textContent = rows.join('\n') + '\n\n' + status;
    }
    function fmtCol(v) {
      if (!isFinite(v)) return '      inf';
      var s = Math.abs(v) >= 1e5 ? v.toExponential(2) : v.toFixed(3);
      return s.padStart(9);
    }
    lr = lrFromSlider();
    sel.addEventListener('change', function () { key = sel.value; plot.setRange(CURVES[key].range); reset(); });
    lrIn.addEventListener('input', function () { lr = lrFromSlider(); draw(); });
    stepBtn.addEventListener('click', function () { step(); draw(); });
    runBtn.addEventListener('click', function () { for (var i = 0; i < 20; i++) step(); draw(); });
    resetBtn.addEventListener('click', function () { reset(); });
    plot.svg.addEventListener('click', function (e) {
      var p = plot.toData(e);
      var C = CURVES[key];
      reset(HB.clamp(p.x, C.range.xmin, C.range.xmax));
    });
    plot.setRange(CURVES[key].range);
    reset();
  });
})();
