/* Chapter 17: sinusoidal positional encodings as a heat map. Each row is one position, each
   column one dimension: PE(pos, 2i) = sin(pos / 10000^(2i/d)), PE(pos, 2i+1) = cos(same).
   Pick a position to see its vector, and a plot of how similar every other position's
   vector is to it (dot product divided by d/2, so the position itself scores 1). */
(function () {
  'use strict';
  var HB = window.HB;
  var NPOS = 64;

  function encode(pos, d) {
    var v = [];
    for (var i = 0; i < d / 2; i++) {
      var w = 1 / Math.pow(10000, (2 * i) / d);
      v.push(Math.sin(pos * w), Math.cos(pos * w));
    }
    return v;
  }

  HB.ready(function () {
    var host = document.getElementById('w-posenc');
    if (!host) return;
    var d = 32, pos = 10;
    var dSel = HB.el('select', { 'aria-label': 'number of dimensions' });
    [8, 16, 32, 64].forEach(function (n) { dSel.appendChild(HB.el('option', { value: String(n), text: String(n), selected: n === d })); });
    var pIn = HB.el('input', { type: 'range', min: '0', max: String(NPOS - 1), step: '1', value: String(pos), 'aria-label': 'position' });
    var pOut = HB.el('b');
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'dimensions d' }), dSel, HB.el('label', null, ['position ', pOut]), pIn]));
    var canvas = HB.el('canvas', { width: '640', height: '320', role: 'img', 'aria-label': 'Heat map of positional encodings: rows are positions 0 to 63, columns are dimensions', style: 'width:100%;height:auto;display:block;border-radius:8px;background:var(--surface);cursor:pointer' });
    host.appendChild(canvas);
    host.appendChild(HB.el('p', { class: 'hint', text: 'Columns are dimensions (left = fast-changing, right = slow); rows are positions 0 to 63, top to bottom. Warm = positive, cool = negative. Click a row to pick a position.' }));
    var plot = HB.Plot({ xmin: 0, xmax: NPOS - 1, ymin: -0.4, ymax: 1.05, xlabel: 'other position', ylabel: 'similarity', width: 560, height: 220, label: 'Similarity of the chosen position to every other position' });
    host.appendChild(plot.svg);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function hexToRgb(h) {
      h = (h || '').trim().replace('#', '');
      if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
      var n = parseInt(h, 16);
      if (!isFinite(n)) return [128, 128, 128];
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function draw() {
      pOut.textContent = String(pos);
      var ctx = canvas.getContext('2d');
      var W = canvas.width, H = canvas.height;
      var bg = hexToRgb(HB.cssVar('--surface'));
      var warm = hexToRgb(HB.cssVar('--c3'));
      var cool = hexToRgb(HB.cssVar('--c1'));
      var cw = W / d, ch = H / NPOS;
      for (var p = 0; p < NPOS; p++) {
        var v = encode(p, d);
        for (var j = 0; j < d; j++) {
          var t = Math.abs(v[j]), c = v[j] >= 0 ? warm : cool;
          var r = Math.round(bg[0] + (c[0] - bg[0]) * t), g = Math.round(bg[1] + (c[1] - bg[1]) * t), b = Math.round(bg[2] + (c[2] - bg[2]) * t);
          ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
          ctx.fillRect(Math.floor(j * cw), Math.floor(p * ch), Math.ceil(cw), Math.ceil(ch));
        }
      }
      ctx.strokeStyle = HB.cssVar('--text');
      ctx.lineWidth = 2;
      ctx.strokeRect(1, pos * ch + 1, W - 2, ch - 1);

      var me = encode(pos, d);
      var sims = [];
      for (var q = 0; q < NPOS; q++) {
        var o = encode(q, d), s = 0;
        for (var k = 0; k < d; k++) s += me[k] * o[k];
        sims.push([q, s / (d / 2)]);
      }
      plot.clear();
      plot.poly(sims, 'pl-c1');
      plot.dot(pos, 1, 5, 'pl-f3');
      var near = sims[Math.min(NPOS - 1, pos + 1)][1], far = sims[pos + 20 < NPOS ? pos + 20 : Math.max(0, pos - 20)][1];
      out.textContent =
        'PE(' + pos + ') first 8 numbers: ' + me.slice(0, 8).map(function (x) { return HB.fmt(x, 3); }).join(', ') + ' …\n' +
        'pair 0 uses frequency 1: sin(' + pos + ') = ' + HB.fmt(Math.sin(pos), 3) + ', cos(' + pos + ') = ' + HB.fmt(Math.cos(pos), 3) + '\n' +
        'last pair uses frequency 1/10000^(' + (d - 2) + '/' + d + ') = ' + HB.fmt(1 / Math.pow(10000, (d - 2) / d), 5) + ', so it barely moves across 64 positions\n' +
        'similarity to the next position: ' + HB.fmt(near, 3) + '   to a position 20 away: ' + HB.fmt(far, 3) + '\n' +
        'The similarity depends only on the distance between positions, not on where they are.';
    }

    canvas.addEventListener('click', function (evt) {
      var rect = canvas.getBoundingClientRect();
      var y = (evt.clientY - rect.top) / rect.height;
      pos = HB.clamp(Math.floor(y * NPOS), 0, NPOS - 1);
      pIn.value = String(pos);
      draw();
    });
    pIn.addEventListener('input', function () { pos = parseInt(pIn.value, 10); draw(); });
    dSel.addEventListener('change', function () { d = parseInt(dSel.value, 10); draw(); });
    HB.onTheme(draw);
    draw();
  });
})();
