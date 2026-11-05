/* Chapter 27: cross-checking a value read from several sources. A small, general widget for one
   kind of figure at a time: a band check (the value must lie in a plausible range), a jump check
   (it may not move too far from the last accepted value), one vote per site, a trusted-sites
   list, a three-site rule and the median. Every figure is treated as read from a web page by a
   model. */
(function () {
  'use strict';
  var HB = window.HB;
  var MIN_HOSTS = 3, AGREE = 0.1;
  var KEYS = {
    'long-run inflation (%)': { low: 0, high: 6, jump: 1.5, posted: false },
    'posted one-year rate (%)': { low: 0, high: 12, jump: 1.5, posted: true },
    'official target (%)': { low: 0, high: 6, jump: null, posted: false }
  };
  var SECOND = ['co', 'com', 'org', 'gov', 'ac', 'bank', 'net'];
  var PRESETS = {
    'First figure, three unlisted sites': { key: 'long-run inflation (%)', last: '', rows: [['stats-a.example.org', false, 2.5], ['www.blog-b.example', false, 2.3], ['news-c.example', false, 2.4]] },
    'First figure, one unlisted site': { key: 'long-run inflation (%)', last: '', rows: [['www.blog-b.example', false, 2.3]] },
    'First figure, a listed site': { key: 'long-run inflation (%)', last: '', rows: [['www.official.example.gov', true, 2.2], ['news-c.example', false, 2.6]] },
    'Same site counted once': { key: 'long-run inflation (%)', last: '', rows: [['a.blog-b.example', false, 2.3], ['b.blog-b.example', false, 2.4], ['news-c.example', false, 2.5]] },
    'A jump is held': { key: 'long-run inflation (%)', last: '2.4', rows: [['www.official.example.gov', true, 4.4]] },
    'Three sites agree on the jump': { key: 'posted one-year rate (%)', last: '3.1', rows: [['bank-a.example.com', true, 4.75], ['rates-b.example', false, 4.75], ['www.c.example.co.uk', false, 4.75]] },
    'Out of band': { key: 'long-run inflation (%)', last: '', rows: [['stats-a.example.org', false, 25]] }
  };

  function siteOf(host) {
    var l = host.toLowerCase().split('.').filter(Boolean);
    if (l.length >= 3 && SECOND.indexOf(l[l.length - 2]) >= 0) return l.slice(-3).join('.');
    return l.slice(-2).join('.');
  }
  function statusFor(c, band, last) {
    if (!(band.low <= c.v && c.v <= band.high)) return ['out_of_bounds', 'outside ' + band.low + ' to ' + band.high];
    if (last !== null && last !== c.v) {
      var moved = Math.round(Math.abs(c.v - last) * 1e6) / 1e6;
      if (band.jump === null) return ['held', 'a target changed'];
      if (moved > band.jump) return ['held', 'moved ' + moved + ' (limit ' + band.jump + ')'];
    }
    return ['accepted', ''];
  }
  function median(pool, reason, out) {
    var o = pool.slice().sort(function (a, b) { return a.v - b.v; });
    var chosen = o[Math.floor((o.length - 1) / 2)];
    o.forEach(function (c) { out.set(c, c === chosen ? ['accepted', ''] : ['superseded', reason]); });
  }
  function decide(cands, band, last, posted) {
    var out = new Map(), first = [], jumped = [];
    cands.forEach(function (c) {
      var s = statusFor(c, band, last);
      if (s[0] === 'accepted' && last === null) first.push(c);
      else if (s[0] === 'held' && last !== null) jumped.push([c, s[1]]);
      else out.set(c, s);
    });
    if (jumped.length) {
      var bySite = {}, order = [];
      jumped.forEach(function (p) {
        var s = siteOf(p[0].host);
        if (bySite[s]) out.set(p[0], ['superseded', 'a second figure from the same site']);
        else { bySite[s] = p; order.push(s); }
      });
      var tol = posted ? 0 : AGREE;
      var sorted = order.map(function (s) { return bySite[s][0]; }).sort(function (a, b) { return a.v - b.v; });
      var agree = [];
      sorted.forEach(function (low, i) {
        var w = sorted.slice(i).filter(function (c) { return c.v - low.v <= tol + 1e-12; });
        if (w.length > agree.length) agree = w;
      });
      if (agree.length < MIN_HOSTS) order.forEach(function (s) { out.set(bySite[s][0], ['held', bySite[s][1]]); });
      else {
        var mid = agree[Math.floor((agree.length - 1) / 2)];
        var chosen = agree.filter(function (c) { return c.v === mid.v && c.listed; })[0] || mid;
        order.forEach(function (s) {
          var c = bySite[s][0];
          if (c === chosen) out.set(c, ['accepted', 'three sites agree; it replaces the last accepted figure']);
          else if (agree.indexOf(c) >= 0) out.set(c, ['superseded', 'agrees with the figure accepted from three sites']);
          else out.set(c, ['held', bySite[s][1]]);
        });
      }
    }
    if (first.length) {
      var seen = {}, kept = [];
      first.forEach(function (c) {
        var s = siteOf(c.host);
        if (seen[s]) out.set(c, ['superseded', 'a second figure from the same site']);
        else { seen[s] = true; kept.push(c); }
      });
      var listed = kept.filter(function (c) { return c.listed; });
      var others = kept.filter(function (c) { return !c.listed; });
      if (listed.length) {
        median(listed, 'not the median of the listed sites', out);
        others.forEach(function (c) { out.set(c, ['superseded', 'a listed site gave this figure']); });
      } else if (kept.length < MIN_HOSTS) {
        kept.forEach(function (c) { out.set(c, ['held', 'first figure from ' + kept.length + ' site(s), not listed; ' + MIN_HOSTS + ' needed']); });
      } else median(kept, 'not the median of the sites', out);
    }
    return out;
  }

  HB.ready(function () {
    var host = document.getElementById('w-settle');
    if (!host) return;
    var preset = HB.el('select', { 'aria-label': 'example' });
    Object.keys(PRESETS).forEach(function (p) { preset.appendChild(HB.el('option', { value: p, text: p })); });
    var keySel = HB.el('select', { 'aria-label': 'kind of figure' });
    Object.keys(KEYS).forEach(function (k) { keySel.appendChild(HB.el('option', { value: k, text: k })); });
    var last = HB.el('input', { type: 'text', 'aria-label': 'last accepted figure', placeholder: 'none', style: 'width:90px' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'example' }), preset]));
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'kind of figure' }), keySel, HB.el('label', { text: 'last accepted figure' }), last]));
    var table = HB.el('div');
    host.appendChild(table);
    var addBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Add a site' });
    host.appendChild(HB.el('div', { class: 'row' }, [addBtn]));
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(out);
    var rows = [];

    function load(name) {
      var p = PRESETS[name];
      keySel.value = p.key;
      last.value = p.last;
      rows = p.rows.map(function (r) { return { host: r[0], listed: r[1], v: r[2] }; });
      build();
    }
    function build() {
      table.innerHTML = '';
      rows.forEach(function (r, i) {
        var h = HB.el('input', { type: 'text', value: r.host, 'aria-label': 'site ' + (i + 1), style: 'width:min(220px,100%)' });
        var l = HB.el('input', { type: 'checkbox', checked: r.listed, 'aria-label': 'site ' + (i + 1) + ' is on the trusted list' });
        var v = HB.el('input', { type: 'number', step: '0.05', value: String(r.v), 'aria-label': 'figure from site ' + (i + 1) });
        var del = HB.el('button', { class: 'btn', type: 'button', text: 'Remove' });
        var st = HB.el('span');
        r.st = st;
        h.addEventListener('input', function () { r.host = h.value; draw(); });
        l.addEventListener('change', function () { r.listed = l.checked; draw(); });
        v.addEventListener('input', function () { r.v = parseFloat(v.value); draw(); });
        del.addEventListener('click', function () { rows.splice(i, 1); build(); });
        table.appendChild(HB.el('div', { class: 'row', style: 'margin-bottom:6px' }, [h, HB.el('label', null, [l, ' listed']), v, del, st]));
      });
      draw();
    }
    function draw() {
      var band = KEYS[keySel.value];
      var lv = last.value.trim() === '' ? null : parseFloat(last.value);
      if (lv !== null && isNaN(lv)) lv = null;
      var cands = rows.filter(function (r) { return r.host && !isNaN(r.v); });
      var res = decide(cands, band, lv, band.posted);
      var accepted = [];
      rows.forEach(function (r) {
        r.st.innerHTML = '';
        var s = res.get(r);
        if (!s) return;
        var cls = s[0] === 'accepted' ? 'ok' : s[0] === 'superseded' ? 'mid' : 'bad';
        r.st.appendChild(HB.el('span', { class: 'pill ' + cls, text: s[0] }));
        if (s[1]) r.st.appendChild(document.createTextNode(' ' + s[1]));
        if (s[0] === 'accepted') accepted.push(r.v);
      });
      out.textContent = 'band ' + band.low + ' to ' + band.high + ', jump limit ' + (band.jump === null ? 'none (any change is held)' : band.jump) +
        (band.posted ? ', a posted rate (three sites must match exactly to replace a held jump)' : ', agreement within 0.1 points') + '\n' +
        'sites counted: ' + Object.keys(cands.reduce(function (a, c) { a[siteOf(c.host)] = 1; return a; }, {})).join(', ') + '\n' +
        (accepted.length ? 'accepted: ' + accepted.join(', ') : lv !== null ? 'nothing new accepted from this run: the last accepted figure, ' + lv + ', stays in use while it is in date, until a person accepts a held one or three sites agree in a later run' : 'nothing accepted from this run, so there is no figure to use yet');
    }
    preset.addEventListener('change', function () { load(preset.value); });
    keySel.addEventListener('change', draw);
    last.addEventListener('input', draw);
    addBtn.addEventListener('click', function () { rows.push({ host: 'new-site.example', listed: false, v: 2.4 }); build(); });
    load(Object.keys(PRESETS)[0]);
  });
})();
