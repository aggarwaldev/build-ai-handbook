/* Chapter 8: mean, median, standard deviation and z-scores for a list you can edit. A button
   adds an outlier so the mean and the median can be compared; the lower strip shows the same
   numbers after normalisation (mean 0, standard deviation 1). */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-zscore');
    if (!host) return;
    var START = '4.1, 4.4, 4.0, 4.3, 4.2';
    var input = HB.el('input', { type: 'text', value: START, 'aria-label': 'numbers separated by commas', style: 'flex:1; min-width: 200px' });
    var outlier = HB.el('button', { class: 'btn', type: 'button', text: 'Add an outlier (9.5)' });
    var reset = HB.el('button', { class: 'btn', type: 'button', text: 'Reset' });
    var top = HB.svg('svg', { viewBox: '0 0 560 70', class: 'plot', role: 'img', 'aria-label': 'The numbers on a line, with the mean and the median marked' });
    var bottom = HB.svg('svg', { viewBox: '0 0 560 70', class: 'plot', role: 'img', 'aria-label': 'The same numbers as z-scores' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'numbers' }), input]));
    host.appendChild(HB.el('div', { class: 'row' }, [outlier, reset]));
    host.appendChild(HB.el('small', { text: 'raw values (blue line: mean, green line: median)' }));
    host.appendChild(top);
    host.appendChild(HB.el('small', { text: 'z-scores: (value − mean) / standard deviation' }));
    host.appendChild(bottom);
    host.appendChild(out);

    function parse() {
      return input.value.split(/[,\s]+/).map(parseFloat).filter(function (v) { return isFinite(v); }).slice(0, 40);
    }
    function strip(svgEl, values, lo, hi, marks) {
      svgEl.innerHTML = '';
      var x = function (v) { return 20 + (v - lo) / (hi - lo || 1) * 520; };
      svgEl.appendChild(HB.svg('line', { x1: 20, x2: 540, y1: 40, y2: 40, class: 'pl-axis' }));
      [lo, (lo + hi) / 2, hi].forEach(function (t) {
        svgEl.appendChild(HB.svg('text', { x: x(t), y: 64, class: 'pl-tick', 'text-anchor': 'middle', text: HB.fmt(t, 2) }));
      });
      (marks || []).forEach(function (m) {
        svgEl.appendChild(HB.svg('line', { x1: x(m.v), x2: x(m.v), y1: 10, y2: 48, class: 'pl-line pl-thin ' + m.cls }));
      });
      values.forEach(function (v) {
        svgEl.appendChild(HB.svg('circle', { cx: x(v), cy: 32, r: 6, class: 'pl-dot pl-f3' }));
      });
    }
    function draw() {
      var xs = parse();
      if (xs.length < 2) { out.textContent = 'Enter at least two numbers.'; top.innerHTML = ''; bottom.innerHTML = ''; return; }
      var n = xs.length;
      var mean = xs.reduce(function (a, b) { return a + b; }, 0) / n;
      var sorted = xs.slice().sort(function (a, b) { return a - b; });
      var median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      var devs = xs.map(function (v) { return v - mean; });
      var variance = devs.reduce(function (a, d) { return a + d * d; }, 0) / n;
      var sd = Math.sqrt(variance);
      var zs = xs.map(function (v) { return sd ? (v - mean) / sd : 0; });
      var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
      var pad = (hi - lo) * 0.08 || 1;
      strip(top, xs, lo - pad, hi + pad, [{ v: mean, cls: 'pl-c1' }, { v: median, cls: 'pl-c4' }]);
      strip(bottom, zs, -3, 3, [{ v: 0, cls: 'pl-c1' }]);
      out.textContent =
        'n = ' + n + '\n' +
        'mean = (' + xs.map(function (v) { return HB.fmt(v, 2); }).join(' + ') + ') / ' + n + ' = ' + HB.fmt(mean, 3) + '\n' +
        'median (middle of the sorted list) = ' + HB.fmt(median, 3) + '\n' +
        'variance = average of (value − mean)² = ' + HB.fmt(variance, 4) + '\n' +
        'standard deviation = √variance = ' + HB.fmt(sd, 4) + '\n' +
        'z-scores: ' + zs.map(function (z) { return HB.fmt(z, 2); }).join(', ') +
        (zs.some(function (z) { return Math.abs(z) > 1.9; }) ? '\nOne value sits about 2 standard deviations out: a likely outlier.' : '');
    }
    input.addEventListener('input', draw);
    outlier.addEventListener('click', function () { input.value = input.value.replace(/\s*$/, '') + ', 9.5'; draw(); });
    reset.addEventListener('click', function () { input.value = START; draw(); });
    draw();
  });
})();
