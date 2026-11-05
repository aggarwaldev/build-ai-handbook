#!/usr/bin/env python3
"""Check every internal link in the book: the file exists, and so does the #id it names.

It reads every .html file in the repository (the pages in book/, and any page under
labs/ or tools/), skipping hidden folders and virtual environments. From each it collects
a[href], link[href], script[src] and img[src] and checks every relative target. It also
checks that every page named in the BOOK list in book/assets/handbook.js exists, since the
sidebar is built from it. An absolute http(s) link is counted and listed but not fetched:
the book works offline.

Run from anywhere, with plain python3:

    python3 tools/check_links.py              # broken links, and a count of external ones
    python3 tools/check_links.py --external   # also list every external link

Exit status 1 when any link is broken.
"""

from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_search_index import BOOK, ROOT, book_entries  # noqa: E402

_LINK_ATTRS = {"a": "href", "link": "href", "script": "src", "img": "src"}
_SKIP_DIRS = {"node_modules", "venv", "__pycache__"}


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()
        self.links: list[tuple[str, int]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"] or "")
        if a.get("name") and tag == "a":
            self.ids.add(a["name"] or "")
        attr = _LINK_ATTRS.get(tag)
        if attr and a.get(attr):
            self.links.append((a[attr] or "", self.getpos()[0]))


def _parse(path: Path) -> _Collector:
    collector = _Collector()
    collector.feed(path.read_text(encoding="utf-8"))
    return collector


def html_pages() -> list[Path]:
    pages = []
    for path in sorted(ROOT.rglob("*.html")):
        rel = path.relative_to(ROOT)
        if any(part.startswith(".") or part in _SKIP_DIRS for part in rel.parts[:-1]):
            continue
        pages.append(path)
    return pages


def main() -> int:
    pages = html_pages()
    parsed = {p.resolve(): _parse(p) for p in pages}
    checked = 0
    external: list[str] = []
    broken: list[str] = []

    for page, info in parsed.items():
        rel_page = page.relative_to(ROOT)
        for href, line in info.links:
            if href.startswith(("http://", "https://", "//")):
                external.append(f"{rel_page}:{line}: {href}")
                continue
            if href.startswith(("mailto:", "javascript:", "data:")):
                continue
            checked += 1
            parts = urlsplit(href)
            target = page if not parts.path else (page.parent / unquote(parts.path)).resolve()
            if not target.exists():
                broken.append(f"{rel_page}:{line}: {href} (no such file)")
                continue
            if parts.fragment:
                ids = parsed[target].ids if target in parsed else None
                if ids is None:
                    broken.append(f"{rel_page}:{line}: {href} (fragment on a non-page)")
                elif unquote(parts.fragment) not in ids:
                    broken.append(f"{rel_page}:{line}: {href} (no id '{parts.fragment}')")

    for entry in book_entries():
        checked += 1
        if not (BOOK / str(entry["file"])).is_file():
            broken.append(f"book/assets/handbook.js: BOOK names a missing page {entry['file']}")

    print(f"pages: {len(pages)}")
    print(f"internal links checked: {checked}")
    print(f"broken: {len(broken)}")
    print(f"external links (not fetched): {len(external)}")
    for line in broken:
        print("  BROKEN", line)
    if "--external" in sys.argv[1:]:
        for line in external:
            print("  EXTERNAL", line)
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
