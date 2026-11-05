/* Build AI handbook: a reading-progress tracker that lives in this browser.

   No login, no network, no cookies, no libraries. assets/handbook.js loads this file on every
   page and announces 'hb-built' when the sidebar and pager exist; the tracker then
   - records the visit to the page,
   - adds "Mark this chapter done" and a "My notes" box above the previous/next links,
   - turns every ul.checklist li[data-check] into a checkbox,
   - records which self-check answers were opened,
   - marks the sidebar (a tick for done, a dot for in progress, done/total per part) and the
     progress link in the top bar,
   - and, on progress.html, draws the whole picture with export, import and reset.

   Storage, best first: IndexedDB database 'build-ai-handbook' (version 1); else one JSON blob in
   localStorage; else memory only, in which case the page says progress will not be kept.

   The pure parts (summaries, import validation, merging, the export shape) take plain objects
   and touch no browser API. They are window.HBProgress in a browser and module.exports in
   Node, so `node --test tools/tests/*.test.js` can test them. */
(function (root) {
  'use strict';

  var APP = 'build-ai-handbook';
  var VERSION = 1;              // export file format
  var SCHEMA = 1;               // IndexedDB schema version
  var DB_NAME = 'build-ai-handbook';
  var LS_KEY = 'build-ai-handbook-progress';
  var EVENT_CAP = 500;
  var MAX_IMPORT_RECORDS = 50000;
  var MAX_NOTE_CHARS = 100000;
  var STORES = ['pages', 'checks', 'notes', 'reveals'];
  var KEY_OF = { pages: 'file', checks: 'id', notes: 'file', reveals: 'id' };
  var TIME_OF = { pages: 'lastSeen', checks: 'at', notes: 'updated', reveals: 'at' };
  var EVENT_TYPES = ['visit', 'done', 'undone', 'autodone', 'check', 'uncheck', 'note', 'reveal', 'import'];
  var VISIT_GAP_MS = 30 * 60 * 1000;   // a revisit within 30 minutes is not a new activity entry
  var NOTE_GAP_MS = 10 * 60 * 1000;    // one "edited your note" entry per page per 10 minutes

  /* =====================================================================================
     Pure logic: no DOM, no storage. Everything below until "Browser" is tested in Node.
     ===================================================================================== */

  function emptyState() { return { pages: {}, checks: {}, notes: {}, reveals: {}, events: [] }; }

  function copy(obj) { return JSON.parse(JSON.stringify(obj)); }

  function cloneState(state) {
    var s = emptyState();
    if (!state) return s;
    STORES.forEach(function (name) { s[name] = copy(state[name] || {}); });
    s.events = copy(state.events || []);
    return s;
  }

  // Chapters (they have a number) and labs (Parts I to V) count toward progress. The cover,
  // this progress page, the glossary and the resources do not.
  function isCounted(entry) {
    return !!entry && (typeof entry.n === 'number' || /^Part /.test(entry.part || ''));
  }

  function kindOf(entry) {
    if (!entry) return 'page';
    if (/^lab-/.test(entry.file)) return 'lab';
    return typeof entry.n === 'number' ? 'chapter' : 'page';
  }

  function pageLabel(entry) {
    if (!entry) return '';
    return (typeof entry.n === 'number' ? entry.n + '. ' : '') + entry.title;
  }

  function stemOf(file) { return String(file || '').replace(/\.html?$/, ''); }

  // Whole percent, rounded down, so 100% means every counted page is done.
  function percent(done, total) { return total > 0 ? Math.floor((100 * done) / total) : 0; }

  function excerpt(text, max) {
    var limit = max || 160;
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= limit) return t;
    var cut = t.slice(0, limit);
    var space = cut.lastIndexOf(' ');
    if (space > limit * 0.6) cut = cut.slice(0, space);
    return cut.replace(/[\s.,;:!?-]+$/, '') + '…';
  }

  function indexBook(book) {
    var byFile = {};
    (book || []).forEach(function (b, i) { byFile[b.file] = { entry: b, index: i }; });
    return byFile;
  }

  // The page record after a visit at time `now`. A page already done stays done.
  function visitRecord(prev, file, now) {
    if (!prev) return { file: file, status: 'reading', firstSeen: now, lastSeen: now, visits: 1, doneAt: null };
    var rec = copy(prev);
    rec.visits = (typeof rec.visits === 'number' ? rec.visits : 0) + 1;
    rec.lastSeen = now;
    if (rec.status !== 'done') rec.status = 'reading';
    return rec;
  }

  // The page record after marking it done (done = true) or not done at time `now`.
  function doneRecord(prev, file, done, now) {
    var rec = prev ? copy(prev) : { file: file, firstSeen: now, visits: 1 };
    rec.file = file;
    rec.status = done ? 'done' : 'reading';
    rec.doneAt = done ? now : null;
    rec.lastSeen = now;
    return rec;
  }

  function pushEvent(events, evt, cap) {
    var list = (events || []).concat([evt]);
    var max = cap || EVENT_CAP;
    return list.length > max ? list.slice(list.length - max) : list;
  }

  // Everything progress.html shows, from the records alone.
  //   book: HB.BOOK; state: {pages, checks, notes, reveals, events};
  //   checkpoints: {file: [{id, text}]} from the search index.
  function summarise(book, state, checkpoints) {
    var s = state || emptyState();
    var cps = checkpoints || {};
    var pages = s.pages || {};
    var checks = s.checks || {};
    var byFile = indexBook(book);
    var parts = [];
    var partAt = {};
    var total = 0;
    var done = 0;
    var reading = 0;

    (book || []).forEach(function (b) {
      if (!isCounted(b)) return;
      if (!(b.part in partAt)) { partAt[b.part] = parts.length; parts.push({ part: b.part, total: 0, done: 0, reading: 0 }); }
      var p = parts[partAt[b.part]];
      var rec = pages[b.file];
      p.total++; total++;
      if (rec && rec.status === 'done') { p.done++; done++; }
      else if (rec && rec.status === 'reading') { p.reading++; reading++; }
    });
    parts.forEach(function (p) { p.percent = percent(p.done, p.total); });

    // Pages with progress checkpoints (the labs, and any chapter that has a checklist).
    var labs = [];
    (book || []).forEach(function (b) {
      var list = cps[b.file];
      if (!list || !list.length) return;
      var ticked = 0;
      list.forEach(function (c) { var r = checks[c.id]; if (r && r.done === true) ticked++; });
      var rec = pages[b.file];
      labs.push({ file: b.file, title: b.title, label: pageLabel(b), total: list.length, ticked: ticked, status: rec ? rec.status : null });
    });

    // Continue where you left off: the counted page touched last. If it is still in
    // progress, go back to it; if it is done, go to the next counted page not done yet.
    var latest = null;
    (book || []).forEach(function (b, i) {
      var rec = pages[b.file];
      if (!isCounted(b) || !rec || typeof rec.lastSeen !== 'number') return;
      if (!latest || rec.lastSeen > latest.rec.lastSeen) latest = { b: b, i: i, rec: rec };
    });
    var continueAt = null;
    function nextNotDone(from) {
      for (var k = from; k < book.length; k++) {
        var r = pages[book[k].file];
        if (isCounted(book[k]) && !(r && r.status === 'done')) return book[k];
      }
      return null;
    }
    if (latest && latest.rec.status !== 'done') {
      continueAt = { file: latest.b.file, label: pageLabel(latest.b), part: latest.b.part, reason: 'reading', lastSeen: latest.rec.lastSeen };
    } else if (book && book.length) {
      var next = (latest && nextNotDone(latest.i + 1)) || nextNotDone(0);
      if (next) continueAt = { file: next.file, label: pageLabel(next), part: next.part, reason: latest ? 'next' : 'start', lastSeen: null };
    }

    var notes = [];
    Object.keys(s.notes || {}).forEach(function (f) {
      var n = s.notes[f];
      if (!n || !String(n.text || '').trim()) return;
      var e = byFile[f] && byFile[f].entry;
      notes.push({ file: f, label: e ? pageLabel(e) : f, text: n.text, excerpt: excerpt(n.text, 160), updated: n.updated });
    });
    notes.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });

    var revealPages = {};
    var revealTotal = 0;
    Object.keys(s.reveals || {}).forEach(function (id) {
      var r = s.reveals[id];
      if (!r || !r.page) return;
      revealTotal++;
      revealPages[r.page] = (revealPages[r.page] || 0) + 1;
    });
    var reveals = Object.keys(revealPages).map(function (f) {
      var e = byFile[f] && byFile[f].entry;
      return { file: f, label: e ? pageLabel(e) : f, count: revealPages[f], order: byFile[f] ? byFile[f].index : 1e9 };
    }).sort(function (a, b) { return a.order - b.order; });

    var recent = (s.events || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).slice(0, 10);

    return {
      total: total, done: done, reading: reading, percent: percent(done, total),
      parts: parts, labs: labs, continueAt: continueAt, notes: notes,
      reveals: { total: revealTotal, pages: reveals }, recent: recent
    };
  }

  // One line of plain English for an activity entry.
  function describeEvent(evt, book, checkpoints) {
    var byFile = indexBook(book);
    var e = evt && evt.page && byFile[evt.page] ? byFile[evt.page].entry : null;
    var label = e ? pageLabel(e) : (evt && evt.page) || 'a page';
    var step = '';
    if (evt && evt.id && checkpoints && checkpoints[evt.page]) {
      checkpoints[evt.page].forEach(function (c) { if (c.id === evt.id) step = excerpt(c.text, 70); });
    }
    switch (evt && evt.type) {
      case 'visit': return 'Opened ' + label;
      case 'done': return 'Marked ' + label + ' done';
      case 'undone': return 'Marked ' + label + ' not done';
      case 'autodone': return 'Ticked every step, so ' + label + ' was marked done';
      case 'check': return step ? 'Ticked “' + step + '” in ' + label : 'Ticked a step in ' + label;
      case 'uncheck': return step ? 'Unticked “' + step + '” in ' + label : 'Unticked a step in ' + label;
      case 'note': return 'Edited your note on ' + label;
      case 'reveal': return 'Opened a self-check answer in ' + label;
      case 'import': return 'Imported progress from a file';
      default: return 'Activity on ' + label;
    }
  }

  /* ---------- export, import validation and merge ---------- */

  function valuesSorted(map) {
    return Object.keys(map || {}).sort().map(function (k) { return map[k]; });
  }

  function buildExport(state, now) {
    var s = state || emptyState();
    return {
      app: APP,
      version: VERSION,
      exportedAt: new Date(typeof now === 'number' ? now : Date.now()).toISOString(),
      pages: valuesSorted(s.pages),
      checks: valuesSorted(s.checks),
      notes: valuesSorted(s.notes),
      reveals: valuesSorted(s.reveals),
      events: (s.events || []).slice()
    };
  }

  function isTime(t) { return typeof t === 'number' && isFinite(t) && t >= 0 && t < 1e15; }
  function isFile(f) { return typeof f === 'string' && f.length <= 200 && /^[A-Za-z0-9._-]+\.html?$/.test(f); }
  function isId(x) { return typeof x === 'string' && x.length > 0 && x.length <= 200; }

  // Each cleaner returns a fresh record with only the known fields, or null if invalid.
  var CLEAN = {
    pages: function (r) {
      if (!r || !isFile(r.file) || (r.status !== 'reading' && r.status !== 'done')) return null;
      if (!isTime(r.firstSeen) || !isTime(r.lastSeen)) return null;
      var visits = r.visits === undefined ? 1 : r.visits;
      if (typeof visits !== 'number' || !isFinite(visits) || visits < 0 || Math.floor(visits) !== visits) return null;
      if (r.doneAt !== null && r.doneAt !== undefined && !isTime(r.doneAt)) return null;
      return { file: r.file, status: r.status, firstSeen: r.firstSeen, lastSeen: r.lastSeen, visits: visits, doneAt: isTime(r.doneAt) ? r.doneAt : null };
    },
    checks: function (r) {
      if (!r || !isId(r.id) || !isFile(r.page) || typeof r.done !== 'boolean' || !isTime(r.at)) return null;
      return { id: r.id, page: r.page, done: r.done, at: r.at };
    },
    notes: function (r) {
      if (!r || !isFile(r.file) || typeof r.text !== 'string' || r.text.length > MAX_NOTE_CHARS || !isTime(r.updated)) return null;
      return { file: r.file, text: r.text, updated: r.updated };
    },
    reveals: function (r) {
      if (!r || !isId(r.id) || !isFile(r.page) || !isTime(r.at)) return null;
      return { id: r.id, page: r.page, at: r.at };
    },
    events: function (r) {
      if (!r || !isTime(r.at) || EVENT_TYPES.indexOf(r.type) < 0) return null;
      if (r.page !== undefined && r.page !== null && !isFile(r.page)) return null;
      if (r.id !== undefined && r.id !== null && !isId(r.id)) return null;
      var out = { at: r.at, type: r.type };
      if (r.page) out.page = r.page;
      if (r.id) out.id = r.id;
      return out;
    }
  };

  // Check a parsed export file. Returns {ok, error, state, skipped, found}.
  // A wrong app, version or shape fails the whole file; a single bad record is skipped.
  function validateImport(obj) {
    function fail(msg) { return { ok: false, error: msg, state: null, skipped: 0, found: null }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('The file does not hold a progress export (a JSON object).');
    if (obj.app !== APP) return fail('This file was not exported from the Build AI handbook (its "app" field is ' + JSON.stringify(obj.app === undefined ? null : obj.app) + ').');
    if (obj.version !== VERSION) return fail('This export is format version ' + JSON.stringify(obj.version === undefined ? null : obj.version) + '; this copy of the book reads version ' + VERSION + '.');
    var lists = STORES.concat(['events']);
    var count = 0;
    for (var i = 0; i < lists.length; i++) {
      var v = obj[lists[i]];
      if (v === undefined) continue;
      if (!Array.isArray(v)) return fail('"' + lists[i] + '" should be a list.');
      count += v.length;
    }
    if (count > MAX_IMPORT_RECORDS) return fail('The file holds ' + count + ' records, more than the ' + MAX_IMPORT_RECORDS + ' this page will read.');

    var state = emptyState();
    var skipped = 0;
    var found = { pages: 0, checks: 0, notes: 0, reveals: 0, events: 0 };
    STORES.forEach(function (name) {
      (obj[name] || []).forEach(function (raw) {
        var rec = CLEAN[name](raw);
        if (!rec) { skipped++; return; }
        found[name]++;
        var key = rec[KEY_OF[name]];
        var have = state[name][key];
        if (!have || rec[TIME_OF[name]] > have[TIME_OF[name]]) state[name][key] = rec;
      });
    });
    (obj.events || []).forEach(function (raw) {
      var rec = CLEAN.events(raw);
      if (!rec) { skipped++; return; }
      found.events++;
      state.events.push(rec);
    });
    state.events = mergeEvents([], state.events).events;
    return { ok: true, error: null, state: state, skipped: skipped, found: found };
  }

  function eventKey(e) { return [e.at, e.type, e.page || '', e.id || ''].join('|'); }

  function mergeEvents(current, incoming, cap) {
    var seen = {};
    var all = [];
    var added = 0;
    (current || []).forEach(function (e) { var k = eventKey(e); if (!seen[k]) { seen[k] = true; all.push(e); } });
    (incoming || []).forEach(function (e) { var k = eventKey(e); if (!seen[k]) { seen[k] = true; all.push(copy(e)); added++; } });
    all.sort(function (a, b) { return a.at - b.at; });
    var max = cap || EVENT_CAP;
    if (all.length > max) all = all.slice(all.length - max);
    return { events: all, added: added };
  }

  // Merge an imported state into the current one, keeping the newer record per key.
  // "Newer" is judged by lastSeen (pages), at (checks, reveals) or updated (notes); a tie
  // keeps the record already in this browser. A page also keeps the earliest firstSeen and
  // the larger visit count from either side. Returns {state, counts}.
  function mergeState(current, incoming) {
    var out = cloneState(current);
    var inc = incoming || emptyState();
    var counts = {};
    STORES.forEach(function (name) {
      var c = { added: 0, updated: 0, kept: 0 };
      var tf = TIME_OF[name];
      Object.keys(inc[name] || {}).forEach(function (key) {
        var theirs = inc[name][key];
        var mine = out[name][key];
        if (!mine) { out[name][key] = copy(theirs); c.added++; return; }
        var theirsNewer = theirs[tf] > mine[tf];
        var winner = copy(theirsNewer ? theirs : mine);
        if (name === 'pages') {
          winner.firstSeen = Math.min(mine.firstSeen, theirs.firstSeen);
          winner.visits = Math.max(mine.visits || 0, theirs.visits || 0);
        }
        out[name][key] = winner;
        if (theirsNewer) c.updated++; else c.kept++;
      });
      counts[name] = c;
    });
    var ev = mergeEvents(out.events, inc.events || []);
    out.events = ev.events;
    counts.events = { added: ev.added };
    return { state: out, counts: counts };
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // Plain-English report of an import.
  function describeMerge(counts, skipped) {
    var names = { pages: ['page', 'pages'], checks: ['ticked step', 'ticked steps'], notes: ['note', 'notes'], reveals: ['self-check answer', 'self-check answers'] };
    var lines = [];
    STORES.forEach(function (name) {
      var c = counts && counts[name];
      if (!c) return;
      var n = c.added + c.updated + c.kept;
      if (!n) return;
      lines.push(plural(n, names[name][0], names[name][1]) + ': ' + c.added + ' new, ' + c.updated + ' newer than yours, ' + c.kept + ' kept because yours were newer or the same');
    });
    if (counts && counts.events) lines.push(plural(counts.events.added, 'new activity entry', 'new activity entries'));
    if (skipped) lines.push(plural(skipped, 'record', 'records') + ' skipped because they did not look right');
    return lines;
  }

  var HBProgress = {
    APP: APP, VERSION: VERSION, SCHEMA: SCHEMA, EVENT_CAP: EVENT_CAP,
    emptyState: emptyState, cloneState: cloneState, isCounted: isCounted, kindOf: kindOf,
    pageLabel: pageLabel, stemOf: stemOf, percent: percent, excerpt: excerpt,
    visitRecord: visitRecord, doneRecord: doneRecord, pushEvent: pushEvent,
    summarise: summarise, describeEvent: describeEvent,
    buildExport: buildExport, validateImport: validateImport,
    mergeEvents: mergeEvents, mergeState: mergeState, describeMerge: describeMerge
  };

  if (typeof module === 'object' && module && module.exports) module.exports = HBProgress;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  root.HBProgress = HBProgress;

  /* =====================================================================================
     Browser: storage
     ===================================================================================== */

  function normalise(obj) {
    var s = emptyState();
    if (!obj || typeof obj !== 'object') return s;
    STORES.forEach(function (name) { if (obj[name] && typeof obj[name] === 'object' && !Array.isArray(obj[name])) s[name] = obj[name]; });
    if (Array.isArray(obj.events)) s.events = obj.events;
    return s;
  }

  // IndexedDB, wrapped in promises. Resolves to a database or null; never rejects.
  function openIdb() {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      function finish(db) { if (settled) { if (db) try { db.close(); } catch (e) { /* ignore */ } return; } settled = true; clearTimeout(timer); resolve(db); }
      timer = setTimeout(function () { finish(null); }, 2500);
      try {
        var idb = root.indexedDB;
        if (!idb) { finish(null); return; }
        var req = idb.open(DB_NAME, SCHEMA);
        req.onupgradeneeded = function () {
          try {
            var db = req.result;
            if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'file' });
            if (!db.objectStoreNames.contains('checks')) db.createObjectStore('checks', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'file' });
            if (!db.objectStoreNames.contains('reveals')) db.createObjectStore('reveals', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { autoIncrement: true });
            if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
          } catch (e) { /* onerror follows */ }
        };
        req.onsuccess = function () { finish(req.result); };
        req.onerror = function () { finish(null); };
        req.onblocked = function () { finish(null); };
      } catch (e) { finish(null); }
    });
  }

  function idbStore(db) {
    var ALL = ['pages', 'checks', 'notes', 'reveals', 'events', 'meta'];
    function tx(names, mode, fn) {
      return new Promise(function (resolve, reject) {
        var t;
        try { t = db.transaction(names, mode); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
        try { fn(t); } catch (e) { try { t.abort(); } catch (e2) { /* ignore */ } reject(e); }
      });
    }
    function trimEvents(store) {
      var c = store.count();
      c.onsuccess = function () {
        var extra = c.result - EVENT_CAP;
        if (extra <= 0) return;
        var cur = store.openCursor();
        cur.onsuccess = function () {
          var k = cur.result;
          if (k && extra > 0) { extra--; k.delete(); k.continue(); }
        };
      };
    }
    function writeAll(t, state) {
      STORES.forEach(function (name) {
        var st = t.objectStore(name);
        st.clear();
        Object.keys(state[name] || {}).forEach(function (k) { st.put(state[name][k]); });
      });
      var ev = t.objectStore('events');
      ev.clear();
      (state.events || []).slice(-EVENT_CAP).forEach(function (e) { ev.add(e); });
      t.objectStore('meta').put({ key: 'schema', value: SCHEMA });
    }
    return {
      kind: 'indexeddb',
      probe: function () { return tx(['meta'], 'readwrite', function (t) { t.objectStore('meta').put({ key: 'schema', value: SCHEMA }); }); },
      loadAll: function () {
        var state = emptyState();
        return tx(ALL, 'readonly', function (t) {
          STORES.forEach(function (name) {
            var r = t.objectStore(name).getAll();
            r.onsuccess = function () { (r.result || []).forEach(function (rec) { state[name][rec[KEY_OF[name]]] = rec; }); };
          });
          var e = t.objectStore('events').getAll();
          e.onsuccess = function () { state.events = e.result || []; };
        }).then(function () { return state; });
      },
      put: function (name, rec) { return tx([name], 'readwrite', function (t) { t.objectStore(name).put(rec); }); },
      addEvent: function (evt) { return tx(['events'], 'readwrite', function (t) { var st = t.objectStore('events'); st.add(evt); trimEvents(st); }); },
      replaceAll: function (state) { return tx(ALL, 'readwrite', function (t) { writeAll(t, state); }); },
      clearAll: function () { return tx(ALL, 'readwrite', function (t) { writeAll(t, emptyState()); }); }
    };
  }

  // One JSON blob, read and written whole on every change (so two open tabs do not
  // overwrite each other's records). Used for localStorage and for memory.
  function blobStore(kind, read, write) {
    function load() { return normalise(read()); }
    function mutate(fn) {
      return new Promise(function (resolve, reject) {
        try { var s = load(); fn(s); write({ schema: SCHEMA, pages: s.pages, checks: s.checks, notes: s.notes, reveals: s.reveals, events: s.events }); resolve(); }
        catch (e) { reject(e); }
      });
    }
    return {
      kind: kind,
      probe: function () { return mutate(function () { /* write back what is there */ }); },
      loadAll: function () { return new Promise(function (resolve, reject) { try { resolve(load()); } catch (e) { reject(e); } }); },
      put: function (name, rec) { return mutate(function (s) { s[name][rec[KEY_OF[name]]] = rec; }); },
      addEvent: function (evt) { return mutate(function (s) { s.events = pushEvent(s.events, evt); }); },
      replaceAll: function (state) { return mutate(function (s) { STORES.forEach(function (n) { s[n] = state[n] || {}; }); s.events = (state.events || []).slice(-EVENT_CAP); }); },
      clearAll: function () { return mutate(function (s) { var e = emptyState(); STORES.forEach(function (n) { s[n] = e[n]; }); s.events = []; }); }
    };
  }

  function localStore() {
    try {
      var ls = root.localStorage;
      if (!ls) return null;
      ls.setItem(LS_KEY + '-probe', '1');
      if (ls.getItem(LS_KEY + '-probe') !== '1') return null;
      ls.removeItem(LS_KEY + '-probe');
    } catch (e) { return null; }
    return blobStore('localstorage', function () {
      var raw = root.localStorage.getItem(LS_KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) {
        // Keep the unreadable blob aside rather than lose it, then start again.
        try { root.localStorage.setItem(LS_KEY + '-unreadable', raw); } catch (e2) { /* ignore */ }
        return null;
      }
    }, function (obj) { root.localStorage.setItem(LS_KEY, JSON.stringify(obj)); });
  }

  function memoryStore() {
    var held = null;
    return blobStore('memory', function () { return held ? copy(held) : null; }, function (obj) { held = copy(obj); });
  }

  function openStore() {
    return openIdb().then(function (db) {
      if (!db) return null;
      var st = idbStore(db);
      return st.probe().then(function () { return st; }, function () { return null; });
    }, function () { return null; }).then(function (st) {
      if (st) return st;
      var ls = localStore();
      if (!ls) return null;
      return ls.probe().then(function () { return ls; }, function () { return null; });
    }).then(function (st) { return st || memoryStore(); }, function () { return memoryStore(); });
  }

  /* =====================================================================================
     Browser: the page
     ===================================================================================== */

  var ctx = null;   // {store, state, book, file, entry, checkpoints}

  function el(tag, attrs, children) {
    if (root.HB && root.HB.el) return root.HB.el(tag, attrs, children);
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') node.textContent = attrs[k]; else node.setAttribute(k, attrs[k]); });
    (children ? [].concat(children) : []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function fmtDate(t) {
    try { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return new Date(t).toDateString(); }
  }
  function fmtTime(t) {
    try { return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return new Date(t).toTimeString().slice(0, 5); }
  }
  function fmtWhen(t) {
    var d = new Date(t);
    var today = new Date();
    if (d.toDateString() === today.toDateString()) return 'today at ' + fmtTime(t);
    return fmtDate(t) + ', ' + fmtTime(t);
  }

  function entryFor(file) {
    var found = null;
    (ctx.book || []).forEach(function (b) { if (b.file === file) found = b; });
    return found;
  }

  // Every write goes through here: update the copy in memory, then the store.
  function save(name, rec) {
    ctx.state[name][rec[KEY_OF[name]]] = rec;
    return ctx.store.put(name, rec).catch(function () { storeFailed(); });
  }
  function logEvent(type, page, id) {
    var evt = { at: Date.now(), type: type };
    if (page) evt.page = page;
    if (id) evt.id = id;
    ctx.state.events = pushEvent(ctx.state.events, evt);
    return ctx.store.addEvent(evt).catch(function () { storeFailed(); });
  }
  function storeFailed() {
    var msg = document.querySelector('.hb-track-msg');
    if (msg) msg.textContent = 'This browser refused to save the last change. It will be lost when you leave the page.';
  }

  function lastEventFor(type, page) {
    var ev = ctx.state.events || [];
    for (var i = ev.length - 1; i >= 0; i--) if (ev[i].type === type && ev[i].page === page) return ev[i];
    return null;
  }

  function memoryNotice() {
    return el('div', { class: 'hb-store-note', role: 'note' }, [
      el('b', { text: 'Your progress is not being saved. ' }),
      'This browser will not let the book store anything, so ticks, notes and “done” marks vanish when you leave the page. ' +
      'This happens in some private windows, and in Firefox and Safari when the book is opened straight from disk. To fix it, run ',
      el('code', { text: 'python3 tools/serve.py' }),
      ' in the book’s folder and open ',
      el('a', { href: 'http://127.0.0.1:8765/', text: 'http://127.0.0.1:8765/' }),
      ' instead.'
    ]);
  }

  /* ---------- sidebar and top bar ---------- */

  function paintNav() {
    var sum = summarise(ctx.book, ctx.state, ctx.checkpoints);
    var side = document.getElementById('sidebar');
    if (side) {
      side.querySelectorAll('li[data-file]').forEach(function (li) {
        var f = li.getAttribute('data-file');
        var a = li.querySelector('a');
        if (!a) return;
        var rec = ctx.state.pages[f];
        var counted = isCounted(entryFor(f));
        var status = counted && rec ? rec.status : null;
        var mark = a.querySelector('.pmark');
        if (!mark) { mark = el('span', { class: 'pmark' }); a.appendChild(mark); }
        mark.className = 'pmark' + (status === 'done' ? ' done' : status === 'reading' ? ' reading' : '');
        mark.textContent = '';
        if (status) mark.appendChild(el('span', { class: 'sr-only', text: status === 'done' ? ' (done)' : ' (in progress)' }));
      });
      side.querySelectorAll('.part[data-part]').forEach(function (div) {
        var name = div.getAttribute('data-part');
        var p = null;
        sum.parts.forEach(function (x) { if (x.part === name) p = x; });
        var span = div.querySelector('.pcount');
        if (!p) { if (span) span.parentNode.removeChild(span); return; }
        if (!span) { span = el('span', { class: 'pcount' }); div.appendChild(span); }
        span.textContent = p.done + '/' + p.total;
        span.setAttribute('title', p.done + ' of ' + p.total + ' done');
        span.classList.toggle('all', p.done === p.total);
      });
    }
    var link = document.querySelector('.topbar .prog-link');
    if (link) {
      var pct = link.querySelector('.pct');
      if (pct) pct.textContent = sum.percent + '%';
      var words = 'Your progress: ' + sum.done + ' of ' + sum.total + ' chapters and labs done (' + sum.percent + '%)';
      link.setAttribute('title', words);
      link.setAttribute('aria-label', words);
    }
    return sum;
  }

  /* ---------- the box above previous/next ---------- */

  function buildTrackBox() {
    var pager = document.getElementById('pager');
    if (!pager || !pager.parentNode) return;
    var file = ctx.file;
    var kind = kindOf(ctx.entry);
    var box = el('section', { class: 'hb-track', 'aria-label': 'Your progress on this page' });
    var msg = el('p', { class: 'hb-track-msg', role: 'status', 'aria-live': 'polite' });

    if (isCounted(ctx.entry)) {
      var input = el('input', { type: 'checkbox', id: 'hb-done' });
      var text = el('span', { class: 'lbl' });
      var label = el('label', { class: 'hb-done', for: 'hb-done' }, [input, text]);
      var paint = function () {
        var rec = ctx.state.pages[file];
        var isDone = !!(rec && rec.status === 'done');
        input.checked = isDone;
        label.classList.toggle('on', isDone);
        text.textContent = isDone ? 'Done' + (rec.doneAt ? ' on ' + fmtDate(rec.doneAt) : '') : 'Mark this ' + kind + ' done';
      };
      input.addEventListener('change', function () {
        setDone(input.checked, input.checked ? 'done' : 'undone');
        msg.textContent = '';
        paint();
      });
      ctx.paintDone = paint;
      paint();
      box.appendChild(el('div', { class: 'hb-track-row' }, [label, el('a', { class: 'hb-track-link', href: 'progress.html', text: 'Your progress' })]));
    } else {
      box.appendChild(el('div', { class: 'hb-track-row' }, [el('a', { class: 'hb-track-link', href: 'progress.html', text: 'Your progress' })]));
    }
    box.appendChild(msg);
    ctx.msg = msg;

    // My notes
    var note = ctx.state.notes[file];
    var ta = el('textarea', { rows: '6', 'aria-label': 'My notes on this page', placeholder: 'Questions, numbers you got, what to try next. Saved in this browser as you type.' });
    ta.value = note && note.text ? note.text : '';
    var status = el('p', { class: 'hb-notes-status', 'aria-live': 'polite', text: note && note.text ? 'Last saved ' + fmtWhen(note.updated) + '.' : '' });
    var notes = el('details', { class: 'hb-notes' }, [el('summary', { text: 'My notes' }), ta, status]);
    if (ta.value.trim()) notes.open = true;
    var timer = null;
    var dirty = false;
    var lastNoteEvent = (lastEventFor('note', file) || {}).at || 0;
    function flush() {
      if (!dirty) return;
      dirty = false;
      clearTimeout(timer);
      var now = Date.now();
      save('notes', { file: file, text: ta.value, updated: now });
      if (now - lastNoteEvent > NOTE_GAP_MS && ta.value.trim()) { lastNoteEvent = now; logEvent('note', file); }
      status.textContent = 'Saved in this browser at ' + fmtTime(now) + '.';
    }
    ta.addEventListener('input', function () { dirty = true; status.textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(flush, 700); });
    ta.addEventListener('blur', flush);
    root.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
    box.appendChild(notes);

    if (ctx.store.kind === 'memory') box.appendChild(memoryNotice());
    pager.parentNode.insertBefore(box, pager);
  }

  function setDone(done, eventType) {
    var rec = doneRecord(ctx.state.pages[ctx.file], ctx.file, done, Date.now());
    save('pages', rec);
    logEvent(eventType, ctx.file);
    if (ctx.paintDone) ctx.paintDone();
    paintNav();
  }

  /* ---------- checklists ---------- */

  function wireChecklists() {
    var items = [];
    document.querySelectorAll('ul.checklist').forEach(function (ul) {
      ul.classList.add('ready');
      ul.querySelectorAll('li[data-check]').forEach(function (li) {
        var id = li.getAttribute('data-check');
        if (!id) return;
        var inputId = 'hbc-' + items.length + '-' + id.replace(/[^A-Za-z0-9_-]+/g, '-');
        var input = el('input', { type: 'checkbox', id: inputId });
        var label = el('label', { for: inputId });
        while (li.firstChild) label.appendChild(li.firstChild);
        li.appendChild(input);
        li.appendChild(label);
        var rec = ctx.state.checks[id];
        input.checked = !!(rec && rec.done);
        li.classList.toggle('done', input.checked);
        input.addEventListener('change', function () {
          var now = Date.now();
          save('checks', { id: id, page: ctx.file, done: input.checked, at: now });
          logEvent(input.checked ? 'check' : 'uncheck', ctx.file, id);
          li.classList.toggle('done', input.checked);
          afterTick(input.checked);
        });
        items.push({ id: id, input: input });
      });
    });
    ctx.items = items;
  }

  function afterTick(ticked) {
    var items = ctx.items || [];
    var all = items.length > 0 && items.every(function (it) { return it.input.checked; });
    var rec = ctx.state.pages[ctx.file];
    if (ticked && all && isCounted(ctx.entry) && !(rec && rec.status === 'done')) {
      setDone(true, 'autodone');
      var kind = kindOf(ctx.entry);
      if (ctx.msg) {
        ctx.msg.textContent = '';
        var undo = el('button', { type: 'button', class: 'btn', text: 'Undo' });
        undo.addEventListener('click', function () {
          setDone(false, 'undone');
          ctx.msg.textContent = 'This ' + kind + ' is no longer marked done.';
        });
        ctx.msg.appendChild(document.createTextNode('You ticked every step, so this ' + kind + ' is now marked done. '));
        ctx.msg.appendChild(undo);
      }
    }
    paintNav();
  }

  /* ---------- self-checks ---------- */

  function wireSelfChecks() {
    var stem = stemOf(ctx.file);
    document.querySelectorAll('.selfcheck details').forEach(function (d, i) {
      var id = stem + ':selfcheck-' + (i + 1);
      if (ctx.state.reveals[id]) d.classList.add('seen');
      d.addEventListener('toggle', function () {
        if (!d.open || ctx.state.reveals[id]) return;
        save('reveals', { id: id, page: ctx.file, at: Date.now() });
        logEvent('reveal', ctx.file, id);
        d.classList.add('seen');
      });
    });
  }

  /* ---------- progress.html ---------- */

  function byId(id) { return document.getElementById(id); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

  function bar(pct, label) {
    var outer = el('div', { class: 'pg-bar', role: 'img', 'aria-label': label });
    var inner = el('span');
    inner.style.width = Math.max(0, Math.min(100, pct)) + '%';
    outer.appendChild(inner);
    return outer;
  }

  function renderProgressPage() {
    var sum = summarise(ctx.book, ctx.state, ctx.checkpoints);
    var node;

    if ((node = byId('pg-overall'))) {
      clear(node);
      node.appendChild(el('p', { class: 'pg-big' }, [el('b', { text: sum.percent + '%' }), ' of the book’s chapters and labs done']));
      node.appendChild(bar(sum.percent, sum.percent + '% done'));
      node.appendChild(el('p', { class: 'pg-sub', text: sum.done + ' of ' + sum.total + ' done, ' + sum.reading + ' in progress. The cover, this page, the glossary and the resources are not counted.' }));
    }

    if ((node = byId('pg-continue'))) {
      clear(node);
      var c = sum.continueAt;
      if (!c) node.appendChild(el('p', { text: 'Every chapter and lab is marked done. Well done. The labs’ “Going further” sections have more to build.' }));
      else {
        var why = c.reason === 'reading' ? 'You were last here ' + fmtWhen(c.lastSeen) + '.' : c.reason === 'next' ? 'The next page you have not finished.' : 'Nothing is marked yet: start at the beginning, or pick a reading path on the cover.';
        node.appendChild(el('a', { class: 'toc-card pg-continue', href: c.file }, [el('span', { class: 'n', text: c.part }), el('span', { class: 't', text: c.label }), el('span', { class: 'd', text: why })]));
      }
    }

    if ((node = byId('pg-parts'))) {
      clear(node);
      sum.parts.forEach(function (p) {
        node.appendChild(el('div', { class: 'bar-row pg-part' }, [
          el('span', { class: 'name', text: p.part }),
          bar(p.percent, p.done + ' of ' + p.total + ' done'),
          el('span', { class: 'pct', text: p.done + '/' + p.total })
        ]));
      });
    }

    if ((node = byId('pg-labs'))) {
      clear(node);
      if (!sum.labs.length) node.appendChild(el('p', { class: 'pg-none', text: 'No page has a checklist yet. Run tools/build_search_index.py after adding one.' }));
      else {
        var table = el('table', { class: 'pg-table' });
        table.appendChild(el('tr', null, [el('th', { text: 'Lab' }), el('th', { class: 'num', text: 'Steps ticked' }), el('th', { text: 'Status' })]));
        sum.labs.forEach(function (l) {
          var st = l.status === 'done' ? el('span', { class: 'pill ok', text: 'done' }) : l.ticked > 0 || l.status === 'reading' ? el('span', { class: 'pill mid', text: 'in progress' }) : el('span', { class: 'pill', text: 'not started' });
          table.appendChild(el('tr', null, [
            el('td', null, el('a', { href: l.file, text: l.label })),
            el('td', { class: 'num', text: l.ticked + ' / ' + l.total }),
            el('td', null, st)
          ]));
        });
        node.appendChild(el('div', { class: 'tbl-wrap' }, table));
      }
    }

    if ((node = byId('pg-activity'))) {
      clear(node);
      if (!sum.recent.length) node.appendChild(el('p', { class: 'pg-none', text: 'Nothing yet. Open a chapter and it appears here.' }));
      else {
        var ol = el('ol', { class: 'pg-activity' });
        sum.recent.forEach(function (e) {
          var target = e.page || null;
          var line = describeEvent(e, ctx.book, ctx.checkpoints);
          ol.appendChild(el('li', null, [el('time', { datetime: new Date(e.at).toISOString(), text: fmtWhen(e.at) }), ' ', target ? el('a', { href: target, text: line }) : line]));
        });
        node.appendChild(ol);
      }
    }

    if ((node = byId('pg-notes'))) {
      clear(node);
      if (!sum.notes.length) node.appendChild(el('p', { class: 'pg-none', text: 'No notes yet. Every chapter and lab has a “My notes” box above the previous and next links.' }));
      else {
        var ul = el('ul', { class: 'res-list pg-notes' });
        sum.notes.forEach(function (n) {
          ul.appendChild(el('li', null, [el('a', { href: n.file, text: n.label }), ' ', el('small', { text: 'updated ' + fmtWhen(n.updated) }), el('br'), el('span', { class: 'res-note', text: n.excerpt })]));
        });
        node.appendChild(ul);
      }
    }

    if ((node = byId('pg-reveals'))) {
      clear(node);
      if (!sum.reveals.total) node.appendChild(el('p', { class: 'pg-none', text: 'None yet. Try each self-check question in your head before you open its answer.' }));
      else {
        node.appendChild(el('p', { text: 'You have opened ' + plural(sum.reveals.total, 'answer') + ' on ' + plural(sum.reveals.pages.length, 'page') + '.' }));
        var list = el('ul', { class: 'pg-reveals' });
        sum.reveals.pages.forEach(function (r) { list.appendChild(el('li', null, [el('a', { href: r.file + '#self-check', text: r.label }), ': ' + r.count])); });
        node.appendChild(list);
      }
    }

    if ((node = byId('pg-store'))) {
      clear(node);
      var where = { indexeddb: 'This browser’s IndexedDB storage for this address', localstorage: 'This browser’s local storage for this address (IndexedDB was not available)', memory: 'Nowhere: this browser refused storage, so progress lasts only until you leave the page' }[ctx.store.kind];
      node.appendChild(el('p', null, [el('b', { text: 'Saved in: ' }), where + '.']));
      if (ctx.store.kind === 'memory') node.appendChild(memoryNotice());
      if (root.location && root.location.protocol === 'file:') {
        node.appendChild(el('p', { class: 'pg-sub', text: 'You opened the book from disk. Chrome and Edge keep progress for pages opened this way; Firefox and Safari may refuse it or keep each page separately. If the numbers here look wrong, use tools/serve.py.' }));
      }
    }
  }

  function wireBackup() {
    var msg = byId('pg-backup-msg');
    function say(lines, isError) {
      if (!msg) return;
      clear(msg);
      msg.classList.toggle('err', !!isError);
      [].concat(lines).forEach(function (line, i) { if (i) msg.appendChild(el('br')); msg.appendChild(document.createTextNode(line)); });
    }

    var exportBtn = byId('pg-export');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      try {
        var data = buildExport(ctx.state, Date.now());
        var blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = el('a', { href: url, download: 'build-ai-handbook-progress-' + new Date().toISOString().slice(0, 10) + '.json' });
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
        say('Exported ' + plural(data.pages.length, 'page record') + ', ' + plural(data.checks.length, 'tick') + ', ' + plural(data.notes.length, 'note') + ', ' + plural(data.reveals.length, 'self-check answer') + ' and ' + plural(data.events.length, 'activity entry', 'activity entries') + '. Keep the file somewhere safe.');
      } catch (e) { say('The export failed in this browser: ' + (e && e.message ? e.message : e), true); }
    });

    var fileInput = byId('pg-import');
    if (fileInput) fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { say('That file is larger than 5 MB, far bigger than any progress export. Nothing was imported.', true); fileInput.value = ''; return; }
      var reader = new FileReader();
      reader.onerror = function () { say('The file could not be read. Nothing was imported.', true); };
      reader.onload = function () {
        fileInput.value = '';
        var obj;
        try { obj = JSON.parse(String(reader.result)); } catch (e) { say('That file is not valid JSON. Nothing was imported.', true); return; }
        var v = validateImport(obj);
        if (!v.ok) { say(v.error + ' Nothing was imported.', true); return; }
        var merged = mergeState(ctx.state, v.state);
        ctx.store.replaceAll(merged.state).then(function () {
          ctx.state = merged.state;
          return logEvent('import');
        }).then(function () {
          paintNav();
          renderProgressPage();
          say(['Imported ' + f.name + '. Where both sides had a record, the newer one was kept.'].concat(describeMerge(merged.counts, v.skipped)));
        }, function () { say('This browser refused to save the import. Nothing changed.', true); });
      };
      reader.readAsText(f);
    });

    var resetBtn = byId('pg-reset');
    var confirmBox = byId('pg-reset-confirm');
    var yes = byId('pg-reset-yes');
    var no = byId('pg-reset-no');
    if (resetBtn && confirmBox && yes && no) {
      resetBtn.addEventListener('click', function () { confirmBox.hidden = false; resetBtn.hidden = true; no.focus(); });
      no.addEventListener('click', function () { confirmBox.hidden = true; resetBtn.hidden = false; resetBtn.focus(); say('Nothing was deleted.'); });
      yes.addEventListener('click', function () {
        ctx.store.clearAll().then(function () {
          ctx.state = emptyState();
          confirmBox.hidden = true; resetBtn.hidden = false;
          paintNav();
          renderProgressPage();
          say('All progress, notes and activity in this browser were deleted.');
        }, function () { say('This browser refused to delete the progress. Nothing changed.', true); });
      });
    }

    // Another tab may have changed things while this one was hidden.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      ctx.store.loadAll().then(function (state) { ctx.state = state; paintNav(); renderProgressPage(); }, function () { /* keep what we have */ });
    });
  }

  /* ---------- start ---------- */

  function run(store, state) {
    var HB = root.HB;
    ctx = {
      store: store, state: normalise(state), book: HB.BOOK || [], file: HB.currentFile(),
      checkpoints: (root.HANDBOOK_SEARCH && root.HANDBOOK_SEARCH.checkpoints) || {}
    };
    ctx.entry = entryFor(ctx.file);
    var onProgressPage = ctx.file === 'progress.html';
    if (ctx.entry && !onProgressPage) {
      var prev = ctx.state.pages[ctx.file];
      var now = Date.now();
      save('pages', visitRecord(prev, ctx.file, now));
      if (!prev || now - (prev.lastSeen || 0) > VISIT_GAP_MS) logEvent('visit', ctx.file);
      buildTrackBox();
      wireChecklists();
      wireSelfChecks();
    }
    paintNav();
    if (onProgressPage) { renderProgressPage(); wireBackup(); }
    root.HBProgress.storageKind = store.kind;
    try { document.dispatchEvent(new CustomEvent('hb-progress-ready', { detail: { storage: store.kind } })); } catch (e) { /* ignore */ }
  }

  var started = false;
  function start() {
    if (started || !root.HB || !root.HB.BOOK) return;
    started = true;
    openStore().then(function (store) {
      return store.loadAll().then(function (state) { run(store, state); }, function () {
        var mem = memoryStore();
        run(mem, emptyState());
      });
    }).catch(function () { /* the book works without the tracker */ });
  }

  if (root.HB && root.HB.built) start();
  else document.addEventListener('hb-built', start);
})(typeof window !== 'undefined' ? window : this);
