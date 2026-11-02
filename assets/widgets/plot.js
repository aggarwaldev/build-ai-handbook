/* A small SVG plotting helper shared by the maths and ML widgets.
   HB.Plot({ xmin, xmax, ymin, ymax, width, height }) draws axes and a grid, and returns
   helpers that convert data coordinates to SVG coordinates and draw into a layer that
   can be cleared and redrawn. Colours come from CSS classes, so themes switch freely. */
(function () {
  'use strict';
  var HB = window.HB;

  function niceStep(span, target) {
    var raw = span / target;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }

  function Plot(opts) {
    var o = Object.assign({ width: 560, height: 320, pad: 34, xmin: -5, xmax: 5, ymin: -5, ymax: 5, xlabel: 'x', ylabel: 'y', grid: true, logy: false }, opts || {});
    var svg = HB.svg('svg', { viewBox: '0 0 ' + o.width + ' ' + o.height, class: 'plot', role: 'img', 'aria-label': o.label || 'Plot' });
    var base = HB.svg('g');
    var layer = HB.svg('g');
    svg.appendChild(base);
    svg.appendChild(layer);
    var api = { svg: svg, layer: layer, o: o };

    function sx(x) { return o.pad + (x - o.xmin) / (o.xmax - o.xmin) * (o.width - o.pad - 10); }
    function sy(y) {
      if (o.logy) {
        var ly = Math.log10(Math.max(y, 1e-9));
        return 10 + (Math.log10(o.ymax) - ly) / (Math.log10(o.ymax) - Math.log10(o.ymin)) * (o.height - o.pad - 10);
      }
      return 10 + (o.ymax - y) / (o.ymax - o.ymin) * (o.height - o.pad - 10);
    }
    function ix(px) { return o.xmin + (px - o.pad) / (o.width - o.pad - 10) * (o.xmax - o.xmin); }
    function iy(py) { return o.ymax - (py - 10) / (o.height - o.pad - 10) * (o.ymax - o.ymin); }
    api.sx = sx; api.sy = sy; api.ix = ix; api.iy = iy;

    function axes() {
      base.innerHTML = '';
      var xs = niceStep(o.xmax - o.xmin, 8);
      var x0 = Math.ceil(o.xmin / xs) * xs;
      for (var x = x0; x <= o.xmax + 1e-9; x += xs) {
        if (o.grid) base.appendChild(HB.svg('line', { x1: sx(x), x2: sx(x), y1: sy(o.logy ? o.ymin : o.ymin), y2: sy(o.ymax), class: 'pl-grid' }));
        base.appendChild(HB.svg('text', { x: sx(x), y: o.height - o.pad + 16, class: 'pl-tick', 'text-anchor': 'middle', text: HB.fmt(x, 2) }));
      }
      if (o.logy) {
        for (var p = Math.ceil(Math.log10(o.ymin)); p <= Math.log10(o.ymax) + 1e-9; p++) {
          var v = Math.pow(10, p);
          if (o.grid) base.appendChild(HB.svg('line', { x1: sx(o.xmin), x2: sx(o.xmax), y1: sy(v), y2: sy(v), class: 'pl-grid' }));
          base.appendChild(HB.svg('text', { x: o.pad - 5, y: sy(v) + 4, class: 'pl-tick', 'text-anchor': 'end', text: v >= 1000 ? v.toExponential(0) : HB.fmt(v, 3) }));
        }
      } else {
        var ys = niceStep(o.ymax - o.ymin, 6);
        var y0 = Math.ceil(o.ymin / ys) * ys;
        for (var y = y0; y <= o.ymax + 1e-9; y += ys) {
          if (o.grid) base.appendChild(HB.svg('line', { x1: sx(o.xmin), x2: sx(o.xmax), y1: sy(y), y2: sy(y), class: 'pl-grid' }));
          base.appendChild(HB.svg('text', { x: o.pad - 5, y: sy(y) + 4, class: 'pl-tick', 'text-anchor': 'end', text: HB.fmt(y, 2) }));
        }
      }
      // axis lines through zero when zero is in range, else along the edges
      var ax = o.ymin <= 0 && o.ymax >= 0 && !o.logy ? sy(0) : sy(o.logy ? o.ymin : o.ymin);
      var ay = o.xmin <= 0 && o.xmax >= 0 ? sx(0) : sx(o.xmin);
      base.appendChild(HB.svg('line', { x1: sx(o.xmin), x2: sx(o.xmax), y1: ax, y2: ax, class: 'pl-axis' }));
      base.appendChild(HB.svg('line', { x1: ay, x2: ay, y1: sy(o.ymax), y2: sy(o.logy ? o.ymin : o.ymin), class: 'pl-axis' }));
      base.appendChild(HB.svg('text', { x: o.width - 12, y: o.height - 6, class: 'pl-label', 'text-anchor': 'end', text: o.xlabel }));
      base.appendChild(HB.svg('text', { x: 6, y: 12, class: 'pl-label', text: o.ylabel }));
    }
    axes();
    api.setRange = function (r) { Object.assign(o, r); axes(); };
    api.clear = function () { layer.innerHTML = ''; };
    api.fn = function (f, cls, n) {
      var steps = n || 240;
      var d = '';
      var pen = false;
      for (var i = 0; i <= steps; i++) {
        var x = o.xmin + (o.xmax - o.xmin) * i / steps;
        var y = f(x);
        var ok = isFinite(y) && (o.logy ? y > 0 : true) && y < o.ymax + (o.ymax - o.ymin) * 3 && y > o.ymin - (o.ymax - o.ymin) * 3;
        if (!ok) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + sx(x).toFixed(2) + ' ' + sy(y).toFixed(2);
        pen = true;
      }
      var path = HB.svg('path', { d: d, class: 'pl-line ' + (cls || 'pl-c1') });
      layer.appendChild(path);
      return path;
    };
    api.line = function (x1, y1, x2, y2, cls) {
      var l = HB.svg('line', { x1: sx(x1), y1: sy(y1), x2: sx(x2), y2: sy(y2), class: 'pl-line ' + (cls || 'pl-c2') });
      layer.appendChild(l);
      return l;
    };
    api.dot = function (x, y, r, cls) {
      var c = HB.svg('circle', { cx: sx(x), cy: sy(y), r: r || 5, class: 'pl-dot ' + (cls || 'pl-f1') });
      layer.appendChild(c);
      return c;
    };
    api.text = function (x, y, str, cls, anchor) {
      var t = HB.svg('text', { x: sx(x), y: sy(y), class: 'pl-text ' + (cls || ''), 'text-anchor': anchor || 'start', text: str });
      layer.appendChild(t);
      return t;
    };
    api.poly = function (pts, cls) {
      var p = HB.svg('polyline', { points: pts.map(function (q) { return sx(q[0]).toFixed(2) + ',' + sy(q[1]).toFixed(2); }).join(' '), class: 'pl-line ' + (cls || 'pl-c3') });
      layer.appendChild(p);
      return p;
    };
    api.toData = function (evt) {
      var pt = HB.svgPoint(svg, evt);
      return { x: ix(pt.x), y: iy(pt.y) };
    };
    return api;
  }

  HB.Plot = Plot;
})();
