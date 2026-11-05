## What changed and why

<!-- One pull request holds one goal. Say what changed and why, and link the issue if there is one. -->

## Checks I ran

<!-- From the repository root. CONTRIBUTING.md lists them all; the same checks run on this pull request. -->

- [ ] `python3 tools/check_links.py`
- [ ] `python3 tools/check_book.py`
- [ ] `python3 tools/build_search_index.py --check`
- [ ] `python3 tools/build_site_meta.py --check`
- [ ] `python3 tools/build_notebooks.py --check`
- [ ] `node --test tools/tests/*.test.js`
- [ ] For a lab, `labs/common/` or a notebook source: `(cd labs && python -m pytest)` and `python tools/run_notebooks.py`
