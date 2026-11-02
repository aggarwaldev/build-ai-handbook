/* Chapters 9 and 16: softmax with temperature, cross-entropy and entropy. Mounts on every
   element with class "w-softmax". Optional data attributes:
     data-labels="Paris,Lyon,London,a"   data-logits="4,2,1.5,0.5"   data-target="0"
     data-mode="loss" (show cross-entropy and the gradient) or "sample" (show sampling draws). */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    Array.prototype.forEach.call(document.querySelectorAll('.w-softmax'), mount);
  });

  function softmax(z, T) {
    var m = Math.max.apply(null, z);
    var e = z.map(function (v) { return Math.exp((v - m) / T); });
    var s = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (v) { return v / s; });
  }

  function mount(host) {
    var labels = (host.getAttribute('data-labels') || 'cat,dog,bird').split(',');
    var logits = (host.getAttribute('data-logits') || '2,1,0.1').split(',').map(parseFloat);
    var target = parseInt(host.getAttribute('data-target') || '0', 10);
    var mode = host.getAttribute('data-mode') || 'loss';
    var T = 1;
    var rand = HB.rng(7);
    var draws = labels.map(function () { return 0; }), nDraws = 0;

    var inputs = HB.el('div', { class: 'row' });
    var logitIns = logits.map(function (v, i) {
      var inp = HB.el('input', { type: 'number', step: '0.1', value: String(v), 'aria-label': 'score for ' + labels[i] });
      inp.addEventListener('input', function () { logits[i] = parseFloat(inp.value) || 0; resetDraws(); draw(); });
      inputs.appendChild(HB.el('label', null, [labels[i] + ' ', inp]));
      return inp;
    });
    host.appendChild(HB.el('p', { class: 'hint', text: 'Raw scores (logits). Edit any of them:' }));
    host.appendChild(inputs);
    var tIn = HB.el('input', { type: 'range', min: '0.1', max: '3', step: '0.05', value: '1', 'aria-label': 'temperature' });
    var tOut = HB.el('b');
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['temperature T = ', tOut]), tIn]));
    var tSel = null;
    if (mode === 'loss') {
      tSel = HB.el('select', { 'aria-label': 'correct answer' });
      labels.forEach(function (l, i) { tSel.appendChild(HB.el('option', { value: String(i), text: l, selected: i === target })); });
      host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'correct answer' }), tSel]));
      tSel.addEventListener('change', function () { target = parseInt(tSel.value, 10); draw(); });
    }
    var bars = HB.el('div');
    host.appendChild(bars);
    var sampleBtn = null;
    if (mode === 'sample') {
      sampleBtn = HB.el('button', { class: 'btn primary', type: 'button', text: 'Sample 100 tokens' });
      var clearBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Clear' });
      host.appendChild(HB.el('div', { class: 'row' }, [sampleBtn, clearBtn]));
      sampleBtn.addEventListener('click', function () {
        var p = softmax(logits, T);
        for (var k = 0; k < 100; k++) {
          var u = rand(), acc = 0;
          for (var i = 0; i < p.length; i++) { acc += p[i]; if (u < acc || i === p.length - 1) { draws[i]++; break; } }
        }
        nDraws += 100;
        draw();
      });
      clearBtn.addEventListener('click', function () { resetDraws(); draw(); });
    }
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function resetDraws() { draws = labels.map(function () { return 0; }); nDraws = 0; }
    function draw() {
      tOut.textContent = HB.fmt(T, 2);
      var p = softmax(logits, T);
      bars.innerHTML = '';
      p.forEach(function (pi, i) {
        var fill = HB.el('span', { style: 'width:' + (pi * 100).toFixed(1) + '%' });
        var label = labels[i] + (mode === 'loss' && i === target ? ' ✓' : '');
        var extra = mode === 'sample' && nDraws ? '  drawn ' + draws[i] : '';
        bars.appendChild(HB.el('div', { class: 'bar-row' }, [HB.el('span', { text: label }), HB.el('div', { class: 'bar' }, [fill]), HB.el('span', { class: 'pct', text: HB.fmt(pi * 100, 1) + '%' + extra })]));
      });
      var m = Math.max.apply(null, logits);
      var ex = logits.map(function (v) { return Math.exp((v - m) / T); });
      var sum = ex.reduce(function (a, b) { return a + b; }, 0);
      var H = -p.reduce(function (a, q) { return a + (q > 0 ? q * Math.log(q) : 0); }, 0);
      var lines = [
        'scores / T:      ' + logits.map(function (v) { return HB.fmt(v / T, 3); }).join(', '),
        'exp(score/T − max):  ' + ex.map(function (v) { return HB.fmt(v, 4); }).join(', ') + '   sum = ' + HB.fmt(sum, 4),
        'probabilities:   ' + p.map(function (v) { return HB.fmt(v, 4); }).join(', '),
        'entropy H = −Σ p ln p = ' + HB.fmt(H, 4) + ' nats = ' + HB.fmt(H / Math.LN2, 4) + ' bits   (most possible for ' + p.length + ' choices: ln ' + p.length + ' = ' + HB.fmt(Math.log(p.length), 4) + ')'
      ];
      if (mode === 'loss') {
        lines.push('cross-entropy loss = −ln p(' + labels[target] + ') = −ln ' + HB.fmt(p[target], 4) + ' = ' + HB.fmt(-Math.log(p[target]), 4));
        lines.push('gradient for each score = p − (1 for the correct answer, else 0): ' + p.map(function (v, i) { return HB.fmt(v - (i === target ? 1 : 0), 3); }).join(', '));
      }
      if (mode === 'sample' && nDraws) lines.push(nDraws + ' samples drawn so far');
      out.textContent = lines.join('\n');
    }
    tIn.addEventListener('input', function () { T = parseFloat(tIn.value); resetDraws(); draw(); });
    draw();
    void logitIns;
  }
})();
