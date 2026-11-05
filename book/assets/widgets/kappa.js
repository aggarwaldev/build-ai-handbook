/* Chapter 44: Cohen's kappa on an agreement table. Rows are rater A's scores, columns rater B's;
   each cell counts the answers that got that pair. Two scales: pass/fail (2 x 2) and 0, 1, 2
   (3 x 3). The readout gives observed agreement p_o, chance agreement p_e from the two raters'
   score shares, and kappa = (p_o - p_e) / (1 - p_e), which is not defined when p_e is 1. On the
   pass/fail scale, with A as the truth and "fail" as the thing detected, it also gives B's
   precision and recall on fails, as for a judge checked against a person. */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-kappa');
    if (!host) return;
    var SCALES = {
      3: { labels: ['0', '1', '2'], a: 'A', b: 'B' },
      2: { labels: ['fail', 'pass'], a: 'Person', b: 'Judge' }
    };
    var PRESETS = [
      ['0–2: worked example', [[3, 1, 0], [1, 4, 2], [0, 1, 8]]],
      ['0–2: perfect agreement', [[4, 0, 0], [0, 6, 0], [0, 0, 10]]],
      ['0–2: both always give 2', [[0, 0, 0], [0, 0, 0], [0, 0, 20]]],
      ['0–2: worse than chance', [[0, 1, 6], [1, 2, 1], [6, 1, 2]]],
      ['Pass/fail: person vs judge', [[24, 6], [7, 63]]],
      ['Pass/fail: nearly all pass', [[1, 4], [4, 91]]]
    ];

    var chips = HB.el('div', { class: 'chips' });
    PRESETS.forEach(function (p) {
      chips.appendChild(HB.el('button', { type: 'button', class: 'chip', text: p[0], onclick: function () { load(p[1]); } }));
    });
    host.appendChild(chips);

    var wrap = HB.el('div', { class: 'tbl-wrap' });
    host.appendChild(wrap);
    var grid = HB.el('div', { class: 'stat-grid' });
    function stat(label) {
      var v = HB.el('div', { class: 'v' });
      var box = HB.el('div', { class: 'stat' }, [HB.el('div', { class: 'k', text: label }), v]);
      grid.appendChild(box);
      return { v: v, box: box };
    }
    var sPo = stat('observed agreement pₒ'), sPe = stat('chance agreement pₑ'), sK = stat('kappa κ');
    var sRec = stat('judge recall on fails'), sPrec = stat('judge precision on fails');
    host.appendChild(grid);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    var size = 0, cells = [], rowTotals = [], colTotals = [], grand = null;

    function build(k) {
      size = k;
      var sc = SCALES[k];
      cells = []; rowTotals = []; colTotals = [];
      var table = HB.el('table', { class: 'worked kappa-grid' });
      var head = HB.el('tr', null, [HB.el('th', { text: sc.a + ' ↓  ' + sc.b + ' →' })]);
      sc.labels.forEach(function (l) { head.appendChild(HB.el('th', { text: sc.b + ': ' + l })); });
      head.appendChild(HB.el('th', { text: 'total' }));
      table.appendChild(head);
      for (var r = 0; r < k; r++) {
        var tr = HB.el('tr', null, [HB.el('th', { text: sc.a + ': ' + sc.labels[r] })]);
        cells.push([]);
        for (var c = 0; c < k; c++) {
          var inp = HB.el('input', { type: 'number', min: '0', max: '999', step: '1', value: '0', 'aria-label': sc.a + ' gave ' + sc.labels[r] + ', ' + sc.b + ' gave ' + sc.labels[c] });
          inp.addEventListener('input', draw);
          cells[r].push(inp);
          tr.appendChild(HB.el('td', { class: r === c ? 'num diag' : 'num' }, [inp]));
        }
        var rt = HB.el('td', { class: 'num' });
        rowTotals.push(rt);
        tr.appendChild(rt);
        table.appendChild(tr);
      }
      var foot = HB.el('tr', null, [HB.el('th', { text: 'total' })]);
      for (var j = 0; j < k; j++) { var ct = HB.el('td', { class: 'num' }); colTotals.push(ct); foot.appendChild(ct); }
      grand = HB.el('td', { class: 'num' });
      foot.appendChild(grand);
      table.appendChild(foot);
      wrap.textContent = '';
      wrap.appendChild(table);
      sRec.box.style.display = sPrec.box.style.display = k === 2 ? '' : 'none';
    }

    function val(inp) {
      var n = parseInt(inp.value, 10);
      return isFinite(n) && n > 0 ? n : 0;
    }
    function load(m) {
      if (m.length !== size) build(m.length);
      for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) cells[r][c].value = String(m[r][c]);
      draw();
    }
    function band(kappa) {
      if (kappa < 0) return 'worse than chance';
      if (kappa <= 0.2) return 'slight';
      if (kappa <= 0.4) return 'fair';
      if (kappa <= 0.6) return 'moderate';
      if (kappa <= 0.8) return 'substantial';
      return 'almost perfect';
    }
    function draw() {
      var k = size, sc = SCALES[k];
      var a = [], b = [], n = 0, agree = 0, r, c;
      for (r = 0; r < k; r++) { a.push(0); b.push(0); }
      for (r = 0; r < k; r++) for (c = 0; c < k; c++) {
        var x = val(cells[r][c]);
        a[r] += x; b[c] += x; n += x;
        if (r === c) agree += x;
      }
      for (var i = 0; i < k; i++) { rowTotals[i].textContent = a[i]; colTotals[i].textContent = b[i]; }
      grand.textContent = n;
      if (n === 0) {
        sPo.v.textContent = sPe.v.textContent = sK.v.textContent = sRec.v.textContent = sPrec.v.textContent = 'n/a';
        out.textContent = 'No answers scored: kappa is not defined.';
        return;
      }
      var po = agree / n;
      var pe = 0, terms = [], diag = [];
      for (var s = 0; s < k; s++) {
        pe += (a[s] / n) * (b[s] / n);
        terms.push('(' + a[s] + '/' + n + ')(' + b[s] + '/' + n + ')');
        diag.push(val(cells[s][s]));
      }
      sPo.v.textContent = HB.fmt(po, 3);
      sPe.v.textContent = HB.fmt(pe, 3);
      var lines = [
        'pₒ = (' + diag.join(' + ') + ') / ' + n + ' = ' + HB.fmt(po, 3),
        'pₑ = ' + terms.join(' + ') + ' = ' + HB.fmt(pe, 3)
      ];
      if (pe >= 1 - 1e-12) {
        sK.v.textContent = 'n/a';
        lines.push('pₑ = 1: both raters used one score only, so chance explains everything and kappa is not defined.');
      } else {
        var kappa = (po - pe) / (1 - pe);
        sK.v.textContent = HB.fmt(kappa, 3);
        lines.push('κ = (' + HB.fmt(po, 3) + ' − ' + HB.fmt(pe, 3) + ') / (1 − ' + HB.fmt(pe, 3) + ') = ' + HB.fmt(kappa, 3));
        lines.push('Rough reading (Landis and Koch): ' + band(kappa) + '.');
      }
      if (k === 2) {
        var caught = val(cells[0][0]);
        var rec = a[0] ? caught / a[0] : null;
        var prec = b[0] ? caught / b[0] : null;
        sRec.v.textContent = rec === null ? 'n/a' : HB.fmt(rec, 3);
        sPrec.v.textContent = prec === null ? 'n/a' : HB.fmt(prec, 3);
        lines.push('');
        lines.push('Taking the ' + sc.a.toLowerCase() + ' as the truth and "fail" as the thing detected:');
        lines.push(rec === null
          ? '  recall: not defined, the ' + sc.a.toLowerCase() + ' failed nothing.'
          : '  recall = caught / ' + sc.a.toLowerCase() + "'s fails = " + caught + ' / ' + a[0] + ' = ' + HB.fmt(rec, 3) + ' (' + (a[0] - caught) + ' missed)');
        lines.push(prec === null
          ? '  precision: not defined, the ' + sc.b.toLowerCase() + ' failed nothing.'
          : '  precision = caught / ' + sc.b.toLowerCase() + "'s fails = " + caught + ' / ' + b[0] + ' = ' + HB.fmt(prec, 3) + ' (' + (b[0] - caught) + ' false alarms)');
      }
      out.textContent = lines.join('\n');
    }
    build(3);
    load(PRESETS[0][1]);
  });
})();
