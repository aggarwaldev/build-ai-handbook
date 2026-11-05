/* Chapter 29: an agent loop, one message at a time. The run is invented: a small trip-planning
   assistant with four allowed tools. The loop has a turn limit that counts tool rounds; when the
   limit is hit the loop stops and code makes one last call with no tools. A second widget
   multiplies per-step success over many steps. */
(function () {
  'use strict';
  var HB = window.HB;
  var Q = 'My trip budget has 1,800 pounds left and the flights are already paid. For how many days can I stay in Lisbon?';
  var START_TOKENS = 2400;

  function script(badInput) {
    var ev = [];
    ev.push({ who: 'code', title: 'Your code calls the model', body: 'Instructions, the four allowed tools (get_trip, get_daily_costs, days_affordable, convert_currency) and the question:\n' + Q, add: 0 });
    ev.push({ who: 'model', round: true, title: 'Model: tool request', body: 'get_trip {}', add: 40 });
    ev.push({ who: 'tool', title: 'Code runs the tool', body: JSON.stringify({ as_of: '2026-10-20', destination: 'Lisbon', currency: 'GBP', budget_left: '1800.00', flights_paid: true }), add: 90 });
    ev.push({ who: 'model', round: true, title: 'Model: tool request', body: 'get_daily_costs ' + JSON.stringify({ city: 'Lisbon' }), add: 40 });
    ev.push({ who: 'tool', title: 'Code runs the tool', body: JSON.stringify({ as_of: '2026-10-20', city: 'Lisbon', currency: 'GBP', hotel_per_night: '75.00', food_and_transport_per_day: '45.00', typical_day: '120.00' }), add: 130 });
    if (badInput) {
      ev.push({ who: 'model', round: true, title: 'Model: tool request', body: 'days_affordable ' + JSON.stringify({ budget_left: '1,800', daily_cost: '120.00', as_of: '2026-10-20' }), add: 60 });
      ev.push({ who: 'tool', title: 'Code runs the tool: an error, returned as data', body: JSON.stringify({ error: 'an input is not a valid number' }), add: 30, note: 'The comma made the amount unreadable. The loop does not crash: the model reads the error and can correct its call.' });
    }
    ev.push({ who: 'model', round: true, title: 'Model: tool request', body: 'days_affordable ' + JSON.stringify({ budget_left: '1800.00', daily_cost: '120.00', as_of: '2026-10-20' }), add: 60 });
    ev.push({ who: 'tool', title: 'Code runs the tool', body: JSON.stringify({ budget_left: '1800.00', daily_cost: '120.00', days_covered: '15.0000' }), add: 60 });
    ev.push({ who: 'model', title: 'Model: final answer (no tool request, so the loop ends)', body: JSON.stringify({ segments: [
      { kind: 'text', text: 'With the money you have left you could stay about' },
      { kind: 'ref', tool: 'days_affordable', field_path: 'days_covered', format: 'count' },
      { kind: 'text', text: 'days at a typical daily cost for the city.' }],
      based_on: [{ kind: 'tool', name: 'get_trip', as_of: '2026-10-20' }, { kind: 'tool', name: 'days_affordable', as_of: '2026-10-20' }] }, null, 1), add: 120 });
    ev.push({ who: 'code', title: 'Code validates, checks and renders', body: 'Schema valid. Every reference resolves in the trace, every source is dated, no digits in the prose.\nThe reader sees the days figure filled in by code, from the days_affordable result.', add: 0 });
    return ev;
  }

  HB.ready(function () {
    var host = document.getElementById('w-agentloop');
    if (host) loop(host);
    var c = document.getElementById('w-compound');
    if (c) compound(c);
  });

  function loop(host) {
    var maxIn = HB.el('input', { type: 'range', min: '1', max: '8', step: '1', value: '8', 'aria-label': 'maximum tool rounds' });
    var maxOut = HB.el('b');
    var bad = HB.el('input', { type: 'checkbox', 'aria-label': 'the first calculator call has a bad input' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['max tool rounds = ', maxOut]), maxIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, [bad, ' the first calculator call has a bad input'])]));
    var back = HB.el('button', { class: 'btn', type: 'button', text: 'Back' });
    var next = HB.el('button', { class: 'btn primary', type: 'button', text: 'Next message' });
    var all = HB.el('button', { class: 'btn', type: 'button', text: 'Run to the end' });
    var reset = HB.el('button', { class: 'btn', type: 'button', text: 'Reset' });
    host.appendChild(HB.el('div', { class: 'row' }, [back, next, all, reset]));
    var status = HB.el('div', { class: 'stat-grid' });
    host.appendChild(status);
    var log = HB.el('div', { 'aria-live': 'polite' });
    host.appendChild(log);
    var shown = 1;

    function events() {
      var ev = script(bad.checked), max = parseInt(maxIn.value, 10), out = [], rounds = 0;
      for (var i = 0; i < ev.length; i++) {
        if (ev[i].round) {
          if (rounds + 1 > max) {
            out.push(Object.assign({}, ev[i], { round: false, title: 'Model: one more tool request, past the limit' }));
            out.push({ who: 'stop', title: 'The framework stops the loop', body: 'Stopped: the limit of ' + max + ' tool rounds was reached', add: 0,
              note: 'The model asked for a tool round past the limit, so the loop ends without an answer.' });
            out.push({ who: 'code', title: 'Code makes one last call, with no tools', body: 'The exchange so far and the same output schema, with no tools and no new prompt.', add: 0,
              note: 'A well-built loop does this whenever the limit is hit. The model can only answer from the tool results it already has.' });
            out.push({ who: 'model', title: 'Model: final answer from what it has', body: 'An answer built from the results above, checked like any other.', add: 120,
              note: 'If this last call fails too, the loop gives up cleanly and your code decides what the user sees: a plain apology and a way to ask again, not a silent half-answer.' });
            return out;
          }
          rounds++;
        }
        out.push(ev[i]);
      }
      return out;
    }
    function stat(k, v) { return HB.el('div', { class: 'stat' }, [HB.el('div', { class: 'k', text: k }), HB.el('div', { class: 'v', text: v })]); }
    function draw() {
      maxOut.textContent = maxIn.value;
      var ev = events();
      if (shown > ev.length) shown = ev.length;
      back.disabled = shown <= 1;
      next.disabled = shown >= ev.length;
      all.disabled = shown >= ev.length;
      var calls = 0, rounds = 0, tokens = 0, ctx = START_TOKENS;
      log.innerHTML = '';
      for (var i = 0; i < shown; i++) {
        var e = ev[i];
        if (e.who === 'model') { calls++; tokens += ctx; if (e.round) rounds++; }
        ctx += e.add;
        var cls = e.who === 'stop' ? 'callout warn' : 'panel';
        var card = HB.el('div', { class: cls, style: 'margin-top:8px' + (e.who === 'model' ? ';border-left:4px solid var(--accent)' : '') }, [
          HB.el('h5', { text: (i + 1) + '. ' + e.title }),
          HB.el('div', { class: 'out', text: e.body })]);
        if (e.note) card.appendChild(HB.el('p', { style: 'margin-top:6px', text: e.note }));
        log.appendChild(card);
      }
      status.innerHTML = '';
      status.appendChild(stat('model calls', String(calls)));
      status.appendChild(stat('tool rounds', rounds + ' of ' + maxIn.value));
      status.appendChild(stat('input tokens sent', calls ? tokens.toLocaleString('en-US') : '0'));
      status.appendChild(stat('context now', ctx.toLocaleString('en-US') + ' tokens'));
    }
    next.addEventListener('click', function () { shown++; draw(); });
    back.addEventListener('click', function () { if (shown > 1) shown--; draw(); });
    all.addEventListener('click', function () { shown = 99; draw(); });
    reset.addEventListener('click', function () { shown = 1; draw(); });
    maxIn.addEventListener('input', draw);
    bad.addEventListener('change', draw);
    draw();
  }

  function compound(host) {
    var pIn = HB.el('input', { type: 'range', min: '0.80', max: '0.999', step: '0.001', value: '0.95', 'aria-label': 'chance each step is right' });
    var nIn = HB.el('input', { type: 'range', min: '1', max: '50', step: '1', value: '10', 'aria-label': 'number of steps' });
    var pOut = HB.el('b'), nOut = HB.el('b');
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['each step right with p = ', pOut]), pIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', null, ['steps n = ', nOut]), nIn]));
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);
    function draw() {
      var p = parseFloat(pIn.value), n = parseInt(nIn.value, 10);
      pOut.textContent = p.toFixed(3);
      nOut.textContent = String(n);
      var all = Math.pow(p, n);
      var need = Math.pow(0.9, 1 / n);
      out.textContent = 'chance every step is right = p^n = ' + p.toFixed(3) + '^' + n + ' = ' + all.toFixed(3) + '\n' +
        'expected wrong steps = n(1 - p) = ' + (n * (1 - p)).toFixed(2) + '\n' +
        'to finish all ' + n + ' steps right 90% of the time, each step needs p = 0.9^(1/' + n + ') = ' + need.toFixed(4);
    }
    pIn.addEventListener('input', draw);
    nIn.addEventListener('input', draw);
    draw();
  }
})();
