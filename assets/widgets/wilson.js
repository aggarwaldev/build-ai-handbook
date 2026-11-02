/* Chapter 36: how sure is a measured error rate? k failures in n checked answers gives an observed
   rate k / n. The Wald interval (rate plus or minus z standard errors) is the textbook formula;
   the Wilson interval stays inside 0..1 and behaves for small counts. A second widget asks how many
   answers you must check for a given margin. */
(function () {
  'use strict';
  var HB = window.HB;
  var Z = { '90': 1.645, '95': 1.96, '99': 2.576 };

  function wald(k, n, z) {
    var p = k / n, half = z * Math.sqrt(p * (1 - p) / n);
    return [p - half, p + half];
  }
  function wilson(k, n, z) {
    var p = k / n, z2 = z * z;
    var centre = (p + z2 / (2 * n)) / (1 + z2 / n);
    var half = z / (1 + z2 / n) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
  }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }

  HB.ready(function () {
    var host = document.getElementById('w-wilson');
    if (host) interval(host);
    var plan = document.getElementById('w-samplesize');
    if (plan) sampleSize(plan);
  });

  function interval(host) {
    var nIn = HB.el('input', { type: 'number', min: '1', max: '100000', step: '1', value: '50', 'aria-label': 'answers checked', style: 'width:110px' });
    var kIn = HB.el('input', { type: 'number', min: '0', max: '100000', step: '1', value: '3', 'aria-label': 'answers with a hallucination', style: 'width:110px' });
    var conf = HB.el('select', { 'aria-label': 'confidence level' }, [
      HB.el('option', { value: '90', text: '90%' }), HB.el('option', { value: '95', text: '95%', selected: true }), HB.el('option', { value: '99', text: '99%' })]);
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'answers checked n' }), nIn, HB.el('label', { text: 'with a hallucination k' }), kIn, HB.el('label', { text: 'confidence' }), conf]));
    var presets = HB.el('div', { class: 'row' });
    [[3, 50], [0, 50], [5, 10], [10, 10], [30, 500]].forEach(function (p) {
      presets.appendChild(HB.el('button', { class: 'btn', type: 'button', text: p[0] + ' in ' + p[1], onclick: function () { kIn.value = String(p[0]); nIn.value = String(p[1]); draw(); } }));
    });
    host.appendChild(presets);
    var plot = HB.Plot({ width: 560, height: 150, xmin: -0.1, xmax: 0.3, ymin: 0, ymax: 3, xlabel: 'error rate', ylabel: '', grid: false, label: 'Wald and Wilson intervals on a number line' });
    host.appendChild(plot.svg);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function draw() {
      var n = Math.max(1, Math.floor(Number(nIn.value) || 1));
      var k = Math.min(n, Math.max(0, Math.floor(Number(kIn.value) || 0)));
      var z = Z[conf.value];
      var p = k / n, a = wald(k, n, z), b = wilson(k, n, z);
      var lo = Math.min(a[0], b[0], 0), hi = Math.max(a[1], b[1]);
      var span = Math.max(hi - lo, 0.02);
      plot.setRange({ xmin: lo - span * 0.08, xmax: hi + span * 0.08 });
      // The vertical axis only separates the two bars, so its tick labels are removed.
      Array.prototype.forEach.call(plot.svg.querySelectorAll('text.pl-tick[text-anchor="end"]'), function (t) { t.remove(); });
      plot.clear();
      plot.line(0, 0.2, 0, 2.9, 'pl-cm pl-thin pl-dash');
      if (hi > 1) plot.line(1, 0.2, 1, 2.9, 'pl-cm pl-thin pl-dash');
      plot.line(a[0], 2.1, a[1], 2.1, 'pl-c3');
      plot.text(a[0], 2.45, 'Wald', '', 'start');
      plot.line(b[0], 0.9, b[1], 0.9, 'pl-c1');
      plot.text(b[0], 1.25, 'Wilson', '', 'start');
      plot.dot(p, 2.1, 5, 'pl-f3');
      plot.dot(p, 0.9, 5, 'pl-f1');
      var lines = [
        'observed rate k / n = ' + k + ' / ' + n + ' = ' + pct(p) + '   (z = ' + z + ')',
        'Wald:   ' + pct(a[0]) + ' to ' + pct(a[1]) + (a[0] < 0 ? '   <- below zero: impossible for a rate' : '') + (a[1] > 1 ? '   <- above 100%: impossible' : '') + (a[1] - a[0] === 0 ? '   <- zero width: claims certainty it does not have' : ''),
        'Wilson: ' + pct(b[0]) + ' to ' + pct(b[1])
      ];
      if (k === 0 && conf.value === '95') lines.push('rule of three: with no failures in n, the 95% upper limit is about 3 / n = ' + pct(3 / n));
      out.textContent = lines.join('\n');
    }
    [nIn, kIn].forEach(function (x) { x.addEventListener('input', draw); });
    conf.addEventListener('change', draw);
    draw();
  }

  function sampleSize(host) {
    var pIn = HB.el('input', { type: 'range', min: '0.01', max: '0.5', step: '0.01', value: '0.05', 'aria-label': 'expected error rate' });
    var hIn = HB.el('input', { type: 'range', min: '0.005', max: '0.1', step: '0.005', value: '0.02', 'aria-label': 'margin either side' });
    var pOut = HB.el('b'), hOut = HB.el('b');
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['expected rate p = ', pOut]), pIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['margin either side = ', hOut]), hIn]));
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);
    function draw() {
      var p = parseFloat(pIn.value), h = parseFloat(hIn.value);
      pOut.textContent = pct(p);
      hOut.textContent = '±' + (h * 100).toFixed(1) + ' points';
      var n = 1.96 * 1.96 * p * (1 - p) / (h * h);
      out.textContent = 'n = z² × p(1 − p) / margin² = 1.96² × ' + p.toFixed(2) + ' × ' + (1 - p).toFixed(2) + ' / ' + h.toFixed(3) + '² = ' + n.toFixed(1) +
        '\nso check about ' + Math.ceil(n).toLocaleString('en-US') + ' answers (95% confidence)' +
        '\nhalving the margin needs four times as many: ' + Math.ceil(n * 4).toLocaleString('en-US');
    }
    pIn.addEventListener('input', draw);
    hIn.addEventListener('input', draw);
    draw();
  }
})();
