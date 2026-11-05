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

// The footer's links, read from the page: [text, href, target, rel] for each.
function footerLinks(page) {
  return page.$$eval('#main > footer.foot a', (as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]));
}

function expectedFooter(file, title, address) {
  const repo = 'https://github.com/aggarwaldev/build-ai-handbook';
  const out = (text, href) => [text, href, '_blank', 'noopener noreferrer'];
  return [
    out('Source on GitHub', repo),
    out('Contribute', repo + '/blob/main/CONTRIBUTING.md'),
    out('Edit this page', repo + '/edit/main/book/' + file),
    out('Report a problem', repo + '/issues/new?template=mistake.yml&title=' + encodeURIComponent('Mistake: ' + title) + '&page=' + encodeURIComponent(address)),
    out('Text CC BY 4.0', repo + '/blob/main/LICENSE-TEXT'),
    out('code MIT', repo + '/blob/main/LICENSE')
  ];
}

test('every page ends with the project footer: source, contributing, edit, report and licences', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  const context = await browser.newContext();
  try {
    const chapter = await openPage(context, CHAPTER, errors);
    assert.deepEqual(await footerLinks(chapter),
      expectedFooter(CHAPTER, 'How to read this book', 'https://handbook.aggarwal.dev/' + CHAPTER));
    assert.match(await chapter.locator('footer.foot').innerText(), /^Build AI handbook\. Your reading progress stays in this browser\./);
    // It comes after the progress box and the pager, as the last thing in the page's main column.
    assert.equal(await chapter.evaluate(() => {
      const foot = document.querySelector('footer.foot');
      const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return after(document.querySelector('.hb-track'), foot) && after(document.getElementById('pager'), foot) &&
        document.getElementById('main').lastElementChild === foot && document.querySelectorAll('.foot').length === 1;
    }), true);
    // Tab from the last pager link lands on the footer's first link, which shows a focus ring.
    await chapter.locator('#pager a').last().focus();
    await chapter.keyboard.press('Tab');
    assert.deepEqual(await chapter.evaluate(() => {
      const a = document.activeElement;
      return [a.textContent, !!a.closest('footer.foot'), getComputedStyle(a).outlineStyle];
    }), ['Source on GitHub', true, 'solid']);

    // The cover, opened at the site's root rather than as index.html.
    const cover = await openPage(context, '', errors);
    assert.deepEqual(await footerLinks(cover),
      expectedFooter('index.html', 'Cover and contents', 'https://handbook.aggarwal.dev/'));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---------- Ask AI with the reader's own key ----------
// The Anthropic API is never called: page.route answers in its place. The stand-in behaves
// as the real API was seen to on 2026-11-06: its reply carries a CORS header that lets the page
// read it only when the request sends anthropic-dangerous-direct-browser-access: true, so
// without that header the browser refuses the reply, as it would refuse the real one.

const ASK = require(path.join(BOOK, 'assets', 'handbook.js')).ask;
const API = 'https://api.anthropic.com/v1/messages';
// Not a real key, and not shaped like one.
const TEST_KEY = 'test-key-for-the-handbook-tests-0001';
const KEY_NAMES = ['hb-askai-key', 'hb-askai-model'];

// The website's own response headers, from vercel.json, so these pages run under its CSP.
function siteHeaders() {
  const config = JSON.parse(fs.readFileSync(path.join(BOOK, '..', 'vercel.json'), 'utf8'));
  const headers = {};
  config.headers.forEach((rule) => rule.headers.forEach((h) => { headers[h.key.toLowerCase()] = h.value; }));
  return headers;
}

async function serveWithSiteHeaders(context) {
  const extra = siteHeaders();
  assert.match(extra['content-security-policy'] || '', /connect-src /);
  await context.route((url) => url.href.startsWith(base), async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: Object.assign({}, response.headers(), extra) });
  });
}

// Open a page served under the site's headers. The CSP refuses eval, which
// page.waitForFunction needs, so wait for what the tracker draws in the top bar instead.
async function openSitePage(context, file, errors) {
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(file + ': ' + err.message));
  await page.goto(base + file);
  await trackerDrawn(page);
  return page;
}

function trackerDrawn(page) {
  return page.locator('.topbar .prog-link[aria-label^="Your progress:"]').waitFor();
}

// Stand in for the Messages API. reply(request) returns {status, body}. Returns the list of
// requests it saw, each as {headers, body, url}. Playwright answers the CORS preflight of a
// routed request itself, so only the POST arrives here. Playwright also adds an
// access-control-allow-origin header for the page to any reply that has none, so where the
// real API would send none, the stand-in names an origin no page has, and Chromium's own
// CORS check refuses the reply.
async function standInApi(page, reply) {
  const seen = [];
  await page.route(API, async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    seen.push({ headers, body: request.postData(), url: request.url() });
    const out = reply(request);
    const browserAllowed = headers['anthropic-dangerous-direct-browser-access'] === 'true';
    await route.fulfill({
      status: out.status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': browserAllowed ? '*' : 'https://no-page.invalid' },
      body: JSON.stringify(out.body)
    });
  });
  return seen;
}

// Select the page's lead paragraph and press the Ask AI button beside it.
async function openAskPanel(page) {
  await page.evaluate(() => {
    const p = document.querySelector('article p.lead');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.locator('.ask-btn').click();
  return page.locator('.askai');
}

function panelButtons(panel) {
  return panel.locator(':scope > .row > button').evaluateAll((bs) => bs.map((b) => [b.textContent, b.classList.contains('primary')]));
}

function storedKeys(page) {
  return page.evaluate((names) => {
    const read = (s) => { const out = {}; names.forEach((n) => { const v = s.getItem(n); if (v !== null) out[n] = v; }); return out; };
    return { local: read(localStorage), session: read(sessionStorage) };
  }, KEY_NAMES);
}

function watchConsole(page, lines) {
  page.on('console', (m) => lines.push(m.text()));
}

test('Ask AI: without a key the panel offers the prompt and a key field; with one, Ask here calls Anthropic from the page', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  const consoleLines = [];
  const context = await browser.newContext();
  try {
    await serveWithSiteHeaders(context);
    const page = await openSitePage(context, CHAPTER, errors);
    watchConsole(page, consoleLines);
    const seen = await standInApi(page, () => ({ status: 200, body: {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'private working that must not show', signature: 'sig' },
        { type: 'text', text: 'The minus sign walks downhill.\n\n<b>Not bold</b>, just text.' }
      ]
    } }));

    let panel = await openAskPanel(page);
    assert.deepEqual(await panelButtons(panel), [['Copy prompt', true], ['Open in Claude', false], ['Open in Claude Desktop', false]]);
    assert.equal(await panel.locator('.askai-key-title').innerText(), 'Answer here with your own API key');
    assert.match(await panel.locator('.askai-key').innerText(), /straight to Anthropic, and each answer is billed to your key\. The key stays in this browser\./);
    const keyField = panel.locator('input.askai-key-input');
    assert.deepEqual(await keyField.evaluate((i) => [i.type, i.getAttribute('autocomplete'), i.getAttribute('spellcheck')]), ['password', 'off', 'false']);
    assert.equal(await panel.locator('input.askai-model').inputValue(), 'claude-haiku-5-5');
    assert.equal(await panel.locator('input.askai-remember').count(), 1, 'an http page offers to remember the key');
    assert.equal(await panel.locator('.askai-ask').count(), 0);

    await keyField.fill(TEST_KEY);
    await panel.locator('.askai-use').click();
    panel = page.locator('.askai');
    assert.deepEqual(await panelButtons(panel), [['Ask here', true], ['Copy prompt', false], ['Open in Claude', false], ['Open in Claude Desktop', false]]);
    assert.match(await panel.locator('.askai-key').innerText(), /Your key is kept for this tab only, and each answer is billed to it\./);
    assert.deepEqual(await storedKeys(page), { local: {}, session: { 'hb-askai-key': TEST_KEY, 'hb-askai-model': 'claude-haiku-5-5' } });
    assert.equal(await page.evaluate((k) => [...document.querySelectorAll('input, textarea')].some((i) => i.value.includes(k)) ||
      document.documentElement.outerHTML.includes(k), TEST_KEY), false, 'the key is not left in the page');

    await panel.locator('textarea').fill('Why the minus sign?');
    await panel.locator('.askai-ask').click();
    await panel.locator('.askai-answer p:not(.askai-wait)').first().waitFor();
    assert.deepEqual(await panel.locator('.askai-answer p').allInnerTexts(), ['The minus sign walks downhill.', '<b>Not bold</b>, just text.']);
    assert.equal(await panel.locator('.askai-answer b').count(), 0, 'model output is text, not HTML');
    assert.ok(!(await panel.innerText()).includes('private working'));

    assert.equal(seen.length, 1);
    const sent = seen[0];
    assert.equal(sent.url, API);
    assert.equal(sent.headers['x-api-key'], TEST_KEY);
    assert.equal(sent.headers['anthropic-version'], '2023-06-01');
    assert.equal(sent.headers['content-type'], 'application/json');
    assert.equal(sent.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(sent.headers.referer, undefined, 'no referrer goes with the question');
    assert.equal(sent.headers.cookie, undefined);
    const body = JSON.parse(sent.body);
    assert.deepEqual(Object.keys(body), ['model', 'max_tokens', 'system', 'messages']);
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.equal(body.max_tokens, 2048);
    assert.equal(body.system, ASK.SYSTEM);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
    const lead = await page.locator('article p.lead').innerText();
    assert.equal(body.messages[0].content, 'Chapter: How to read this book\n\nSelected passage:\n"""\n' + lead.replace(/\s+/g, ' ').trim() + '\n"""\n\nQuestion: Why the minus sign?');
    assert.ok(!sent.body.includes(TEST_KEY));

    assert.deepEqual(consoleLines.filter((l) => /Content Security Policy/.test(l)), [], 'the site\'s CSP allows the call');
    assert.deepEqual(consoleLines.filter((l) => l.includes(TEST_KEY)), []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('Ask AI: a remembered key survives a reload, a 401 reads plainly without the key, and Forget clears both stores', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  const consoleLines = [];
  const context = await browser.newContext();
  try {
    await serveWithSiteHeaders(context);
    const page = await openSitePage(context, CHAPTER, errors);
    watchConsole(page, consoleLines);
    let panel = await openAskPanel(page);
    await panel.locator('input.askai-key-input').fill(TEST_KEY);
    await panel.locator('input.askai-model').fill('claude-sonnet-5-5');
    await panel.locator('input.askai-remember').check();
    await panel.locator('input.askai-key-input').press('Enter');
    assert.deepEqual(await storedKeys(page), { local: { 'hb-askai-key': TEST_KEY, 'hb-askai-model': 'claude-sonnet-5-5' }, session: {} });

    await page.reload();
    await trackerDrawn(page);
    const seen = await standInApi(page, () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
    panel = await openAskPanel(page);
    assert.match(await panel.locator('.askai-key').innerText(), /Your key is remembered in this browser until you press Forget the key/);
    assert.equal(await panel.locator('input.askai-model').inputValue(), 'claude-sonnet-5-5');
    await panel.locator('.askai-ask').click();
    await panel.locator('.askai-answer .askai-err').waitFor();
    assert.equal(await panel.locator('.askai-answer').innerText(),
      'Anthropic did not accept the key (HTTP 401: invalid x-api-key). Copy prompt still works.');
    assert.equal(JSON.parse(seen[0].body).model, 'claude-sonnet-5-5');
    assert.ok(!(await panel.innerText()).includes(TEST_KEY));

    await panel.locator('.askai-forget').click();
    assert.deepEqual(await storedKeys(page), { local: {}, session: {} });
    panel = page.locator('.askai');
    assert.equal(await panel.locator('.askai-ask').count(), 0);
    assert.equal(await panel.locator('input.askai-key-input').evaluate((i) => i === document.activeElement), true);
    assert.deepEqual(consoleLines.filter((l) => l.includes(TEST_KEY)), []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('Ask AI from a page opened from disk: no Remember box, the key stays in this tab, and the call works', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push('file page: ' + err.message));
    await page.goto('file://' + path.join(BOOK, CHAPTER));
    await page.waitForFunction(() => window.HB && window.HB.built);
    assert.equal(await page.evaluate(() => location.protocol), 'file:');
    const seen = await standInApi(page, () => ({ status: 200, body: { content: [{ type: 'text', text: 'Answered from disk.' }], stop_reason: 'end_turn' } }));

    let panel = await openAskPanel(page);
    assert.equal(await panel.locator('input.askai-remember').count(), 0);
    assert.match(await panel.locator('.askai-disk').innerText(), /^Opened from disk, the key is kept for this tab only/);
    await panel.locator('input.askai-key-input').fill(TEST_KEY);
    await panel.locator('.askai-use').click();
    assert.deepEqual(await storedKeys(page), { local: {}, session: { 'hb-askai-key': TEST_KEY, 'hb-askai-model': 'claude-haiku-5-5' } });
    panel = page.locator('.askai');
    await panel.locator('.askai-ask').click();
    await panel.locator('.askai-answer p:not(.askai-wait)').first().waitFor();
    assert.deepEqual(await panel.locator('.askai-answer p').allInnerTexts(), ['Answered from disk.']);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].headers.origin, 'null');
    assert.equal(seen[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('Ask AI: the progress tracker never exports, imports over or resets the key', async (t) => {
  if (skipReason) { if (REQUIRED) assert.fail(skipReason); t.skip(skipReason); return; }
  const errors = [];
  // localStorage is where the tracker and a remembered key would meet, so test that path.
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-askai-'));
  try {
    const lab = await openPage(context, LAB, errors);
    assert.equal(await lab.evaluate(() => window.HBProgress.storageKind), 'localstorage');
    const id = await firstCheck(lab);
    await lab.locator('ul.checklist input[type=checkbox]').first().check();
    await waitForStoredCheck(lab, id, true);
    const panel = await openAskPanel(lab);
    await panel.locator('input.askai-key-input').fill(TEST_KEY);
    await panel.locator('input.askai-remember').check();
    await panel.locator('.askai-use').click();
    await lab.close();

    const prog = await openPage(context, 'progress.html', errors);
    const [download] = await Promise.all([prog.waitForEvent('download'), prog.click('#pg-export')]);
    const file = path.join(tmp, download.suggestedFilename());
    await download.saveAs(file);
    const exported = fs.readFileSync(file, 'utf8');
    assert.ok(exported.includes(id), 'the export holds the tick');
    assert.ok(!exported.includes(TEST_KEY), 'the export does not hold the key');
    assert.ok(!exported.includes('hb-askai'), 'the export does not name the key\'s storage');

    await prog.click('#pg-reset');
    await prog.click('#pg-reset-yes');
    await prog.waitForFunction(() => /were deleted/.test(document.getElementById('pg-backup-msg').textContent));
    assert.equal(await prog.evaluate(() => localStorage.getItem('hb-askai-key')), TEST_KEY, 'reset deletes progress, not the key');
    await prog.setInputFiles('#pg-import', file);
    await prog.waitForFunction(() => /^Imported /.test(document.getElementById('pg-backup-msg').textContent));
    assert.deepEqual(await storedKeys(prog), { local: { 'hb-askai-key': TEST_KEY, 'hb-askai-model': 'claude-haiku-5-5' }, session: {} });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
