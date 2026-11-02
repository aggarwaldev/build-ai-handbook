#!/usr/bin/env python3
"""Build assets/search-index.js: page titles and headings, glossary terms and lab checkpoints.

The book has no server, so the search box cannot read the HTML files at run time. This
script reads them once and writes a small JavaScript file that sets window.HANDBOOK_SEARCH:

- pages: every page in the BOOK list, with its h2 and h3 headings that carry an id
  (a search result links to that id);
- glossary: each term in glossary.html with the first sentences of its definition, for
  the hover box on dotted words;
- checkpoints: for each page with a progress checklist, its items in order, as
  {page: [{id, text}]}. The items come from <ul class="checklist"><li data-check="…">.
  progress.html uses them to show "ticked / total" per lab.

Page order comes from the BOOK list in assets/handbook.js.

Run from the repository root with plain python3 (standard library only):

    python3 tools/build_search_index.py          # write the file
    python3 tools/build_search_index.py --check  # exit 1 if the file is stale
"""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK_JS = ROOT / "assets" / "handbook.js"
OUT = ROOT / "assets" / "search-index.js"

_STR = r"'(?P<{name}>(?:[^'\\]|\\.)*)'"
_ENTRY_RE = re.compile(
    r"\{\s*file:\s*" + _STR.format(name="file") + r",\s*part:\s*" + _STR.format(name="part") + r","
    r"(?:\s*n:\s*(?P<n>\d+),)?\s*title:\s*" + _STR.format(name="title") + r"\s*\}"
)
_FILE_KEY_RE = re.compile(r"\{\s*file:\s*'")
_ESCAPES = {"n": "\n", "t": "\t", "r": "\r"}


def _js_unescape(text: str) -> str:
    """Undo the escapes a single-quoted JavaScript string may hold."""

    def repl(match: re.Match[str]) -> str:
        code = match.group(1)
        if code.startswith("u") and len(code) == 5:
            return chr(int(code[1:], 16))
        return _ESCAPES.get(code, code)

    return re.sub(r"\\(u[0-9a-fA-F]{4}|.)", repl, text)


def book_entries() -> list[dict[str, object]]:
    """The BOOK list from assets/handbook.js, in order: file, part, n (or None), title."""
    source = BOOK_JS.read_text(encoding="utf-8")
    entries: list[dict[str, object]] = []
    for match in _ENTRY_RE.finditer(source):
        entries.append(
            {
                "file": _js_unescape(match.group("file")),
                "part": _js_unescape(match.group("part")),
                "n": int(match.group("n")) if match.group("n") else None,
                "title": _js_unescape(match.group("title")),
            }
        )
    if not entries:
        raise SystemExit("no BOOK entries found in assets/handbook.js")
    return entries


def book_key_count() -> int:
    """How many `{ file: '` openings handbook.js has: every one should parse as an entry."""
    return len(_FILE_KEY_RE.findall(BOOK_JS.read_text(encoding="utf-8")))


class _PageParser(HTMLParser):
    """Collect h1/h2/h3 text with ids, glossary dt/dd pairs and checklist items."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.headings: list[dict[str, object]] = []
        self.terms: list[dict[str, str]] = []
        self.checkpoints: list[dict[str, str]] = []
        self._capture: dict[str, object] | None = None
        self._buf: list[str] = []
        self._dd_for: str | None = None
        self._dd_buf: list[str] | None = None
        self._dd_depth = 0
        self._list_stack: list[bool] = []
        self._li_id: str | None = None
        self._li_buf: list[str] = []
        self._li_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag in ("ul", "ol"):
            classes = (a.get("class") or "").split()
            self._list_stack.append(tag == "ul" and "checklist" in classes)
        if tag == "li":
            if self._li_id is not None:
                self._li_depth += 1
            elif self._list_stack and self._list_stack[-1] and a.get("data-check"):
                self._li_id = a.get("data-check") or ""
                self._li_buf = []
                self._li_depth = 1
        if tag in ("h1", "h2", "h3"):
            self._capture = {"tag": tag, "id": a.get("id")}
            self._buf = []
        elif tag == "dt" and a.get("id"):
            self._capture = {"tag": "dt", "id": a.get("id")}
            self._buf = []
        elif tag == "dd" and self._dd_for is not None:
            self._dd_buf = []
            self._dd_depth = 1
        elif tag == "dd" and self._dd_buf is not None:
            self._dd_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "li" and self._li_id is not None:
            self._li_depth -= 1
            if self._li_depth == 0:
                text = " ".join("".join(self._li_buf).split())
                self.checkpoints.append({"id": self._li_id, "text": text})
                self._li_id = None
        if tag in ("ul", "ol") and self._list_stack:
            self._list_stack.pop()
        if self._capture is not None and tag == self._capture["tag"]:
            text = " ".join("".join(self._buf).split())
            if tag == "dt":
                self.terms.append({"id": str(self._capture["id"]), "term": text, "def": ""})
                self._dd_for = str(self._capture["id"])
            elif self._capture["id"]:
                self.headings.append(
                    {"id": self._capture["id"], "text": text, "level": int(tag[1])}
                )
            elif tag == "h1":
                self.headings.append({"id": "", "text": text, "level": 1})
            self._capture = None
        elif tag == "dd" and self._dd_buf is not None:
            self._dd_depth -= 1
            if self._dd_depth == 0:
                text = " ".join("".join(self._dd_buf).split())
                if self.terms and self.terms[-1]["id"] == self._dd_for:
                    self.terms[-1]["def"] = _first_sentences(text)
                self._dd_buf = None
                self._dd_for = None

    def handle_data(self, data: str) -> None:
        if self._li_id is not None:
            self._li_buf.append(data)
        if self._capture is not None:
            self._buf.append(data)
        elif self._dd_buf is not None:
            self._dd_buf.append(data)


def parse_page(path: Path) -> _PageParser:
    parser = _PageParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return parser


def _first_sentences(text: str, limit: int = 260) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    stop = cut.rfind(". ")
    return cut[: stop + 1] if stop > 80 else cut.rstrip() + "\u2026"


def build() -> str:
    pages = []
    glossary: dict[str, dict[str, str]] = {}
    checkpoints: dict[str, list[dict[str, str]]] = {}
    for entry in book_entries():
        file = str(entry["file"])
        path = ROOT / file
        if not path.is_file():
            # A planned page not written yet: the search lists its title only.
            print(f"note: BOOK names a page not written yet: {file}", file=sys.stderr)
            pages.append({"file": file, "title": entry["title"], "part": entry["part"], "headings": []})
            continue
        parser = parse_page(path)
        headings = [
            {"id": h["id"], "text": h["text"], "level": h["level"]}
            for h in parser.headings
            if h["level"] in (2, 3) and h["id"]
        ]
        pages.append({"file": file, "title": entry["title"], "part": entry["part"], "headings": headings})
        if parser.checkpoints:
            checkpoints[file] = parser.checkpoints
        if file == "glossary.html":
            for term in parser.terms:
                glossary[term["id"]] = {"term": term["term"], "def": term["def"]}
    data = {
        "pages": pages,
        "glossary": dict(sorted(glossary.items())),
        "checkpoints": checkpoints,
    }
    body = json.dumps(data, ensure_ascii=False, indent=1)
    return (
        "/* Generated by tools/build_search_index.py from the pages, the glossary and the lab "
        "checklists. Do not edit by hand. */\n"
        f"window.HANDBOOK_SEARCH = {body};\n"
    )


def main(argv: list[str]) -> int:
    text = build()
    if "--check" in argv:
        current = OUT.read_text(encoding="utf-8") if OUT.is_file() else ""
        if current != text:
            print("search index is stale: run python3 tools/build_search_index.py")
            return 1
        print("search index is current")
        return 0
    OUT.write_text(text, encoding="utf-8")
    data = json.loads(text.split("= ", 1)[1].rstrip(";\n"))
    n_head = sum(len(p["headings"]) for p in data["pages"])
    n_check = sum(len(v) for v in data["checkpoints"].values())
    print(
        f"wrote {OUT.relative_to(ROOT)}: {len(data['pages'])} pages, {n_head} headings, "
        f"{len(data['glossary'])} glossary terms, {n_check} checkpoints on "
        f"{len(data['checkpoints'])} pages"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
