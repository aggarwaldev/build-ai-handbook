/* Chapter 2: explore a straight line y = m x + b. Sliders move the slope and the intercept;
   a rise-over-run triangle between x = 1 and x = 3 shows where the slope comes from. */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-line');
    if (!host) return;
    var m = 0.5, b = 1;
    var plot = HB.Plot({ xmin: -6, xmax: 6, ymin: -6, ymax: 6, label: 'Graph of a straight line' });
    var mIn = HB.el('input', { type: 'range', min: '-3', max: '3', step: '0.1', value: String(m), 'aria-label': 'slope m' });
    var bIn = HB.el('input', { type: 'range', min: '-4', max: '4', step: '0.5', value: String(b), 'aria-label': 'intercept b' });
    var mOut = HB.el('b'), bOut = HB.el('b');
    var eq = HB.el('div', { class: 'out' });
    var table = HB.el('div', { class: 'out' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['slope m = ', mOut]), mIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['intercept b = ', bOut]), bIn]));
    host.appendChild(plot.svg);
    host.appendChild(eq);
    host.appendChild(table);

    function y(x) { return m * x + b; }
    function draw() {
      mOut.textContent = HB.fmt(m, 1);
      bOut.textContent = HB.fmt(b, 1);
      plot.clear();
      plot.fn(y, 'pl-c1');
      var x1 = 1, x2 = 3;
      plot.line(x1, y(x1), x2, y(x1), 'pl-c3 pl-thin pl-dash');
      plot.line(x2, y(x1), x2, y(x2), 'pl-c2 pl-thin pl-dash');
      plot.dot(x1, y(x1), 5, 'pl-f1');
      plot.dot(x2, y(x2), 5, 'pl-f1');
      plot.dot(0, b, 5, 'pl-f4');
      plot.text(2, y(x1) - 0.55, 'run = 2', 'pl-tick', 'middle');
      plot.text(3.2, (y(x1) + y(x2)) / 2, 'rise = ' + HB.fmt(y(x2) - y(x1), 2), 'pl-tick');
      plot.text(0.25, b + 0.35, 'b', 'pl-tick');
      var rise = y(x2) - y(x1);
      eq.innerHTML = '';
      eq.appendChild(document.createTextNode(
        'y = ' + HB.fmt(m, 1) + 'x ' + (b < 0 ? '− ' + HB.fmt(-b, 1) : '+ ' + HB.fmt(b, 1)) + '\n' +
        'At x = 1, y = ' + HB.fmt(y(1), 2) + '.  At x = 3, y = ' + HB.fmt(y(3), 2) + '.\n' +
        'slope = rise / run = ' + HB.fmt(rise, 2) + ' / 2 = ' + HB.fmt(rise / 2, 2) +
        (m > 0 ? '  (the line goes up to the right)' : m < 0 ? '  (the line goes down to the right)' : '  (a flat line)')));
      var rows = 'x    : ' + [-2, -1, 0, 1, 2].map(function (v) { return String(v).padStart(6); }).join('') + '\n' +
        'f(x) : ' + [-2, -1, 0, 1, 2].map(function (v) { return HB.fmt(y(v), 2).padStart(6); }).join('');
      table.textContent = rows;
    }
    mIn.addEventListener('input', function () { m = parseFloat(mIn.value); draw(); });
    bIn.addEventListener('input', function () { b = parseFloat(bIn.value); draw(); });
    draw();
  });
})();
