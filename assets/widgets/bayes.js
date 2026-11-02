/* Chapter 7: Bayes' rule with 1,000 messages drawn as dots. Sliders set how common the bad
   messages are (the base rate), how many of them a checker catches (recall) and how many good
   messages it wrongly flags (false positive rate). The readout is the chance a flagged message
   really is bad. */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-bayes');
    if (!host) return;
    var COLS = 40, ROWS = 25, N = COLS * ROWS, CELL = 13;
    var base = 0.01, recall = 0.95, fpr = 0.05;
    function slider(label, min, max, step, value, fmt, onInput) {
      var inp = HB.el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      var b = HB.el('b');
      host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, [label + ' = ', b]), inp]));
      function show() { b.textContent = fmt(parseFloat(inp.value)); }
      inp.addEventListener('input', function () { onInput(parseFloat(inp.value)); show(); draw(); });
      show();
      return inp;
    }
    slider('bad messages (base rate)', 0.1, 50, 0.1, base * 100, function (v) { return HB.fmt(v, 1) + '%'; }, function (v) { base = v / 100; });
    slider('bad ones caught (recall)', 50, 100, 1, recall * 100, function (v) { return HB.fmt(v, 0) + '%'; }, function (v) { recall = v / 100; });
    slider('good ones flagged (false positive rate)', 0, 20, 0.5, fpr * 100, function (v) { return HB.fmt(v, 1) + '%'; }, function (v) { fpr = v / 100; });
    var grid = HB.svg('svg', { viewBox: '0 0 ' + (COLS * CELL) + ' ' + (ROWS * CELL), class: 'plot grid-dots', role: 'img', 'aria-label': '1,000 messages coloured by outcome' });
    var cells = [];
    for (var i = 0; i < N; i++) {
      var r = HB.svg('rect', { x: (i % COLS) * CELL + 1.5, y: Math.floor(i / COLS) * CELL + 1.5, width: CELL - 3, height: CELL - 3, rx: 2 });
      grid.appendChild(r);
      cells.push(r);
    }
    var legend = HB.el('div', { class: 'chips' });
    [['dot-a', 'bad, flagged'], ['dot-b', 'bad, missed'], ['dot-fp', 'good, flagged by mistake'], ['dot-n', 'good, passed']].forEach(function (l) {
      var sw = HB.svg('svg', { viewBox: '0 0 10 10', width: 12, height: 12, class: 'grid-dots' }, [HB.svg('rect', { width: 10, height: 10, rx: 2, class: l[0] })]);
      legend.appendChild(HB.el('span', { class: 'chip' }, [sw, ' ' + l[1]]));
    });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(grid);
    host.appendChild(legend);
    host.appendChild(out);

    function draw() {
      var bad = Math.round(N * base);
      var tp = Math.round(bad * recall), fn = bad - tp;
      var good = N - bad;
      var fp = Math.round(good * fpr), tn = good - fp;
      for (var i = 0; i < N; i++) {
        var cls = i < tp ? 'dot-a' : i < bad ? 'dot-b' : i < bad + fp ? 'dot-fp' : 'dot-n';
        cells[i].setAttribute('class', cls);
      }
      var flagged = tp + fp;
      var ppv = flagged ? tp / flagged : 0;
      out.textContent =
        'Of 1,000 messages: ' + bad + ' bad, ' + good + ' good.\n' +
        'Flagged: ' + tp + ' bad (caught) + ' + fp + ' good (false alarms) = ' + flagged + '\n' +
        'P(bad | flagged) = ' + tp + ' / ' + flagged + ' = ' + (flagged ? HB.fmt(ppv * 100, 1) + '%' : 'undefined (nothing flagged)') + '\n' +
        'Missed: ' + fn + ' bad messages passed.  Passed and really good: ' + tn + '.';
    }
    draw();
  });
})();
