/* Chapter 4: multiply a 2x3 matrix by a 3x2 matrix one output cell at a time. Each step
   highlights the row of A and the column of B that make the cell, and writes out the dot
   product. The entries of A and B can be edited. */
(function () {
  'use strict';
  var HB = window.HB;
  HB.ready(function () {
    var host = document.getElementById('w-matmul');
    if (!host) return;
    var A = [[1, 2, 3], [4, 5, 6]];
    var B = [[7, 8], [9, 10], [11, 12]];
    var step = 0; // 0 = nothing computed; 1..4 = cells done in reading order
    var aIn = [], bIn = [], cOut = [];

    function matrix(rows, cols, cells) {
      var m = HB.el('div', { class: 'mat', style: 'grid-template-columns: repeat(' + cols + ', auto)' });
      for (var i = 0; i < rows; i++) for (var j = 0; j < cols; j++) m.appendChild(cells(i, j));
      return m;
    }
    var mA = matrix(2, 3, function (i, j) {
      var inp = HB.el('input', { type: 'number', value: String(A[i][j]), 'aria-label': 'A row ' + (i + 1) + ' column ' + (j + 1) });
      inp.addEventListener('input', function () { A[i][j] = parseFloat(inp.value) || 0; draw(); });
      (aIn[i] = aIn[i] || [])[j] = inp;
      return inp;
    });
    var mB = matrix(3, 2, function (i, j) {
      var inp = HB.el('input', { type: 'number', value: String(B[i][j]), 'aria-label': 'B row ' + (i + 1) + ' column ' + (j + 1) });
      inp.addEventListener('input', function () { B[i][j] = parseFloat(inp.value) || 0; draw(); });
      (bIn[i] = bIn[i] || [])[j] = inp;
      return inp;
    });
    var mC = matrix(2, 2, function (i, j) {
      var s = HB.el('span', { class: 'todo', text: '?' });
      (cOut[i] = cOut[i] || [])[j] = s;
      return s;
    });
    var wrap = HB.el('div', { class: 'mm-wrap' }, [
      HB.el('div', null, [HB.el('small', { text: 'A (2 × 3)' }), HB.el('br'), mA]), '×',
      HB.el('div', null, [HB.el('small', { text: 'B (3 × 2)' }), HB.el('br'), mB]), '=',
      HB.el('div', null, [HB.el('small', { text: 'C (2 × 2)' }), HB.el('br'), mC])
    ]);
    var prev = HB.el('button', { class: 'btn', type: 'button', text: '◀ Back' });
    var next = HB.el('button', { class: 'btn primary', type: 'button', text: 'Next cell ▶' });
    var reset = HB.el('button', { class: 'btn', type: 'button', text: 'Reset' });
    var out = HB.el('div', { class: 'out', 'aria-live': 'polite' });
    host.appendChild(wrap);
    host.appendChild(HB.el('div', { class: 'row' }, [prev, next, reset]));
    host.appendChild(out);

    function cell(i, j) { var s = 0; for (var k = 0; k < 3; k++) s += A[i][k] * B[k][j]; return s; }
    function draw() {
      var hi = step > 0 ? step - 1 : -1;
      var ci = hi >= 0 ? Math.floor(hi / 2) : -1, cj = hi >= 0 ? hi % 2 : -1;
      for (var i = 0; i < 2; i++) for (var k = 0; k < 3; k++) aIn[i][k].className = i === ci ? 'hl-row' : '';
      for (var r = 0; r < 3; r++) for (var j = 0; j < 2; j++) bIn[r][j].className = j === cj ? 'hl-col' : '';
      for (var p = 0; p < 4; p++) {
        var x = Math.floor(p / 2), y = p % 2, span = cOut[x][y];
        if (p < step) { span.textContent = HB.fmt(cell(x, y), 2); span.className = p === hi ? 'hl-cell done' : 'done'; }
        else { span.textContent = '?'; span.className = 'todo'; }
      }
      prev.disabled = step === 0;
      next.disabled = step === 4;
      if (step === 0) {
        out.textContent = 'Each cell of C is a dot product: a row of A with a column of B.\n' +
          'A has 3 columns and B has 3 rows, so the pairs match up. Press Next cell.';
        return;
      }
      var terms = [], prods = [];
      for (var k2 = 0; k2 < 3; k2++) {
        terms.push(HB.fmt(A[ci][k2], 2) + '×' + HB.fmt(B[k2][cj], 2));
        prods.push(HB.fmt(A[ci][k2] * B[k2][cj], 2));
      }
      out.textContent = 'C[row ' + (ci + 1) + ', col ' + (cj + 1) + '] = row ' + (ci + 1) + ' of A · column ' + (cj + 1) + ' of B\n' +
        '  = ' + terms.join(' + ') + '\n' +
        '  = ' + prods.join(' + ') + '\n' +
        '  = ' + HB.fmt(cell(ci, cj), 2) +
        (step === 4 ? '\nDone: 4 cells, each needing 3 multiplications, so 12 multiplications in all.' : '');
    }
    next.addEventListener('click', function () { step = Math.min(4, step + 1); draw(); });
    prev.addEventListener('click', function () { step = Math.max(0, step - 1); draw(); });
    reset.addEventListener('click', function () { step = 0; draw(); });
    draw();
  });
})();
