/* Chapter 3: compound growth. Sliders set the yearly rate and the horizon; a toggle switches
   the vertical axis between an ordinary scale and a log scale, where steady growth becomes a
   straight line. Simple (non-compounding) growth is drawn for comparison. */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-growth');
    if (!host) return;
    var start = 1000, rate = 0.07, years = 30, logScale = false;
    var rIn = HB.el('input', { type: 'range', min: '0', max: '15', step: '0.5', value: '7', 'aria-label': 'yearly rate in percent' });
    var yIn = HB.el('input', { type: 'range', min: '5', max: '50', step: '1', value: '30', 'aria-label': 'years' });
    var rOut = HB.el('b'), yOut = HB.el('b');
    var logBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Use a log scale' });
    var out = HB.el('div', { class: 'out' });
    var plot = HB.Plot({ xmin: 0, xmax: years, ymin: 0, ymax: 10000, xlabel: 'years', ylabel: 'value', label: 'Compound growth of 1,000' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['yearly rate = ', rOut]), rIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['years = ', yOut]), yIn, logBtn]));
    host.appendChild(plot.svg);
    host.appendChild(out);

    function compound(t) { return start * Math.pow(1 + rate, t); }
    function simple(t) { return start * (1 + rate * t); }

    function draw() {
      rOut.textContent = HB.fmt(rate * 100, 1) + '%';
      yOut.textContent = String(years);
      var top = compound(years);
      if (logScale) plot.setRange({ xmin: 0, xmax: years, ymin: 100, ymax: Math.max(10000, Math.pow(10, Math.ceil(Math.log10(top * 1.05)))), logy: true });
      else plot.setRange({ xmin: 0, xmax: years, ymin: 0, ymax: Math.max(2000, top * 1.1), logy: false });
      plot.clear();
      plot.fn(simple, 'pl-c3 pl-dash', 120);
      plot.fn(compound, 'pl-c1', 240);
      plot.text(years * 0.02, plot.o.logy ? plot.o.ymax / 1.6 : plot.o.ymax * 0.93, 'solid: compound    dashed: simple', 'pl-tick');
      var dbl = rate > 0 ? Math.log(2) / Math.log(1 + rate) : Infinity;
      if (isFinite(dbl) && dbl <= years) {
        plot.dot(dbl, 2000, 5, 'pl-f2');
        plot.text(dbl + years * 0.015, 2000, 'doubled', 'pl-tick');
      }
      var lines = [];
      lines.push('After ' + years + ' years at ' + HB.fmt(rate * 100, 1) + '% a year:');
      lines.push('  compound: 1,000 × ' + HB.fmt(1 + rate, 3) + '^' + years + ' = ' + Math.round(top).toLocaleString('en-GB'));
      lines.push('  simple:   1,000 × (1 + ' + HB.fmt(rate, 3) + ' × ' + years + ') = ' + Math.round(simple(years)).toLocaleString('en-GB'));
      if (isFinite(dbl)) {
        lines.push('Doubling time: ln 2 / ln(' + HB.fmt(1 + rate, 3) + ') = ' + HB.fmt(dbl, 2) + ' years' +
          (rate > 0 ? '   (rule of 72 guesses ' + HB.fmt(72 / (rate * 100), 1) + ')' : ''));
      } else lines.push('At 0% nothing grows, so it never doubles.');
      out.textContent = lines.join('\n');
      logBtn.textContent = logScale ? 'Use an ordinary scale' : 'Use a log scale';
    }
    rIn.addEventListener('input', function () { rate = parseFloat(rIn.value) / 100; draw(); });
    yIn.addEventListener('input', function () { years = parseInt(yIn.value, 10); draw(); });
    logBtn.addEventListener('click', function () { logScale = !logScale; draw(); });
    draw();
  });
})();
