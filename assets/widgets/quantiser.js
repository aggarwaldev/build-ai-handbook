/* Chapter 39: a quantiser for sixteen weights. Pick the bits, symmetric or asymmetric scaling and
   the group size, and add an outlier to see why one large weight ruins the scale for its whole
   group. Each group stores its own scale as a 16-bit number (and, if asymmetric, a zero point). */
(function () {
  'use strict';
  var HB = window.HB;
  var BASE = [-0.62, 0.10, 0.31, 1.27, 0.05, -0.18, 0.42, -0.33, 0.21, -0.07, 0.15, -0.49, 0.36, 0.02, -0.26, 0.11];
  var OUTLIER_AT = 9, OUTLIER = 6.0;

  // Round half away from zero, the usual "round to nearest" taught at school.
  function rnd(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }

  function quantise(ws, bits, scheme) {
    var q = [], deq = [], scale, zero = 0;
    if (scheme === 'sym') {
      var qmax = Math.pow(2, bits - 1) - 1;
      var amax = Math.max.apply(null, ws.map(Math.abs)) || 1;
      scale = amax / qmax;
      ws.forEach(function (w) { var v = HB.clamp(rnd(w / scale), -qmax, qmax); q.push(v); deq.push(v * scale); });
    } else {
      var top = Math.pow(2, bits) - 1;
      var lo = Math.min.apply(null, ws), hi = Math.max.apply(null, ws);
      scale = (hi - lo) / top || 1;
      zero = rnd(-lo / scale);
      ws.forEach(function (w) { var v = HB.clamp(rnd(w / scale) + zero, 0, top); q.push(v); deq.push((v - zero) * scale); });
    }
    return { q: q, deq: deq, scale: scale, zero: zero };
  }

  HB.ready(function () {
    var host = document.getElementById('w-quantiser');
    if (!host) return;
    function sel(label, opts, value) {
      var s = HB.el('select', { 'aria-label': label });
      opts.forEach(function (o) { s.appendChild(HB.el('option', { value: o[0], text: o[1], selected: o[0] === value })); });
      return s;
    }
    var bits = sel('bits per weight', [['8', '8 bits'], ['4', '4 bits'], ['3', '3 bits'], ['2', '2 bits']], '4');
    var scheme = sel('scaling', [['sym', 'symmetric (zero stays zero)'], ['asym', 'asymmetric (scale plus zero point)']], 'sym');
    var group = sel('group size', [['16', 'one scale for all 16'], ['4', 'one scale per group of 4']], '16');
    var outlier = HB.el('input', { type: 'checkbox', 'aria-label': 'add an outlier weight' });
    host.appendChild(HB.el('div', { class: 'row' }, [bits, scheme, group]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, [outlier, ' make weight 9 an outlier (' + OUTLIER.toFixed(1) + ')'])]));
    var plot = HB.Plot({ width: 560, height: 230, xmin: -0.5, xmax: 15.5, ymin: -1, ymax: 1.5, xlabel: 'weight number', ylabel: 'value', label: 'original and quantised weights' });
    host.appendChild(plot.svg);
    host.appendChild(HB.el('p', { class: 'hint', text: 'Blue dots: the original weights. Orange: the value after quantising and scaling back. The grey bar between them is the error.' }));
    var stats = HB.el('div', { class: 'stat-grid' });
    host.appendChild(stats);
    var tableBox = HB.el('details', null, [HB.el('summary', { text: 'Every weight, step by step' })]);
    var tableWrap = HB.el('div', { class: 'tbl-wrap' });
    tableBox.appendChild(tableWrap);
    host.appendChild(tableBox);

    function stat(k, v) { return HB.el('div', { class: 'stat' }, [HB.el('div', { class: 'k', text: k }), HB.el('div', { class: 'v', text: v })]); }

    function draw() {
      var ws = BASE.slice();
      if (outlier.checked) ws[OUTLIER_AT] = OUTLIER;
      var b = parseInt(bits.value, 10), g = parseInt(group.value, 10), sc = scheme.value;
      var rows = [], scales = [], errs = [];
      for (var start = 0; start < ws.length; start += g) {
        var part = ws.slice(start, start + g), r = quantise(part, b, sc);
        scales.push(r.scale);
        part.forEach(function (w, j) {
          var i = start + j, e = Math.abs(w - r.deq[j]);
          errs.push(e);
          rows.push([i, w, start / g + 1, r.q[j], r.deq[j], e, i === OUTLIER_AT && outlier.checked]);
        });
      }
      var lo = Math.min.apply(null, ws), hi = Math.max.apply(null, ws);
      plot.setRange({ ymin: Math.min(-1, lo - 0.2), ymax: Math.max(1.5, hi + 0.3) });
      plot.clear();
      rows.forEach(function (r) {
        if (r[5] > 1e-9) plot.line(r[0], r[1], r[0], r[4], 'pl-cm pl-thin');
        plot.dot(r[0], r[1], 5, 'pl-f1');
        plot.dot(r[0], r[4], 3.5, 'pl-f2');
      });
      var normal = errs.filter(function (e, i) { return !(outlier.checked && i === OUTLIER_AT); });
      var mae = normal.reduce(function (a, x) { return a + x; }, 0) / normal.length;
      var maxErr = Math.max.apply(null, normal);
      var zeros = rows.filter(function (r) { return Math.abs(r[4]) < 1e-12 && Math.abs(r[1]) > 1e-12; }).length;
      var overhead = (16 + (sc === 'asym' ? b : 0)) / g;
      var perWeight = b + overhead;
      stats.innerHTML = '';
      stats.appendChild(stat(scales.length > 1 ? 'scales' : 'scale', scales.map(function (s) { return s.toFixed(4); }).join(', ')));
      stats.appendChild(stat('mean error (ordinary weights)', mae.toFixed(4)));
      stats.appendChild(stat('largest error (ordinary weights)', maxErr.toFixed(4)));
      stats.appendChild(stat('non-zero weights turned into 0', String(zeros)));
      stats.appendChild(stat('bits per weight with scales', perWeight.toFixed(2) + ' (vs 16)'));
      stats.appendChild(stat('7B parameters would take', (7e9 * perWeight / 8 / 1e9).toFixed(1) + ' GB'));
      var t = HB.el('table', { class: 'worked' });
      t.appendChild(HB.el('tr', null, ['#', 'weight w', 'group', 'stored integer q', 'scaled back', 'error'].map(function (h) { return HB.el('th', { text: h }); })));
      rows.forEach(function (r) {
        t.appendChild(HB.el('tr', r[6] ? { style: 'background:var(--amber-soft)' } : null, [
          HB.el('td', { class: 'num', text: String(r[0]) }), HB.el('td', { class: 'num', text: r[1].toFixed(2) }),
          HB.el('td', { class: 'num', text: String(r[2]) }), HB.el('td', { class: 'num', text: String(r[3]) }),
          HB.el('td', { class: 'num', text: r[4].toFixed(4) }), HB.el('td', { class: 'num', text: r[5].toFixed(4) })]));
      });
      tableWrap.innerHTML = '';
      tableWrap.appendChild(t);
    }
    [bits, scheme, group].forEach(function (x) { x.addEventListener('change', draw); });
    outlier.addEventListener('change', draw);
    draw();
  });
})();
