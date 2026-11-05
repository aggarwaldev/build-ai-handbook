// Tests for the pure helpers in book/assets/handbook.js: page addresses and the footer's links.
// Run from the repository root:  node --test tools/tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const HB = require(path.join(__dirname, '..', '..', 'book', 'assets', 'handbook.js'));

const REPO = 'https://github.com/aggarwaldev/build-ai-handbook';

test('the repository, branch and site address', () => {
  assert.equal(HB.REPO, 'aggarwaldev/build-ai-handbook');
  assert.equal(HB.BRANCH, 'main');
  assert.equal(HB.BOOK_URL, 'https://handbook.aggarwal.dev/');
});

test('a page lives at the site address plus its file name; the cover is the root', () => {
  assert.equal(HB.pageUrl('index.html'), 'https://handbook.aggarwal.dev/');
  assert.equal(HB.pageUrl('agents.html'), 'https://handbook.aggarwal.dev/agents.html');
});

test('footer links for a chapter', () => {
  assert.deepEqual(HB.footerLinks('agents.html', 'Agents and agentic flow'), {
    source: REPO,
    contribute: REPO + '/blob/main/CONTRIBUTING.md',
    edit: REPO + '/edit/main/book/agents.html',
    report: REPO + '/issues/new?template=mistake.yml&title=Mistake%3A%20Agents%20and%20agentic%20flow' +
      '&page=https%3A%2F%2Fhandbook.aggarwal.dev%2Fagents.html',
    textLicence: REPO + '/blob/main/LICENSE-TEXT',
    codeLicence: REPO + '/blob/main/LICENSE'
  });
});

test('footer links for the cover point at index.html and the site root', () => {
  const links = HB.footerLinks('index.html', 'Cover and contents');
  assert.equal(links.edit, REPO + '/edit/main/book/index.html');
  const q = new URL(links.report).searchParams;
  assert.equal(q.get('template'), 'mistake.yml');
  assert.equal(q.get('title'), 'Mistake: Cover and contents');
  assert.equal(q.get('page'), 'https://handbook.aggarwal.dev/');
});

test('a title with characters that mean something in an address arrives intact', () => {
  const title = 'Q&A: 50% off #1, a+b=c? café';
  const url = new URL(HB.footerLinks('glossary.html', title).report);
  assert.deepEqual([...url.searchParams.keys()], ['template', 'title', 'page']);
  assert.equal(url.searchParams.get('title'), 'Mistake: ' + title);
  assert.equal(url.searchParams.get('page'), 'https://handbook.aggarwal.dev/glossary.html');
  assert.equal(url.hash, '');
});
