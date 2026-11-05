/* Chapter 18: one attention head with real numbers. Four tokens have 2-number embeddings
   (editable). Queries, keys and values come from three fixed 2x2 matrices. Pick the token
   whose output to compute; the widget shows its query, the score against every key, the
   scaling by sqrt(d), the causal mask, the softmax weights and the weighted sum of values,
   plus the full grid of attention weights. */
(function () {
  'use strict';
  var HB = window.HB;
  var WQ = [[1, 0], [1, 1]], WK = [[1, 0], [0, 1]], WV = [[1, 0], [0, 2]];

  function mul(x, W) { return [x[0] * W[0][0] + x[1] * W[1][0], x[0] * W[0][1] + x[1] * W[1][1]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function v2(a) { return '(' + HB.fmt(a[0], 3) + ', ' + HB.fmt(a[1], 3) + ')'; }

  HB.ready(function () {
    var host = document.getElementById('w-attention');
    if (!host) return;
    var toks = ['fund', 'pays', 'it', 'back'];
    var X = [[1, 0], [0, 1], [1, 1], [0.5, -1]];
    var sel = 2, causal = true, scale = true;

    var embRow = HB.el('div', { class: 'row' });
    toks.forEach(function (t, i) {
      var a = HB.el('input', { type: 'number', step: '0.5', value: String(X[i][0]), 'aria-label': t + ' first number' });
      var b = HB.el('input', { type: 'number', step: '0.5', value: String(X[i][1]), 'aria-label': t + ' second number' });
      a.addEventListener('input', function () { X[i][0] = parseFloat(a.value) || 0; draw(); });
      b.addEventListener('input', function () { X[i][1] = parseFloat(b.value) || 0; draw(); });
      a.style.width = b.style.width = '64px';
      embRow.appendChild(HB.el('label', null, [t + ' ', a, ' ', b]));
    });
    host.appendChild(HB.el('p', { class: 'hint', text: 'Token embeddings x (edit any number). W_Q = [[1,0],[1,1]], W_K = identity, W_V = [[1,0],[0,2]]; each vector is a row, so q = x W_Q.' }));
    host.appendChild(embRow);
    var tokSel = HB.el('select', { 'aria-label': 'query token' });
    toks.forEach(function (t, i) { tokSel.appendChild(HB.el('option', { value: String(i), text: (i + 1) + ': ' + t, selected: i === sel })); });
    var cBox = HB.el('input', { type: 'checkbox', checked: true, 'aria-label': 'causal mask' });
    var sBox = HB.el('input', { type: 'checkbox', checked: true, 'aria-label': 'scale by square root of d' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'output for token' }), tokSel,
      HB.el('label', null, [cBox, ' causal mask (only look back)']), HB.el('label', null, [sBox, ' divide by √d'])]));
    var bars = HB.el('div');
    host.appendChild(bars);
    var gridWrap = HB.el('div', { class: 'tbl-wrap' });
    host.appendChild(gridWrap);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function weightsFor(t, Q, K) {
      var raw = [], s = [], allowed = [];
      for (var j = 0; j < toks.length; j++) {
        raw.push(dot(Q[t], K[j]));
        s.push(raw[j] / (scale ? Math.SQRT2 : 1));
        allowed.push(!causal || j <= t);
      }
      var m = -Infinity;
      s.forEach(function (v, j) { if (allowed[j]) m = Math.max(m, v); });
      var e = s.map(function (v, j) { return allowed[j] ? Math.exp(v - m) : 0; });
      var sum = e.reduce(function (a, b) { return a + b; }, 0);
      return { raw: raw, s: s, allowed: allowed, w: e.map(function (v) { return v / sum; }) };
    }

    function draw() {
      var Q = X.map(function (x) { return mul(x, WQ); });
      var K = X.map(function (x) { return mul(x, WK); });
      var V = X.map(function (x) { return mul(x, WV); });
      var r = weightsFor(sel, Q, K);
      bars.innerHTML = '';
      r.w.forEach(function (w, j) {
        var fill = HB.el('span', { style: 'width:' + (w * 100).toFixed(1) + '%' });
        bars.appendChild(HB.el('div', { class: 'bar-row' }, [HB.el('span', { text: (j + 1) + ': ' + toks[j] + (r.allowed[j] ? '' : ' (masked)') }), HB.el('div', { class: 'bar' }, [fill]), HB.el('span', { class: 'pct', text: HB.fmt(w * 100, 1) + '%' })]));
      });
      var o = [0, 0];
      r.w.forEach(function (w, j) { o[0] += w * V[j][0]; o[1] += w * V[j][1]; });

      var table = HB.el('table');
      var head = HB.el('tr', null, [HB.el('th', { text: 'query ↓ key →' })]);
      toks.forEach(function (t) { head.appendChild(HB.el('th', { text: t })); });
      table.appendChild(head);
      toks.forEach(function (t, i) {
        var row = HB.el('tr', null, [HB.el('th', { text: t })]);
        var wi = weightsFor(i, Q, K);
        wi.w.forEach(function (w, j) {
          var cell = HB.el('td', { class: 'num', text: wi.allowed[j] ? HB.fmt(w, 2) : '·' });
          cell.style.background = 'color-mix(in srgb, var(--accent) ' + Math.round(w * 70) + '%, transparent)';
          if (i === sel) cell.style.fontWeight = '700';
          row.appendChild(cell);
        });
        table.appendChild(row);
      });
      gridWrap.innerHTML = '';
      gridWrap.appendChild(table);

      var lines = [];
      lines.push('q = x W_Q = ' + v2(X[sel]) + ' W_Q = ' + v2(Q[sel]));
      lines.push('keys k_j = x_j W_K: ' + K.map(v2).join(', '));
      lines.push('scores q·k_j: ' + r.raw.map(function (v, j) { return r.allowed[j] ? HB.fmt(v, 3) : 'masked'; }).join(', '));
      if (scale) lines.push('divided by √2 = 1.414: ' + r.s.map(function (v, j) { return r.allowed[j] ? HB.fmt(v, 3) : 'masked'; }).join(', '));
      lines.push('softmax weights: ' + r.w.map(function (v) { return HB.fmt(v, 3); }).join(', '));
      lines.push('values v_j = x_j W_V: ' + V.map(v2).join(', '));
      lines.push('output = Σ weight × value = ' + v2(o));
      out.textContent = lines.join('\n');
    }
    tokSel.addEventListener('change', function () { sel = parseInt(tokSel.value, 10); draw(); });
    cBox.addEventListener('change', function () { causal = cBox.checked; draw(); });
    sBox.addEventListener('change', function () { scale = sBox.checked; draw(); });
    draw();
  });
})();
