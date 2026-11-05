/* Chapter 11: overfitting. Fit a polynomial of a chosen degree to 10 noisy training points
   drawn from a smooth curve, with an optional L2 (ridge) penalty. Ten other points from the
   same curve are held out for validation. A second plot shows training and validation error
   for every degree at the current penalty. */
(function () {
  'use strict';
  var HB = window.HB;
  function truth(x) { return Math.sin(2.6 * x) + 0.3 * x; }
  function makeSet(seed, n, offset) {
    var r = HB.rng(seed), pts = [];
    for (var i = 0; i < n; i++) {
      var x = -1 + (i + offset) * 2 / (n - 1 + 0.6);
      pts.push({ x: x, y: truth(x) + (r() - 0.5) * 0.7 });
    }
    return pts;
  }
  // Solve (X^T X + lambda I) w = X^T y by Gaussian elimination with partial pivoting.
  function fit(pts, degree, lambda) {
    var m = degree + 1, A = [], v = [];
    for (var i = 0; i < m; i++) { A.push(new Array(m).fill(0)); v.push(0); }
    pts.forEach(function (p) {
      var pw = [];
      for (var k = 0; k < m; k++) pw.push(Math.pow(p.x, k));
      for (var a = 0; a < m; a++) { v[a] += pw[a] * p.y; for (var c = 0; c < m; c++) A[a][c] += pw[a] * pw[c]; }
    });
    for (var d = 1; d < m; d++) A[d][d] += lambda; // the bias term is not penalised
    for (var col = 0; col < m; col++) {
      var piv = col;
      for (var row = col + 1; row < m; row++) if (Math.abs(A[row][col]) > Math.abs(A[piv][col])) piv = row;
      var tmp = A[col]; A[col] = A[piv]; A[piv] = tmp; var tv = v[col]; v[col] = v[piv]; v[piv] = tv;
      if (Math.abs(A[col][col]) < 1e-14) continue;
      for (var r2 = col + 1; r2 < m; r2++) {
        var f = A[r2][col] / A[col][col];
        for (var c2 = col; c2 < m; c2++) A[r2][c2] -= f * A[col][c2];
        v[r2] -= f * v[col];
      }
    }
    var w = new Array(m).fill(0);
    for (var r3 = m - 1; r3 >= 0; r3--) {
      var s = v[r3];
      for (var c3 = r3 + 1; c3 < m; c3++) s -= A[r3][c3] * w[c3];
      w[r3] = Math.abs(A[r3][r3]) < 1e-14 ? 0 : s / A[r3][r3];
    }
    return w;
  }
  function predict(w, x) { var s = 0; for (var k = w.length - 1; k >= 0; k--) s = s * x + w[k]; return s; }
  function mse(w, pts) { return pts.reduce(function (a, p) { var e = predict(w, p.x) - p.y; return a + e * e; }, 0) / pts.length; }

  HB.ready(function () {
    var host = document.getElementById('w-overfit');
    if (!host) return;
    var train = makeSet(21, 10, 0), val = makeSet(22, 10, 0.5);
    var degree = 3, lamExp = -9; // lambda = 10^lamExp, -9 means effectively none
    var dIn = HB.el('input', { type: 'range', min: '0', max: '9', step: '1', value: '3', 'aria-label': 'polynomial degree' });
    var lIn = HB.el('input', { type: 'range', min: '-9', max: '1', step: '1', value: '-9', 'aria-label': 'penalty strength, as a power of ten' });
    var dOut = HB.el('b'), lOut = HB.el('b');
    var plot = HB.Plot({ xmin: -1.1, xmax: 1.1, ymin: -2.2, ymax: 2.2, label: 'Polynomial fit to training points' });
    var curve = HB.Plot({ xmin: 0, xmax: 9, ymin: 0.01, ymax: 10, logy: true, xlabel: 'degree', ylabel: 'error', height: 220, label: 'Training and validation error by degree' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['degree = ', dOut]), dIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['L2 penalty λ = ', lOut]), lIn]));
    host.appendChild(plot.svg);
    host.appendChild(HB.el('small', { text: 'Error for every degree at this penalty (log scale). Blue: training. Orange: validation.' }));
    host.appendChild(curve.svg);
    host.appendChild(out);

    function draw() {
      var lambda = lamExp <= -9 ? 0 : Math.pow(10, lamExp);
      dOut.textContent = String(degree);
      lOut.textContent = lambda === 0 ? '0' : '10^' + lamExp;
      var w = fit(train, degree, lambda + 1e-12);
      plot.clear();
      plot.fn(truth, 'pl-cm pl-thin pl-dash');
      plot.fn(function (x) { return predict(w, x); }, 'pl-c1', 300);
      train.forEach(function (p) { plot.dot(p.x, p.y, 6, 'pl-f1'); });
      val.forEach(function (p) { plot.dot(p.x, p.y, 5, 'pl-f3'); });
      curve.clear();
      var tr = [], va = [];
      for (var d = 0; d <= 9; d++) {
        var wd = fit(train, d, lambda + 1e-12);
        tr.push([d, Math.max(mse(wd, train), 0.011)]);
        va.push([d, Math.min(Math.max(mse(wd, val), 0.011), 9.9)]);
      }
      curve.poly(tr, 'pl-c1');
      curve.poly(va, 'pl-c3');
      curve.dot(degree, tr[degree][1], 5, 'pl-f1');
      curve.dot(degree, va[degree][1], 5, 'pl-f3');
      var size = Math.sqrt(w.slice(1).reduce(function (a, x) { return a + x * x; }, 0));
      out.textContent =
        'training error (blue dots, used to fit): ' + HB.fmt(mse(w, train), 4) + '\n' +
        'validation error (orange dots, never seen): ' + HB.fmt(mse(w, val), 4) + '\n' +
        'size of the weights √Σw² = ' + HB.fmt(size, 2) + '\n' +
        (degree >= 7 && lambda < 1e-4 ? 'Overfitting: the curve threads the blue dots and swings wildly between them.' :
          degree <= 1 ? 'Underfitting: a line is too simple for this curve, so both errors stay high.' :
          'A reasonable fit: the curve follows the trend, not the noise.');
    }
    dIn.addEventListener('input', function () { degree = parseInt(dIn.value, 10); draw(); });
    lIn.addEventListener('input', function () { lamExp = parseInt(lIn.value, 10); draw(); });
    draw();
  });
})();
