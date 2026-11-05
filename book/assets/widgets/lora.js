/* Chapter 40: two calculators. The first counts what LoRA trains: a frozen d x k matrix gets an
   update A @ B with A of size d x r and B of size r x k, so r(d + k) numbers instead of d * k.
   The second softens a teacher's logits with a temperature, the soft targets of distillation. */
(function () {
  'use strict';
  var HB = window.HB;
  function n(x) { return Math.round(x).toLocaleString('en-US'); }
  function mb(params) { return (params * 2 / 1e6).toFixed(1) + ' MB'; }

  HB.ready(function () {
    var host = document.getElementById('w-lora');
    if (host) lora(host);
    var t = document.getElementById('w-softtemp');
    if (t) temperature(t);
  });

  function lora(host) {
    function num(label, value, max) { return HB.el('input', { type: 'number', min: '1', max: max, step: '1', value: value, 'aria-label': label, style: 'width:100px' }); }
    var d = num('rows d', '4096', '65536'), k = num('columns k', '4096', '65536');
    var r = HB.el('input', { type: 'range', min: '0', max: '8', step: '1', value: '3', 'aria-label': 'rank as a power of two' });
    var rOut = HB.el('b');
    var per = num('adapted matrices per layer', '4', '16'), layers = num('layers', '32', '200');
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'matrix d × k' }), d, HB.el('span', { text: '×' }), k]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['rank r = ', rOut]), r]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'matrices adapted per layer' }), per, HB.el('label', { text: 'layers' }), layers]));
    var stats = HB.el('div', { class: 'stat-grid' });
    host.appendChild(stats);
    var bar = HB.el('div', { class: 'bar-row' });
    host.appendChild(bar);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);
    function stat(a, b) { return HB.el('div', { class: 'stat' }, [HB.el('div', { class: 'k', text: a }), HB.el('div', { class: 'v', text: b })]); }
    function draw() {
      var D = Math.max(1, Number(d.value) || 1), K = Math.max(1, Number(k.value) || 1);
      var R = Math.pow(2, parseInt(r.value, 10));
      var P = Math.max(1, Number(per.value) || 1), L = Math.max(1, Number(layers.value) || 1);
      rOut.textContent = String(R);
      var full = D * K, low = R * (D + K), share = low / full;
      var totalFull = full * P * L, totalLow = low * P * L;
      stats.innerHTML = '';
      stats.appendChild(stat('one matrix, full update', n(full)));
      stats.appendChild(stat('one matrix, LoRA A and B', n(low)));
      stats.appendChild(stat('share trained', (share * 100).toFixed(share < 0.01 ? 2 : 1) + '%'));
      stats.appendChild(stat('whole adapter', n(totalLow) + ' (' + mb(totalLow) + ' at 16 bits)'));
      bar.innerHTML = '';
      bar.appendChild(HB.el('span', { text: 'trained' }));
      bar.appendChild(HB.el('div', { class: 'bar' }, [HB.el('span', { style: 'width:' + Math.max(0.5, Math.min(100, share * 100)).toFixed(2) + '%' })]));
      bar.appendChild(HB.el('span', { class: 'pct', text: (share * 100).toFixed(2) + '%' }));
      out.textContent = 'full update: d × k = ' + n(D) + ' × ' + n(K) + ' = ' + n(full) +
        '\nLoRA: r(d + k) = ' + R + ' × (' + n(D) + ' + ' + n(K) + ') = ' + n(low) +
        '\nacross ' + P + ' matrices in each of ' + L + ' layers: ' + n(totalFull) + ' weights frozen, ' + n(totalLow) + ' trained' +
        (R >= Math.min(D, K) ? '\nr is as large as the matrix: LoRA saves nothing here' : '');
    }
    [d, k, per, layers, r].forEach(function (x) { x.addEventListener('input', draw); });
    draw();
  }

  function temperature(host) {
    var LOGITS = [4, 2, 1];
    var NAMES = ['class 1', 'class 2', 'class 3'];
    var tIn = HB.el('input', { type: 'range', min: '0.25', max: '10', step: '0.25', value: '1', 'aria-label': 'temperature' });
    var tOut = HB.el('b');
    host.appendChild(HB.el('p', { class: 'hint', text: 'The teacher’s logits are 4, 2 and 1.' }));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['temperature T = ', tOut]), tIn]));
    var bars = HB.el('div');
    host.appendChild(bars);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);
    function draw() {
      var T = parseFloat(tIn.value);
      tOut.textContent = T.toFixed(2);
      var ex = LOGITS.map(function (z) { return Math.exp(z / T); });
      var sum = ex.reduce(function (a, b) { return a + b; }, 0);
      var p = ex.map(function (e) { return e / sum; });
      bars.innerHTML = '';
      p.forEach(function (v, i) {
        bars.appendChild(HB.el('div', { class: 'bar-row' }, [HB.el('span', { text: NAMES[i] }),
          HB.el('div', { class: 'bar' }, [HB.el('span', { style: 'width:' + (v * 100).toFixed(1) + '%' })]),
          HB.el('span', { class: 'pct', text: v.toFixed(4) })]));
      });
      var h = -p.reduce(function (a, v) { return a + (v > 0 ? v * Math.log2(v) : 0); }, 0);
      out.textContent = 'softmax(z / T) with z / T = ' + LOGITS.map(function (z) { return HB.fmt(z / T, 3); }).join(', ') +
        '\nentropy ' + h.toFixed(3) + ' bits (the most possible for 3 classes is ' + Math.log2(3).toFixed(3) + ')';
    }
    tIn.addEventListener('input', draw);
    draw();
  }
})();
