// Tests for the pure Ask AI helpers in book/assets/handbook.js: the request the page sends to
// the Anthropic Messages API, how a reply becomes the answer, and the error sentences.
// Nothing here touches the network. Run from the repository root:  node --test tools/tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ASK = require(path.join(__dirname, '..', '..', 'book', 'assets', 'handbook.js')).ask;

// Not a real key, and not shaped like one.
const KEY = 'test-key-for-the-handbook-tests-0001';

test('the request goes to the Messages API with the four headers a browser call needs', () => {
  const req = ASK.request(KEY, '', 'Gradient descent', 'The step is the gradient times the rate.', 'Why the minus sign?');
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.init.method, 'POST');
  assert.deepEqual(req.init.headers, {
    'content-type': 'application/json',
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  });
  assert.equal(req.init.credentials, 'omit');
  assert.equal(req.init.referrerPolicy, 'no-referrer');
});

test('the body: model, max_tokens, system and one user message, and no temperature', () => {
  const body = JSON.parse(ASK.request(KEY, '', 'Gradient descent', 'The step is the gradient times the rate.', 'Why the minus sign?').init.body);
  assert.deepEqual(Object.keys(body), ['model', 'max_tokens', 'system', 'messages']);
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.system,
    'You are a patient tutor for a reader of the Build AI handbook, a free book that teaches how AI works and ' +
    'how to build with it, from school algebra to agents, with hands-on labs in Python. The reader selected a ' +
    'passage and asks about it. Answer in plain English with short sentences, show worked numbers before ' +
    'symbols, and keep to the question. If a small code example helps, keep it short and runnable. If you are ' +
    'not sure of something, say so.');
  assert.deepEqual(body.messages, [{
    role: 'user',
    content: 'Chapter: Gradient descent\n\nSelected passage:\n"""\nThe step is the gradient times the rate.\n"""\n\nQuestion: Why the minus sign?'
  }]);
});

test('the key is in the x-api-key header only: not in the address or the body', () => {
  const req = ASK.request(KEY, 'claude-haiku-5-5', 'T', 'Some passage', 'A question');
  assert.ok(!req.url.includes(KEY));
  assert.ok(!req.init.body.includes(KEY));
  const elsewhere = Object.entries(req.init.headers).filter(([name, value]) => name !== 'x-api-key' && value.includes(KEY));
  assert.deepEqual(elsewhere, []);
});

test('a named model is used, trimmed; a blank one falls back to the default', () => {
  assert.equal(JSON.parse(ASK.request(KEY, '  claude-sonnet-5-5 ', 'T', 'S', 'Q').init.body).model, 'claude-sonnet-5-5');
  assert.equal(JSON.parse(ASK.request(KEY, '   ', 'T', 'S', 'Q').init.body).model, 'claude-haiku-5-5');
  assert.equal(JSON.parse(ASK.request(KEY, null, 'T', 'S', 'Q').init.body).model, 'claude-haiku-5-5');
});

test('field limits: title 200, selection 4000, question 1000; an empty question asks for an explanation', () => {
  assert.deepEqual(ASK.LIMITS, { title: 200, selection: 4000, question: 1000, model: 100 });
  const text = ASK.userText('t'.repeat(500), 's'.repeat(9000), 'q'.repeat(3000));
  assert.equal(text, 'Chapter: ' + 't'.repeat(200) + '\n\nSelected passage:\n"""\n' + 's'.repeat(4000) +
    '\n"""\n\nQuestion: ' + 'q'.repeat(1000));
  assert.match(ASK.userText('T', 'S', '  '), /\nQuestion: Please explain this passage in plain English\.$/);
});

test('the answer is the text blocks only, split into paragraphs', () => {
  const reply = {
    content: [
      { type: 'thinking', thinking: 'private working', signature: 'x' },
      { type: 'text', text: 'First paragraph.\n\nSecond, with <b>tags</b> kept as text.\n  \nThird:\n- one\n- two' },
      { type: 'tool_use', id: 't1', name: 'calc', input: {} },
      { type: 'text', text: '\n\nLast.\n' }
    ],
    stop_reason: 'end_turn'
  };
  assert.deepEqual(ASK.answer(reply), ['First paragraph.', 'Second, with <b>tags</b> kept as text.', 'Third:\n- one\n- two', 'Last.']);
});

test('a reply with no text says why', () => {
  assert.match(ASK.answer({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' })[0], /whole token allowance/);
  assert.deepEqual(ASK.answer({ content: [], stop_reason: 'refusal' }), ['(The model declined to answer this question.)']);
  assert.deepEqual(ASK.answer({}), ['(The model returned no text.)']);
  assert.deepEqual(ASK.answer(null), ['(The model returned no text.)']);
});

function apiError(type, message) { return { type: 'error', error: { type, message } }; }

test('an error is one sentence with the API\'s own message, and says Copy prompt still works', () => {
  assert.equal(ASK.errorText(401, apiError('authentication_error', 'invalid x-api-key'), KEY),
    'Anthropic did not accept the key (HTTP 401: invalid x-api-key). Copy prompt still works.');
  assert.equal(ASK.errorText(429, apiError('rate_limit_error', 'Number of requests has exceeded your rate limit.'), KEY),
    'Anthropic is limiting requests from this key for now (HTTP 429: Number of requests has exceeded your rate limit). Copy prompt still works.');
  assert.equal(ASK.errorText(529, apiError('overloaded_error', 'Overloaded'), KEY),
    'Anthropic is overloaded at the moment (HTTP 529: Overloaded). Copy prompt still works.');
  assert.equal(ASK.errorText(400, apiError('invalid_request_error', 'model: not found'), KEY),
    'Anthropic refused the request (HTTP 400: model: not found). Copy prompt still works.');
  assert.equal(ASK.errorText(500, null, KEY), 'Anthropic could not answer just now (HTTP 500). Copy prompt still works.');
});

test('an error message never shows the key, and a long one is cut', () => {
  const text = ASK.errorText(401, apiError('authentication_error', 'bad key ' + KEY + ' given'), KEY);
  assert.ok(!text.includes(KEY));
  assert.match(text, /bad key \[your key\] given/);
  assert.ok(ASK.errorText(400, apiError('x', 'y'.repeat(2000)), KEY).length < 400);
});

test('the network failure and unreadable reply sentences', () => {
  assert.equal(ASK.NETWORK_ERROR, 'Could not reach Anthropic. Check your connection and try again, or use Copy prompt.');
  assert.match(ASK.UNREADABLE, /could not be read\. Copy prompt still works\.$/);
});

test('the key may be remembered only on http(s) pages, never on pages opened from disk', () => {
  assert.equal(ASK.canRemember('https:'), true);
  assert.equal(ASK.canRemember('http:'), true);
  assert.equal(ASK.canRemember('file:'), false);
  assert.equal(ASK.canRemember(''), false);
  assert.equal(ASK.canRemember(undefined), false);
});
