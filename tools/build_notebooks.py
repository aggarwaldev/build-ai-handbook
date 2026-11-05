#!/usr/bin/env python3
"""Build the lab notebooks in labs/notebooks/ from their sources in labs/notebooks/src/.

Each source is a plain Python file split into cells by lines that start with "# %%":

    # %% [markdown]
    # # Lab 1: your first model call
    # Text, written as comment lines.

    # %%
    print("a code cell")

The script puts the same setup cells after every notebook's first cell: they find or clone
the repository, install what the labs need, and pick the backend (fake, anthropic or
ollama). "{{BOOK}}" in a source becomes the address of the published book.

    python3 tools/build_notebooks.py           # write the notebooks
    python3 tools/build_notebooks.py --check   # fail if a notebook is out of date, a lab page
                                               # lacks its launch links, or Binder's
                                               # requirements miss one the labs list

The notebooks are written without outputs, so they stay small and diff cleanly. Standard
library only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOK = ROOT / "book"
SRC = ROOT / "labs" / "notebooks" / "src"
OUT = ROOT / "labs" / "notebooks"

REPO = "aggarwaldev/build-ai-handbook"
BRANCH = "main"
BOOK_URL = "https://handbook.aggarwal.dev/"

# notebook stem -> the lab page it follows
LABS = {
    "lab-00-setup": "lab-setup.html",
    "lab-01-first-call": "lab-first-call.html",
    "lab-02-prompt-bench": "lab-prompt-bench.html",
    "lab-03-rag": "lab-rag.html",
    "lab-04-retrieval-eval": "lab-retrieval-eval.html",
    "lab-05-agent": "lab-agent.html",
    "lab-06-mcp": "lab-mcp.html",
    "lab-07-guardrails": "lab-guardrails.html",
    "lab-08-judge": "lab-judge.html",
    "lab-09-tracing": "lab-tracing.html",
    "lab-10-capstone": "lab-capstone.html",
}

SETUP_MARKDOWN = """\
## Set up

Run the next cell first. It finds the book's code (in Colab it downloads it), installs what
the labs need and picks who answers:

- `fake` needs no key and costs nothing. Its replies are scripted, so they show how the
  code works, not what a model would say.
- `anthropic` uses Claude with your own API key. In Colab, add `ANTHROPIC_API_KEY` in the
  Secrets panel (the key icon on the left) and let this notebook read it. Elsewhere the cell
  asks for the key. It is never written into the notebook.
- `ollama` runs a small open model, free. In Colab it installs and starts Ollama for you:
  switch to a GPU first (Runtime, then Change runtime type, then T4 GPU), and expect the
  first run to download about 2 GB.

To change the backend later, change it here and run this cell again. Lab 0 in the book
explains the choices: {{BOOK}}lab-setup.html"""

SETUP_CODE = '''\
# @title Set up this lab
BACKEND = "fake"  # @param ["fake", "anthropic", "ollama"]
MODEL = ""  # @param {type:"string"}

import os, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

REPO = "https://github.com/{{REPO}}.git"


def find_root():
    here = Path.cwd().resolve()
    for folder in (here, *here.parents):
        if (folder / "labs" / "common" / "llm.py").is_file():
            return folder
    return None


root = find_root()
if root is None:
    if not Path("build-ai-handbook").is_dir():
        subprocess.run(["git", "clone", "--quiet", "--depth", "1", REPO], check=True)
    root = Path("build-ai-handbook").resolve()
os.chdir(root)


def run_command(*cmd):
    """Run a command from the repository root, show its output in this cell, and stop if it fails."""
    done = subprocess.run([sys.executable if part == "python" else part for part in cmd],
                          capture_output=True, text=True)
    print(done.stdout, end="")
    print(done.stderr, end="", file=sys.stderr)
    if done.returncode:
        raise RuntimeError("this command failed: " + " ".join(cmd))


if str(root / "labs") not in sys.path:
    sys.path.insert(0, str(root / "labs"))

try:
    import anthropic, numpy  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "-r", "labs/requirements.txt"], check=True)

os.environ["LLM_BACKEND"] = BACKEND
if MODEL.strip():
    os.environ["LLM_MODEL"] = MODEL.strip()
else:
    os.environ.pop("LLM_MODEL", None)
IN_COLAB = "google.colab" in sys.modules

if BACKEND == "anthropic" and not os.environ.get("ANTHROPIC_API_KEY", "").strip():
    if IN_COLAB:
        from google.colab import userdata
        try:
            os.environ["ANTHROPIC_API_KEY"] = userdata.get("ANTHROPIC_API_KEY")
        except Exception as err:
            raise RuntimeError("Add ANTHROPIC_API_KEY in the Secrets panel (the key icon on the left) "
                               "and allow this notebook to read it, then run this cell again.") from err
    else:
        from getpass import getpass
        os.environ["ANTHROPIC_API_KEY"] = getpass("Anthropic API key (not saved in the notebook): ")


def ollama_running():
    host = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
    try:
        urllib.request.urlopen(host + "/api/tags", timeout=2)
        return True
    except OSError:
        return False


if BACKEND == "ollama":
    if not ollama_running():
        if not IN_COLAB:
            raise RuntimeError("Start Ollama on this machine (ollama serve), or pick another backend.")
        if shutil.which("ollama") is None:
            if shutil.which("zstd") is None:
                subprocess.run("apt-get -qq update && apt-get -qq install -y zstd", shell=True, check=True)
            subprocess.run("curl -fsSL https://ollama.com/install.sh | sh", shell=True, check=True)
        subprocess.Popen(["ollama", "serve"], stdout=open("ollama.log", "a"), stderr=subprocess.STDOUT)
        for _ in range(60):
            if ollama_running():
                break
            time.sleep(1)
        else:
            raise RuntimeError("Ollama did not start; see ollama.log.")
    if shutil.which("nvidia-smi") is None:
        print("No GPU found: Ollama will answer slowly on the CPU.")
    pulled = os.environ.get("LLM_MODEL", "llama3.2")
    if shutil.which("ollama"):
        subprocess.run(["ollama", "pull", pulled], check=True)

print(f"Ready: code in {root}, backend {BACKEND}" + (f", model {os.environ['LLM_MODEL']}" if os.environ.get("LLM_MODEL") else ""))'''


def colab_url(stem: str) -> str:
    return f"https://colab.research.google.com/github/{REPO}/blob/{BRANCH}/labs/notebooks/{stem}.ipynb"


def binder_url(stem: str) -> str:
    return f"https://mybinder.org/v2/gh/{REPO}/{BRANCH}?urlpath=lab/tree/labs/notebooks/{stem}.ipynb"


CODESPACES_URL = f"https://codespaces.new/{REPO}?quickstart=1"


def fill(text: str) -> str:
    return text.replace("{{BOOK}}", BOOK_URL).replace("{{REPO}}", REPO)


def parse(source: str) -> list[tuple[str, str]]:
    """Split a source into (kind, text) cells; kind is "markdown" or "code"."""
    cells: list[tuple[str, list[str]]] = []
    for line in source.splitlines():
        m = re.match(r"# %%(?:\s*\[(\w+)\])?\s*$", line)
        if m:
            kind = m.group(1) or "code"
            if kind not in ("markdown", "code"):
                raise ValueError(f"unknown cell kind [{kind}]")
            cells.append((kind, []))
            continue
        if not cells:
            if line.strip():
                raise ValueError("text before the first '# %%' line")
            continue
        kind, lines = cells[-1]
        if kind == "markdown":
            if line.strip() and not line.startswith("#"):
                raise ValueError(f"markdown line does not start with '#': {line!r}")
            line = line[2:] if line.startswith("# ") else line[1:]
        lines.append(line)
    out = []
    for kind, lines in cells:
        text = "\n".join(lines).strip("\n")
        if text.strip():
            out.append((kind, text))
    return out


def cell(kind: str, text: str, cell_id: str) -> dict:
    lines = text.split("\n")
    source = [line + "\n" for line in lines[:-1]] + [lines[-1]]
    c = {"cell_type": kind, "id": cell_id, "metadata": {}, "source": source}
    if kind == "code":
        c["execution_count"] = None
        c["outputs"] = []
    return c


def build(stem: str, source: str) -> str:
    cells = parse(fill(source))
    if not cells or cells[0][0] != "markdown":
        raise ValueError("the first cell must be markdown (the title)")
    cells[1:1] = [("markdown", fill(SETUP_MARKDOWN)), ("code", fill(SETUP_CODE))]
    nb = {
        "cells": [cell(kind, text, f"{stem}-{i:02d}") for i, (kind, text) in enumerate(cells)],
        "metadata": {
            "colab": {"provenance": [], "toc_visible": True},
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return json.dumps(nb, indent=1, ensure_ascii=False) + "\n"


def page_links_problems() -> list[str]:
    problems = []
    for stem, page in LABS.items():
        text = (BOOK / page).read_text(encoding="utf-8")
        for name, url in (("Colab", colab_url(stem)), ("Binder", binder_url(stem)), ("Codespaces", CODESPACES_URL)):
            if f'href="{html_attr(url)}"' not in text:
                problems.append(f"book/{page}: no {name} link to {stem}")
    return problems


def requirement_lines(path: Path) -> set[str]:
    lines = (line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines())
    return {line for line in lines if line}


def binder_problems() -> list[str]:
    """Binder installs binder/requirements.txt on its own, so it must list every lab requirement."""
    have = requirement_lines(ROOT / "binder" / "requirements.txt")
    problems = []
    for name in ("labs/requirements.txt", "labs/06-mcp-server/requirements.txt"):
        for req in sorted(requirement_lines(ROOT / name) - have):
            problems.append(f"binder/requirements.txt lacks {req!r} from {name}")
    return problems


def html_attr(url: str) -> str:
    return url.replace("&", "&amp;")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="change nothing; fail if anything is out of date")
    args = ap.parse_args()

    problems = []
    sources = {p.stem: p for p in sorted(SRC.glob("*.py"))}
    for stem in sorted(set(sources) - set(LABS)):
        problems.append(f"{sources[stem].relative_to(ROOT)}: not a known lab (add it to LABS)")
    for stem in LABS:
        if stem not in sources:
            problems.append(f"labs/notebooks/src/{stem}.py is missing")
            continue
        try:
            text = build(stem, sources[stem].read_text(encoding="utf-8"))
        except ValueError as err:
            problems.append(f"{sources[stem].relative_to(ROOT)}: {err}")
            continue
        target = OUT / f"{stem}.ipynb"
        if args.check:
            if not target.is_file() or target.read_text(encoding="utf-8") != text:
                problems.append(f"{target.relative_to(ROOT)} is out of date: run python3 tools/build_notebooks.py")
        elif not target.is_file() or target.read_text(encoding="utf-8") != text:
            target.write_text(text, encoding="utf-8")
            print(f"wrote {target.relative_to(ROOT)}")
    for extra in sorted(OUT.glob("*.ipynb")):
        if extra.stem not in LABS:
            problems.append(f"{extra.relative_to(ROOT)}: no source for this notebook")
    problems += page_links_problems()
    problems += binder_problems()

    print(f"notebooks: {len(LABS)}; problems: {len(problems)}")
    for p in problems:
        print("  " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
