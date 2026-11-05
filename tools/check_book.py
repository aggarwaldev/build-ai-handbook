#!/usr/bin/env python3
"""Check the book's structure and wording. Prints every problem and exits 1 if there are any.

What it checks:

1. The BOOK list in book/assets/handbook.js parses (every entry), every file it names
   exists, and every .html page in book/ is in it.
2. Words that must not appear: leftovers from the book's earlier internal edition (its old
   callout kinds and paths), plus any patterns listed one per line in
   tools/banned-words.local.txt (# starts a comment). git ignores that file, so a private
   list of names never lands in the repository. It reads every text file git knows about or
   would add (.html .js .css .py .md .txt .json .jsonl .ipynb .yml .yaml .toml .ini .cfg, and
   .gitignore), except this script and the local list.
3. Every page loads assets/handbook.css, assets/search-index.js and assets/handbook.js,
   has the sidebar and pager navs, and has a <title> ending in "Build AI handbook".
4. Progress checkpoints (<li data-check="…">) have ids that are unique in the book and
   start with their page's file name without .html, then a colon.
5. h2 and h3 ids are unique within each page.
6. Callouts use only the kinds note, why, warn and build.
7. Every <code class="path"> that names something under labs/, tools/ or book/ exists.
   Paths are named from the repository root, so one that starts with assets/ is reported:
   in the repository that folder is book/assets/.
   The one exception is a folder a lab creates when it runs, such as
   labs/02-prompt-bench/runs/: it passes when it ends in "/", git ignores it, and the
   folder that holds it exists.
8. book/assets/handbook.js names the same repository, branch and site address as the
   Python tools: REPO and BRANCH in tools/build_notebooks.py, SITE_URL in
   tools/build_site_meta.py. The footer's links come from the first, the page heads and
   the sitemap from the second.

Standard library only. Run from anywhere:

    python3 tools/check_book.py
"""

from __future__ import annotations

import glob
import html
import re
import subprocess
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_notebooks import BRANCH, REPO  # noqa: E402
from build_search_index import BOOK, ROOT, book_entries, book_key_count  # noqa: E402
from build_site_meta import SITE_URL  # noqa: E402

SELF = Path(__file__).resolve()
TEXT_SUFFIXES = {".html", ".js", ".css", ".py", ".md", ".txt", ".json", ".jsonl", ".ipynb", ".yml", ".yaml", ".toml", ".ini", ".cfg"}
TEXT_NAMES = {".gitignore"}
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache"}
CALLOUT_KINDS = {"note", "why", "warn", "build"}
CHECKED_PATH_ROOTS = ("labs/", "tools/", "book/")
TITLE_SUFFIX = "Build AI handbook"

# (what to report, pattern). Case matters only where a word is a common English word.
BANNED: list[tuple[str, re.Pattern[str]]] = [
    ("In this repo", re.compile(r"\bIn this repo\b")),
    ("callout repo / callout unsure", re.compile(r"callout[\s.]+(?:repo|unsure)\b")),
    ("docs/technical-handbook", re.compile(r"docs/technical-handbook")),
    ("projects/", re.compile(r"projects/")),
    ("old code path app/…", re.compile(r"\bapp/(?:tools|knowledge|guards|models|orchestrator|judge)\b")),
    ("old code path in a path tag", re.compile(r'class="path">\s*(?:app|corpus|evals)/')),
]
LOCAL_WORDS = ROOT / "tools" / "banned-words.local.txt"
_JS_ADDRESS_RE = re.compile(r"^\s*var (REPO|BRANCH|BOOK_URL) = '([^'\\]*)';", re.M)


def local_banned() -> list[tuple[str, re.Pattern[str]]]:
    """Case-insensitive patterns from the git-ignored local list, if there is one."""
    if not LOCAL_WORDS.is_file():
        return []
    out = []
    for line in LOCAL_WORDS.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(("local list: " + line, re.compile(line, re.I)))
    return out


def text_files() -> list[Path]:
    """Files git tracks or would add (not ignored); a plain walk if git is not available."""
    names: list[str] = []
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=ROOT, capture_output=True, check=True,
        ).stdout.decode("utf-8")
        names = [n for n in out.split("\0") if n]
    except (OSError, subprocess.CalledProcessError):
        for path in ROOT.rglob("*"):
            rel = path.relative_to(ROOT)
            if any(part in SKIP_DIRS for part in rel.parts[:-1]) or not path.is_file():
                continue
            names.append(rel.as_posix())
    files = []
    for name in sorted(set(names)):
        path = ROOT / name
        if not path.is_file() or path.resolve() == SELF:
            continue
        if path.suffix.lower() in TEXT_SUFFIXES or path.name in TEXT_NAMES:
            files.append(path)
    return files


class _PageFacts(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] | None = None
        self.title = ""
        self.scripts: list[str] = []
        self.styles: list[str] = []
        self.nav_ids: set[str] = set()
        self.heading_ids: list[tuple[str, int]] = []
        self.checks: list[tuple[str, int]] = []
        self.callouts: list[tuple[str, int]] = []
        self.paths: list[tuple[str, int]] = []
        self._path_buf: list[str] | None = None
        self._path_line = 0
        self._code_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        line = self.getpos()[0]
        classes = a.get("class", "").split()
        if tag == "title":
            self.title_parts = []
        elif tag == "script" and a.get("src"):
            self.scripts.append(a["src"])
        elif tag == "link" and "stylesheet" in a.get("rel", "").split():
            self.styles.append(a.get("href", ""))
        elif tag == "nav" and a.get("id"):
            self.nav_ids.add(a["id"])
        if tag in ("h2", "h3") and a.get("id"):
            self.heading_ids.append((a["id"], line))
        if tag == "li" and "data-check" in a:
            self.checks.append((a["data-check"], line))
        if "callout" in classes:
            self.callouts.append((" ".join(classes), line))
        if tag == "code":
            if self._path_buf is not None:
                self._code_depth += 1
            elif "path" in classes:
                self._path_buf = []
                self._path_line = line
                self._code_depth = 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self.title_parts is not None:
            self.title = " ".join("".join(self.title_parts).split())
            self.title_parts = None
        if tag == "code" and self._path_buf is not None:
            self._code_depth -= 1
            if self._code_depth == 0:
                self.paths.append(("".join(self._path_buf).strip(), self._path_line))
                self._path_buf = None

    def handle_data(self, data: str) -> None:
        if self.title_parts is not None:
            self.title_parts.append(data)
        if self._path_buf is not None:
            self._path_buf.append(data)


def check_book_list(problems: list[str]) -> list[str]:
    entries = book_entries()
    keys = book_key_count()
    if keys != len(entries):
        problems.append(
            f"book/assets/handbook.js: {keys} BOOK entries start with `file:` but only {len(entries)} parse; "
            "keep each entry on one line with keys file, part, n (optional), title"
        )
    files = [str(e["file"]) for e in entries]
    for name, count in Counter(files).items():
        if count > 1:
            problems.append(f"book/assets/handbook.js: BOOK lists {name} {count} times")
    for name in files:
        if not (BOOK / name).is_file():
            problems.append(f"book/assets/handbook.js: BOOK names a missing page {name}")
    listed = set(files)
    for page in sorted(BOOK.glob("*.html")):
        if page.name not in listed:
            problems.append(f"{page.name}: page is not in the BOOK list in book/assets/handbook.js")
    return files


def check_banned(problems: list[str]) -> int:
    scanned = 0
    patterns = BANNED + local_banned()
    for path in text_files():
        if path.resolve() == LOCAL_WORDS.resolve():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        rel = path.relative_to(ROOT).as_posix()
        for lineno, line in enumerate(text.splitlines(), 1):
            for label, pattern in patterns:
                m = pattern.search(line)
                if m:
                    start = max(0, m.start() - 40)
                    snippet = " ".join(line[start : m.end() + 40].split())
                    problems.append(f"{rel}:{lineno}: banned word ({label}): …{snippet}…")
    return scanned


def _run_output_folder(text: str) -> bool:
    """True for a folder a lab writes when it runs: named with a trailing "/", ignored by
    git, and inside a folder that exists. A misspelt name fails one of the three."""
    if not text.endswith("/") or not (ROOT / text).parent.is_dir():
        return False
    try:
        done = subprocess.run(
            ["git", "-C", str(ROOT), "check-ignore", "-q", "--no-index", text],
            capture_output=True, check=False,
        )
    except OSError:
        return False
    return done.returncode == 0


def check_pages(problems: list[str]) -> int:
    seen_checks: dict[str, str] = {}
    n_checks = 0
    for page in sorted(BOOK.glob("*.html")):
        name = page.name
        stem = page.stem
        facts = _PageFacts()
        facts.feed(page.read_text(encoding="utf-8"))
        facts.close()

        for needed in ("assets/handbook.css",):
            if needed not in facts.styles:
                problems.append(f"{name}: does not load {needed}")
        for needed in ("assets/search-index.js", "assets/handbook.js"):
            if needed not in facts.scripts:
                problems.append(f"{name}: does not load {needed}")
        for nav in ("sidebar", "pager"):
            if nav not in facts.nav_ids:
                problems.append(f'{name}: has no <nav id="{nav}">')
        title = html.unescape(facts.title)
        if not title.endswith(TITLE_SUFFIX):
            problems.append(f"{name}: <title> {title!r} does not end with {TITLE_SUFFIX!r}")

        for hid, count in Counter(h for h, _ in facts.heading_ids).items():
            if count > 1:
                lines = ", ".join(str(ln) for h, ln in facts.heading_ids if h == hid)
                problems.append(f"{name}: h2/h3 id {hid!r} is used {count} times (lines {lines})")

        for cid, line in facts.checks:
            n_checks += 1
            if not cid.startswith(stem + ":") or len(cid) <= len(stem) + 1:
                problems.append(f"{name}:{line}: data-check {cid!r} should start with {stem + ':'!r} and a slug")
            if cid in seen_checks:
                problems.append(f"{name}:{line}: data-check {cid!r} is already used in {seen_checks[cid]}")
            else:
                seen_checks[cid] = name

        for classes, line in facts.callouts:
            kinds = [c for c in classes.split() if c != "callout"]
            if len(kinds) != 1 or kinds[0] not in CALLOUT_KINDS:
                problems.append(
                    f"{name}:{line}: callout class {classes!r}: use exactly one of "
                    + ", ".join(sorted(CALLOUT_KINDS))
                )

        for text, line in facts.paths:
            if text.startswith("assets/"):
                problems.append(f"{name}:{line}: path {text!r}: name it from the repository root, book/{text}")
                continue
            if not text.startswith(CHECKED_PATH_ROOTS):
                continue
            if any(ch in text for ch in "*?["):
                if not glob.glob(str(ROOT / text)):
                    problems.append(f"{name}:{line}: path {text!r} matches nothing")
            elif not (ROOT / text).exists() and not _run_output_folder(text):
                problems.append(f"{name}:{line}: path {text!r} does not exist")
    return n_checks


def check_addresses(problems: list[str]) -> None:
    """handbook.js and the Python tools must name the same repository, branch and site."""
    source = (BOOK / "assets" / "handbook.js").read_text(encoding="utf-8")
    found: dict[str, list[str]] = {}
    for name, value in _JS_ADDRESS_RE.findall(source):
        found.setdefault(name, []).append(value)
    expected = {
        "REPO": (REPO, "tools/build_notebooks.py REPO"),
        "BRANCH": (BRANCH, "tools/build_notebooks.py BRANCH"),
        "BOOK_URL": (SITE_URL, "tools/build_site_meta.py SITE_URL"),
    }
    for name, (want, where) in expected.items():
        values = found.get(name, [])
        if len(values) != 1:
            problems.append(f"book/assets/handbook.js: expected one line `var {name} = '...';`, found {len(values)}")
        elif values[0] != want:
            problems.append(f"book/assets/handbook.js: {name} is {values[0]!r} but {where} is {want!r}")


def main() -> int:
    problems: list[str] = []
    files = check_book_list(problems)
    check_addresses(problems)
    n_pages = len(list(BOOK.glob("*.html")))
    scanned = check_banned(problems)
    n_checks = check_pages(problems)
    if not (BOOK / "assets" / "progress.js").is_file():
        problems.append("book/assets/progress.js is missing: book/assets/handbook.js loads it on every page")
    print(f"BOOK entries: {len(files)}; pages in book/: {n_pages}")
    print(f"text files scanned for banned words: {scanned}")
    print(f"progress checkpoints: {n_checks}")
    print(f"problems: {len(problems)}")
    for line in problems:
        print("  " + line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
