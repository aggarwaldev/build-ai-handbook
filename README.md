# Build AI handbook

A book that teaches how AI works and how to build with it, from the maths up to working
code. It is a set of plain HTML pages with small interactive widgets, and a folder of
hands-on labs in Python.

- **Parts I to III** cover the maths, machine-learning foundations and how large language
  models work, with a worked example before every formula.
- **Part IV** covers what you need to build with models: prompting, retrieval, agents,
  tools, MCP, guardrails, evaluation, observability and running in production.
- **Part V** is the labs. Each one builds a small, tested program, from a first model call
  to a capstone assistant.

There is no build step, no account and no tracking. The pages need no network, except for
links to outside reading and the optional Ask AI helper.

## Open the book

Either double-click `book/index.html`, or serve the book and open the address it prints:

    python3 tools/serve.py

then open <http://127.0.0.1:8765/>. `serve.py` uses only the Python standard library. It
listens on 127.0.0.1 only and serves the files in `book/`, nothing hidden. It also powers
the optional Ask AI helper: start it with `ANTHROPIC_API_KEY` set in your shell and the
"Ask AI" button sends the passage you selected, and your question, to Claude. The key is
read from the environment only and is never written to a file or a log. The default model
is `claude-haiku-5-5`; pick another with `--model`. Run `python3 tools/serve.py --help` for
the other options.

Without the helper, "Ask AI" copies a ready-made prompt that you can paste into any chat
assistant.

## Run the labs

The labs need Python 3.10 or newer. Set up once, from the repository root:

    python3 -m venv .venv
    source .venv/bin/activate          # Windows: .venv\Scripts\activate
    python -m pip install -r labs/requirements.txt

Every lab talks to a model through `labs/common/llm.py`. The `LLM_BACKEND` environment
variable chooses who answers:

| `LLM_BACKEND` | Needs | Cost |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` in your shell | per token; default model `claude-haiku-5-5` |
| `ollama` | [Ollama](https://ollama.com) running, and `ollama pull llama3.2` | free, on your computer |
| `fake` | nothing | free; scripted replies, for reading the code and for tests |

`LLM_MODEL` picks a model inside the backend. Never put a key in a file inside the
repository. Lab 0 (`book/lab-setup.html`) walks through all of this, and `labs/README.md`
lists every lab's folder and how to run it.

Run the tests:

    cd labs
    python -m pytest

The tests always use the fake backend, so they need no key and no network, and cost
nothing. Lab 6 also needs the MCP Python SDK
(`python -m pip install -r labs/06-mcp-server/requirements.txt`); without it, the three
tests that use the SDK are skipped.

## Run the labs online

Every lab has a notebook in `labs/notebooks/` that follows its page step by step, and each
lab page has buttons to open it:

- **Colab** (needs a Google account):
  [open Lab 1](https://colab.research.google.com/github/aggarwaldev/build-ai-handbook/blob/main/labs/notebooks/lab-01-first-call.ipynb).
  Its free GPU can run a small open model through Ollama, so the labs cost nothing. For
  Claude, add `ANTHROPIC_API_KEY` in Colab's Secrets panel.
- **Binder** (no account):
  [launch](https://mybinder.org/v2/gh/aggarwaldev/build-ai-handbook/main?urlpath=lab/tree/labs/notebooks/lab-01-first-call.ipynb).
  It can take a few minutes to start, and has no GPU: use the fake backend, or Claude with
  your key.
- **Codespaces** (needs a GitHub account):
  [open](https://codespaces.new/aggarwaldev/build-ai-handbook?quickstart=1). A full machine
  set up by `.devcontainer/devcontainer.json`, where everything in this README works as
  written. Add `ANTHROPIC_API_KEY` as a Codespaces secret to use Claude.

The first cell of each notebook sets up the code and picks the backend; the fake backend is
the default, so every notebook runs without a key. The notebooks are generated from
`labs/notebooks/src/` by `python3 tools/build_notebooks.py`: edit the sources, not the
`.ipynb` files.

## Your progress

The book keeps track of what you have read and built, in your browser only:

- every chapter and lab has a "Mark this chapter done" box and a "My notes" box above the
  previous and next links;
- each lab's checklist turns into tick boxes, and ticking every step marks the lab done;
- the sidebar shows a tick for done pages and a count per part, and the top bar shows the
  overall percentage;
- `book/progress.html` shows it all in one place, with where to continue, recent activity,
  your notes and the self-check answers you have opened. It can export everything as one
  JSON file, import such a file (merging it with what is there, newer record wins) and
  reset.

Progress is stored in the browser's IndexedDB, or its local storage when IndexedDB is not
available. Nothing is sent anywhere. Progress belongs to the address the book was opened
from, so the book opened from disk and the same book served by `serve.py` keep separate
progress; use Export and Import to move it. Chrome and Edge keep progress for pages opened
from disk. Firefox and Safari may not; if ticks do not survive a reload, use `serve.py`.
When a browser refuses all storage, every page says that progress is not being kept.

## Layout

| Path | What it holds |
| --- | --- |
| `book/` | The book, and the whole website: every page and its assets |
| `book/index.html` | The cover: how to use the book, reading paths and the full contents |
| `book/reading.html` | How to read the book: conventions, boxes, self-checks, labs, keeping current |
| `book/progress.html` | Your progress page |
| `book/*.html` | One page per chapter, lab and reference page |
| `book/assets/handbook.js` | Builds the sidebar, search, pager and Ask AI box. Its `BOOK` list sets the reading order |
| `book/assets/progress.js` | The progress tracker |
| `book/assets/handbook.css` | All styles, light and dark |
| `book/assets/search-index.js` | Generated search index; do not edit by hand |
| `book/assets/widgets/` | One script per interactive widget |
| `book/assets/icon.svg` | The site icon: the book's blue, with a variant for dark themes |
| `book/sitemap.xml`, `book/robots.txt` | For search engines: every page's address, and where the sitemap is. Generated; do not edit by hand |
| `labs/` | The lab code and its tests, plus the larger projects from earlier chapters |
| `tools/` | The local server and the checks below |
| `labs/notebooks/` | One notebook per lab, generated from `labs/notebooks/src/` |
| `binder/`, `.devcontainer/` | Set-up for Binder and GitHub Codespaces |
| `vercel.json` | Hosting on Vercel: publishes `book/`, with security headers |

## Checks

All of these use only the Python standard library or Node's built-in test runner:

    python3 tools/check_links.py                 # every internal link and #id resolves
    python3 tools/check_book.py                  # reading order, page structure, ids, paths
    python3 tools/build_search_index.py --check  # the search index is up to date
    python3 tools/build_site_meta.py --check     # page heads, sitemap.xml and robots.txt are up to date
    node --test tools/tests/*.test.js            # the progress tracker
    python3 tools/build_notebooks.py --check     # notebooks match their sources; launch links
    python tools/run_notebooks.py                # every notebook runs on the fake backend

After you add or rename a page, heading or checklist step, run
`python3 tools/build_search_index.py` to rebuild the search index.

After you add a page, or change a page's main heading or lead paragraph, run
`python3 tools/build_site_meta.py`. It rewrites the marked block in each page's head (a
description from the lead paragraph, the page's address on the website, the icon and the
tags that link previews read), `book/sitemap.xml` and `book/robots.txt`, and changes only
the files that are out of date.

The tracker tests in `tools/tests/browser.test.js` drive the real pages in headless
Chromium. They need the `playwright` package with a browser it has already installed, and
are skipped when it is missing. To run them, point `NODE_PATH` at a `node_modules` folder
that holds playwright. Set `REQUIRE_BROWSER=1` to make a missing browser fail the run
instead; CI does.

`check_book.py` also reads `tools/banned-words.local.txt` if you create it: one pattern per
line that must not appear in the book. git ignores that file, so a private list stays
private.

`run_notebooks.py` needs `nbclient`, `nbformat` and `ipykernel` as well as the lab
requirements.

The same checks, the lab tests, the notebooks and the browser tests run on every push and
pull request (`.github/workflows/check.yml`).

## Publish it

The book is a static site: the `book/` folder as it is. On Vercel, import the repository
with the framework preset "Other" and no build command. `vercel.json` makes `book/` the
output folder, so nothing outside it reaches the site, and adds security headers. On a
public address the Ask AI box copies a ready-made prompt instead of calling a model, so no
key is ever needed on the server.

## Licence

The code (everything under `labs/`, `tools/` and `book/assets/`, the notebooks, and the
code samples in the pages) is under the MIT License, in `LICENSE`. The text of the book is
under Creative Commons Attribution 4.0 (CC BY 4.0), in `LICENSE-TEXT`.
