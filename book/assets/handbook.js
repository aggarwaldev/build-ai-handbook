/* Build AI handbook: navigation, search, theme and shared helpers.
   Vanilla JS, no network, except one call: Ask AI, when the reader has given it their own
   Anthropic API key, sends their question from this page to the Anthropic Messages API.
   Loaded in <head> of every page (not deferred), so the theme applies before the page
   paints; everything that needs the DOM waits for it.

   BOOK is the single list of pages, in reading order. Add a page here and the sidebar,
   previous/next links, search and the progress tracker pick it up (run
   tools/build_search_index.py afterwards). Keep each entry on one line, with its keys in
   the order file, part, n (chapters only; labs have none), title: the Python tools in
   tools/ read this list with a regular expression, and tools/check_book.py fails if an
   entry does not parse.

   When the sidebar and pager are built, HB.built becomes true and the document receives an
   'hb-built' event. assets/progress.js (the reading tracker) waits for it.

   The addresses below, the footer's links and the Ask AI request are pure: in Node they are
   module.exports, so `node --test tools/tests/*.test.js` can test them. */
(function () {
  'use strict';

  /* ---------- where the book lives ----------
     The repository, its default branch and the published site. tools/check_book.py fails
     if these differ from the constants the Python tools in tools/ use. */
  var REPO = 'aggarwaldev/build-ai-handbook';
  var BRANCH = 'main';
  var BOOK_URL = 'https://handbook.aggarwal.dev/';

  // A page's canonical address: the cover is the site's root.
  function pageUrl(file) {
    return file === 'index.html' ? BOOK_URL : BOOK_URL + file;
  }

  // The footer's links for one page, given its file name and title.
  function footerLinks(file, title) {
    var repo = 'https://github.com/' + REPO;
    return {
      source: repo,
      contribute: repo + '/blob/' + BRANCH + '/CONTRIBUTING.md',
      edit: repo + '/edit/' + BRANCH + '/book/' + encodeURIComponent(file),
      report: repo + '/issues/new?template=mistake.yml&title=' + encodeURIComponent('Mistake: ' + title) +
        '&page=' + encodeURIComponent(pageUrl(file)),
      textLicence: repo + '/blob/' + BRANCH + '/LICENSE-TEXT',
      codeLicence: repo + '/blob/' + BRANCH + '/LICENSE'
    };
  }

  /* ---------- Ask AI: the request to Anthropic and its reply ----------
     With the reader's own key, "Ask here" calls the Anthropic Messages API straight from
     this page; no other server sees the question or the key. The functions here build the
     request and read the reply from plain values; the panel further down uses them.
     tools/check_book.py fails unless vercel.json's connect-src names ASK_API's origin and
     no other site. */
  var ASK_API = 'https://api.anthropic.com/v1/messages';
  var ASK_API_VERSION = '2023-06-01';
  var ASK_MODEL = 'claude-haiku-5-5';
  // Current Claude models think before they answer, and the thinking counts toward
  // max_tokens, so the limit is 2048 rather than a few hundred. They also reject the
  // temperature setting, so the request does not send one.
  var ASK_MAX_TOKENS = 2048;
  var ASK_LIMITS = { title: 200, selection: 4000, question: 1000, model: 100 };
  var ASK_SYSTEM =
    'You are a patient tutor for a reader of the Build AI handbook, a free book that teaches ' +
    'how AI works and how to build with it, from school algebra to agents, with hands-on labs ' +
    'in Python. The reader selected a passage and asks about it. Answer in plain English with ' +
    'short sentences, show worked numbers before symbols, and keep to the question. If a small ' +
    'code example helps, keep it short and runnable. If you are not sure of something, say so.';
  var ASK_NETWORK_ERROR = 'Could not reach Anthropic. Check your connection and try again, or use Copy prompt.';
  var ASK_UNREADABLE = 'Anthropic’s reply could not be read. Copy prompt still works.';

  function clip(value, max) { return String(value === null || value === undefined ? '' : value).trim().slice(0, max).trim(); }

  // The one user message: the chapter, the passage and the question.
  function askUserText(title, selection, question) {
    var q = clip(question, ASK_LIMITS.question) || 'Please explain this passage in plain English.';
    return 'Chapter: ' + clip(title, ASK_LIMITS.title) + '\n\nSelected passage:\n"""\n' +
      clip(selection, ASK_LIMITS.selection) + '\n"""\n\nQuestion: ' + q;
  }

  // The fetch() for one question. The key goes in the x-api-key header and nowhere else.
  function askRequest(key, model, title, selection, question) {
    var body = {
      model: clip(model, ASK_LIMITS.model) || ASK_MODEL,
      max_tokens: ASK_MAX_TOKENS,
      system: ASK_SYSTEM,
      messages: [{ role: 'user', content: askUserText(title, selection, question) }]
    };
    return {
      url: ASK_API,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ASK_API_VERSION,
          // Without this header the API's reply carries no CORS header, and the browser
          // refuses to hand it to the page.
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store'
      }
    };
  }

  // The answer's paragraphs. A reply can also hold "thinking" and other blocks; only its
  // "text" blocks are the answer.
  function askAnswer(reply) {
    var blocks = reply && Array.isArray(reply.content) ? reply.content : [];
    var paras = [];
    blocks.forEach(function (b) {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return;
      b.text.split(/\n[ \t]*\n/).forEach(function (p) { if (p.trim()) paras.push(p.trim()); });
    });
    if (paras.length) return paras;
    var stop = reply && reply.stop_reason;
    if (stop === 'max_tokens') return ['(The model used its whole token allowance, thinking included, before it wrote an answer. Try a narrower question.)'];
    if (stop === 'refusal') return ['(The model declined to answer this question.)'];
    return ['(The model returned no text.)'];
  }

  // One plain sentence for a reply with an error status, with the API's own message. That
  // message does not hold the key; if it ever did, the key would be cut out.
  function askErrorText(status, reply, key) {
    var what = status === 401 ? 'Anthropic did not accept the key'
      : status === 403 ? 'Anthropic does not allow this key to make the request'
        : status === 429 ? 'Anthropic is limiting requests from this key for now'
          : status === 529 ? 'Anthropic is overloaded at the moment'
            : status >= 500 ? 'Anthropic could not answer just now'
              : 'Anthropic refused the request';
    var message = reply && reply.error && typeof reply.error.message === 'string' ? reply.error.message : '';
    if (key) message = message.split(key).join('[your key]');
    message = message.replace(/\s+/g, ' ').trim().slice(0, 300).replace(/[.\s]+$/, '');
    return what + ' (HTTP ' + status + (message ? ': ' + message : '') + '). Copy prompt still works.';
  }

  // Whether the key may be kept beyond this tab. Every page opened from disk can share one
  // storage area, so any other file opened from disk could read a key kept there.
  function askCanRemember(protocol) { return protocol === 'https:' || protocol === 'http:'; }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = {
      REPO: REPO, BRANCH: BRANCH, BOOK_URL: BOOK_URL, pageUrl: pageUrl, footerLinks: footerLinks,
      ask: {
        API: ASK_API, API_VERSION: ASK_API_VERSION, MODEL: ASK_MODEL, MAX_TOKENS: ASK_MAX_TOKENS,
        LIMITS: ASK_LIMITS, SYSTEM: ASK_SYSTEM, NETWORK_ERROR: ASK_NETWORK_ERROR, UNREADABLE: ASK_UNREADABLE,
        userText: askUserText, request: askRequest, answer: askAnswer, errorText: askErrorText,
        canRemember: askCanRemember
      }
    };
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Load the progress tracker beside this script, so no page has to name it.
  (function loadProgress() {
    try {
      var me = document.currentScript;
      var src = me && me.src ? me.src.replace(/handbook\.js(\?.*)?$/, 'progress.js') : 'assets/progress.js';
      var s = document.createElement('script');
      s.src = src;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* the book works without the tracker */ }
  })();

  var BOOK = [
    { file: 'index.html', part: 'Start here', title: 'Cover and contents' },
    { file: 'reading.html', part: 'Start here', n: 1, title: 'How to read this book' },
    { file: 'progress.html', part: 'Start here', title: 'Your progress' },

    { file: 'maths-functions.html', part: 'Part I \u00b7 Maths', n: 2, title: 'Algebra, functions and graphs' },
    { file: 'maths-exp-log.html', part: 'Part I \u00b7 Maths', n: 3, title: 'Exponentials and logarithms' },
    { file: 'maths-vectors-matrices.html', part: 'Part I \u00b7 Maths', n: 4, title: 'Vectors and matrices' },
    { file: 'maths-derivatives.html', part: 'Part I \u00b7 Maths', n: 5, title: 'Derivatives and gradients' },
    { file: 'maths-gradient-descent.html', part: 'Part I \u00b7 Maths', n: 6, title: 'Gradient descent' },
    { file: 'maths-probability.html', part: 'Part I \u00b7 Maths', n: 7, title: 'Probability and Bayes' },
    { file: 'maths-statistics.html', part: 'Part I \u00b7 Maths', n: 8, title: 'Mean, variance and normalisation' },
    { file: 'maths-softmax-entropy.html', part: 'Part I \u00b7 Maths', n: 9, title: 'Softmax, cross-entropy and KL divergence' },

    { file: 'ml-learning.html', part: 'Part II \u00b7 ML foundations', n: 10, title: 'What learning means: linear and logistic regression' },
    { file: 'ml-generalisation.html', part: 'Part II \u00b7 ML foundations', n: 11, title: 'Generalisation, overfitting and regularisation' },
    { file: 'ml-neural-networks.html', part: 'Part II \u00b7 ML foundations', n: 12, title: 'Neural networks and backpropagation' },
    { file: 'ml-training-deep.html', part: 'Part II \u00b7 ML foundations', n: 13, title: 'Training deep networks well' },
    { file: 'ml-history.html', part: 'Part II \u00b7 ML foundations', n: 14, title: 'From perceptron to transformer: the bottlenecks' },
    { file: 'project-neural-net.html', part: 'Part II \u00b7 ML foundations', n: 15, title: 'Project: train your own neural network' },

    { file: 'llm-tokens.html', part: 'Part III \u00b7 How LLMs work', n: 16, title: 'Language models, tokens and sampling' },
    { file: 'llm-embeddings-positions.html', part: 'Part III \u00b7 How LLMs work', n: 17, title: 'The embedding layer and positions' },
    { file: 'llm-transformer.html', part: 'Part III \u00b7 How LLMs work', n: 18, title: 'The transformer block' },
    { file: 'llm-training.html', part: 'Part III \u00b7 How LLMs work', n: 19, title: 'How LLMs are trained' },
    { file: 'project-tiny-lm.html', part: 'Part III \u00b7 How LLMs work', n: 20, title: 'Project: train your own tiny language model' },

    { file: 'prompt-engineering.html', part: 'Part IV \u00b7 Applied concepts', n: 21, title: 'Prompt engineering' },
    { file: 'context-engineering.html', part: 'Part IV \u00b7 Applied concepts', n: 22, title: 'Context engineering and choosing models' },
    { file: 'embeddings.html', part: 'Part IV \u00b7 Applied concepts', n: 23, title: 'Embeddings and similarity' },
    { file: 'rag.html', part: 'Part IV \u00b7 Applied concepts', n: 24, title: 'Retrieval and RAG' },
    { file: 'vector-search.html', part: 'Part IV \u00b7 Applied concepts', n: 25, title: 'Vector search internals' },
    { file: 'rag-eval.html', part: 'Part IV \u00b7 Applied concepts', n: 26, title: 'Evaluating RAG' },
    { file: 'knowledge-base.html', part: 'Part IV \u00b7 Applied concepts', n: 27, title: 'The knowledge base and maintaining it' },
    { file: 'tools.html', part: 'Part IV \u00b7 Applied concepts', n: 28, title: 'Tools and function calling' },
    { file: 'agents.html', part: 'Part IV \u00b7 Applied concepts', n: 29, title: 'Agents and agentic flow' },
    { file: 'mcp.html', part: 'Part IV \u00b7 Applied concepts', n: 30, title: 'MCP, basic and advanced' },
    { file: 'skills.html', part: 'Part IV \u00b7 Applied concepts', n: 31, title: 'Skills' },
    { file: 'subagents.html', part: 'Part IV \u00b7 Applied concepts', n: 32, title: 'Subagents' },
    { file: 'harness.html', part: 'Part IV \u00b7 Applied concepts', n: 33, title: 'Harness engineering' },
    { file: 'guardrails.html', part: 'Part IV \u00b7 Applied concepts', n: 34, title: 'Guardrails' },
    { file: 'security.html', part: 'Part IV \u00b7 Applied concepts', n: 35, title: 'LLM security' },
    { file: 'hallucination.html', part: 'Part IV \u00b7 Applied concepts', n: 36, title: 'Hallucination' },
    { file: 'memory.html', part: 'Part IV \u00b7 Applied concepts', n: 37, title: 'Memory' },
    { file: 'frameworks.html', part: 'Part IV \u00b7 Applied concepts', n: 38, title: 'Frameworks and model providers' },
    { file: 'quantisation.html', part: 'Part IV \u00b7 Applied concepts', n: 39, title: 'Quantisation' },
    { file: 'fine-tuning.html', part: 'Part IV \u00b7 Applied concepts', n: 40, title: 'Fine-tuning and distillation' },
    { file: 'project-finetune-distil.html', part: 'Part IV \u00b7 Applied concepts', n: 41, title: 'Projects: LoRA fine-tune and distillation' },
    { file: 'production.html', part: 'Part IV \u00b7 Applied concepts', n: 42, title: 'Running AI in production' },
    { file: 'regulated.html', part: 'Part IV \u00b7 Applied concepts', n: 43, title: 'AI in a regulated domain' },
    { file: 'evals.html', part: 'Part IV \u00b7 Applied concepts', n: 44, title: 'Evaluating LLM output: judges and agreement' },
    { file: 'observability.html', part: 'Part IV \u00b7 Applied concepts', n: 45, title: 'Observability, tracing and cost' },

    { file: 'lab-setup.html', part: 'Part V \u00b7 Build it', title: 'Lab 0: set up your workbench' },
    { file: 'lab-first-call.html', part: 'Part V \u00b7 Build it', title: 'Lab 1: your first model call' },
    { file: 'lab-prompt-bench.html', part: 'Part V \u00b7 Build it', title: 'Lab 2: a prompt test bench' },
    { file: 'lab-rag.html', part: 'Part V \u00b7 Build it', title: 'Lab 3: RAG from scratch' },
    { file: 'lab-retrieval-eval.html', part: 'Part V \u00b7 Build it', title: 'Lab 4: measure your retrieval' },
    { file: 'lab-agent.html', part: 'Part V \u00b7 Build it', title: 'Lab 5: tools and an agent loop' },
    { file: 'lab-mcp.html', part: 'Part V \u00b7 Build it', title: 'Lab 6: build an MCP server' },
    { file: 'lab-guardrails.html', part: 'Part V \u00b7 Build it', title: 'Lab 7: guardrails you can test' },
    { file: 'lab-judge.html', part: 'Part V \u00b7 Build it', title: 'Lab 8: an LLM judge you can trust' },
    { file: 'lab-tracing.html', part: 'Part V \u00b7 Build it', title: 'Lab 9: tracing and cost' },
    { file: 'lab-capstone.html', part: 'Part V \u00b7 Build it', title: 'Lab 10: capstone, a small assistant' },

    { file: 'glossary.html', part: 'Reference', title: 'Glossary' },
    { file: 'resources.html', part: 'Reference', title: 'Resources' }
  ];

  var THEME_KEY = 'build-ai-handbook-theme';
  var NAV_KEY = 'build-ai-handbook-scroll';

  function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ } }

  // Apply a saved theme before first paint.
  var saved = storageGet(THEME_KEY);
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);

  function currentFile() {
    var path = decodeURIComponent(window.location.pathname || '');
    var last = path.split('/').pop();
    return last && /\.html?$/.test(last) ? last : 'index.html';
  }

  function isDark() {
    var forced = document.documentElement.getAttribute('data-theme');
    if (forced) return forced === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /* ---------- tiny DOM helpers, shared with the widgets ---------- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }
  function svg(tag, attrs, children) {
    var node = document.createElementNS(SVGNS, tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }
  function setAttrs(node, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    });
  }
  function append(node, children) {
    if (children === null || children === undefined) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }
  function fmt(x, digits) {
    if (typeof x !== 'number' || !isFinite(x)) return String(x);
    var d = digits === undefined ? 3 : digits;
    var s = x.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  // A seeded random generator, so every widget draws the same "random" data on each visit.
  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function onTheme(fn) { document.addEventListener('hb-theme', fn); }
  // Make an SVG element draggable by pointer (mouse and touch); cb receives SVG user coords.
  function svgPoint(svgEl, evt) {
    var pt = svgEl.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    var m = svgEl.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  window.HB = {
    BOOK: BOOK, currentFile: currentFile, built: false,
    el: el, svg: svg, fmt: fmt, cssVar: cssVar, clamp: clamp, ready: ready,
    rng: rng, onTheme: onTheme, isDark: isDark, svgPoint: svgPoint, storageGet: storageGet, storageSet: storageSet
  };

  /* ---------- icons ---------- */
  var ICON = {
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
    progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg>'
  };

  /* ---------- top bar ---------- */
  function buildTopbar() {
    var bar = el('header', { class: 'topbar' });
    var menu = el('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open contents', html: ICON.menu });
    menu.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    var brand = el('a', { class: 'brand', href: 'index.html' }, ['Build AI', el('small', { text: 'handbook' })]);
    var searchBox = el('div', { class: 'search', role: 'search' });
    var glass = el('span', { class: 'glass', html: ICON.search });
    var input = el('input', { type: 'search', placeholder: 'Search titles and headings  ( / )', 'aria-label': 'Search the handbook', autocomplete: 'off' });
    var results = el('div', { class: 'search-results', role: 'listbox' });
    searchBox.appendChild(glass); searchBox.appendChild(input); searchBox.appendChild(results);
    var gl = el('a', { class: 'icon-btn gl-link', href: 'glossary.html', title: 'Glossary', html: ICON.book + '<span>Glossary</span>' });
    // assets/progress.js fills in the percentage once it has read this browser's progress.
    var prog = el('a', { class: 'icon-btn prog-link', href: 'progress.html', title: 'Your progress', html: ICON.progress + '<span class="pct">Progress</span>' });
    var theme = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Switch light or dark theme' });
    function paintTheme() { theme.innerHTML = isDark() ? ICON.sun : ICON.moon; }
    paintTheme();
    theme.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      storageSet(THEME_KEY, next);
      paintTheme();
      document.dispatchEvent(new CustomEvent('hb-theme'));
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { paintTheme(); document.dispatchEvent(new CustomEvent('hb-theme')); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
    bar.appendChild(menu); bar.appendChild(brand); bar.appendChild(el('span', { class: 'spacer' }));
    bar.appendChild(searchBox); bar.appendChild(prog); bar.appendChild(gl); bar.appendChild(theme);
    document.body.insertBefore(bar, document.body.firstChild);
    wireSearch(input, results);
  }

  /* ---------- search over titles, headings and glossary terms ---------- */
  function searchEntries() {
    var entries = [];
    var data = window.HANDBOOK_SEARCH;
    if (data && data.pages) {
      data.pages.forEach(function (p) {
        entries.push({ href: p.file, title: p.title, where: p.part || '', weight: 3 });
        (p.headings || []).forEach(function (h) {
          entries.push({ href: p.file + '#' + h.id, title: h.text, where: p.title, weight: h.level === 2 ? 2 : 1 });
        });
      });
      Object.keys(data.glossary || {}).forEach(function (id) {
        var g = data.glossary[id];
        entries.push({ href: 'glossary.html#' + id, title: g.term, where: 'Glossary', weight: 2 });
      });
    } else {
      BOOK.forEach(function (b) { entries.push({ href: b.file, title: b.title, where: b.part, weight: 3 }); });
    }
    return entries;
  }

  function wireSearch(input, results) {
    var entries = null;
    var active = -1;
    function render(q) {
      entries = entries || searchEntries();
      results.innerHTML = '';
      active = -1;
      var words = q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) { results.classList.remove('open'); return; }
      var scored = [];
      entries.forEach(function (e) {
        var t = e.title.toLowerCase();
        var all = (t + ' ' + e.where.toLowerCase());
        for (var i = 0; i < words.length; i++) if (all.indexOf(words[i]) < 0) return;
        var s = e.weight;
        if (t.indexOf(words[0]) === 0) s += 3;
        words.forEach(function (w) { if (t.indexOf(w) >= 0) s += 2; });
        scored.push({ e: e, s: s });
      });
      scored.sort(function (a, b) { return b.s - a.s || a.e.title.length - b.e.title.length; });
      scored.slice(0, 14).forEach(function (r) {
        results.appendChild(el('a', { href: r.e.href, role: 'option' }, [r.e.title, el('small', { text: r.e.where })]));
      });
      if (!scored.length) results.appendChild(el('div', { class: 'none', text: 'No title or heading matches. Try a shorter word.' }));
      results.classList.add('open');
    }
    function move(d) {
      var links = results.querySelectorAll('a');
      if (!links.length) return;
      if (active >= 0) links[active].classList.remove('active');
      active = (active + d + links.length) % links.length;
      links[active].classList.add('active');
      links[active].scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('focus', function () { if (input.value) render(input.value); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
      else if (ev.key === 'Enter') {
        var links = results.querySelectorAll('a');
        var target = links[active >= 0 ? active : 0];
        if (target) window.location.href = target.getAttribute('href');
      } else if (ev.key === 'Escape') { results.classList.remove('open'); input.blur(); }
    });
    document.addEventListener('click', function (ev) {
      if (!results.contains(ev.target) && ev.target !== input) results.classList.remove('open');
    });
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target && ev.target.tagName) || '';
      if (ev.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) { ev.preventDefault(); input.focus(); }
    });
  }

  /* ---------- sidebar ---------- */
  function buildSidebar(file) {
    var side = document.getElementById('sidebar');
    if (!side) return;
    side.setAttribute('aria-label', 'Contents');
    var lastPart = null;
    var list = null;
    BOOK.forEach(function (b) {
      if (b.part !== lastPart) {
        side.appendChild(el('div', { class: 'part', 'data-part': b.part }, el('span', { class: 'part-name', text: b.part })));
        list = el('ol');
        side.appendChild(list);
        lastPart = b.part;
      }
      var a = el('a', { href: b.file }, [el('span', { class: 'n', text: b.n ? String(b.n) : '' }), el('span', { class: 't', text: b.title })]);
      var li = el('li', { 'data-file': b.file }, a);
      if (b.file === file) {
        a.setAttribute('aria-current', 'page');
        var subs = el('div', { class: 'subs' });
        document.querySelectorAll('article h2[id]').forEach(function (h) {
          subs.appendChild(el('a', { href: '#' + h.id, text: h.getAttribute('data-short') || h.textContent.replace(/#$/, '') }));
        });
        if (subs.childNodes.length) li.appendChild(subs);
      }
      list.appendChild(li);
    });
    // Keep the sidebar's scroll position between pages.
    var pos = parseInt(storageGet(NAV_KEY) || '0', 10);
    if (pos > 0) side.scrollTop = pos;
    var current = side.querySelector('[aria-current="page"]');
    if (current) {
      var r = current.getBoundingClientRect();
      var sr = side.getBoundingClientRect();
      if (r.top < sr.top || r.bottom > sr.bottom) current.scrollIntoView({ block: 'center' });
    }
    side.addEventListener('scroll', function () { storageSet(NAV_KEY, String(side.scrollTop)); });
    side.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('a')) document.body.classList.remove('nav-open');
    });
    var scrim = el('div', { class: 'scrim' });
    scrim.addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    document.body.appendChild(scrim);
  }

  /* ---------- previous / next ---------- */
  function buildPager(file) {
    var pager = document.getElementById('pager');
    if (!pager) return;
    var i = -1;
    for (var k = 0; k < BOOK.length; k++) if (BOOK[k].file === file) i = k;
    if (i < 0) return;
    function label(b) { return (b.n ? b.n + '. ' : '') + b.title; }
    if (i > 0) pager.appendChild(el('a', { class: 'prev', href: BOOK[i - 1].file, rel: 'prev' }, [el('small', { text: 'Previous' }), label(BOOK[i - 1])]));
    if (i < BOOK.length - 1) pager.appendChild(el('a', { class: 'next', href: BOOK[i + 1].file, rel: 'next' }, [el('small', { text: 'Next' }), label(BOOK[i + 1])]));
  }

  /* ---------- footer: the project, its source and its licences ---------- */
  function buildFooter(file) {
    var main = document.getElementById('main');
    if (!main || main.querySelector('.foot')) return;
    var title = null;
    BOOK.forEach(function (b) { if (b.file === file) title = b.title; });
    var links = footerLinks(file, title || chapterTitle());
    // Outside links open in a new tab, as every outside link in the pages does.
    function out(href, text) { return el('a', { href: href, target: '_blank', rel: 'noopener noreferrer', text: text }); }
    function item(href, text) { return el('li', null, out(href, text)); }
    main.appendChild(el('footer', { class: 'foot' }, [
      el('p', null, [el('b', { text: 'Build AI handbook.' }), ' Your reading progress stays in this browser.']),
      el('ul', { class: 'foot-links' }, [
        item(links.source, 'Source on GitHub'),
        item(links.contribute, 'Contribute'),
        item(links.edit, 'Edit this page'),
        item(links.report, 'Report a problem')
      ]),
      el('p', null, [out(links.textLicence, 'Text CC BY 4.0'), ', ', out(links.codeLicence, 'code MIT')])
    ]));
  }

  /* ---------- on this page ---------- */
  function buildOnThisPage() {
    var heads = document.querySelectorAll('article h2[id]');
    var layout = document.querySelector('.layout');
    if (heads.length < 3 || !layout) return;
    var box = el('nav', { class: 'otp', 'aria-label': 'On this page' }, el('h2', { text: 'On this page' }));
    var links = [];
    heads.forEach(function (h) {
      var a = el('a', { href: '#' + h.id, text: h.getAttribute('data-short') || h.textContent.replace(/#$/, '') });
      links.push({ a: a, h: h });
      box.appendChild(a);
    });
    layout.appendChild(box);
    function spy() {
      var y = window.scrollY + 120;
      var on = links[0];
      links.forEach(function (l) { if (l.h.offsetTop <= y) on = l; });
      links.forEach(function (l) { l.a.classList.toggle('on', l === on); });
    }
    window.addEventListener('scroll', spy, { passive: true });
    spy();
  }

  /* ---------- heading anchors, copy buttons, tables ---------- */
  function decorate() {
    document.querySelectorAll('article h2[id], article h3[id]').forEach(function (h) {
      h.appendChild(el('a', { class: 'anchor', href: '#' + h.id, 'aria-label': 'Link to this section', text: '#' }));
    });
    document.querySelectorAll('pre').forEach(function (pre) {
      var btn = el('button', { class: 'copy-btn', type: 'button', text: 'Copy' });
      btn.addEventListener('click', function () {
        var code = pre.querySelector('code') || pre;
        var text = code.innerText;
        var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1200); };
        try {
          if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
          else { fallbackCopy(text); done(); }
        } catch (e) { fallbackCopy(text); done(); }
      });
      pre.appendChild(btn);
    });
    document.querySelectorAll('article table').forEach(function (t) {
      if (t.parentNode.classList.contains('tbl-wrap')) return;
      var wrap = el('div', { class: 'tbl-wrap' });
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });
  }
  function fallbackCopy(text) {
    var ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /* ---------- glossary tooltips ---------- */
  function glossaryTips() {
    var data = window.HANDBOOK_SEARCH;
    if (!data || !data.glossary) return;
    var tip = null;
    function show(a) {
      var href = a.getAttribute('href') || '';
      var id = href.split('#')[1];
      var g = id && data.glossary[id];
      if (!g) return;
      hide();
      tip = el('div', { class: 'gtip', role: 'tooltip' }, [el('b', { text: g.term }), g.def]);
      document.body.appendChild(tip);
      var r = a.getBoundingClientRect();
      var left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - tip.offsetWidth - 10);
      tip.style.left = Math.max(8, left) + 'px';
      tip.style.top = (window.scrollY + r.bottom + 6) + 'px';
    }
    function hide() { if (tip && tip.parentNode) tip.parentNode.removeChild(tip); tip = null; }
    document.querySelectorAll('a.g').forEach(function (a) {
      a.addEventListener('mouseenter', function () { show(a); });
      a.addEventListener('focus', function () { show(a); });
      a.addEventListener('mouseleave', hide);
      a.addEventListener('blur', hide);
    });
    window.addEventListener('scroll', hide, { passive: true });
  }

  /* ---------- Ask AI on selected text ----------
     The panel builds a prompt from the chapter title, the selected text and the reader's
     question, and offers three ways to take it to Claude: copy it (the reliable path), or
     pass it in a link: claude.ai/new?q= is not documented by Anthropic and may arrive empty,
     while the desktop app's claude://claude.ai/new?q= link is documented to prefill only.
     With the reader's own Anthropic API key, "Ask here" sends the same three things from
     this page to the Messages API (askRequest above) and shows the answer in the panel.
     The key stays in this browser: in sessionStorage by default, in localStorage when the
     reader asks for that on an http(s) page. Its storage names are the panel's own;
     assets/progress.js never reads, exports or deletes them. */
  var ASK = {
    claudeNew: 'https://claude.ai/new',
    claudeDesktop: 'claude://claude.ai/new',
    urlSelectionMax: 1500,
    selectionMax: 3000,
    questionMax: 1000,
    keyName: 'hb-askai-key',
    modelName: 'hb-askai-model',
    memory: null // {key, model} when the browser refuses both storage areas: this page only
  };

  function chapterTitle() {
    var h1 = document.querySelector('article h1');
    return (h1 ? h1.textContent : document.title).replace(/\s+/g, ' ').trim();
  }
  function trimTo(text, max) {
    var t = text.replace(/\s+/g, ' ').trim();
    return t.length > max ? { text: t.slice(0, max) + ' […]', trimmed: true } : { text: t, trimmed: false };
  }
  function buildPrompt(title, selection, question) {
    var q = question.trim() || 'Please explain this passage in plain English, with a small worked example if it helps.';
    return 'I am reading the Build AI handbook, a book that teaches how AI works and how to build with it. Chapter: "' + title + '".\n\n' +
      'Here is the passage I selected:\n"""\n' + selection + '\n"""\n\n' +
      'My question: ' + q + '\n\n' +
      'Please answer as a patient tutor for someone new to AI and maths: plain English, short sentences, and numbers before symbols.';
  }

  // sessionStorage or localStorage, or null when the browser refuses it.
  function webStore(name) {
    try { var s = window[name]; s.getItem(ASK.keyName); return s; } catch (e) { return null; }
  }
  // The reader's key and model, and where they are kept: 'local' (remembered in this
  // browser), 'session' (this tab) or 'page' (this page only). Null when there is no key.
  function savedKey() {
    var places = [['session', 'sessionStorage']];
    if (askCanRemember(window.location.protocol)) places.unshift(['local', 'localStorage']);
    for (var i = 0; i < places.length; i++) {
      var s = webStore(places[i][1]);
      try {
        var key = s && s.getItem(ASK.keyName);
        if (key) return { key: key, model: s.getItem(ASK.modelName) || ASK_MODEL, where: places[i][0] };
      } catch (e) { /* refused: try the next */ }
    }
    return ASK.memory ? { key: ASK.memory.key, model: ASK.memory.model, where: 'page' } : null;
  }
  function forgetKey() {
    ASK.memory = null;
    ['localStorage', 'sessionStorage'].forEach(function (name) {
      var s = webStore(name);
      try { if (s) { s.removeItem(ASK.keyName); s.removeItem(ASK.modelName); } } catch (e) { /* nothing kept there */ }
    });
  }
  function saveKey(key, model, remember) {
    forgetKey();
    var where = remember && askCanRemember(window.location.protocol) ? 'local' : 'session';
    try {
      var s = webStore(where === 'local' ? 'localStorage' : 'sessionStorage');
      s.setItem(ASK.keyName, key);
      s.setItem(ASK.modelName, model);
    } catch (e) {
      forgetKey();
      ASK.memory = { key: key, model: model };
    }
  }
  function saveModel(model) {
    var saved = savedKey();
    if (!saved) return;
    if (saved.where === 'page') { ASK.memory.model = model; return; }
    try { webStore(saved.where === 'local' ? 'localStorage' : 'sessionStorage').setItem(ASK.modelName, model); } catch (e) { /* keep the old one */ }
  }

  function askAi() {
    var btn = el('button', { class: 'ask-btn', type: 'button', text: 'Ask AI', 'aria-label': 'Ask AI about the selected text' });
    btn.style.display = 'none';
    document.body.appendChild(btn);
    var panel = null;
    var pending = '';

    function selectionInfo() {
      var sel = window.getSelection ? window.getSelection() : null;
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      var text = sel.toString();
      if (text.replace(/\s/g, '').length < 3) return null;
      var node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode);
      if (!node || !node.closest) return null;
      if (!node.closest('#main') || node.closest('.askai, .foot, input, textarea, select, button')) return null;
      return { text: text, rect: sel.getRangeAt(0).getBoundingClientRect() };
    }
    function place() {
      var info = selectionInfo();
      if (!info) { btn.style.display = 'none'; return; }
      pending = info.text;
      btn.style.display = 'block';
      var top = window.scrollY + info.rect.bottom + 8;
      var left = window.scrollX + Math.min(info.rect.right, document.documentElement.clientWidth - 90);
      btn.style.top = top + 'px';
      btn.style.left = Math.max(8, left - 40) + 'px';
    }
    var t = null;
    document.addEventListener('selectionchange', function () { clearTimeout(t); t = setTimeout(place, 220); });
    window.addEventListener('scroll', function () { if (btn.style.display === 'block') place(); }, { passive: true });
    btn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    btn.addEventListener('click', function () { btn.style.display = 'none'; open(pending); });

    function close() { if (panel && panel.parentNode) panel.parentNode.removeChild(panel); panel = null; }
    // focus: 'ask' after a key is saved, 'key' after it is forgotten, else the question.
    function open(rawSelection, draft, focus) {
      close();
      var title = chapterTitle();
      var saved = savedKey();
      var shown = trimTo(rawSelection, saved ? ASK.selectionMax : ASK.urlSelectionMax);
      var urlSel = trimTo(rawSelection, ASK.urlSelectionMax).text;
      var question = el('textarea', { rows: '3', maxlength: String(ASK.questionMax), 'aria-label': 'Your question', placeholder: 'Your question, for example: explain this with a simpler example.' });
      question.value = draft || '';
      var answer = el('div', { class: 'askai-answer', 'aria-live': 'polite' });
      var closeBtn = el('button', { class: 'icon-btn askai-close', type: 'button', 'aria-label': 'Close', text: '×' });
      closeBtn.addEventListener('click', close);
      var askBtn = saved ? el('button', { class: 'btn primary askai-ask', type: 'button', text: 'Ask here' }) : null;
      var copyBtn = el('button', { class: 'btn' + (saved ? '' : ' primary'), type: 'button', text: 'Copy prompt' });
      var openBtn = el('button', { class: 'btn', type: 'button', text: 'Open in Claude' });
      var desktopBtn = el('button', { class: 'btn', type: 'button', text: 'Open in Claude Desktop' });
      var keyField = null;
      function reopen(focusOn) { open(rawSelection, question.value, focusOn); }

      openBtn.addEventListener('click', function () {
        var prompt = buildPrompt(title, urlSel, question.value);
        window.open(ASK.claudeNew + '?q=' + encodeURIComponent(prompt), '_blank', 'noopener');
      });
      desktopBtn.addEventListener('click', function () {
        var prompt = buildPrompt(title, urlSel, question.value);
        window.location.href = ASK.claudeDesktop + '?q=' + encodeURIComponent(prompt);
      });
      copyBtn.addEventListener('click', function () {
        var prompt = buildPrompt(title, urlSel, question.value);
        var done = function () { copyBtn.textContent = 'Copied: paste it in Claude'; };
        try {
          if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(prompt).then(done, function () { fallbackCopy(prompt); done(); });
          else { fallbackCopy(prompt); done(); }
        } catch (e) { fallbackCopy(prompt); done(); }
        window.open(ASK.claudeNew, '_blank', 'noopener');
      });

      function show(nodes) { answer.textContent = ''; nodes.forEach(function (n) { answer.appendChild(n); }); }
      function errorLine(text) { return el('p', { class: 'askai-err', text: text }); }
      if (askBtn) {
        askBtn.addEventListener('click', function () {
          var now = savedKey();
          if (!now) { reopen('key'); return; } // forgotten in another tab
          var req = askRequest(now.key, now.model, title, trimTo(rawSelection, ASK.selectionMax).text, question.value);
          askBtn.disabled = true;
          show([el('p', { class: 'askai-wait', text: 'Asking Anthropic…' })]);
          fetch(req.url, req.init)
            .then(function (r) {
              return r.text().then(function (body) {
                var data = null;
                try { data = JSON.parse(body); } catch (e) { data = null; }
                return { ok: r.ok, status: r.status, data: data };
              });
            })
            .then(function (res) {
              if (!res.ok) return [errorLine(askErrorText(res.status, res.data, now.key))];
              if (!res.data) return [errorLine(ASK_UNREADABLE)];
              // Model output goes in as text, never as HTML.
              return askAnswer(res.data).map(function (p) { return el('p', { text: p }); });
            }, function () { return [errorLine(ASK_NETWORK_ERROR)]; })
            .then(function (nodes) { show(nodes); askBtn.disabled = false; });
        });
      }

      // Without a key: the form that takes one. With a key: where it is kept, and Forget.
      function keyForm() {
        keyField = el('input', { type: 'password', class: 'askai-key-input', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: 'Your Anthropic API key' });
        var modelField = el('input', { type: 'text', class: 'askai-model', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', maxlength: String(ASK_LIMITS.model), value: ASK_MODEL });
        var remember = askCanRemember(window.location.protocol) ? el('input', { type: 'checkbox', class: 'askai-remember' }) : null;
        var useBtn = el('button', { class: 'btn askai-use', type: 'button', text: 'Use this key' });
        var msg = el('p', { class: 'askai-err', 'aria-live': 'polite' });
        function use() {
          var key = keyField.value.trim();
          if (!key) { msg.textContent = 'Paste your API key first.'; keyField.focus(); return; }
          if (!/^[\x21-\x7e]{1,400}$/.test(key)) { msg.textContent = 'That is not an API key: a key is one word of letters, digits and dashes, with no spaces.'; keyField.focus(); return; }
          keyField.value = '';
          saveKey(key, clip(modelField.value, ASK_LIMITS.model) || ASK_MODEL, !!(remember && remember.checked));
          reopen('ask');
        }
        useBtn.addEventListener('click', use);
        [keyField, modelField].forEach(function (f) {
          f.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); use(); } });
        });
        return el('div', { class: 'askai-key' }, [
          el('p', { class: 'askai-key-title' }, el('b', { text: 'Answer here with your own API key' })),
          el('p', { class: 'askai-mode', text: 'The passage and your question then go from this browser straight to Anthropic, and each answer is billed to your key. The key stays in this browser. Use a key made for this, which you can delete when you are done. ' },
            el('a', { href: 'reading.html#ask-ai', text: 'How it works' })),
          el('div', { class: 'askai-fields' }, [
            el('label', null, [el('span', { text: 'API key' }), keyField]),
            el('label', null, [el('span', { text: 'Model' }), modelField])
          ]),
          remember
            ? el('label', { class: 'askai-check' }, [remember, 'Remember the key in this browser'])
            : el('p', { class: 'askai-note askai-disk', text: 'Opened from disk, the key is kept for this tab only: files opened from disk can share one storage area, so another file could read it.' }),
          el('div', { class: 'row' }, useBtn),
          msg
        ]);
      }
      function keyControls() {
        var modelField = el('input', { type: 'text', class: 'askai-model', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', maxlength: String(ASK_LIMITS.model), value: saved.model });
        modelField.addEventListener('change', function () {
          var model = clip(modelField.value, ASK_LIMITS.model) || ASK_MODEL;
          modelField.value = model;
          saveModel(model);
        });
        var forgetBtn = el('button', { class: 'btn askai-forget', type: 'button', text: 'Forget the key' });
        forgetBtn.addEventListener('click', function () { forgetKey(); reopen('key'); });
        var kept = saved.where === 'local' ? 'remembered in this browser until you press Forget the key'
          : saved.where === 'session' ? 'kept for this tab only'
            : 'kept on this page only, because this browser refuses storage';
        return el('div', { class: 'askai-key' }, [
          el('p', { class: 'askai-mode', text: 'Ask here sends the passage and your question from this browser straight to Anthropic and shows the answer below. Your key is ' + kept + ', and each answer is billed to it.' }),
          el('div', { class: 'askai-fields' }, [el('label', null, [el('span', { text: 'Model' }), modelField]), forgetBtn])
        ]);
      }

      panel = el('div', { class: 'askai', role: 'dialog', 'aria-label': 'Ask AI about the selected text' }, [
        el('div', { class: 'askai-head' }, [el('b', { text: 'Ask AI' }), closeBtn]),
        el('p', { class: 'askai-ch', text: 'Chapter: ' + title }),
        el('blockquote', { class: 'askai-sel', text: shown.text }),
        shown.trimmed ? el('p', { class: 'askai-note', text: 'The selection was trimmed to keep the request short.' }) : null,
        question,
        el('div', { class: 'row' }, [askBtn, copyBtn, openBtn, desktopBtn]),
        saved ? null : el('p', { class: 'askai-mode', text: 'Copy prompt copies the prompt and opens Claude: paste it there. Open in Claude passes the prompt in the address, which claude.ai does not document, so the box may arrive empty. Open in Claude Desktop uses the desktop app’s documented link, which fills the prompt in for you to send.' }),
        saved ? keyControls() : keyForm(),
        answer
      ]);
      document.body.appendChild(panel);
      panel.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
      if (focus === 'ask' && askBtn) askBtn.focus();
      else if (focus === 'key' && keyField) keyField.focus();
      else question.focus();
    }
  }

  ready(function () {
    var file = currentFile();
    askAi();
    buildTopbar();
    buildSidebar(file);
    buildPager(file);
    buildFooter(file);
    window.HB.built = true;
    try { document.dispatchEvent(new CustomEvent('hb-built')); } catch (e) { /* progress.js also checks HB.built */ }
    decorate();
    buildOnThisPage();
    glossaryTips();
  });
})();
