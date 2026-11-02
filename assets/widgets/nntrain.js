/* Chapter 12: train a small neural network in the browser on 2-D points. Choose a dataset,
   the number of hidden layers and neurons, the activation and the learning rate, then train.
   The shaded background is the network's probability for the orange class at every point, so
   the decision boundary is where the shading changes. With no hidden layer the network is
   logistic regression and can only draw a straight boundary. Plain full-batch gradient descent
   on binary cross-entropy, written out by hand below. */
(function () {
  'use strict';
  var HB = window.HB;

  function dataset(name) {
    var r = HB.rng(name.length * 97 + 5), pts = [];
    function gauss() { var u = r() || 1e-9, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    for (var i = 0; i < 200; i++) {
      var x, y, c;
      if (name === 'blobs') {
        c = i % 2; x = (c ? 0.45 : -0.45) + gauss() * 0.22; y = (c ? 0.35 : -0.35) + gauss() * 0.22;
      } else if (name === 'xor') {
        x = r() * 2 - 1; y = r() * 2 - 1;
        if (Math.abs(x) < 0.08 || Math.abs(y) < 0.08) { i--; continue; }
        c = x * y > 0 ? 1 : 0;
      } else if (name === 'circle') {
        c = i % 2; var rad = c ? 0.25 * r() : 0.55 + 0.35 * r(); var a = r() * 2 * Math.PI;
        x = rad * Math.cos(a); y = rad * Math.sin(a);
      } else { // spiral
        c = i % 2; var t = (i >> 1) / 100 * 3.2; var rr = 0.1 + t / 3.6;
        var ang = t * 1.9 + (c ? Math.PI : 0);
        x = rr * Math.cos(ang) + gauss() * 0.03; y = rr * Math.sin(ang) + gauss() * 0.03;
      }
      pts.push({ x: x, y: y, c: c });
    }
    return pts;
  }

  var ACT = {
    tanh: { f: Math.tanh, d: function (a) { return 1 - a * a; } },
    relu: { f: function (z) { return z > 0 ? z : 0; }, d: function (a) { return a > 0 ? 1 : 0; } },
    sigmoid: { f: function (z) { return 1 / (1 + Math.exp(-z)); }, d: function (a) { return a * (1 - a); } }
  };
  function sig(z) { return 1 / (1 + Math.exp(-z)); }

  function Net(sizes, act, seed) {
    var r = HB.rng(seed);
    this.sizes = sizes; this.act = ACT[act]; this.W = []; this.b = [];
    for (var l = 0; l < sizes.length - 1; l++) {
      var lim = Math.sqrt(6 / (sizes[l] + sizes[l + 1])), W = [];
      for (var j = 0; j < sizes[l + 1]; j++) { var row = []; for (var k = 0; k < sizes[l]; k++) row.push((r() * 2 - 1) * lim); W.push(row); }
      this.W.push(W); this.b.push(new Array(sizes[l + 1]).fill(0));
    }
  }
  Net.prototype.forward = function (x) {
    var acts = [x];
    for (var l = 0; l < this.W.length; l++) {
      var prev = acts[l], next = [], last = l === this.W.length - 1;
      for (var j = 0; j < this.W[l].length; j++) {
        var z = this.b[l][j];
        for (var k = 0; k < prev.length; k++) z += this.W[l][j][k] * prev[k];
        next.push(last ? sig(z) : this.act.f(z));
      }
      acts.push(next);
    }
    return acts;
  };
  Net.prototype.epoch = function (pts, lr) {
    var L = this.W.length, gW = [], gb = [], loss = 0, correct = 0, self = this;
    for (var l = 0; l < L; l++) { gW.push(this.W[l].map(function (row) { return row.map(function () { return 0; }); })); gb.push(this.b[l].map(function () { return 0; })); }
    pts.forEach(function (p) {
      var acts = self.forward([p.x, p.y]);
      var out = acts[L][0];
      loss += -(p.c ? Math.log(out + 1e-12) : Math.log(1 - out + 1e-12));
      if ((out > 0.5 ? 1 : 0) === p.c) correct++;
      var delta = [out - p.c]; // dLoss/dz at the sigmoid output with cross-entropy
      for (var l2 = L - 1; l2 >= 0; l2--) {
        var prev = acts[l2], nd = l2 > 0 ? new Array(prev.length).fill(0) : null;
        for (var j = 0; j < delta.length; j++) {
          gb[l2][j] += delta[j];
          for (var k = 0; k < prev.length; k++) {
            gW[l2][j][k] += delta[j] * prev[k];
            if (nd) nd[k] += delta[j] * self.W[l2][j][k];
          }
        }
        if (nd) delta = nd.map(function (v, k) { return v * self.act.d(prev[k]); });
      }
    });
    var n = pts.length;
    for (var l3 = 0; l3 < L; l3++) for (var j2 = 0; j2 < this.W[l3].length; j2++) {
      this.b[l3][j2] -= lr * gb[l3][j2] / n;
      for (var k2 = 0; k2 < this.W[l3][j2].length; k2++) this.W[l3][j2][k2] -= lr * gW[l3][j2][k2] / n;
    }
    return { loss: loss / n, acc: correct / n };
  };
  Net.prototype.count = function () {
    var c = 0; this.W.forEach(function (W, l) { c += W.length * W[0].length + this.b[l].length; }, this); return c;
  };

  HB.ready(function () {
    var host = document.getElementById('w-nntrain');
    if (!host) return;
    var state = { data: 'xor', layers: 1, width: 4, act: 'tanh', lr: 0.5, epochs: 0, running: false, seed: 1 };
    function sel(label, opts, value, onChange) {
      var s = HB.el('select', { 'aria-label': label });
      opts.forEach(function (o) { s.appendChild(HB.el('option', { value: String(o[0]), text: o[1], selected: String(o[0]) === String(value) })); });
      s.addEventListener('change', function () { onChange(s.value); });
      return HB.el('label', null, [label + ' ', s]);
    }
    var row1 = HB.el('div', { class: 'row' }, [
      sel('data', [['blobs', 'two blobs'], ['xor', 'XOR'], ['circle', 'ring'], ['spiral', 'spiral']], state.data, function (v) { state.data = v; rebuild(); }),
      sel('hidden layers', [[0, '0 (logistic regression)'], [1, '1'], [2, '2']], state.layers, function (v) { state.layers = +v; rebuild(); }),
      sel('neurons per layer', [[2, '2'], [3, '3'], [4, '4'], [6, '6'], [8, '8']], state.width, function (v) { state.width = +v; rebuild(); }),
      sel('activation', [['tanh', 'tanh'], ['relu', 'ReLU'], ['sigmoid', 'sigmoid']], state.act, function (v) { state.act = v; rebuild(); })
    ]);
    var lrIn = HB.el('input', { type: 'range', min: '0.01', max: '2', step: '0.01', value: String(state.lr), 'aria-label': 'learning rate' });
    var lrOut = HB.el('b');
    var trainBtn = HB.el('button', { class: 'btn primary', type: 'button', text: 'Train' });
    var stepBtn = HB.el('button', { class: 'btn', type: 'button', text: '+10 epochs' });
    var resetBtn = HB.el('button', { class: 'btn', type: 'button', text: 'New random start' });
    host.appendChild(row1);
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['learning rate = ', lrOut]), lrIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [trainBtn, stepBtn, resetBtn]));
    var SIZE = 320, GRID = 40;
    var canvas = HB.el('canvas', { width: SIZE, height: SIZE, style: 'width:100%; max-width:420px; aspect-ratio:1; border-radius:8px; display:block', role: 'img', 'aria-label': 'Training points and the network decision region' });
    host.appendChild(canvas);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);
    var ctx = canvas.getContext('2d');
    var pts, net, last = { loss: NaN, acc: NaN };

    function rebuild() {
      pts = dataset(state.data);
      var sizes = [2];
      for (var i = 0; i < state.layers; i++) sizes.push(state.width);
      sizes.push(1);
      net = new Net(sizes, state.act, state.seed);
      state.epochs = 0;
      last = net.epoch(pts, 0); // measure without moving
      draw();
    }
    function hexToRgb(h) {
      var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h.trim());
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
    }
    function draw() {
      lrOut.textContent = HB.fmt(state.lr, 2);
      var cA = hexToRgb(HB.cssVar('--c1')), cB = hexToRgb(HB.cssVar('--c3')), bg = hexToRgb(HB.cssVar('--surface'));
      var cell = SIZE / GRID;
      for (var gx = 0; gx < GRID; gx++) for (var gy = 0; gy < GRID; gy++) {
        var x = -1 + (gx + 0.5) * 2 / GRID, y = 1 - (gy + 0.5) * 2 / GRID;
        var p = net.forward([x, y])[net.W.length][0];
        var t = Math.abs(p - 0.5) * 2 * 0.55, c = p > 0.5 ? cB : cA;
        ctx.fillStyle = 'rgb(' + [0, 1, 2].map(function (k) { return Math.round(bg[k] * (1 - t) + c[k] * t); }).join(',') + ')';
        ctx.fillRect(gx * cell, gy * cell, cell + 0.5, cell + 0.5);
      }
      pts.forEach(function (q) {
        ctx.beginPath();
        ctx.arc((q.x + 1) / 2 * SIZE, (1 - q.y) / 2 * SIZE, 4, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgb(' + (q.c ? cB : cA).join(',') + ')';
        ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
      });
      out.textContent =
        'network: ' + net.sizes.join(' → ') + '   (' + net.count() + ' parameters)\n' +
        'epochs: ' + state.epochs + '   loss: ' + HB.fmt(last.loss, 4) + '   accuracy: ' + HB.fmt(last.acc * 100, 1) + '%' +
        (!isFinite(last.loss) ? '\nThe loss blew up: lower the learning rate and start again.' : '') +
        (state.layers === 0 && state.data !== 'blobs' && state.epochs > 100 ? '\nNo hidden layer means a straight boundary: this data cannot be split by one line.' : '');
    }
    function train(n) { for (var i = 0; i < n; i++) { last = net.epoch(pts, state.lr); state.epochs++; } }
    function loop() {
      if (!state.running) return;
      train(5); draw();
      if (state.epochs >= 5000) { state.running = false; trainBtn.textContent = 'Train'; return; }
      window.requestAnimationFrame(loop);
    }
    trainBtn.addEventListener('click', function () {
      state.running = !state.running;
      trainBtn.textContent = state.running ? 'Pause' : 'Train';
      if (state.running) loop();
    });
    stepBtn.addEventListener('click', function () { train(10); draw(); });
    resetBtn.addEventListener('click', function () { state.seed++; rebuild(); });
    lrIn.addEventListener('input', function () { state.lr = parseFloat(lrIn.value); draw(); });
    HB.onTheme(draw);
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', draw);
    }
    rebuild();
  });
})();
