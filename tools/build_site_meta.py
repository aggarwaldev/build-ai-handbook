#!/usr/bin/env python3
"""Write each page's metadata block, book/sitemap.xml and book/robots.txt.

Every page in the BOOK list gets one block in its <head>, between two marker comments,
right after its <title>:

- a description: the opening sentences of the page's lead paragraph (<p class="lead">),
  50 to 160 characters, cut at a word boundary when the first sentence is longer;
- its canonical address on the published site;
- the site icon, book/assets/icon.svg;
- Open Graph tags (site name, title, description, address, type) and a Twitter card, which
  chat apps and social sites read to show a link preview. The title is the page's h1.

The tool replaces only what lies between the markers and leaves the rest of the head as it
is. It also writes book/sitemap.xml (every page in the BOOK list, at its canonical address)
and book/robots.txt (crawl everything; here is the sitemap).

Run from the repository root with plain python3 (standard library only):

    python3 tools/build_site_meta.py          # rewrite only what changed
    python3 tools/build_site_meta.py --check  # change nothing; exit 1 if anything is out of date

Run it after you add a page, or change a page's title, h1 or lead paragraph.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_notebooks import BOOK_URL  # noqa: E402
from build_search_index import BOOK, ROOT, book_entries  # noqa: E402

# The address the site is published at: the same one the notebooks link to.
SITE_URL = BOOK_URL

SITE_NAME = "Build AI handbook"
ICON = "assets/icon.svg"
SITEMAP = BOOK / "sitemap.xml"
ROBOTS = BOOK / "robots.txt"
COVER = "index.html"

BEGIN = "<!-- page metadata: written by tools/build_site_meta.py, do not edit by hand -->"
END = "<!-- end of page metadata -->"
DESC_MIN = 50
DESC_MAX = 160

# Words that do not end a sentence even though they end with a full stop.
_ABBREVIATIONS = {"e.g.", "i.e.", "etc.", "vs.", "cf.", "approx.", "Dr.", "Mr.", "Mrs.", "Ms.", "St."}
_SENTENCE_END = re.compile(r"[.!?][\"'”’)]*$")
# A cut that leaves one of these last reads badly ("…until it…"), so it goes too.
_WEAK_ENDINGS = {"a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "is",
                 "it", "its", "of", "on", "or", "that", "the", "to", "with"}


def page_url(file: str) -> str:
    """A page's canonical address: the cover is the site's root."""
    return SITE_URL if file == COVER else SITE_URL + file


class _Opening(HTMLParser):
    """The text of the h1 and of the lead paragraph (or, failing that, the first paragraph
    in the article that is not the kicker)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.h1 = ""
        self.lead = ""
        self.first_p = ""
        self._in_article = False
        self._grab: str | None = None
        self._slot = ""
        self._buf: list[str] = []
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if tag == "article":
            self._in_article = True
        if self._grab is not None:
            if tag == self._grab:
                self._depth += 1
            return
        classes = a.get("class", "").split()
        if tag == "h1" and not self.h1:
            self._start("h1")
        elif tag == "p" and self._in_article:
            if "lead" in classes and not self.lead:
                self._start("p", "lead")
            elif "kicker" not in classes and not self.first_p:
                self._start("p", "first_p")

    def _start(self, tag: str, slot: str | None = None) -> None:
        self._grab = tag
        self._slot = slot or tag
        self._buf = []
        self._depth = 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "article":
            self._in_article = False
        if self._grab is not None and tag == self._grab:
            self._depth -= 1
            if self._depth == 0:
                setattr(self, self._slot, " ".join("".join(self._buf).split()))
                self._grab = None

    def handle_data(self, data: str) -> None:
        if self._grab is not None:
            self._buf.append(data)


def sentences(text: str) -> list[str]:
    """Split plain text into sentences: a word ending in . ! or ? (perhaps followed by a
    closing quote or bracket) ends one, unless it is a known abbreviation."""
    out: list[str] = []
    current: list[str] = []
    for word in text.split():
        current.append(word)
        if _SENTENCE_END.search(word) and word not in _ABBREVIATIONS:
            out.append(" ".join(current))
            current = []
    if current:
        out.append(" ".join(current))
    return out


def shorten(text: str, limit: int = DESC_MAX) -> str:
    """Cut text to at most `limit` characters, ending with an ellipsis. The cut falls at the
    end of a clause (a comma, colon or semicolon) when one lies in the last third, otherwise
    at a word boundary. It never leaves a bracket or a quotation open, and a trailing word
    like "the" or "and" goes too."""
    if len(text) <= limit:
        return text
    room = limit - 1  # one character for the ellipsis
    clause = [m.start() for m in re.finditer(r"[,;:](?= )", text[: room + 1]) if m.start() <= room]
    if clause and clause[-1] >= limit * 2 // 3:
        kept = text[: clause[-1]]
    else:
        space = text.rfind(" ", 0, room + 1)
        kept = text[:space] if space > 0 else text[:room]
    if kept.count("(") > kept.count(")"):
        kept = kept[: kept.rfind("(")]
    if kept.count('"') % 2:
        kept = kept[: kept.rfind('"')]
    words = kept.rstrip().split(" ")
    while len(words) > 1 and words[-1].lower().strip(",;:") in _WEAK_ENDINGS:
        words.pop()
    kept = " ".join(words).rstrip(" ,;:-–—")
    return kept + "…"


def describe(text: str) -> str:
    """A description from a page's opening text: whole sentences while they fit in
    DESC_MAX characters; if that is under DESC_MIN, the text cut to DESC_MAX instead."""
    text = " ".join(text.split())
    out = ""
    for sentence in sentences(text):
        joined = f"{out} {sentence}".strip()
        if len(joined) > DESC_MAX:
            break
        out = joined
    if len(out) < DESC_MIN:
        out = shorten(text)
    return out


def meta_block(file: str, title: str, description: str) -> str:
    url = page_url(file)
    kind = "website" if file == COVER else "article"
    attr = lambda value: html.escape(value, quote=True)  # noqa: E731
    lines = [
        BEGIN,
        f'<meta name="description" content="{attr(description)}">',
        f'<link rel="canonical" href="{attr(url)}">',
        f'<link rel="icon" href="{ICON}" type="image/svg+xml">',
        f'<meta property="og:site_name" content="{attr(SITE_NAME)}">',
        f'<meta property="og:type" content="{kind}">',
        f'<meta property="og:title" content="{attr(title)}">',
        f'<meta property="og:description" content="{attr(description)}">',
        f'<meta property="og:url" content="{attr(url)}">',
        '<meta name="twitter:card" content="summary">',
        END,
    ]
    return "\n".join(lines) + "\n"


_BLOCK_RE = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", re.S)
_TITLE_END_RE = re.compile(r"</title>[ \t]*\n")


def with_block(page: str, source: str, block: str, problems: list[str]) -> str | None:
    """The page's text with its metadata block replaced, or added after </title>."""
    head_end = source.find("</head>")
    if head_end < 0:
        problems.append(f"book/{page}: no </head>")
        return None
    starts, ends = source.count(BEGIN), source.count(END)
    if starts != ends or starts > 1:
        problems.append(f"book/{page}: expected one metadata block, found {starts} start and {ends} end markers")
        return None
    if starts == 1:
        m = _BLOCK_RE.search(source)
        if not m or m.end() > head_end + len("</head>"):
            problems.append(f"book/{page}: the metadata block is not inside <head>")
            return None
        return source[: m.start()] + block + source[m.end():]
    m = _TITLE_END_RE.search(source, 0, head_end)
    if not m:
        problems.append(f"book/{page}: no </title> at the end of a line in <head> to put the metadata after")
        return None
    return source[: m.end()] + block + source[m.end():]


def sitemap(files: list[str]) -> str:
    rows = "".join(f"<url><loc>{xml_escape(page_url(f))}</loc></url>\n" for f in files)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!-- Written by tools/build_site_meta.py from the BOOK list. Do not edit by hand. -->\n"
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{rows}"
        "</urlset>\n"
    )


def robots() -> str:
    return (
        "# Written by tools/build_site_meta.py. Do not edit by hand.\n"
        "User-agent: *\n"
        "Allow: /\n"
        "\n"
        f"Sitemap: {SITE_URL}sitemap.xml\n"
    )


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="change nothing; fail if anything is out of date")
    args = ap.parse_args(argv)

    problems: list[str] = []
    stale: list[str] = []
    wanted: dict[Path, str] = {}
    files = [str(e["file"]) for e in book_entries()]

    for file in files:
        path = BOOK / file
        if not path.is_file():
            problems.append(f"book/{file}: in the BOOK list but missing")
            continue
        source = path.read_text(encoding="utf-8")
        opening = _Opening()
        opening.feed(source)
        opening.close()
        text = opening.lead or opening.first_p
        if not opening.h1:
            problems.append(f"book/{file}: no <h1> for the page title")
            continue
        description = describe(text)
        if not DESC_MIN <= len(description) <= DESC_MAX:
            problems.append(
                f"book/{file}: description is {len(description)} characters, outside "
                f"{DESC_MIN}-{DESC_MAX}; lengthen the lead paragraph: {description!r}"
            )
            continue
        new = with_block(file, source, meta_block(file, opening.h1, description), problems)
        if new is not None:
            wanted[path] = new

    wanted[SITEMAP] = sitemap(files)
    wanted[ROBOTS] = robots()

    for path, text in wanted.items():
        current = path.read_text(encoding="utf-8") if path.is_file() else None
        if current == text:
            continue
        rel = path.relative_to(ROOT).as_posix()
        if args.check:
            stale.append(f"{rel} is out of date: run python3 tools/build_site_meta.py")
        elif not problems:
            path.write_text(text, encoding="utf-8")
            print(f"wrote {rel}")

    print(f"pages: {len(files)}; out of date: {len(stale)}; problems: {len(problems)}")
    for line in problems + stale:
        print("  " + line)
    return 1 if problems or stale else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
