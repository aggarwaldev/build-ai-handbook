/* Chapter 23: semantic search with real embeddings. The twelve sentences and three queries
   were embedded with BAAI/bge-small-en-v1.5 (384 numbers each, unit length; the [CLS] vector of
   the model's full-precision weights), a small open embedding model, and the cosine similarities
   were stored here, rounded to three places. Pick a
   query, or click a sentence to search with it, and choose k. The map squeezes 384 dimensions
   into 2 (principal components), so distances on it are only a rough guide; the scores are
   exact. */
(function () {
  'use strict';
  var HB = window.HB;
  var DATA = {"docs":["How much should I keep in an emergency fund?","What is a sensible cash buffer if I lose my job?","How long would my savings last without a salary?","Is the interest on my savings account taxed?","Do I pay income tax on fixed deposit interest?","What rate does a one-year fixed deposit pay?","Which bank has the best term deposit rate?","Does my health insurance cover a hospital stay abroad?","What is the waiting period on my insurance policy?","How much will I have at retirement if I invest monthly?","What is an index fund?","How did my portfolio do this month?"],"queries":["I was laid off. How many months can I live on my savings?","tax on the interest my deposits earn","best FD rates"],"sim":[[0.643,0.705,0.79,0.67,0.643,0.662,0.549,0.568,0.659,0.691,0.503,0.59],[0.631,0.618,0.585,0.858,0.868,0.73,0.638,0.518,0.585,0.656,0.564,0.583],[0.639,0.567,0.535,0.556,0.572,0.637,0.68,0.493,0.55,0.601,0.542,0.568]],"docsim":[[1.0,0.692,0.69,0.652,0.6,0.638,0.544,0.558,0.596,0.75,0.667,0.615],[0.692,1.0,0.726,0.607,0.621,0.622,0.585,0.515,0.538,0.621,0.523,0.566],[0.69,0.726,1.0,0.627,0.599,0.679,0.537,0.523,0.606,0.69,0.501,0.581],[0.652,0.607,0.627,1.0,0.833,0.672,0.577,0.557,0.585,0.653,0.608,0.599],[0.6,0.621,0.599,0.833,1.0,0.787,0.603,0.554,0.551,0.635,0.569,0.568],[0.638,0.622,0.679,0.672,0.787,1.0,0.71,0.52,0.558,0.662,0.536,0.561],[0.544,0.585,0.537,0.577,0.603,0.71,1.0,0.471,0.535,0.521,0.51,0.512],[0.558,0.515,0.523,0.557,0.554,0.52,0.471,1.0,0.668,0.494,0.447,0.444],[0.596,0.538,0.606,0.585,0.551,0.558,0.535,0.668,1.0,0.57,0.475,0.566],[0.75,0.621,0.69,0.653,0.635,0.662,0.521,0.494,0.57,1.0,0.603,0.726],[0.667,0.523,0.501,0.608,0.569,0.536,0.51,0.447,0.475,0.603,1.0,0.569],[0.615,0.566,0.581,0.599,0.568,0.561,0.512,0.444,0.566,0.726,0.569,1.0]],"xy":[[-0.19,0.203],[-0.151,0.016],[-0.257,-0.046],[0.305,-0.076],[0.411,-0.117],[0.232,-0.039],[0.204,0.0],[-0.219,-0.47],[-0.261,-0.329],[-0.137,0.258],[0.009,0.369],[-0.146,0.303],[-0.202,-0.152],[0.406,-0.083],[-0.004,0.165]]};

  HB.ready(function () {
    var host = document.getElementById('w-nnsearch');
    if (!host) return;
    var nd = DATA.docs.length, q = 0, fromDoc = -1, k = 3;
    var sel = HB.el('select', { 'aria-label': 'query' });
    DATA.queries.forEach(function (t, i) { sel.appendChild(HB.el('option', { value: String(i), text: t })); });
    var kIn = HB.el('input', { type: 'range', min: '1', max: String(nd), step: '1', value: '3', 'aria-label': 'k' });
    var kOut = HB.el('b');
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'query' }), sel]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['top k = ', kOut]), kIn]));
    var split = HB.el('div', { class: 'split' });
    var list = HB.el('div');
    var xs = DATA.xy.map(function (p) { return p[0]; }), ys = DATA.xy.map(function (p) { return p[1]; });
    var pad = 0.08;
    var plot = HB.Plot({ xmin: Math.min.apply(null, xs) - pad, xmax: Math.max.apply(null, xs) + pad, ymin: Math.min.apply(null, ys) - pad, ymax: Math.max.apply(null, ys) + pad, width: 360, height: 300, grid: false, xlabel: 'component 1', ylabel: 'component 2', label: 'Sentences and queries projected to two dimensions' });
    split.appendChild(list);
    split.appendChild(plot.svg);
    host.appendChild(split);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function scores() { return fromDoc >= 0 ? DATA.docsim[fromDoc] : DATA.sim[q]; }
    function draw() {
      kOut.textContent = String(k);
      var s = scores();
      var order = s.map(function (v, i) { return i; }).filter(function (i) { return i !== fromDoc; }).sort(function (a, b) { return s[b] - s[a]; });
      list.innerHTML = '';
      order.forEach(function (i, rank) {
        var inTop = rank < k;
        var fill = HB.el('span', { style: 'width:' + Math.max(0, (s[i] - 0.4) / 0.6 * 100).toFixed(1) + '%' + (inTop ? '' : ';opacity:.35') });
        var row = HB.el('div', { class: 'bar-row', style: 'grid-template-columns: 1fr 70px 48px;cursor:pointer', title: 'Search with this sentence' }, [
          HB.el('span', { style: 'font-size:13px' + (inTop ? ';font-weight:600' : ''), text: (rank + 1) + '. ' + DATA.docs[i] }),
          HB.el('div', { class: 'bar' }, [fill]),
          HB.el('span', { class: 'pct', text: s[i].toFixed(3) })]);
        row.addEventListener('click', function () { fromDoc = i; draw(); });
        list.appendChild(row);
      });
      plot.clear();
      var top = order.slice(0, k);
      var qx = fromDoc >= 0 ? DATA.xy[fromDoc] : DATA.xy[nd + q];
      top.forEach(function (i) { plot.line(qx[0], qx[1], DATA.xy[i][0], DATA.xy[i][1], 'pl-c2 pl-thin pl-dash'); });
      for (var i = 0; i < nd; i++) plot.dot(DATA.xy[i][0], DATA.xy[i][1], top.indexOf(i) >= 0 ? 6 : 4, top.indexOf(i) >= 0 ? 'pl-f2' : 'pl-fm');
      plot.dot(qx[0], qx[1], 7, 'pl-f3');
      var query = fromDoc >= 0 ? DATA.docs[fromDoc] : DATA.queries[q];
      out.textContent = 'query: ' + query + '\n' +
        'top ' + k + ': ' + top.map(function (i) { return s[i].toFixed(3); }).join(', ') +
        '   lowest of all: ' + s[order[order.length - 1]].toFixed(3) + '\n' +
        'Scores are cosine similarities of unit vectors, so they equal dot products. For this model they rarely fall below about 0.4, so read them as a ranking, not as a percentage.';
    }
    sel.addEventListener('change', function () { q = parseInt(sel.value, 10); fromDoc = -1; draw(); });
    kIn.addEventListener('input', function () { k = parseInt(kIn.value, 10); draw(); });
    draw();
  });
})();
