/* Chapter 28: typed references. A model's answer names a tool and a field path instead of typing
   a number; code looks the value up in the tool results, formats it and checks the answer. The
   trace below is an invented bookshop order with invented values. The rendering writes money as
   "CCY 1,234.56", a percent with "%" and a date as "20 Oct 2026", and the checks are a small
   set of the ones a real answer pipeline runs: the tool was called, the path resolves, the prose
   has no digits and every source is dated. */
(function () {
  'use strict';
  var HB = window.HB;
  var TRACE = [{
    tool: 'get_order', args: {},
    result: {
      currency: 'GBP', as_of: '2026-10-20',
      figures: { subtotal: '22.00', delivery: '3.40', total: '25.40', delivery_pct: '15.45' },
      lines: [
        { sku: 'BK-101', title: 'Field Guide to Birds', quantity: '2', unit_price: '8.00', line_total: '16.00', as_of: '2026-10-20' },
        { sku: 'BK-207', title: 'Pocket Atlas', quantity: '1', unit_price: '6.00', line_total: '6.00', as_of: '2026-10-20' }
      ]
    }
  }];
  var PRESETS = [
    { label: 'A correct answer', t1: 'Your order comes to', tool1: 'get_order', path1: 'figures.total', fmt1: 'money', t2: ', and delivery adds', tool2: 'get_order', path2: 'figures.delivery_pct', fmt2: 'percent', t3: 'on top of the books.', asof: true },
    { label: 'The model types a number', t1: 'Your 2 titles come to', tool1: 'get_order', path1: 'figures.total', fmt1: 'money', t2: ', and delivery adds', tool2: 'get_order', path2: 'figures.delivery_pct', fmt2: 'percent', t3: 'on top of the books.', asof: true },
    { label: 'A path that does not exist', t1: 'Your order comes to', tool1: 'get_order', path1: 'figures.grand_total', fmt1: 'money', t2: ', and your third item costs', tool2: 'get_order', path2: 'lines.2.line_total', fmt2: 'money', t3: '.', asof: true },
    { label: 'A tool that was never called', t1: 'You have', tool1: 'get_loyalty', path1: 'credit', fmt1: 'money', t2: 'in loyalty credit and an order worth', tool2: 'get_order', path2: 'figures.total', fmt2: 'money', t3: '.', asof: true },
    { label: 'No as-of date in the sources', t1: 'Your order comes to', tool1: 'get_order', path1: 'figures.total', fmt1: 'money', t2: ', and delivery adds', tool2: 'get_order', path2: 'figures.delivery_pct', fmt2: 'percent', t3: 'on top of the books.', asof: false }
  ];
  var TOOLS = ['get_order', 'get_loyalty'];
  var FORMATS = ['money', 'percent', 'count', 'units', 'date'];

  function resolve(obj, path) {
    var cur = obj, parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return null;
      if (Array.isArray(cur)) {
        if (!/^\d+$/.test(parts[i])) return null;
        var n = parseInt(parts[i], 10);
        if (n >= cur.length) return null;
        cur = cur[n];
      } else if (typeof cur === 'object') {
        if (!Object.prototype.hasOwnProperty.call(cur, parts[i])) return null;
        cur = cur[parts[i]];
      } else return null;
    }
    return cur;
  }
  function callOf(tool) {
    for (var i = 0; i < TRACE.length; i++) if (TRACE[i].tool === tool) return TRACE[i];
    return null;
  }
  function money(v) {
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function show(seg) {
    var call = callOf(seg.tool);
    var v = call ? resolve(call.result, seg.field_path) : null;
    if (!call || v === null || typeof v === 'object') return '[' + seg.tool + '.' + seg.field_path + ']';
    if (seg.format === 'money') return call.result.currency + ' ' + money(v);
    if (seg.format === 'percent') return v + '%';
    if (seg.format === 'date') return dateText(String(v));
    return String(v);
  }
  // A date as the page writes it, "20 Oct 2026"; a value that is not a date is shown as it is.
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateText(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return s;
    return d + ' ' + MONTHS[mo - 1] + ' ' + y;
  }

  HB.ready(function () {
    var host = document.getElementById('w-toolref');
    if (!host) return;
    var pick = HB.el('select', { 'aria-label': 'example' });
    PRESETS.forEach(function (p, i) { pick.appendChild(HB.el('option', { value: String(i), text: p.label })); });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'example' }), pick]));

    function textIn(label) { return HB.el('input', { type: 'text', 'aria-label': label, style: 'width: min(420px, 100%)' }); }
    function selectIn(label, opts) {
      var s = HB.el('select', { 'aria-label': label });
      opts.forEach(function (o) { s.appendChild(HB.el('option', { value: o, text: o })); });
      return s;
    }
    var t1 = textIn('text segment 1'), t2 = textIn('text segment 2'), t3 = textIn('text segment 3');
    var tool1 = selectIn('reference 1 tool', TOOLS), tool2 = selectIn('reference 2 tool', TOOLS);
    var path1 = HB.el('input', { type: 'text', 'aria-label': 'reference 1 field path', style: 'width: 220px; max-width: 100%' });
    var path2 = HB.el('input', { type: 'text', 'aria-label': 'reference 2 field path', style: 'width: 220px; max-width: 100%' });
    var fmt1 = selectIn('reference 1 format', FORMATS), fmt2 = selectIn('reference 2 format', FORMATS);
    var asof = HB.el('input', { type: 'checkbox', 'aria-label': 'sources carry the as-of date' });
    var panel = HB.el('div', { class: 'panel' }, [
      HB.el('h5', { text: 'The answer the model returns' }),
      HB.el('div', { class: 'row' }, [HB.el('label', { text: 'text' }), t1]),
      HB.el('div', { class: 'row' }, [HB.el('label', { text: 'ref' }), tool1, path1, fmt1]),
      HB.el('div', { class: 'row' }, [HB.el('label', { text: 'text' }), t2]),
      HB.el('div', { class: 'row' }, [HB.el('label', { text: 'ref' }), tool2, path2, fmt2]),
      HB.el('div', { class: 'row' }, [HB.el('label', { text: 'text' }), t3]),
      HB.el('div', { class: 'row' }, [HB.el('label', null, [asof, ' based_on gives each tool with its as_of date'])])
    ]);
    host.appendChild(panel);
    var traceBox = HB.el('details', null, [HB.el('summary', { text: 'The tool trace this answer is checked against' }),
      HB.el('div', { class: 'out', text: JSON.stringify(TRACE, null, 2) })]);
    host.appendChild(traceBox);
    var rendered = HB.el('div', { class: 'out', 'aria-live': 'polite', style: 'margin-top:10px' });
    var verdict = HB.el('div', { class: 'panel' });
    var json = HB.el('details', null, [HB.el('summary', { text: 'The answer as JSON' })]);
    var jsonOut = HB.el('div', { class: 'out' });
    json.appendChild(jsonOut);
    host.appendChild(rendered);
    host.appendChild(verdict);
    host.appendChild(json);

    function load(i) {
      var p = PRESETS[i];
      t1.value = p.t1; t2.value = p.t2; t3.value = p.t3;
      tool1.value = p.tool1; tool2.value = p.tool2; path1.value = p.path1; path2.value = p.path2;
      fmt1.value = p.fmt1; fmt2.value = p.fmt2; asof.checked = p.asof;
      draw();
    }
    function answer() {
      var segs = [
        { kind: 'text', text: t1.value },
        { kind: 'ref', tool: tool1.value, field_path: path1.value.trim(), format: fmt1.value },
        { kind: 'text', text: t2.value },
        { kind: 'ref', tool: tool2.value, field_path: path2.value.trim(), format: fmt2.value },
        { kind: 'text', text: t3.value }
      ];
      var tools = [];
      segs.forEach(function (s) { if (s.kind === 'ref' && tools.indexOf(s.tool) < 0) tools.push(s.tool); });
      var based = tools.map(function (t) {
        var c = callOf(t);
        var src = { kind: 'tool', name: t };
        if (asof.checked && c) src.as_of = c.result.as_of;
        return src;
      });
      return { segments: segs, based_on: based };
    }
    function render(a) {
      var out = '';
      a.segments.forEach(function (s) {
        var part = s.kind === 'text' ? s.text : show(s);
        if (!out) out = part;
        else if (/^[.,;:)]/.test(part)) out += part;
        else out += ' ' + part;
      });
      return out.trim();
    }
    function checks(a) {
      var reasons = [];
      var hasText = a.segments.some(function (s) { return s.kind === 'text' && s.text.trim(); });
      if (!hasText) reasons.push('answer has no text');
      a.segments.forEach(function (s) {
        if (s.kind !== 'ref') return;
        var c = callOf(s.tool);
        if (!c) { reasons.push('typed reference tool not in trace: ' + s.tool); return; }
        var v = resolve(c.result, s.field_path);
        if (v === null) reasons.push('typed reference does not resolve: ' + s.tool + '.' + s.field_path);
      });
      if (a.segments.some(function (s) { return s.kind === 'text' && /[0-9]/.test(s.text); })) reasons.push('digits in prose segment');
      a.based_on.forEach(function (b) { if (!b.as_of) reasons.push('missing as-of for tool source: ' + b.name); });
      return reasons;
    }
    function draw() {
      var a = answer();
      rendered.textContent = 'What the customer sees:\n' + render(a);
      var r = checks(a);
      verdict.innerHTML = '';
      verdict.appendChild(HB.el('h5', { text: 'The deterministic checks' }));
      if (!r.length) verdict.appendChild(HB.el('p', null, [HB.el('span', { class: 'pill ok', text: 'pass' }), ' Every figure comes from a tool result, and every source is dated.']));
      else {
        verdict.appendChild(HB.el('p', null, [HB.el('span', { class: 'pill bad', text: 'blocked' }), ' The answer is not shown. These block reasons go to the retry:']));
        var ul = HB.el('ul');
        r.forEach(function (x) { ul.appendChild(HB.el('li', null, [HB.el('code', { text: x })])); });
        verdict.appendChild(ul);
      }
      jsonOut.textContent = JSON.stringify(a, null, 2);
    }
    pick.addEventListener('change', function () { load(parseInt(pick.value, 10)); });
    [t1, t2, t3, path1, path2].forEach(function (x) { x.addEventListener('input', draw); });
    [tool1, tool2, fmt1, fmt2, asof].forEach(function (x) { x.addEventListener('change', draw); });
    load(0);
  });
})();
