/* Chapter 22: a context-window budget. Sliders set the tokens in each part of one call; the
   widget stacks them in a bar, prices the call with the per-million-token prices of three
   Claude models (the same prices the labs use), and shows what caching the stable prefix
   (system prompt and tool definitions) would save at a cache-read price of 0.1 x the input
   price. */
(function () {
  'use strict';
  var HB = window.HB;
  var MODELS = {
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-opus-5-5': { input: 4, output: 20 }
  };
  var PARTS = [
    { id: 'system', label: 'system prompt', v: 1500, max: 8000, cls: 'var(--c1)', stable: true },
    { id: 'tools', label: 'tool definitions', v: 2000, max: 8000, cls: 'var(--c5)', stable: true },
    { id: 'history', label: 'earlier turns', v: 6000, max: 40000, cls: 'var(--c2)' },
    { id: 'docs', label: 'retrieved passages', v: 1200, max: 20000, cls: 'var(--c3)' },
    { id: 'results', label: 'tool results', v: 2500, max: 20000, cls: 'var(--c4)' },
    { id: 'question', label: 'question', v: 50, max: 600, cls: 'var(--c6)' }
  ];

  HB.ready(function () {
    var host = document.getElementById('w-ctxbudget');
    if (!host) return;
    var vals = {};
    PARTS.forEach(function (p) {
      vals[p.id] = p.v;
      var inp = HB.el('input', { type: 'range', min: '0', max: String(p.max), step: '50', value: String(p.v), 'aria-label': p.label + ' tokens' });
      var o = HB.el('b');
      inp.addEventListener('input', function () { vals[p.id] = parseInt(inp.value, 10); draw(); });
      p.out = o;
      host.appendChild(HB.el('div', { class: 'row' }, [HB.el('span', { style: 'display:inline-block;width:12px;height:12px;border-radius:3px;background:' + p.cls }), HB.el('label', null, [p.label + ' ', o]), inp]));
    });
    var outTok = HB.el('input', { type: 'range', min: '50', max: '4000', step: '50', value: '600', 'aria-label': 'output tokens' });
    var outTokB = HB.el('b');
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['output tokens ', outTokB]), outTok]));
    var model = HB.el('select', { 'aria-label': 'model' });
    Object.keys(MODELS).forEach(function (m) { model.appendChild(HB.el('option', { value: m, text: m, selected: m === 'claude-sonnet-5-5' })); });
    var cache = HB.el('input', { type: 'checkbox', 'aria-label': 'cache the stable prefix' });
    var perDay = HB.el('input', { type: 'number', value: '1000', min: '1', step: '100', 'aria-label': 'calls per day' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'model' }), model, HB.el('label', null, [cache, ' cache system prompt and tools']), HB.el('label', { text: 'calls per day' }), perDay]));
    var bar = HB.el('div', { style: 'display:flex;height:26px;border-radius:6px;overflow:hidden;margin:10px 0;background:var(--surface-2)' });
    host.appendChild(bar);
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    function usd(x) { return '$' + (x < 0.01 ? x.toFixed(5) : x < 10 ? x.toFixed(4) : x.toFixed(2)); }
    function draw() {
      var total = 0, stable = 0;
      PARTS.forEach(function (p) { p.out.textContent = vals[p.id].toLocaleString('en-GB'); total += vals[p.id]; if (p.stable) stable += vals[p.id]; });
      var o = parseInt(outTok.value, 10);
      outTokB.textContent = o.toLocaleString('en-GB');
      bar.innerHTML = '';
      PARTS.forEach(function (p) {
        if (!vals[p.id]) return;
        bar.appendChild(HB.el('span', { title: p.label + ': ' + vals[p.id], style: 'display:block;height:100%;width:' + (100 * vals[p.id] / Math.max(1, total)).toFixed(2) + '%;background:' + p.cls }));
      });
      var price = MODELS[model.value];
      var plain = (total * price.input + o * price.output) / 1e6;
      var cached = ((total - stable) * price.input + stable * price.input * 0.1 + o * price.output) / 1e6;
      var cost = cache.checked ? cached : plain;
      var n = Math.max(1, parseInt(perDay.value, 10) || 1);
      out.textContent = [
        'input tokens: ' + total.toLocaleString('en-GB') + '   of which stable prefix: ' + stable.toLocaleString('en-GB') + ' (' + Math.round(100 * stable / Math.max(1, total)) + '%)',
        'input cost: ' + usd(total * price.input / 1e6) + '   output cost: ' + usd(o * price.output / 1e6) + '   (' + price.input + ' and ' + price.output + ' dollars per million tokens)',
        'one call: ' + usd(plain) + (cache.checked ? '   with the prefix read from cache: ' + usd(cached) + ' (cache writes not counted)' : ''),
        'per day at ' + n.toLocaleString('en-GB') + ' calls: ' + usd(cost * n) + '   per 30 days: ' + usd(cost * n * 30),
        'largest part: ' + PARTS.slice().sort(function (a, b) { return vals[b.id] - vals[a.id]; })[0].label
      ].join('\n');
    }
    [outTok, perDay].forEach(function (i) { i.addEventListener('input', draw); });
    model.addEventListener('change', draw);
    cache.addEventListener('change', draw);
    draw();
  });
})();
