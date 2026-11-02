/* Chapter 16: byte-pair encoding, one merge at a time. The corpus is a list of words with
   counts. Each step counts every adjacent pair of symbols (weighted by the word's count),
   merges the most frequent pair everywhere, and records the merge. A test word is then
   split with the learned merges, applied in the order they were learned. Ties go to the
   pair that sorts first, so the steps match the worked example in the chapter. */
(function () {
  'use strict';
  var HB = window.HB;
  var END = '_';

  function parseCorpus(text) {
    var out = [];
    text.split(/[\s,]+/).forEach(function (item) {
      if (!item) return;
      var m = item.match(/^([a-z]+)(?:[:×*](\d+))?$/i);
      if (!m) return;
      var w = m[1].toLowerCase(), c = m[2] ? parseInt(m[2], 10) : 1;
      var found = out.filter(function (e) { return e.word === w; })[0];
      if (found) found.count += c; else out.push({ word: w, count: c });
    });
    return out;
  }

  function pairCounts(words) {
    var counts = {};
    words.forEach(function (e) {
      for (var i = 0; i + 1 < e.syms.length; i++) {
        var key = e.syms[i] + '\u0000' + e.syms[i + 1];
        counts[key] = (counts[key] || 0) + e.count;
      }
    });
    return Object.keys(counts).map(function (k) {
      var p = k.split('\u0000');
      return { a: p[0], b: p[1], n: counts[k] };
    }).sort(function (x, y) {
      if (y.n !== x.n) return y.n - x.n;
      if (x.a !== y.a) return x.a < y.a ? -1 : 1;
      return x.b < y.b ? -1 : x.b > y.b ? 1 : 0;
    });
  }

  function applyMerge(syms, a, b) {
    var out = [];
    for (var i = 0; i < syms.length; i++) {
      if (i + 1 < syms.length && syms[i] === a && syms[i + 1] === b) { out.push(a + b); i++; }
      else out.push(syms[i]);
    }
    return out;
  }

  HB.ready(function () {
    var host = document.getElementById('w-bpe');
    if (!host) return;
    var corpusIn = HB.el('input', { type: 'text', value: 'rate:5 rates:2 late:3 later:2 eat:4', 'aria-label': 'corpus: word:count pairs', style: 'width: min(420px, 100%)' });
    var testIn = HB.el('input', { type: 'text', value: 'rated', 'aria-label': 'word to split', style: 'width: 140px' });
    var stepBtn = HB.el('button', { class: 'btn primary', type: 'button', text: 'Do the next merge' });
    var resetBtn = HB.el('button', { class: 'btn', type: 'button', text: 'Reset' });
    host.appendChild(HB.el('div', { class: 'row' }, [HB.el('label', { text: 'corpus (word:count)' }), corpusIn]));
    host.appendChild(HB.el('div', { class: 'row' }, [stepBtn, resetBtn, HB.el('label', { text: 'split a new word' }), testIn]));
    var words = HB.el('div', { class: 'panel' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(words);
    host.appendChild(out);

    var corpus, merges, last;
    function reset() {
      corpus = parseCorpus(corpusIn.value).map(function (e) {
        return { word: e.word, count: e.count, syms: e.word.split('').concat([END]) };
      });
      merges = []; last = null;
      draw();
    }
    function step() {
      var pairs = pairCounts(corpus);
      if (!pairs.length) return;
      var top = pairs[0];
      corpus.forEach(function (e) { e.syms = applyMerge(e.syms, top.a, top.b); });
      merges.push(top);
      last = top;
      draw();
    }
    function split(word) {
      var syms = word.toLowerCase().replace(/[^a-z]/g, '').split('').concat([END]);
      merges.forEach(function (m) { syms = applyMerge(syms, m.a, m.b); });
      return syms;
    }
    function chips(syms) {
      return HB.el('span', { class: 'chips', style: 'display:inline-flex' }, syms.map(function (s) { return HB.el('span', { class: 'chip', text: s }); }));
    }
    function draw() {
      words.innerHTML = '';
      words.appendChild(HB.el('h5', { text: 'The corpus now (each word ends with ' + END + ')' }));
      corpus.forEach(function (e) {
        words.appendChild(HB.el('div', { class: 'row', style: 'margin:4px 0' }, [HB.el('span', { style: 'min-width:86px;font-family:var(--mono);font-size:13px', text: e.word + ' ×' + e.count }), chips(e.syms)]));
      });
      var vocab = {};
      corpus.forEach(function (e) { e.syms.forEach(function (s) { vocab[s] = 1; }); });
      var pairs = pairCounts(corpus).slice(0, 5);
      var lines = [];
      if (last) lines.push('Merge ' + merges.length + ': ' + last.a + ' + ' + last.b + ' → ' + last.a + last.b + '  (appeared ' + last.n + ' times)');
      else lines.push('No merges yet: every word is split into single letters.');
      lines.push('Most frequent pairs now: ' + (pairs.length ? pairs.map(function (p) { return p.a + ' ' + p.b + ' (' + p.n + ')'; }).join(', ') : 'none left, every word is one token'));
      lines.push('Merges learned, in order: ' + (merges.length ? merges.map(function (m) { return m.a + m.b; }).join(', ') : '(none)'));
      lines.push('Symbols in use: ' + Object.keys(vocab).length + '   tokens across the corpus: ' + corpus.reduce(function (a, e) { return a + e.syms.length * e.count; }, 0));
      var t = split(testIn.value);
      lines.push('"' + testIn.value + '" splits into ' + t.length + ' tokens: ' + t.join(' | '));
      out.textContent = lines.join('\n');
      stepBtn.disabled = !pairCounts(corpus).length;
    }
    stepBtn.addEventListener('click', step);
    resetBtn.addEventListener('click', reset);
    corpusIn.addEventListener('change', reset);
    testIn.addEventListener('input', draw);
    reset();
  });
})();
