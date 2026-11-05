/* Chapter 25: approximate nearest-neighbour search on 300 points in two dimensions.
   Exact search measures the distance to every point. IVF groups the points into 16 cells with
   k-means and searches only the cells whose centres are nearest the query ("probes"). The graph
   method is a two-layer cut-down of HNSW: a greedy walk over a sparse top layer finds a starting
   point, then a beam search of width ef walks a graph linking each point to its nearest
   neighbours. Each method reports how many distances it computed and its recall@5 against the
   exact answer. Click the plot to move the query. */
(function () {
  'use strict';
  var HB = window.HB;
  var N = 300, K = 5, NLIST = 16, M0 = 5, M1 = 3, TOP = 18;

  function makePoints() {
    var r = HB.rng(7), pts = [], centres = [];
    for (var c = 0; c < 6; c++) centres.push([0.12 + 0.76 * r(), 0.12 + 0.76 * r()]);
    for (var i = 0; i < N; i++) {
      var ce = centres[i % 6];
      var u = Math.max(r(), 1e-9), v = r();
      var g = Math.sqrt(-2 * Math.log(u));
      pts.push([HB.clamp(ce[0] + 0.07 * g * Math.cos(2 * Math.PI * v), 0.01, 0.99), HB.clamp(ce[1] + 0.07 * g * Math.sin(2 * Math.PI * v), 0.01, 0.99)]);
    }
    return pts;
  }
  function d2(a, b) { var x = a[0] - b[0], y = a[1] - b[1]; return x * x + y * y; }
  function nearest(pts, ids, q, k) {
    return ids.slice().sort(function (a, b) { return d2(pts[a], q) - d2(pts[b], q) || a - b; }).slice(0, k);
  }
  function kmeans(pts) {
    var cents = [];
    for (var i = 0; i < NLIST; i++) cents.push(pts[(i * 37) % N].slice());
    var assign = new Array(N);
    for (var it = 0; it < 15; it++) {
      for (var p = 0; p < N; p++) {
        var best = 0;
        for (var c = 1; c < NLIST; c++) if (d2(pts[p], cents[c]) < d2(pts[p], cents[best])) best = c;
        assign[p] = best;
      }
      for (c = 0; c < NLIST; c++) {
        var sx = 0, sy = 0, n = 0;
        for (p = 0; p < N; p++) if (assign[p] === c) { sx += pts[p][0]; sy += pts[p][1]; n++; }
        if (n) cents[c] = [sx / n, sy / n];
      }
    }
    var lists = cents.map(function () { return []; });
    for (p = 0; p < N; p++) lists[assign[p]].push(p);
    return { cents: cents, lists: lists };
  }
  function knnGraph(pts, ids, m) {
    var adj = {};
    ids.forEach(function (i) { adj[i] = adj[i] || []; });
    ids.forEach(function (i) {
      var others = ids.filter(function (j) { return j !== i; });
      nearest(pts, others, pts[i], m).forEach(function (j) {
        if (adj[i].indexOf(j) < 0) adj[i].push(j);
        if (adj[j].indexOf(i) < 0) adj[j].push(i);
      });
    });
    return adj;
  }

  HB.ready(function () {
    var host = document.getElementById('w-vsearch');
    if (!host) return;
    var pts = makePoints();
    var all = pts.map(function (p, i) { return i; });
    var ivf = kmeans(pts);
    var topIds = all.filter(function (i) { return i % (N / TOP) === 0; });
    var g1 = knnGraph(pts, topIds, M1);
    var g0 = knnGraph(pts, all, M0);
    var q = [0.5, 0.5];

    var method = HB.el('select', { 'aria-label': 'method' }, [
      HB.el('option', { value: 'exact', text: 'exact (every point)' }),
      HB.el('option', { value: 'ivf', text: 'IVF (cells)', selected: true }),
      HB.el('option', { value: 'graph', text: 'graph (HNSW-like)' })]);
    var probes = HB.el('input', { type: 'range', min: '1', max: String(NLIST), step: '1', value: '1', 'aria-label': 'probes' });
    var probesOut = HB.el('b');
    var ef = HB.el('input', { type: 'range', min: String(K), max: '60', step: '1', value: '5', 'aria-label': 'ef' });
    var efOut = HB.el('b');
    var rnd = HB.el('button', { class: 'btn', type: 'button', text: 'Random query' });
    var avg = HB.el('button', { class: 'btn', type: 'button', text: 'Average over 200 queries' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'method' }), method, rnd, avg]));
    var rowP = HB.el('div', { class: 'row' }, [HB.el('label', null, ['probes = ', probesOut, ' of ' + NLIST + ' cells']), probes]);
    var rowE = HB.el('div', { class: 'row' }, [HB.el('label', null, ['ef = ', efOut, ' (beam width)']), ef]);
    host.appendChild(rowP);
    host.appendChild(rowE);
    var plot = HB.Plot({ xmin: 0, xmax: 1, ymin: 0, ymax: 1, width: 420, height: 380, grid: false, xlabel: 'x', ylabel: 'y', label: 'Points, the query and the neighbours found' });
    var fig = HB.el('div', { style: 'max-width:520px' }, [plot.svg]);
    host.appendChild(fig);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function search(qq) {
      var m = method.value, count = 0, found, seen = [];
      if (m === 'exact') {
        count = N;
        found = nearest(pts, all, qq, K);
        seen = all;
      } else if (m === 'ivf') {
        var p = parseInt(probes.value, 10);
        count = NLIST;
        var order = ivf.cents.map(function (c, i) { return i; }).sort(function (a, b) { return d2(ivf.cents[a], qq) - d2(ivf.cents[b], qq); }).slice(0, p);
        order.forEach(function (c) { seen = seen.concat(ivf.lists[c]); });
        count += seen.length;
        found = nearest(pts, seen, qq, K);
        return { found: found, count: count, seen: seen, cells: order };
      } else {
        var e = parseInt(ef.value, 10);
        var cache = {};
        // Each distance is computed once and counted once, whichever layer asks for it.
        var dist = function (i) {
          if (!(i in cache)) { cache[i] = d2(pts[i], qq); count++; }
          return cache[i];
        };
        var byDist = function (a, b) { return dist(a) - dist(b) || a - b; };
        // Top layer: greedy walk from a fixed entry point to the closest top-layer point.
        var cur = topIds[0];
        var moved = true;
        while (moved) {
          moved = false;
          g1[cur].forEach(function (n) { if (dist(n) < dist(cur)) { cur = n; moved = true; } });
        }
        // Bottom layer: beam search that keeps the ef closest points found so far.
        var visited = {};
        visited[cur] = true;
        var cand = [cur], res = [cur];
        while (cand.length) {
          cand.sort(byDist);
          var c = cand.shift();
          if (res.length >= e && dist(c) > dist(res[res.length - 1])) break;
          g0[c].forEach(function (n) {
            if (visited[n]) return;
            visited[n] = true;
            if (res.length < e || dist(n) < dist(res[res.length - 1])) {
              cand.push(n);
              res.push(n);
              res.sort(byDist);
              if (res.length > e) res.pop();
            }
          });
        }
        found = res.slice(0, K);
        seen = Object.keys(cache).map(Number);
      }
      return { found: found, count: count, seen: seen };
    }

    function draw() {
      probesOut.textContent = probes.value;
      efOut.textContent = ef.value;
      rowP.style.display = method.value === 'ivf' ? '' : 'none';
      rowE.style.display = method.value === 'graph' ? '' : 'none';
      var r = search(q);
      var truth = nearest(pts, all, q, K);
      var hit = r.found.filter(function (i) { return truth.indexOf(i) >= 0; }).length;
      plot.clear();
      if (method.value === 'graph') {
        r.seen.forEach(function (i) { g0[i].forEach(function (j) { if (j > i && r.seen.indexOf(j) >= 0) plot.line(pts[i][0], pts[i][1], pts[j][0], pts[j][1], 'pl-cm pl-thin'); }); });
      }
      for (var i = 0; i < N; i++) {
        var s = r.seen.indexOf(i) >= 0 && method.value !== 'exact';
        plot.dot(pts[i][0], pts[i][1], s ? 3.5 : 2.5, s ? 'pl-f2' : 'pl-fm');
      }
      if (method.value === 'ivf') ivf.cents.forEach(function (c, ci) { plot.dot(c[0], c[1], r.cells.indexOf(ci) >= 0 ? 6 : 4, 'pl-f4'); });
      truth.forEach(function (t) { if (r.found.indexOf(t) < 0) plot.dot(pts[t][0], pts[t][1], 6, 'pl-f5'); });
      r.found.forEach(function (f) { plot.dot(pts[f][0], pts[f][1], 6, 'pl-f3'); });
      plot.dot(q[0], q[1], 7, 'pl-f1');
      out.textContent = 'distances computed: ' + r.count + ' of ' + N + ' points (' + Math.round(100 * r.count / N) + '%)' +
        (method.value === 'ivf' ? ', counting the ' + NLIST + ' cell centres' : '') + '\n' +
        'recall@5: ' + hit + '/5' + (hit < K ? '   (larger dots in the fifth colour are true neighbours it missed)' : '') + '\n' +
        'Colours: query first colour, found neighbours third, points it examined second' + (method.value === 'ivf' ? ', cell centres fourth (larger = probed)' : '') + '.';
    }
    function average() {
      var r = HB.rng(99), sumC = 0, sumR = 0, n = 200;
      for (var t = 0; t < n; t++) {
        var qq = [r(), r()];
        var res = search(qq), truth = nearest(pts, all, qq, K);
        sumC += res.count;
        sumR += res.found.filter(function (i) { return truth.indexOf(i) >= 0; }).length / K;
      }
      draw();
      out.textContent += '\n\nOver ' + n + ' random queries with these settings: mean recall@5 = ' + (sumR / n).toFixed(3) + ', mean distances computed = ' + (sumC / n).toFixed(1) + ' of ' + N + '.';
    }
    plot.svg.addEventListener('click', function (e) { var p = plot.toData(e); q = [HB.clamp(p.x, 0, 1), HB.clamp(p.y, 0, 1)]; draw(); });
    rnd.addEventListener('click', function () { var r = Math.random; q = [r(), r()]; draw(); });
    avg.addEventListener('click', average);
    [probes, ef].forEach(function (x) { x.addEventListener('input', draw); });
    method.addEventListener('change', draw);
    draw();
  });
})();
