// Drives the real pages in a headless browser and proves that progress survives a reload.
//
// It needs the `playwright` package and a browser it has already installed. Neither is a
// dependency of the book: when they are missing, every test here is skipped with a note,
// so `node --test` still passes on a plain machine. To run them, point NODE_PATH at a
// folder that holds playwright, for example:
//
//     NODE_PATH=/path/to/node_modules node --test tools/tests/*.test.js
//
// Set REQUIRE_BROWSER=1 to fail instead of skip, as CI does, so a missing browser cannot
// pass quietly.
//
// The pages are served by `python3 -m http.server` on 127.0.0.1, on a free port.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const BOOK = path.resolve(__dirname, '..', '..', 'book');
const LAB = 'lab-setup.html';
const CHAPTER = 'reading.html';

let playwright = null;
try { playwright = require('playwright'); } catch (e) { playwright = null; }

const REQUIRED = process.env.REQUIRE_BROWSER === '1';
let server = null;
let base = '';
let browser = null;
let skipReason = playwright ? '' : 'playwright is not installed (set NODE_PATH to a folder that has it)';

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1', '--directory', BOOK], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error('http.server did not start: ' + out)), 10000);
    proc.stdout.on('data', (chunk) => {
      out += chunk;
      const m = /port (\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve({ proc, port: Number(m[1]) }); }
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

test.before(async () => {
  if (!playwright) return;
  if (!fs.existsSync(path.join(BOOK, LAB))) { skipReason = LAB + ' does not exist yet'; return; }
  try {
    browser = await playwright.chromium.launch();
  } catch (e) {
    skipReason = 'playwright could not start Chromium: ' + String(e.message || e).split('\n')[0];
    return;
  }
  const s = await startServer();
  server = s.proc;
  base = 'http://127.0.0.1:' + s.port + '/';
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});

// Open a page and wait until the tracker has loaded its state.
async function openPage(context, file, errors) {
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(file + ': ' + err.message));
  await page.goto(base + file);
  await page.waitForFunction(() => window.HBProgress && window.HBProgress.storageKind);
  return page;
}

async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => window.HBProgress && window.HBProgress.storageKind);
}

// Read what the tracker stored, straight from IndexedDB or localStorage.
function readStored(page) {
  return page.evaluate(async () => {
    if (window.HBProgress.storageKind === 'localstorage') {
      const raw = localStorage.getItem('build-ai-handbook-progress');
      const s = raw ? JSON.parse(raw) : { checks: {}, pages: {} };
      return { checks: s.checks || {}, pages: s.pages || {} };
    }
    const db = await new Promise((res, rej) => { const r = indexedDB.open('build-ai-handbook', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = (name) => new Promise((res) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); });
    const checks = {}; (await all('checks')).forEach((c) => { checks[c.id] = c; });
    const pages = {}; (await all('pages')).forEach((p) => { pages[p.file] = p; });
    db.close();
    return { checks, pages };
  });
}

async function waitForStoredCheck(page, id, done) {
  for (let i = 0; i < 50; i++) {
    const s = await readStored(page);
    if (s.checks[id] && s.checks[id].done === done) return;
    await page.waitForTimeout(50);
  }
  assert.fail('the tick on ' + id + ' was not stored');
}

async function firstCheck(page) {
  const id = await page.getAttribute('ul.checklist li[data-check]', 'data-check');
  assert.ok(id, 'the lab has a checklist');
  return id;
}

test('a ticked step and a done chapter survive a reload (IndexedDB)', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  const context = await browser.newContext();
  try {
    const page = await openPage(context, LAB, errors);
    assert.equal(await page.evaluate(() => window.HBProgress.storageKind), 'indexeddb');
    assert.equal(await page.locator('ul.checklist.ready').count(), 1);
    const id = await firstCheck(page);
    const box = page.locator('ul.checklist input[type=checkbox]').first();
    assert.equal(await box.isChecked(), false);
    await box.check();
    await waitForStoredCheck(page, id, true);

    await reload(page);
    assert.equal(await page.locator('ul.checklist input[type=checkbox]').first().isChecked(), true, 'the tick came back after a reload');
    assert.match(await page.locator('.topbar .prog-link').getAttribute('aria-label'), /^Your progress: 0 of \d+ chapters and labs done \(0%\)$/);

    const chapter = await openPage(context, CHAPTER, errors);
    await chapter.locator('#hb-done').check();
    for (let i = 0; i < 50; i++) {
      const s = await readStored(chapter);
      if (s.pages[CHAPTER] && s.pages[CHAPTER].status === 'done') break;
      await chapter.waitForTimeout(50);
    }
    await reload(chapter);
    assert.equal(await chapter.locator('#hb-done').isChecked(), true);
    assert.match(await chapter.locator('label.hb-done').innerText(), /^Done on \d{1,2} \w{3} \d{4}$/);
    assert.equal(await chapter.locator('#sidebar li[data-file="reading.html"] .pmark.done').count(), 1);
    assert.equal(await chapter.locator('#sidebar .part[data-part="Start here"] .pcount').innerText(), '1/1');

    const prog = await openPage(context, 'progress.html', errors);
    const labRow = prog.locator('#pg-labs tr', { has: prog.locator('a[href="' + LAB + '"]') });
    assert.match(await labRow.locator('td.num').innerText(), /^1 \/ \d+$/);
    assert.match(await prog.locator('#pg-overall .pg-sub').innerText(), /^1 of \d+ done, 1 in progress\./);
    assert.match(await prog.locator('#pg-store').innerText(), /IndexedDB/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('progress page: export, reset in two steps, then import brings the tick back', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-progress-'));
  try {
    const lab = await openPage(context, LAB, errors);
    const id = await firstCheck(lab);
    await lab.locator('ul.checklist input[type=checkbox]').first().check();
    await waitForStoredCheck(lab, id, true);
    await lab.close();

    const prog = await openPage(context, 'progress.html', errors);
    const [download] = await Promise.all([prog.waitForEvent('download'), prog.click('#pg-export')]);
    assert.match(download.suggestedFilename(), /^build-ai-handbook-progress-\d{4}-\d{2}-\d{2}\.json$/);
    const file = path.join(tmp, download.suggestedFilename());
    await download.saveAs(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(data), ['app', 'version', 'exportedAt', 'pages', 'checks', 'notes', 'reveals', 'events']);
    assert.equal(data.app, 'build-ai-handbook');
    assert.deepEqual(data.checks.map((c) => [c.id, c.done]), [[id, true]]);

    // Reset asks first, and "no" deletes nothing.
    assert.equal(await prog.locator('#pg-reset-confirm').isVisible(), false);
    await prog.click('#pg-reset');
    assert.equal(await prog.locator('#pg-reset-confirm').isVisible(), true);
    await prog.click('#pg-reset-no');
    assert.equal(await prog.locator('#pg-backup-msg').innerText(), 'Nothing was deleted.');
    await prog.click('#pg-reset');
    await prog.click('#pg-reset-yes');
    await prog.waitForFunction(() => /were deleted/.test(document.getElementById('pg-backup-msg').textContent));
    assert.match(await prog.locator('#pg-labs tr', { has: prog.locator('a[href="' + LAB + '"]') }).locator('td.num').innerText(), /^0 \/ \d+$/);

    // A file from something else is refused.
    const bad = path.join(tmp, 'other.json');
    fs.writeFileSync(bad, JSON.stringify({ app: 'something-else', version: 1 }));
    await prog.setInputFiles('#pg-import', bad);
    await prog.waitForFunction(() => document.getElementById('pg-backup-msg').classList.contains('err'));
    assert.match(await prog.locator('#pg-backup-msg').innerText(), /not exported from the Build AI handbook.*Nothing was imported\./);

    await prog.setInputFiles('#pg-import', file);
    await prog.waitForFunction(() => /^Imported /.test(document.getElementById('pg-backup-msg').textContent));
    const msg = await prog.locator('#pg-backup-msg').innerText();
    assert.match(msg, /1 ticked step: 1 new, 0 newer than yours, 0 kept/);
    assert.match(await prog.locator('#pg-labs tr', { has: prog.locator('a[href="' + LAB + '"]') }).locator('td.num').innerText(), /^1 \/ \d+$/);

    const again = await openPage(context, LAB, errors);
    assert.equal(await again.locator('ul.checklist input[type=checkbox]').first().isChecked(), true, 'the imported tick shows on the lab');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('without IndexedDB the tracker falls back to localStorage and still keeps the tick', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  const context = await browser.newContext();
  await context.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
  try {
    const page = await openPage(context, LAB, errors);
    assert.equal(await page.evaluate(() => window.HBProgress.storageKind), 'localstorage');
    const id = await firstCheck(page);
    await page.locator('ul.checklist input[type=checkbox]').first().check();
    await waitForStoredCheck(page, id, true);
    await reload(page);
    assert.equal(await page.locator('ul.checklist input[type=checkbox]').first().isChecked(), true);
    assert.equal(await page.locator('.hb-store-note').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('with no storage at all the page says so and the book still works', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  try {
    const page = await openPage(context, LAB, errors);
    assert.equal(await page.evaluate(() => window.HBProgress.storageKind), 'memory');
    const note = page.locator('.hb-track .hb-store-note');
    assert.equal(await note.count(), 1);
    assert.match(await note.innerText(), /not being saved.*python3 tools\/serve\.py.*http:\/\/127\.0\.0\.1:8765\//s);
    await page.locator('ul.checklist input[type=checkbox]').first().check();
    assert.equal(await page.locator('ul.checklist li.done').count(), 1, 'ticking still works on the page');
    await reload(page);
    assert.equal(await page.locator('ul.checklist input[type=checkbox]').first().isChecked(), false, 'nothing is kept, as the notice says');
    assert.ok(await page.locator('#sidebar li[data-file]').count() > 50, 'the sidebar is still built');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
