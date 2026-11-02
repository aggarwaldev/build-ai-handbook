/* Chapter 26: ranking metrics on one ranked list. The default list is the real top six for one
   of the demo corpus's retrieval questions (scores from rag-data.js, body text only). Grade each
   passage 0 (not relevant), 1 (related) or 2 (answers the question), move rows up and down, and
   watch precision, recall, hit, reciprocal rank and nDCG change. A passage counts as relevant
   for the yes-or-no metrics when its grade is at least 1; nDCG uses the grade itself as the
   gain. */
(function () {
  'use strict';
  var HB = window.HB;
  var START = [
    { t: 'critical-illness > Cover', g: 1, s: 0.822 },
    { t: 'health > Waiting period', g: 0, s: 0.756 },
    { t: 'health > Cover', g: 0, s: 0.733 },
    { t: 'critical-illness > Waiting period', g: 2, s: 0.723 },
    { t: 'critical-illness > Exclusions', g: 0, s: 0.697 },
    { t: 'critical-illness > Claims', g: 0, s: 0.695 }
  ];

  HB.ready(function () {
    var host = document.getElementById('w-rankeval');
    if (!host) return;
    var rows = START.map(function (r) { return Object.assign({}, r); });
    var k = 3;
    host.appendChild(HB.el('p', { class: 'hint', text: 'Question: "How long is the waiting period before critical illness cover pays under Harbour Shield CI?"' }));
    var kIn = HB.el('input', { type: 'range', min: '1', max: '6', step: '1', value: '3', 'aria-label': 'k' });
    var kOut = HB.el('b');
    var reset = HB.el('button', { class: 'btn', type: 'button', text: 'Retrieval order' });
    var ideal = HB.el('button', { class: 'btn', type: 'button', text: 'Ideal order' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['k = ', kOut]), kIn, reset, ideal]));
    var list = HB.el('div');
    host.appendChild(list);
    var stats = HB.el('div', { class: 'stat-grid' });
    host.appendChild(stats);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function log2(x) { return Math.log(x) / Math.LN2; }
    function dcg(gs, n) { var s = 0; for (var i = 0; i < Math.min(n, gs.length); i++) s += gs[i] / log2(i + 2); return s; }
    function stat(k2, v) { return HB.el('div', { class: 'stat' }, [HB.el('span', { class: 'k', text: k2 }), HB.el('span', { class: 'v', text: v })]); }

    function draw() {
      kOut.textContent = String(k);
      list.innerHTML = '';
      rows.forEach(function (r, i) {
        var up = HB.el('button', { class: 'btn', type: 'button', text: '↑', 'aria-label': 'move up', disabled: i === 0 ? '' : null });
        var down = HB.el('button', { class: 'btn', type: 'button', text: '↓', 'aria-label': 'move down', disabled: i === rows.length - 1 ? '' : null });
        var grade = HB.el('select', { 'aria-label': 'grade for ' + r.t }, [0, 1, 2].map(function (g) { return HB.el('option', { value: String(g), text: 'grade ' + g, selected: r.g === g }); }));
        up.addEventListener('click', function () { var t = rows[i - 1]; rows[i - 1] = rows[i]; rows[i] = t; draw(); });
        down.addEventListener('click', function () { var t = rows[i + 1]; rows[i + 1] = rows[i]; rows[i] = t; draw(); });
        grade.addEventListener('change', function () { r.g = parseInt(grade.value, 10); draw(); });
        list.appendChild(HB.el('div', { class: 'row', style: 'margin-bottom:6px;' + (i < k ? 'font-weight:600' : 'opacity:.7') }, [
          HB.el('span', { style: 'min-width:2ch', text: String(i + 1) + '.' }),
          HB.el('span', { style: 'flex:1 1 220px', text: r.t + '  (' + r.s.toFixed(3) + ')' }),
          grade, up, down]));
        if (i === k - 1 && k < rows.length) list.appendChild(HB.el('hr', { style: 'margin:4px 0 8px' }));
      });
      var rel = rows.map(function (r) { return r.g > 0 ? 1 : 0; });
      var totalRel = rel.reduce(function (a, b) { return a + b; }, 0);
      var inTop = rel.slice(0, k).reduce(function (a, b) { return a + b; }, 0);
      var first = rel.indexOf(1);
      var gains = rows.map(function (r) { return r.g; });
      var idealGains = gains.slice().sort(function (a, b) { return b - a; });
      var d = dcg(gains, k), id = dcg(idealGains, k);
      stats.innerHTML = '';
      stats.appendChild(stat('precision@' + k, (inTop / k).toFixed(3)));
      stats.appendChild(stat('recall@' + k, totalRel ? (inTop / totalRel).toFixed(3) : 'n/a'));
      stats.appendChild(stat('hit@' + k, inTop > 0 ? '1' : '0'));
      stats.appendChild(stat('reciprocal rank', first >= 0 ? (1 / (first + 1)).toFixed(3) : '0'));
      stats.appendChild(stat('nDCG@' + k, id > 0 ? (d / id).toFixed(3) : 'n/a'));
      var terms = gains.slice(0, k).map(function (g, i) { return g + '/log2(' + (i + 2) + ')'; }).join(' + ');
      out.textContent = 'relevant (grade 1 or 2): ' + totalRel + ' in the list, ' + inTop + ' in the top ' + k + '\n' +
        'DCG@' + k + ' = ' + terms + ' = ' + d.toFixed(3) + '\n' +
        'ideal DCG@' + k + ' (best possible order) = ' + id.toFixed(3) + '   nDCG = DCG / ideal' +
        (first >= 0 ? '\nfirst relevant passage at rank ' + (first + 1) + ', so reciprocal rank = 1/' + (first + 1) : '');
    }
    kIn.addEventListener('input', function () { k = parseInt(kIn.value, 10); draw(); });
    reset.addEventListener('click', function () {
      var grades = {};
      rows.forEach(function (r) { grades[r.t] = r.g; });
      rows = START.map(function (r) { return { t: r.t, g: grades[r.t], s: r.s }; });
      draw();
    });
    ideal.addEventListener('click', function () { rows.sort(function (a, b) { return b.g - a.g || b.s - a.s; }); draw(); });
    draw();
  });
})();
