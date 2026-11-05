/* Chapters 4 and 23: drag the tips of two 2-D vectors and read their lengths, dot product,
   angle and cosine similarity. Mounts on every element with class "w-vectors". */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var hosts = document.querySelectorAll('.w-vectors');
    Array.prototype.forEach.call(hosts, mount);
  });

  function mount(host) {
    var a = { x: 3, y: 1 }, b = { x: 1, y: 2 };
    var plot = HB.Plot({ xmin: -4, xmax: 4, ymin: -3, ymax: 3, width: 520, height: 340, label: 'Two vectors you can drag' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    var presets = HB.el('div', { class: 'row' });
    [['same direction', { x: 3, y: 1 }, { x: 1.5, y: 0.5 }], ['at right angles', { x: 2, y: 0 }, { x: 0, y: 2 }],
     ['opposite', { x: 2, y: 1 }, { x: -2, y: -1 }], ['close', { x: 3, y: 1 }, { x: 2.5, y: 1.4 }]].forEach(function (p) {
      var btn = HB.el('button', { class: 'btn', type: 'button', text: p[0] });
      btn.addEventListener('click', function () { a = { x: p[1].x, y: p[1].y }; b = { x: p[2].x, y: p[2].y }; draw(); });
      presets.appendChild(btn);
    });
    host.appendChild(plot.svg);
    host.appendChild(presets);
    host.appendChild(out);

    var dragging = null;
    function draw() {
      plot.clear();
      plot.line(0, 0, a.x, a.y, 'pl-c1');
      plot.line(0, 0, b.x, b.y, 'pl-c2');
      var da = plot.dot(a.x, a.y, 9, 'pl-f1 drag');
      var db = plot.dot(b.x, b.y, 9, 'pl-f2 drag');
      plot.text(a.x + 0.15, a.y + 0.15, 'a', 'pl-label');
      plot.text(b.x + 0.15, b.y + 0.15, 'b', 'pl-label');
      da.addEventListener('pointerdown', function (e) { dragging = 'a'; plot.svg.setPointerCapture(e.pointerId); e.preventDefault(); });
      db.addEventListener('pointerdown', function (e) { dragging = 'b'; plot.svg.setPointerCapture(e.pointerId); e.preventDefault(); });
      var la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
      var dot = a.x * b.x + a.y * b.y;
      var cos = la && lb ? dot / (la * lb) : 0;
      var ang = Math.acos(HB.clamp(cos, -1, 1)) * 180 / Math.PI;
      out.textContent =
        'a = (' + HB.fmt(a.x, 1) + ', ' + HB.fmt(a.y, 1) + ')   b = (' + HB.fmt(b.x, 1) + ', ' + HB.fmt(b.y, 1) + ')\n' +
        'length |a| = √(' + HB.fmt(a.x, 1) + '² + ' + HB.fmt(a.y, 1) + '²) = ' + HB.fmt(la, 3) + '   |b| = ' + HB.fmt(lb, 3) + '\n' +
        'dot a·b = ' + HB.fmt(a.x, 1) + '×' + HB.fmt(b.x, 1) + ' + ' + HB.fmt(a.y, 1) + '×' + HB.fmt(b.y, 1) + ' = ' + HB.fmt(dot, 3) + '\n' +
        'cosine similarity = a·b / (|a| |b|) = ' + HB.fmt(dot, 3) + ' / ' + HB.fmt(la * lb, 3) + ' = ' + HB.fmt(cos, 3) + '\n' +
        'angle = ' + HB.fmt(ang, 1) + '°   cosine distance = 1 − cos = ' + HB.fmt(1 - cos, 3);
    }
    plot.svg.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var p = plot.toData(e);
      var v = { x: Math.round(HB.clamp(p.x, -3.9, 3.9) * 10) / 10, y: Math.round(HB.clamp(p.y, -2.9, 2.9) * 10) / 10 };
      if (dragging === 'a') a = v; else b = v;
      draw();
    });
    function stop() { dragging = null; }
    plot.svg.addEventListener('pointerup', stop);
    plot.svg.addEventListener('pointercancel', stop);
    draw();
  }
})();
