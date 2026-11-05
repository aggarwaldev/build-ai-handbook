/* Chapter 5: the slope of a curve. Pick a function, slide the point x and the gap h. The
   dashed secant through x and x + h approaches the tangent as h shrinks; the readout compares
   rise-over-run with the exact derivative. */
(function () {
  'use strict';
  var HB = window.HB;
  var FUNCS = {
    square: { label: 'f(x) = x²', f: function (x) { return x * x; }, d: function (x) { return 2 * x; }, dText: "f'(x) = 2x", range: { xmin: -3, xmax: 3, ymin: -2, ymax: 9 } },
    cubic: { label: 'f(x) = x³ − 3x', f: function (x) { return x * x * x - 3 * x; }, d: function (x) { return 3 * x * x - 3; }, dText: "f'(x) = 3x² − 3", range: { xmin: -2.5, xmax: 2.5, ymin: -5, ymax: 5 } },
    exp: { label: 'f(x) = eˣ', f: Math.exp, d: Math.exp, dText: "f'(x) = eˣ", range: { xmin: -3, xmax: 2.2, ymin: -1, ymax: 9 } },
    sigmoid: { label: 'f(x) = σ(x) = 1 / (1 + e⁻ˣ)', f: function (x) { return 1 / (1 + Math.exp(-x)); }, d: function (x) { var s = 1 / (1 + Math.exp(-x)); return s * (1 - s); }, dText: "f'(x) = σ(x)(1 − σ(x))", range: { xmin: -6, xmax: 6, ymin: -0.2, ymax: 1.2 } }
  };
  HB.ready(function () {
    var host = document.getElementById('w-tangent');
    if (!host) return;
    var key = 'square', x = 1, h = 1;
    var sel = HB.el('select', { 'aria-label': 'function' });
    Object.keys(FUNCS).forEach(function (k) { sel.appendChild(HB.el('option', { value: k, text: FUNCS[k].label })); });
    var xIn = HB.el('input', { type: 'range', min: '-2.5', max: '2.5', step: '0.05', value: '1', 'aria-label': 'x' });
    var hIn = HB.el('input', { type: 'range', min: '0', max: '100', step: '1', value: '100', 'aria-label': 'gap h' });
    var xOut = HB.el('b'), hOut = HB.el('b');
    var plot = HB.Plot({ label: 'Tangent line to a curve' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'function' }), sel]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['x = ', xOut]), xIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['gap h = ', hOut]), hIn]));
    host.appendChild(plot.svg);
    host.appendChild(out);

    function setFunc() {
      var F = FUNCS[key];
      plot.setRange(F.range);
      xIn.min = String(F.range.xmin + 0.3); xIn.max = String(F.range.xmax - 0.3);
      x = HB.clamp(x, F.range.xmin + 0.3, F.range.xmax - 0.3); xIn.value = String(x);
    }
    function draw() {
      var F = FUNCS[key];
      // h runs from 1 down to 0.001 on a log scale so small gaps are reachable
      h = Math.pow(10, -3 + 3 * parseInt(hIn.value, 10) / 100);
      xOut.textContent = HB.fmt(x, 2);
      hOut.textContent = HB.fmt(h, 4);
      plot.clear();
      plot.fn(F.f, 'pl-c1');
      var y0 = F.f(x), slope = F.d(x), y1 = F.f(x + h);
      var sec = (y1 - y0) / h;
      plot.fn(function (t) { return y0 + slope * (t - x); }, 'pl-c2 pl-thin');
      plot.fn(function (t) { return y0 + sec * (t - x); }, 'pl-c3 pl-thin pl-dash');
      plot.dot(x, y0, 6, 'pl-f2');
      plot.dot(x + h, y1, 5, 'pl-f3');
      out.textContent =
        F.label + '   at x = ' + HB.fmt(x, 2) + ',  f(x) = ' + HB.fmt(y0, 4) + '\n' +
        'secant (dashed): [f(x + h) − f(x)] / h = (' + HB.fmt(y1, 4) + ' − ' + HB.fmt(y0, 4) + ') / ' + HB.fmt(h, 4) + ' = ' + HB.fmt(sec, 4) + '\n' +
        'tangent (solid): ' + F.dText + ' = ' + HB.fmt(slope, 4) + '\n' +
        'gap between them: ' + HB.fmt(Math.abs(sec - slope), 5) + (Math.abs(slope) < 0.02 ? '\nThe slope is about zero here: a flat spot (a minimum, a maximum or a plateau).' : '');
    }
    sel.addEventListener('change', function () { key = sel.value; setFunc(); draw(); });
    xIn.addEventListener('input', function () { x = parseFloat(xIn.value); draw(); });
    hIn.addEventListener('input', draw);
    setFunc();
    draw();
  });
})();
