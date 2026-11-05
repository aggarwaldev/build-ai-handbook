/* Chapter 45: a budget guard. Before each call the guard works out the call's worst case (its
   input tokens at the input price plus max_tokens at the output price) and refuses the call when
   spent + worst case would reach the cap. A call that goes ahead is priced from its real tokens,
   rounded up to a millionth of a dollar so the meter never undercounts, and added to a running
   total. A meter that cannot be read refuses every call: the guard fails closed. Prices are US
   dollars per million tokens, input and output. */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-spend');
    if (!host) return;
    // Prices in cents per million tokens, so every sum stays a whole number until it is rounded.
    var PRICES = {
      'claude-haiku-5-5': { input: 10, output: 50 },
      'claude-sonnet-5-5': { input: 200, output: 1000 },
      'claude-opus-5-5': { input: 400, output: 2000 }
    };
    var sel = HB.el('select', { 'aria-label': 'model' });
    Object.keys(PRICES).forEach(function (k) { sel.appendChild(HB.el('option', { value: k, text: k })); });
    sel.value = 'claude-sonnet-5-5';

    function num(label, value, step) {
      var inp = HB.el('input', { type: 'number', min: '0', step: String(step || 1), value: String(value), 'aria-label': label });
      return { inp: inp, label: label };
    }
    var f = {
      input: num('input tokens', 3000),
      output: num('output tokens', 400),
      maxTokens: num('max_tokens', 1024),
      cap: num('cap USD', 0.05, 0.01)
    };
    var broken = HB.el('input', { type: 'checkbox', 'aria-label': 'the meter cannot be read' });
    function lab(x) { return HB.el('label', null, [x.label + ' ', x.inp]); }

    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['model ', sel])]));
    host.appendChild(HB.el('div', { class: 'row' }, [lab(f.input), lab(f.output), lab(f.maxTokens)]));
    host.appendChild(HB.el('div', { class: 'row' }, [lab(f.cap), HB.el('label', null, [broken, ' the meter cannot be read'])]));
    var one = HB.el('button', { type: 'button', class: 'btn primary', text: 'Make the call' });
    var five = HB.el('button', { type: 'button', class: 'btn', text: 'Make 5 calls' });
    var reset = HB.el('button', { type: 'button', class: 'btn', text: 'Reset' });
    host.appendChild(HB.el('div', { class: 'row' }, [one, five, reset]));

    var barFill = HB.el('span', { style: 'width:0%' });
    var barPct = HB.el('span', { class: 'pct', text: '0%' });
    host.appendChild(HB.el('div', { class: 'bar-row' }, [HB.el('span', { text: 'spent of cap' }), HB.el('div', { class: 'bar' }, [barFill]), barPct]));

    var grid = HB.el('div', { class: 'stat-grid' });
    function stat(label) {
      var v = HB.el('div', { class: 'v' });
      grid.appendChild(HB.el('div', { class: 'stat' }, [HB.el('div', { class: 'k', text: label }), v]));
      return v;
    }
    var vSpent = stat('spent'), vLeft = stat('left under the cap'), vMade = stat('calls made'), vRefused = stat('calls refused');
    host.appendChild(grid);

    var tbody = HB.el('tbody');
    var table = HB.el('table', null, [
      HB.el('thead', null, [HB.el('tr', null, ['#', 'model', 'in', 'out', 'cost', 'running total', 'guard'].map(function (h, i) {
        return HB.el('th', { class: i >= 2 && i <= 5 ? 'num' : null, text: h });
      }))]),
      tbody
    ]);
    host.appendChild(HB.el('div', { class: 'tbl-wrap' }, [table]));
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);

    var state;
    function clear() {
      state = { spent: 0, made: 0, refused: 0, n: 0 };
      tbody.textContent = '';
      out.textContent = 'No calls yet. Press "Make the call".';
      show();
    }

    function whole(x) { var n = Math.floor(parseFloat(x.inp.value)); return isFinite(n) && n > 0 ? n : 0; }
    function dollars(x) { var n = parseFloat(x.inp.value); return isFinite(n) && n > 0 ? n : 0; }
    function usd(micro) { return '$' + (micro / 1e6).toFixed(6); }
    function count(n) { return n.toLocaleString('en-US'); }

    function show() {
      var capMicro = Math.round(dollars(f.cap) * 1e6);
      vSpent.textContent = usd(state.spent);
      vLeft.textContent = usd(Math.max(0, capMicro - state.spent));
      vMade.textContent = state.made;
      vRefused.textContent = state.refused;
      var pct = capMicro > 0 ? Math.min(100, state.spent / capMicro * 100) : 0;
      barFill.style.width = pct.toFixed(1) + '%';
      barPct.textContent = Math.round(pct) + '%';
    }

    function addRow(cells) {
      var tr = HB.el('tr', null, cells.map(function (c, i) {
        return HB.el('td', { class: i >= 2 && i <= 5 ? 'num' : null, text: String(c) });
      }));
      tbody.insertBefore(tr, tbody.firstChild);
      while (tbody.children.length > 8) tbody.removeChild(tbody.lastChild);
    }

    function call() {
      var model = sel.value, p = PRICES[model];
      var tin = whole(f.input), maxT = whole(f.maxTokens);
      var tout = Math.min(whole(f.output), maxT);
      var capMicro = Math.round(dollars(f.cap) * 1e6);
      state.n += 1;
      var lines = ['Call ' + state.n + ' on ' + model + ':'];
      if (broken.checked) {
        state.refused += 1;
        addRow([state.n, model, count(tin), '–', '–', usd(state.spent), 'refused']);
        lines.push('The meter cannot be read, so the guard cannot know what has been spent.');
        lines.push('It refuses the call: it fails closed. No call is made and nothing is charged.');
        out.textContent = lines.join('\n');
        show();
        return false;
      }
      var worst = Math.ceil((tin * p.input + maxT * p.output) / 100);
      lines.push('worst case = (' + count(tin) + ' × $' + (p.input / 100).toFixed(2) + ' + ' + count(maxT) + ' × $' + (p.output / 100).toFixed(2) + ') / 1M = ' + usd(worst));
      lines.push('spent + worst case = ' + usd(state.spent) + ' + ' + usd(worst) + ' = ' + usd(state.spent + worst));
      if (state.spent + worst >= capMicro) {
        state.refused += 1;
        addRow([state.n, model, count(tin), '–', '–', usd(state.spent), 'refused']);
        lines.push('That reaches or passes the cap of ' + usd(capMicro) + ', so the call is refused before it is made.');
        if (capMicro - state.spent > 0) lines.push('Note: ' + usd(capMicro - state.spent) + ' of the cap is still unspent. The guard plans for the worst case.');
        out.textContent = lines.join('\n');
        show();
        return false;
      }
      var cost = Math.ceil((tin * p.input + tout * p.output) / 100);
      state.spent += cost;
      state.made += 1;
      addRow([state.n, model, count(tin), count(tout), usd(cost), usd(state.spent), 'ok']);
      lines.push('Below the cap of ' + usd(capMicro) + ': the call goes ahead.');
      lines.push('real cost = (' + count(tin) + ' × $' + (p.input / 100).toFixed(2) + ' + ' + count(tout) + ' × $' + (p.output / 100).toFixed(2) + ') / 1M = ' + usd(cost) + ' (rounded up to $0.000001)');
      if (whole(f.output) > maxT) lines.push('The output was cut to max_tokens = ' + count(maxT) + '; the reply would stop with stop reason max_tokens.');
      lines.push('Settled: the reservation is released and the running total is now ' + usd(state.spent) + '.');
      out.textContent = lines.join('\n');
      show();
      return true;
    }

    one.addEventListener('click', call);
    five.addEventListener('click', function () {
      for (var i = 0; i < 5; i++) { if (!call()) break; }
    });
    reset.addEventListener('click', clear);
    f.cap.inp.addEventListener('input', show);
    clear();
  });
})();
