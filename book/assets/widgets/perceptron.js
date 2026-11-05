/* Chapter 14: the perceptron learning rule on four points. For AND (and OR) it finds a
   separating line in a few passes; for XOR it never settles, because no straight line puts
   (0,1) and (1,0) on one side and (0,0) and (1,1) on the other. */
(function () {
  'use strict';
  var HB = window.HB;
  var TABLES = { AND: [0, 0, 0, 1], OR: [0, 1, 1, 1], XOR: [0, 1, 1, 0] };
  var X = [[0, 0], [0, 1], [1, 0], [1, 1]];
  HB.ready(function () {
    var host = document.getElementById('w-perceptron');
    if (!host) return;
    var task = 'AND', w = [0, 0], b = 0, i = 0, updates = 0, cleanRun = 0, steps = 0, lr = 1;
    var sel = HB.el('select', { 'aria-label': 'logic function' });
    Object.keys(TABLES).forEach(function (k) { sel.appendChild(HB.el('option', { value: k, text: k })); });
    var stepBtn = HB.el('button', { class: 'btn primary', type: 'button', text: 'Show next point' });
    var passBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Run 10 passes' });
    var resetBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Reset' });
    var plot = HB.Plot({ xmin: -0.5, xmax: 1.5, ymin: -0.5, ymax: 1.5, xlabel: 'x₁', ylabel: 'x₂', width: 360, height: 300, label: 'Perceptron line and four points' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'learn' }), sel, stepBtn, passBtn, resetBtn]));
    host.appendChild(plot.svg);
    host.appendChild(out);

    function predict(x) { return w[0] * x[0] + w[1] * x[1] + b > 0 ? 1 : 0; }
    var lastMsg = '';
    function step() {
      var x = X[i], y = TABLES[task][i], p = predict(x);
      var err = y - p;
      if (err !== 0) {
        w = [w[0] + lr * err * x[0], w[1] + lr * err * x[1]]; b += lr * err; updates++; cleanRun = 0;
        lastMsg = 'Point (' + x + ') should be ' + y + ' but got ' + p + ': w += ' + err + '×(' + x + '), b += ' + err;
      } else { cleanRun++; lastMsg = 'Point (' + x + ') is right (' + y + '): no change'; }
      i = (i + 1) % 4; steps++;
    }
    function draw() {
      plot.clear();
      if (w[1] !== 0) plot.fn(function (x) { return -(w[0] * x + b) / w[1]; }, 'pl-c1');
      else if (w[0] !== 0) plot.line(-b / w[0], -0.5, -b / w[0], 1.5, 'pl-c1');
      X.forEach(function (x, k) {
        plot.dot(x[0], x[1], 9, TABLES[task][k] ? 'pl-f3' : 'pl-f1');
        plot.text(x[0] + 0.07, x[1] + 0.08, String(TABLES[task][k]), 'pl-tick');
      });
      var done = cleanRun >= 4;
      out.textContent =
        'rule: if prediction is wrong, w ← w + (target − prediction) × x and b ← b + (target − prediction)\n' +
        (lastMsg ? lastMsg + '\n' : '') +
        'w = (' + w[0] + ', ' + w[1] + '), b = ' + b + '   points shown: ' + steps + ', updates: ' + updates + '\n' +
        (done ? 'All four points correct: the line separates the classes.' :
          task === 'XOR' && steps >= 40 ? 'Still changing after ' + steps + ' points. It never will settle: XOR is not linearly separable.' : '');
    }
    stepBtn.addEventListener('click', function () { step(); draw(); });
    passBtn.addEventListener('click', function () { for (var k = 0; k < 40; k++) { if (cleanRun >= 4) break; step(); } draw(); });
    resetBtn.addEventListener('click', function () { w = [0, 0]; b = 0; i = 0; updates = 0; cleanRun = 0; steps = 0; lastMsg = ''; draw(); });
    sel.addEventListener('change', function () { task = sel.value; resetBtn.click(); });
    draw();
  });
})();
