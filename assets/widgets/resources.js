/* Resources page: filter the lists by type and level. Hidden items are only hidden; every
   link stays in the page source. */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-resfilter');
    if (!host) return;
    var items = Array.prototype.slice.call(document.querySelectorAll('.res-list li'));
    var types = ['all', 'video', 'article', 'docs', 'paper'];
    var levels = ['all', 'beginner', 'intermediate', 'advanced'];
    var state = { type: 'all', level: 'all' };
    var count = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    function group(name, values) {
      var row = HB.el('div', { class: 'steps', role: 'group', 'aria-label': name });
      values.forEach(function (v) {
        var b = HB.el('button', { type: 'button', text: v, 'aria-pressed': String(v === 'all') });
        if (v === 'all') b.className = 'on';
        b.addEventListener('click', function () {
          state[name] = v;
          Array.prototype.forEach.call(row.children, function (c) { c.className = c === b ? 'on' : ''; c.setAttribute('aria-pressed', String(c === b)); });
          apply();
        });
        row.appendChild(b);
      });
      host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: name }), row]));
    }
    group('type', types);
    group('level', levels);
    host.appendChild(count);
    function apply() {
      var shown = 0;
      items.forEach(function (li) {
        var ok = (state.type === 'all' || li.getAttribute('data-type') === state.type) &&
          (state.level === 'all' || li.getAttribute('data-level') === state.level);
        li.hidden = !ok;
        if (ok) shown++;
      });
      count.textContent = 'Showing ' + shown + ' of ' + items.length + ' entries.';
    }
    apply();
  });
})();
