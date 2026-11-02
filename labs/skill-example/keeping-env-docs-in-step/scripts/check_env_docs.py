"""Compare the variable names in .env.example with those in the README's environment tables.

    python check_env_docs.py                 # run from the repository root
    python check_env_docs.py --repo PATH     # or point it at one

It reads names only: everything after "=" in .env.example is ignored and never printed, so a
real value pasted there by mistake cannot leak through this script's output. Standard library only.
Exit status: 0 when both lists agree, 1 when they differ, 2 when a file or section is missing.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

NAME_LINE = re.compile(r"^([A-Z][A-Z0-9_]*)=")  # an uncommented NAME=... line
TABLE_ROW = re.compile(r"^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|")  # a README row starting | `NAME` |
SECTION = "## Environment variables"


def example_names(path: Path) -> set[str]:
    names = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        match = NAME_LINE.match(line.strip())
        if match:
            names.add(match.group(1))
    return names


def readme_names(path: Path) -> set[str] | None:
    names: set[str] = set()
    inside = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            if inside:
                break  # the next top-level section ends the environment tables
            inside = line.strip() == SECTION
            continue
        if inside:
            match = TABLE_ROW.match(line)
            if match:
                names.add(match.group(1))
    return names if inside or names else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="repository root")
    root = parser.parse_args().repo
    example, readme = root / ".env.example", root / "README.md"
    for path in (example, readme):
        if not path.is_file():
            print(f"missing file: {path}")
            return 2
    in_example = example_names(example)
    in_readme = readme_names(readme)
    if in_readme is None:
        print(f'no "{SECTION}" section in {readme}')
        return 2
    only_example = sorted(in_example - in_readme)
    only_readme = sorted(in_readme - in_example)
    print(f".env.example: {len(in_example)} names; README tables: {len(in_readme)} names")
    for name in only_example:
        print(f"only in .env.example: {name}")
    for name in only_readme:
        print(f"only in README: {name}")
    if only_example or only_readme:
        return 1
    print("in step")
    return 0


if __name__ == "__main__":
    sys.exit(main())
