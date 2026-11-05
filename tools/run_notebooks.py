#!/usr/bin/env python3
"""Run the lab notebooks top to bottom on the fake backend and report each one.

    python tools/run_notebooks.py                     # every notebook in labs/notebooks/
    python tools/run_notebooks.py lab-03-rag lab-05-agent
    python tools/run_notebooks.py --keep /tmp/out lab-03-rag   # also save the executed copy

Needs nbclient, nbformat and ipykernel, besides what the labs need. The notebooks run in
memory: nothing is written back, so they stay without outputs. Each runs from its own
folder, so its setup cell finds this checkout instead of downloading the code.

A shell line ("!python ...") that fails does not fail its cell in Jupyter, so before running,
each such line gets a check of its exit code after it. A notebook also fails if any output
shows a Python traceback, or if it prints anything outside its cells: a program started with
subprocess.run and not captured writes to the kernel's own output, which a reader never
sees.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTEBOOKS = ROOT / "labs" / "notebooks"
CELL_TIMEOUT_S = 300


def guard_shell_lines(nb) -> None:
    """After every top-level "!command" line, fail the cell if the command failed."""
    for c in nb.cells:
        if c.cell_type != "code":
            continue
        out = []
        for line in c.source.split("\n"):
            out.append(line)
            if line.startswith("!"):
                out.append(f"assert _exit_code == 0, 'this command failed: ' + {line[1:]!r}")
        c.source = "\n".join(out)


def traceback_in_outputs(nb) -> str | None:
    for c in nb.cells:
        for o in c.get("outputs", []):
            text = o.get("text", "") if o.get("output_type") == "stream" else ""
            if "Traceback (most recent call last)" in text:
                return text[-1500:]
    return None


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("names", nargs="*", help="notebook names; all of them if none")
    ap.add_argument("--keep", type=Path, help="save each executed notebook in this folder")
    args = ap.parse_args(argv)
    try:
        import nbformat
        from nbclient import NotebookClient
        from nbclient.exceptions import CellExecutionError
    except ImportError:
        print("needs nbclient, nbformat and ipykernel: python -m pip install nbclient nbformat ipykernel")
        return 2

    # Kernels inherit this process's stdout. Point it at a file, so whatever a notebook writes
    # outside its cells can be counted, and report on a copy of the real stdout.
    sys.stdout.flush()
    report = os.fdopen(os.dup(1), "w", buffering=1)
    leaks = tempfile.TemporaryFile()
    os.dup2(leaks.fileno(), 1)
    sys.stdout = report

    os.environ["LLM_BACKEND"] = "fake"
    os.environ.pop("ANTHROPIC_API_KEY", None)
    paths = [NOTEBOOKS / f"{name.removesuffix('.ipynb')}.ipynb" for name in args.names] or sorted(NOTEBOOKS.glob("*.ipynb"))
    if not paths:
        print("no notebooks found")
        return 1
    failed = 0
    for path in paths:
        nb = nbformat.read(path, as_version=4)
        nbformat.validate(nb)
        guard_shell_lines(nb)
        leaked_before = os.fstat(leaks.fileno()).st_size
        start = time.monotonic()
        try:
            NotebookClient(nb, timeout=CELL_TIMEOUT_S, kernel_name="python3",
                           resources={"metadata": {"path": str(path.parent)}}).execute()
        except CellExecutionError as err:
            failed += 1
            print(f"FAIL {path.name} ({time.monotonic() - start:.1f} s)")
            print("\n".join("    " + line for line in str(err).splitlines()[-15:]))
            continue
        finally:
            if args.keep:
                args.keep.mkdir(parents=True, exist_ok=True)
                nbformat.write(nb, args.keep / path.name)
        leaked = os.fstat(leaks.fileno()).st_size - leaked_before
        if leaked:
            failed += 1
            leaks.seek(leaked_before)
            print(f"FAIL {path.name}: wrote {leaked} bytes outside its cells (capture subprocess output)")
            print("\n".join("    " + line for line in leaks.read().decode(errors="replace").splitlines()[:5]))
            continue
        tb = traceback_in_outputs(nb)
        if tb:
            failed += 1
            print(f"FAIL {path.name}: an output shows a traceback")
            print("\n".join("    " + line for line in tb.splitlines()[-15:]))
            continue
        cells = sum(1 for c in nb.cells if c.cell_type == "code")
        print(f"ok   {path.name}: {cells} code cells in {time.monotonic() - start:.1f} s")
    print(f"notebooks run: {len(paths)}; failed: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
