/* Chapter 34: a toy personal-data scrubber. It uses three regular expressions and a short list of
   first names, where a real scrubber uses a trained entity recogniser (for example Presidio with a
   spaCy model) and custom recognisers. What it shares with a real one is the shape: personal data
   becomes a placeholder such as <PERSON_A> before any model sees the text, and code puts the values
   back afterwards. */
(function () {
  'use strict';
  var HB = window.HB;
  var NAMES = ['Mira', 'Rohan', 'Priya', 'Omar', 'Fatima', 'Arjun'];
  var RULES = [
    { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    { kind: 'PHONE', re: /\+?\d[\d ]{8,14}\d/g },
    { kind: 'TAXID', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
    { kind: 'PERSON', re: new RegExp('\\b(' + NAMES.join('|') + ')\\b', 'g') }
  ];
  var SAMPLES = [
    'Hi, I am Mira. My husband Omar and I want to save for a house. Reach me on +44 7700 900123 or mira.k@example.com.',
    'Please check tax ID ABCDE1234F for Rohan before he invests.',
    'My brother Vikram wants to know if he should sell.'
  ];

  function scrub(text) {
    var found = [];
    RULES.forEach(function (rule) {
      var re = new RegExp(rule.re.source, 'g'), m;
      while ((m = re.exec(text)) !== null) found.push({ kind: rule.kind, start: m.index, end: m.index + m[0].length, value: m[0] });
    });
    found.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    var kept = [], last = -1;
    found.forEach(function (f) { if (f.start >= last) { kept.push(f); last = f.end; } });
    var map = {}, counters = {}, byValue = {}, out = '', pos = 0;
    kept.forEach(function (f) {
      var key = f.kind + '|' + f.value;
      if (!byValue[key]) {
        var i = counters[f.kind] || 0;
        counters[f.kind] = i + 1;
        byValue[key] = '<' + f.kind + '_' + String.fromCharCode(65 + i) + '>';
        map[byValue[key]] = f.value;
      }
      out += text.slice(pos, f.start) + byValue[key];
      pos = f.end;
    });
    return { text: out + text.slice(pos), map: map };
  }
  function restore(text, map) {
    return text.replace(/<[A-Z]+_[A-Z]+>/g, function (p) { return Object.prototype.hasOwnProperty.call(map, p) ? map[p] : p; });
  }

  HB.ready(function () {
    var host = document.getElementById('w-piiscrub');
    if (!host) return;
    var pick = HB.el('div', { class: 'row' });
    var input = HB.el('textarea', { rows: '3', 'aria-label': 'customer message', style: 'width:100%' });
    SAMPLES.forEach(function (s, i) { pick.appendChild(HB.el('button', { class: 'btn', type: 'button', text: 'Example ' + (i + 1), onclick: function () { input.value = s; draw(); } })); });
    host.appendChild(pick);
    host.appendChild(input);
    var sent = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    var table = HB.el('div', { class: 'tbl-wrap' });
    var back = HB.el('div', { class: 'out' });
    host.appendChild(HB.el('div', { class: 'panel' }, [HB.el('h5', { text: 'What the model receives' }), sent]));
    host.appendChild(HB.el('div', { class: 'panel' }, [HB.el('h5', { text: 'The placeholder map (kept by code, never sent)' }), table]));
    host.appendChild(HB.el('div', { class: 'panel' }, [HB.el('h5', { text: 'A model reply that uses the placeholders, restored by code' }), back]));
    function draw() {
      var r = scrub(input.value);
      sent.textContent = r.text;
      var keys = Object.keys(r.map);
      table.innerHTML = '';
      if (!keys.length) table.appendChild(HB.el('p', { text: 'Nothing found. (If the text has personal data, this toy missed it.)' }));
      else {
        var t = HB.el('table');
        t.appendChild(HB.el('tr', null, [HB.el('th', { text: 'placeholder' }), HB.el('th', { text: 'original' })]));
        keys.forEach(function (k) { t.appendChild(HB.el('tr', null, [HB.el('td', null, [HB.el('code', { text: k })]), HB.el('td', { text: r.map[k] })])); });
        table.appendChild(t);
      }
      var person = keys.filter(function (k) { return k.indexOf('<PERSON_') === 0; })[0];
      var reply = person ? 'I have noted the details for ' + person + '.' : 'I have noted your question.';
      back.textContent = 'model wrote:   ' + reply + '\ncustomer sees: ' + restore(reply, r.map);
    }
    input.addEventListener('input', draw);
    input.value = SAMPLES[0];
    draw();
  });
})();
