// Tests for the pure functions in book/assets/progress.js (window.HBProgress in a browser).
// Run from the repository root:  node --test tools/tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const P = require(path.join(__dirname, '..', '..', 'book', 'assets', 'progress.js'));

// A small book in the same shape as HB.BOOK.
const BOOK = [
  { file: 'index.html', part: 'Start here', title: 'Cover and contents' },
  { file: 'reading.html', part: 'Start here', n: 1, title: 'How to read this book' },
  { file: 'progress.html', part: 'Start here', title: 'Your progress' },
  { file: 'maths-a.html', part: 'Part I · Maths', n: 2, title: 'A' },
  { file: 'maths-b.html', part: 'Part I · Maths', n: 3, title: 'B' },
  { file: 'lab-one.html', part: 'Part V · Build it', title: 'Lab 1: one' },
  { file: 'lab-two.html', part: 'Part V · Build it', title: 'Lab 2: two' },
  { file: 'glossary.html', part: 'Reference', title: 'Glossary' }
];
const CHECKPOINTS = {
  'lab-one.html': [{ id: 'lab-one:a', text: 'Step a' }, { id: 'lab-one:b', text: 'Step b' }, { id: 'lab-one:c', text: 'Step c' }],
  'lab-two.html': [{ id: 'lab-two:a', text: 'Only step' }]
};

function page(file, status, t, extra) {
  return Object.assign({ file, status, firstSeen: t, lastSeen: t, visits: 1, doneAt: status === 'done' ? t : null }, extra || {});
}

test('counted pages are chapters and labs, not the cover, progress page or reference', () => {
  assert.deepEqual(BOOK.filter(P.isCounted).map((b) => b.file),
    ['reading.html', 'maths-a.html', 'maths-b.html', 'lab-one.html', 'lab-two.html']);
  assert.equal(P.kindOf(BOOK[5]), 'lab');
  assert.equal(P.kindOf(BOOK[3]), 'chapter');
  assert.equal(P.pageLabel(BOOK[3]), '2. A');
  assert.equal(P.pageLabel(BOOK[5]), 'Lab 1: one');
});

test('summary of an empty state', () => {
  const s = P.summarise(BOOK, P.emptyState(), CHECKPOINTS);
  assert.equal(s.total, 5);
  assert.equal(s.done, 0);
  assert.equal(s.percent, 0);
  assert.deepEqual(s.parts.map((p) => [p.part, p.done, p.total]),
    [['Start here', 0, 1], ['Part I · Maths', 0, 2], ['Part V · Build it', 0, 2]]);
  assert.deepEqual(s.continueAt && [s.continueAt.file, s.continueAt.reason], ['reading.html', 'start']);
  assert.deepEqual(s.labs.map((l) => [l.file, l.ticked, l.total]), [['lab-one.html', 0, 3], ['lab-two.html', 0, 1]]);
  assert.deepEqual(s.notes, []);
  assert.equal(s.reveals.total, 0);
  assert.deepEqual(s.recent, []);
});

test('summary counts done and in-progress pages, rounds the percent down and ignores uncounted pages', () => {
  const st = P.emptyState();
  st.pages['reading.html'] = page('reading.html', 'done', 100);
  st.pages['maths-a.html'] = page('maths-a.html', 'done', 200);
  st.pages['maths-b.html'] = page('maths-b.html', 'reading', 300);
  st.pages['glossary.html'] = page('glossary.html', 'reading', 400);
  const s = P.summarise(BOOK, st, CHECKPOINTS);
  assert.equal(s.done, 2);
  assert.equal(s.reading, 1);
  assert.equal(s.percent, 40); // 2 of 5
  assert.equal(P.percent(2, 3), 66); // never rounds up
  assert.equal(P.percent(0, 0), 0);
  const maths = s.parts.find((p) => p.part === 'Part I · Maths');
  assert.deepEqual([maths.done, maths.reading, maths.total, maths.percent], [1, 1, 2, 50]);
  // The glossary was seen last, but it does not count: continue at the chapter in progress.
  assert.deepEqual([s.continueAt.file, s.continueAt.reason, s.continueAt.lastSeen], ['maths-b.html', 'reading', 300]);
});

test('continue goes to the next unfinished page after the one finished last', () => {
  const st = P.emptyState();
  st.pages['reading.html'] = page('reading.html', 'reading', 100);
  st.pages['maths-a.html'] = page('maths-a.html', 'done', 500);
  const s = P.summarise(BOOK, st, CHECKPOINTS);
  assert.deepEqual([s.continueAt.file, s.continueAt.reason], ['maths-b.html', 'next']);
  // With everything done there is nowhere to continue.
  BOOK.filter(P.isCounted).forEach((b, i) => { st.pages[b.file] = page(b.file, 'done', 600 + i); });
  const all = P.summarise(BOOK, st, CHECKPOINTS);
  assert.equal(all.percent, 100);
  assert.equal(all.continueAt, null);
});

test('lab ticks count only true ticks on known checkpoints', () => {
  const st = P.emptyState();
  st.checks['lab-one:a'] = { id: 'lab-one:a', page: 'lab-one.html', done: true, at: 1 };
  st.checks['lab-one:b'] = { id: 'lab-one:b', page: 'lab-one.html', done: false, at: 2 };
  st.checks['lab-one:gone'] = { id: 'lab-one:gone', page: 'lab-one.html', done: true, at: 3 };
  const s = P.summarise(BOOK, st, CHECKPOINTS);
  assert.deepEqual(s.labs.map((l) => [l.file, l.ticked, l.total]), [['lab-one.html', 1, 3], ['lab-two.html', 0, 1]]);
});

test('notes, reveals and recent activity', () => {
  const st = P.emptyState();
  st.notes['maths-a.html'] = { file: 'maths-a.html', text: 'old note', updated: 10 };
  st.notes['lab-one.html'] = { file: 'lab-one.html', text: 'word '.repeat(80), updated: 20 };
  st.notes['maths-b.html'] = { file: 'maths-b.html', text: '   ', updated: 30 };
  st.reveals['maths-a:selfcheck-1'] = { id: 'maths-a:selfcheck-1', page: 'maths-a.html', at: 1 };
  st.reveals['maths-a:selfcheck-2'] = { id: 'maths-a:selfcheck-2', page: 'maths-a.html', at: 2 };
  st.reveals['reading:selfcheck-1'] = { id: 'reading:selfcheck-1', page: 'reading.html', at: 3 };
  for (let i = 0; i < 15; i++) st.events.push({ at: i, type: 'visit', page: 'maths-a.html' });
  const s = P.summarise(BOOK, st, CHECKPOINTS);
  assert.deepEqual(s.notes.map((n) => n.file), ['lab-one.html', 'maths-a.html']); // newest first, blank skipped
  assert.ok(s.notes[0].excerpt.length <= 161 && s.notes[0].excerpt.endsWith('…'));
  assert.equal(s.reveals.total, 3);
  assert.deepEqual(s.reveals.pages.map((r) => [r.file, r.count]), [['reading.html', 1], ['maths-a.html', 2]]); // book order
  assert.equal(s.recent.length, 10);
  assert.deepEqual(s.recent.map((e) => e.at).slice(0, 3), [14, 13, 12]);
});

test('visit and done records', () => {
  const first = P.visitRecord(null, 'maths-a.html', 100);
  assert.deepEqual(first, { file: 'maths-a.html', status: 'reading', firstSeen: 100, lastSeen: 100, visits: 1, doneAt: null });
  const done = P.doneRecord(first, 'maths-a.html', true, 200);
  assert.deepEqual([done.status, done.doneAt, done.lastSeen, done.firstSeen], ['done', 200, 200, 100]);
  const again = P.visitRecord(done, 'maths-a.html', 300);
  assert.deepEqual([again.status, again.visits, again.lastSeen, again.doneAt], ['done', 2, 300, 200]); // stays done
  const undone = P.doneRecord(again, 'maths-a.html', false, 400);
  assert.deepEqual([undone.status, undone.doneAt, undone.lastSeen], ['reading', null, 400]);
  assert.equal(first.visits, 1, 'inputs are not changed');
});

test('events keep only the newest 500', () => {
  let ev = [];
  for (let i = 0; i < 510; i++) ev = P.pushEvent(ev, { at: i, type: 'visit', page: 'maths-a.html' });
  assert.equal(ev.length, 500);
  assert.equal(ev[0].at, 10);
  assert.equal(ev[499].at, 509);
});

test('describeEvent names the page and the step', () => {
  assert.equal(P.describeEvent({ at: 1, type: 'done', page: 'maths-a.html' }, BOOK, CHECKPOINTS), 'Marked 2. A done');
  assert.equal(P.describeEvent({ at: 1, type: 'check', page: 'lab-one.html', id: 'lab-one:b' }, BOOK, CHECKPOINTS), 'Ticked “Step b” in Lab 1: one');
  assert.equal(P.describeEvent({ at: 1, type: 'import' }, BOOK, CHECKPOINTS), 'Imported progress from a file');
});

function sampleState() {
  const st = P.emptyState();
  st.pages['maths-a.html'] = page('maths-a.html', 'done', 1000, { firstSeen: 500, visits: 3 });
  st.checks['lab-one:a'] = { id: 'lab-one:a', page: 'lab-one.html', done: true, at: 1100 };
  st.notes['maths-a.html'] = { file: 'maths-a.html', text: 'mine', updated: 1200 };
  st.reveals['maths-a:selfcheck-1'] = { id: 'maths-a:selfcheck-1', page: 'maths-a.html', at: 1300 };
  st.events = [{ at: 1000, type: 'done', page: 'maths-a.html' }, { at: 1100, type: 'check', page: 'lab-one.html', id: 'lab-one:a' }];
  return st;
}

test('export has the documented shape and round-trips through validation', () => {
  const st = sampleState();
  const out = P.buildExport(st, Date.UTC(2026, 10, 2, 12, 0, 0));
  assert.deepEqual(Object.keys(out), ['app', 'version', 'exportedAt', 'pages', 'checks', 'notes', 'reveals', 'events']);
  assert.equal(out.app, 'build-ai-handbook');
  assert.equal(out.version, 1);
  assert.equal(out.exportedAt, '2026-11-02T12:00:00.000Z');
  assert.ok(Array.isArray(out.pages) && out.pages.length === 1);
  const parsed = JSON.parse(JSON.stringify(out));
  const v = P.validateImport(parsed);
  assert.equal(v.ok, true, v.error);
  assert.equal(v.skipped, 0);
  assert.deepEqual(v.found, { pages: 1, checks: 1, notes: 1, reveals: 1, events: 2 });
  assert.deepEqual(v.state, st);
});

test('validation refuses files that are not this book’s export', () => {
  const bad = [
    [null, /JSON object/],
    [[1, 2], /JSON object/],
    ['text', /JSON object/],
    [{ app: 'something-else', version: 1 }, /not exported from the Build AI handbook/],
    [{ version: 1 }, /not exported/],
    [{ app: 'build-ai-handbook', version: 2 }, /version 2/],
    [{ app: 'build-ai-handbook', version: '1' }, /version "1"/],
    [{ app: 'build-ai-handbook', version: 1, pages: {} }, /"pages" should be a list/],
    [{ app: 'build-ai-handbook', version: 1, events: 'x' }, /"events" should be a list/]
  ];
  bad.forEach(([obj, re]) => {
    const v = P.validateImport(obj);
    assert.equal(v.ok, false, JSON.stringify(obj));
    assert.match(v.error, re);
  });
  const huge = { app: 'build-ai-handbook', version: 1, events: new Array(50001).fill({ at: 1, type: 'visit' }) };
  assert.match(P.validateImport(huge).error, /more than the 50000/);
});

test('validation skips bad records, keeps good ones and drops unknown fields', () => {
  const v = P.validateImport({
    app: 'build-ai-handbook', version: 1,
    pages: [
      page('maths-a.html', 'done', 10, { extra: 'dropped' }),
      page('../escape.html', 'done', 10),            // not a plain file name
      page('maths-b.html', 'finished', 10),           // unknown status
      { file: 'lab-one.html', status: 'reading', firstSeen: 'yesterday', lastSeen: 1, visits: 1 }
    ],
    checks: [{ id: 'lab-one:a', page: 'lab-one.html', done: 'yes', at: 1 }, { id: 'lab-one:b', page: 'lab-one.html', done: true, at: 2 }],
    notes: [{ file: 'maths-a.html', text: 'x'.repeat(100001), updated: 1 }, { file: 'maths-b.html', text: 'ok', updated: 5 }],
    reveals: [{ id: '', page: 'maths-a.html', at: 1 }],
    events: [{ at: 1, type: 'teleport' }, { at: 2, type: 'visit', page: 'maths-a.html', junk: true }]
  });
  assert.equal(v.ok, true);
  assert.equal(v.skipped, 7);
  assert.deepEqual(Object.keys(v.state.pages), ['maths-a.html']);
  assert.equal(v.state.pages['maths-a.html'].extra, undefined);
  assert.deepEqual(Object.keys(v.state.checks), ['lab-one:b']);
  assert.deepEqual(Object.keys(v.state.notes), ['maths-b.html']);
  assert.deepEqual(v.state.reveals, {});
  assert.deepEqual(v.state.events, [{ at: 2, type: 'visit', page: 'maths-a.html' }]);
});

test('merge keeps the newer record per key, and the local one on a tie', () => {
  const mine = sampleState();
  const theirs = P.emptyState();
  // Older page record from the other device, but seen earlier and more often.
  theirs.pages['maths-a.html'] = page('maths-a.html', 'reading', 900, { firstSeen: 100, visits: 7 });
  // A page only they have.
  theirs.pages['maths-b.html'] = page('maths-b.html', 'reading', 50);
  // A newer untick of a step I ticked.
  theirs.checks['lab-one:a'] = { id: 'lab-one:a', page: 'lab-one.html', done: false, at: 1500 };
  // A note with the same time as mine: mine stays.
  theirs.notes['maths-a.html'] = { file: 'maths-a.html', text: 'theirs', updated: 1200 };
  theirs.events = [{ at: 1000, type: 'done', page: 'maths-a.html' }, { at: 1500, type: 'uncheck', page: 'lab-one.html', id: 'lab-one:a' }];

  const before = JSON.stringify(mine);
  const { state, counts } = P.mergeState(mine, theirs);
  assert.equal(JSON.stringify(mine), before, 'the current state is not changed');

  const pa = state.pages['maths-a.html'];
  assert.deepEqual([pa.status, pa.lastSeen, pa.firstSeen, pa.visits], ['done', 1000, 100, 7]);
  assert.equal(state.pages['maths-b.html'].status, 'reading');
  assert.equal(state.checks['lab-one:a'].done, false);
  assert.equal(state.notes['maths-a.html'].text, 'mine');
  assert.equal(state.reveals['maths-a:selfcheck-1'].at, 1300);
  assert.deepEqual(state.events.map((e) => e.type), ['done', 'check', 'uncheck']); // de-duplicated, in time order

  assert.deepEqual(counts.pages, { added: 1, updated: 0, kept: 1 });
  assert.deepEqual(counts.checks, { added: 0, updated: 1, kept: 0 });
  assert.deepEqual(counts.notes, { added: 0, updated: 0, kept: 1 });
  assert.deepEqual(counts.reveals, { added: 0, updated: 0, kept: 0 });
  assert.deepEqual(counts.events, { added: 1 });

  const lines = P.describeMerge(counts, 2);
  assert.deepEqual(lines, [
    '2 pages: 1 new, 0 newer than yours, 1 kept because yours were newer or the same',
    '1 ticked step: 0 new, 1 newer than yours, 0 kept because yours were newer or the same',
    '1 note: 0 new, 0 newer than yours, 1 kept because yours were newer or the same',
    '1 new activity entry',
    '2 records skipped because they did not look right'
  ]);
});

test('importing the same export twice changes nothing the second time', () => {
  const other = sampleState();
  const file = JSON.parse(JSON.stringify(P.buildExport(other, 0)));
  const once = P.mergeState(P.emptyState(), P.validateImport(file).state);
  const twice = P.mergeState(once.state, P.validateImport(file).state);
  assert.deepEqual(twice.state, once.state);
  assert.deepEqual(twice.counts.pages, { added: 0, updated: 0, kept: 1 });
  assert.deepEqual(twice.counts.events, { added: 0 });
});

test('merged events stay within the cap of 500', () => {
  const a = P.emptyState();
  const b = P.emptyState();
  for (let i = 0; i < 400; i++) a.events.push({ at: i * 2, type: 'visit', page: 'maths-a.html' });
  for (let i = 0; i < 400; i++) b.events.push({ at: i * 2 + 1, type: 'visit', page: 'maths-b.html' });
  const { state, counts } = P.mergeState(a, b);
  assert.equal(state.events.length, 500);
  assert.equal(counts.events.added, 400);
  assert.equal(state.events[0].at, 300);
  assert.equal(state.events[499].at, 799);
});
