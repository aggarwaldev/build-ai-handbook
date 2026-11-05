/* Chapter 19: training compute with C = 6 x parameters x tokens. Sliders on log scales set
   the model size and the number of training tokens; the GPU speed, utilisation and GPU count
   turn the operations into GPU-hours and days. It also shows tokens per parameter against the
   rule of thumb of about 20 for compute-optimal training, and rough memory needs. */
(function () {
  'use strict';
  var HB = window.HB;

  function big(x) {
    if (x >= 1e12) return HB.fmt(x / 1e12, 2) + ' trillion';
    if (x >= 1e9) return HB.fmt(x / 1e9, 2) + ' billion';
    if (x >= 1e6) return HB.fmt(x / 1e6, 2) + ' million';
    if (x >= 1e3) return HB.fmt(x / 1e3, 2) + ' thousand';
    return HB.fmt(x, 2);
  }
  function sci(x) {
    var e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
    return HB.fmt(m, 2) + ' × 10^' + e;
  }
  function dur(seconds) {
    if (seconds < 120) return HB.fmt(seconds, 1) + ' seconds';
    if (seconds < 7200) return HB.fmt(seconds / 60, 1) + ' minutes';
    if (seconds < 172800) return HB.fmt(seconds / 3600, 1) + ' hours';
    if (seconds < 3.15e7 * 2) return HB.fmt(seconds / 86400, 1) + ' days';
    return HB.fmt(seconds / 3.15e7, 1) + ' years';
  }

  function bytes(b) {
    if (b >= 1e12) return HB.fmt(b / 1e12, 2) + ' TB';
    if (b >= 1e9) return HB.fmt(b / 1e9, 1) + ' GB';
    if (b >= 1e6) return HB.fmt(b / 1e6, 1) + ' MB';
    return HB.fmt(b / 1e3, 1) + ' KB';
  }
  function chipTime(seconds) {
    return seconds >= 7200 ? HB.fmt(seconds / 3600, 0) + ' chip-hours' : dur(seconds) + ' of one chip';
  }

  HB.ready(function () {
    var host = document.getElementById('w-scaling');
    if (!host) return;
    function logSlider(label, min, max, value) {
      var inp = HB.el('input', { type: 'range', min: String(Math.log10(min)), max: String(Math.log10(max)), step: 'any', value: String(Math.log10(value)), 'aria-label': label });
      var o = HB.el('b');
      host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, [label + ' ', o]), inp]));
      return { inp: inp, out: o, get: function () { return Math.pow(10, parseFloat(inp.value)); } };
    }
    var N = logSlider('parameters N =', 1e5, 1e12, 7e9);
    var D = logSlider('training tokens D =', 1e6, 3e13, 2e12);
    var gpu = HB.el('select', { 'aria-label': 'GPU peak speed' });
    [[1e10, 'a laptop CPU, about 10^10 per second'], [1e14, '100 trillion per second'], [3e14, '300 trillion per second'], [1e15, '1,000 trillion per second']].forEach(function (g) {
      gpu.appendChild(HB.el('option', { value: String(g[0]), text: g[1], selected: g[0] === 3e14 }));
    });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'peak operations per second, per chip' }), gpu]));
    var util = HB.el('input', { type: 'range', min: '0.1', max: '0.7', step: '0.05', value: '0.4', 'aria-label': 'utilisation' });
    var utilOut = HB.el('b');
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['share of peak actually used ', utilOut]), util]));
    var G = logSlider('number of chips =', 1, 32768, 1024);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function draw() {
      var n = N.get(), d = D.get(), g = Math.round(G.get()), peak = parseFloat(gpu.value), u = parseFloat(util.value);
      N.out.textContent = big(n); D.out.textContent = big(d); G.out.textContent = String(g); utilOut.textContent = Math.round(u * 100) + '%';
      var C = 6 * n * d;
      var chipSeconds = C / (peak * u);
      var ratio = d / n;
      var nOpt = Math.sqrt(C / 120), dOpt = 20 * nOpt;
      out.textContent = [
        'compute C = 6 × N × D = 6 × ' + sci(n) + ' × ' + sci(d) + ' = ' + sci(C) + ' operations',
        'one chip at ' + sci(peak * u) + ' useful operations per second: ' + chipTime(chipSeconds),
        'on ' + g + ' chip' + (g === 1 ? '' : 's') + ': about ' + dur(chipSeconds / g) + ' of wall-clock time (if it scaled perfectly)',
        'tokens per parameter: ' + HB.fmt(ratio, 1) + (ratio < 15 ? '  (below the ~20 rule of thumb: more data would help)' : ratio > 30 ? '  (above ~20: more than compute-optimal, which buys a cheaper model to run)' : '  (close to the ~20 rule of thumb)'),
        'compute-optimal split of the same C (D = 20 N): N ≈ ' + big(nOpt) + ', D ≈ ' + big(dOpt),
        'memory to train with Adam in mixed precision, about 16 bytes per parameter: ' + bytes(16 * n) + ' (before activations)',
        'memory just to hold the weights for use in 16-bit numbers, 2 bytes per parameter: ' + bytes(2 * n)
      ].join('\n');
    }
    [N.inp, D.inp, G.inp, util].forEach(function (i) { i.addEventListener('input', draw); });
    gpu.addEventListener('change', draw);
    draw();
  });
})();
