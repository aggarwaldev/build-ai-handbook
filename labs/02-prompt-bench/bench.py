"""Lab 2: a prompt test bench.

Run one prompt version over a fixed set of labelled cases, score every reply, print a
report and save the run, so the next version can be compared with it case by case.

    python labs/02-prompt-bench/bench.py run v2               # prompts/v2.txt over cases.jsonl
    python labs/02-prompt-bench/bench.py run v1 --limit 10    # the first ten cases only
    python labs/02-prompt-bench/bench.py list                 # the saved runs
    python labs/02-prompt-bench/bench.py compare RUN_A RUN_B  # names from `list`

The task: sort the messages sent to the support desk of an invented bike repair shop into
six categories, replying with JSON. With LLM_BACKEND=fake a few keyword rules stand in for
the model, so the numbers then measure the bench's plumbing, not a model or a prompt.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # labs/
from common import llm  # noqa: E402

CATEGORIES = ["booking", "status", "quote", "parts", "complaint", "other"]
CASES = HERE / "cases.jsonl"
PROMPTS = HERE / "prompts"
RUNS = HERE / "runs"
REFERENCE_MODEL = "claude-haiku-5-5"  # costs are also shown at this model's prices
NOTHING = "(nothing)"  # the predicted label when no answer could be read


# ---------------------------------------------------------------- inputs


def load_cases(path: Path | str = CASES) -> list[dict[str, str]]:
    """One JSON object per line: {"id", "message", "label"}."""
    cases = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        case = json.loads(line)
        missing = {"id", "message", "label"} - case.keys()
        if missing:
            raise ValueError(f"{path}:{number}: missing {sorted(missing)}")
        cases.append(case)
    seen = Counter(c["id"] for c in cases)
    repeated = sorted(i for i, k in seen.items() if k > 1)
    if repeated:
        raise ValueError(f"{path}: repeated ids {repeated}")
    return cases


def load_prompt(version: str, prompts_dir: Path | str = PROMPTS) -> tuple[str, str]:
    """(name, text) for a version such as "v2" (prompts/v2.txt) or a path to a text file."""
    path = Path(version)
    if not path.is_file():
        path = Path(prompts_dir) / f"{version}.txt"
    if not path.is_file():
        raise FileNotFoundError(f"no prompt {version!r}: looked for {path}")
    return path.stem, path.read_text(encoding="utf-8").strip()


def fingerprint(text: str) -> str:
    """A short hash, so a run records exactly which text it used."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def user_turn(message: str) -> str:
    """The customer's words, marked as data. Every prompt version gets the same wrapping."""
    return f"<message>\n{message}\n</message>"


# ---------------------------------------------------------------- scoring


def _object(text: str) -> dict[str, Any] | None:
    try:
        data = json.loads(text)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def parse_reply(text: str) -> tuple[str | None, bool]:
    """Read a reply as (category, json_ok).

    json_ok is True only when the whole reply is a JSON object with a string "category":
    what code downstream could use without guessing. When it is not, the category is still
    read where possible, from a JSON object inside other text (a code fence, say) or from a
    bare answer such as "Category: booking.", so format and accuracy are scored separately.
    """
    s = text.strip()
    whole = _object(s)
    if whole is not None and isinstance(whole.get("category"), str):
        return whole["category"].strip().lower(), True
    start, end = s.find("{"), s.rfind("}")
    if 0 <= start < end:
        inner = _object(s[start:end + 1])
        if inner is not None and isinstance(inner.get("category"), str):
            return inner["category"].strip().lower(), False
    bare = s.lower().removeprefix("category:").strip().rstrip(".").strip()
    return (bare or None), False


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson interval for a proportion k/n: where the true rate plausibly lies."""
    if n == 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def sign_test(wins: int, losses: int) -> float:
    """Two-sided sign test: how often a split this uneven happens if both sides are equal.

    Only the cases where two runs disagree count; each would be a coin toss if the two
    prompts were equally good.
    """
    n = wins + losses
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, i) for i in range(min(wins, losses) + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def percentile(values: list[float], q: float) -> float:
    """Nearest-rank percentile; q in [0, 1]."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q * len(ordered)) - 1)]


def summarise(results: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(results)
    correct = sum(r["correct"] for r in results)
    per_category = {}
    labels = CATEGORIES + sorted({r["label"] for r in results} - set(CATEGORIES))
    for label in labels:
        rows = [r for r in results if r["label"] == label]
        if rows:
            answered = Counter(r["predicted"] or NOTHING for r in rows)
            per_category[label] = {
                "n": len(rows),
                "correct": sum(r["correct"] for r in rows),
                "answered_as": dict(answered.most_common()),
            }
    answered = [r for r in results if not r.get("error")]
    latencies = [r["latency_s"] for r in answered]
    tokens_in = sum(r["input_tokens"] for r in results)
    tokens_out = sum(r["output_tokens"] for r in results)
    return {
        "n": n,
        "correct": correct,
        "accuracy": correct / n if n else 0.0,
        "interval": list(wilson(correct, n)),
        "json_ok": sum(r["json_ok"] for r in results),
        "errors": n - len(answered),
        "per_category": per_category,
        "input_tokens": tokens_in,
        "output_tokens": tokens_out,
        "cost_usd": sum(r["cost_usd"] for r in results),
        "reference_cost_usd": llm.estimate_cost(REFERENCE_MODEL, tokens_in, tokens_out),
        "latency_mean_s": statistics.fmean(latencies) if latencies else 0.0,
        "latency_p95_s": percentile(latencies, 0.95),
        "stop_reasons": dict(Counter(r["stop_reason"] for r in results).most_common()),
    }


def worst_category(summary: dict[str, Any]) -> str | None:
    """The category with the lowest accuracy; the first in CATEGORIES order on a tie."""
    per = summary["per_category"]
    if not per:
        return None
    return min(per, key=lambda c: per[c]["correct"] / per[c]["n"])


# ---------------------------------------------------------------- the fake model

KEYWORD_RULES = [
    ("complaint", ("refund", "unhappy", "not happy", "disappointed", "worse", "again", "rude",
                   "overcharged")),
    ("status", ("ready", "collect", "pick it up", "pick up", "finished", "update on", "progress")),
    ("booking", ("book", "appointment", "slot", "reschedule", "cancel", "available on")),
    ("quote", ("how much", "cost", "price", "estimate", "quote")),
    ("parts", ("in stock", "stock", "order", "buy", "sell", "inner tube", "brake pads", "helmet")),
]
# The words a model tends to use for each topic when nobody gave it the list of categories.
OWN_WORDS = {"booking": "appointment", "status": "repair update", "quote": "pricing",
             "parts": "shop order", "complaint": "complaint", "other": "general enquiry"}


def keyword_label(message: str) -> str:
    """The first rule with a matching word wins; no match means "other"."""
    text = message.lower()
    for label, words in KEYWORD_RULES:
        if any(word in text for word in words):
            return label
    return "other"


def keyword_router(request: dict[str, Any]) -> str:
    """Stand in for a model when LLM_BACKEND=fake. Deterministic, and every rule is here:

    - it labels the message with keyword_label();
    - if the system prompt does not name all six categories, it answers in its own words,
      as a real model does when nobody told it the list;
    - it replies in JSON only if the system prompt mentions JSON.

    It reads no examples and no tie-break rules, so prompt versions that differ only in
    those score the same on it. Its numbers test the bench, not a prompt.
    """
    system = request.get("system") or ""
    last = request["messages"][-1]["content"]
    found = re.search(r"<message>\s*(.*?)\s*</message>", last, re.S)
    label = keyword_label(found.group(1) if found else last)
    if not all(re.search(rf"\b{c}\b", system) for c in CATEGORIES):
        label = OWN_WORDS[label]
    if "JSON" in system:
        return json.dumps({"category": label})
    return f"Category: {label}."


# ---------------------------------------------------------------- running


def run_bench(
    version: str,
    cases: list[dict[str, str]],
    *,
    prompts_dir: Path | str = PROMPTS,
    max_tokens: int = 1024,
    effort: str | None = None,
    on_case: Callable[[int, dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Send every case to the model with this prompt version and score each reply."""
    name, prompt = load_prompt(version, prompts_dir)
    backend = llm.backend_name()
    model = os.environ.get("LLM_MODEL", "").strip() or llm.DEFAULT_MODELS[backend]
    results: list[dict[str, Any]] = []
    started = time.perf_counter()
    for case in cases:
        row: dict[str, Any] = {"id": case["id"], "label": case["label"]}
        try:
            reply = llm.chat([{"role": "user", "content": user_turn(case["message"])}],
                             system=prompt, max_tokens=max_tokens, effort=effort)
        except llm.LLMError as exc:  # record it and carry on: one failure should not end a run
            row.update(predicted=None, json_ok=False, correct=False, reply="", error=str(exc),
                       stop_reason="error", input_tokens=0, output_tokens=0, latency_s=0.0,
                       cost_usd=0.0)
        else:
            model = reply.model
            predicted, json_ok = parse_reply(reply.text)
            row.update(predicted=predicted, json_ok=json_ok, correct=predicted == case["label"],
                       reply=reply.text, stop_reason=reply.stop_reason,
                       input_tokens=reply.input_tokens, output_tokens=reply.output_tokens,
                       latency_s=reply.latency_s, cost_usd=reply.cost_usd)
        results.append(row)
        if on_case:
            on_case(len(results), row)
    stamp = datetime.now()
    return {
        "id": f"{stamp:%Y%m%d-%H%M%S}-{name}-{backend}",
        "created": stamp.isoformat(timespec="seconds"),
        "prompt": name,
        "prompt_sha": fingerprint(prompt),
        "cases_sha": fingerprint(json.dumps(cases, sort_keys=True)),
        "backend": backend,
        "model": model,
        "max_tokens": max_tokens,
        "effort": effort,
        "wall_s": time.perf_counter() - started,
        "messages": {c["id"]: c["message"] for c in cases},
        "results": results,
        "summary": summarise(results),
    }


def save_run(run: dict[str, Any], runs_dir: Path | str = RUNS) -> Path:
    folder = Path(runs_dir)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{run['id']}.json"
    extra = 2
    while path.exists():  # two runs in the same second
        path = folder / f"{run['id']}-{extra}.json"
        extra += 1
    path.write_text(json.dumps(run, indent=1), encoding="utf-8")
    return path


def find_run(name: str, runs_dir: Path | str = RUNS) -> Path:
    """A run by path, by file name in runs_dir, or by file name without .json."""
    for path in (Path(name), Path(runs_dir) / name, Path(runs_dir) / f"{name}.json"):
        if path.is_file():
            return path
    raise FileNotFoundError(f"no run {name!r} (try `bench.py list`)")


def load_run(name: str, runs_dir: Path | str = RUNS) -> dict[str, Any]:
    return json.loads(find_run(name, runs_dir).read_text(encoding="utf-8"))


# ---------------------------------------------------------------- reports


def usd(amount: float) -> str:
    if amount == 0:
        return "$0"
    return f"${amount:.6f}" if amount < 0.01 else f"${amount:.4f}"


def _clip(text: str, width: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= width else text[:width - 3] + "..."


def format_report(run: dict[str, Any]) -> str:
    s = run["summary"]
    n = s["n"]
    low, high = s["interval"]
    lines = [f"prompt {run['prompt']} (sha {run['prompt_sha']})   backend {run['backend']}   "
             f"model {run['model']}   {n} cases"]
    if run["backend"] == "fake":
        lines.append("note: the fake backend answers with keyword rules. These numbers test "
                     "the bench, not a model or a prompt.")
    lines += [
        "",
        f"accuracy     {s['accuracy']:.3f}  ({s['correct']}/{n})   "
        f"95% interval {low:.3f} to {high:.3f}",
        f"json valid   {s['json_ok'] / n if n else 0:.3f}  ({s['json_ok']}/{n})",
    ]
    if s["errors"]:
        lines.append(f"errors       {s['errors']} calls failed (see the saved run)")
    lines += ["", f"{'category':<11} {'cases':>5} {'right':>6} {'accuracy':>9}"]
    for label, row in s["per_category"].items():
        lines.append(f"{label:<11} {row['n']:>5} {row['correct']:>6} "
                     f"{row['correct'] / row['n']:>9.3f}")
    worst = worst_category(s)
    if worst is not None:
        row = s["per_category"][worst]
        answered = ", ".join(f"{k} {v}" for k, v in row["answered_as"].items())
        lines += ["", f"worst: {worst} ({row['correct']}/{row['n']}), answered as: {answered}"]
        for r in run["results"]:
            if r["label"] == worst and not r["correct"]:
                message = run.get("messages", {}).get(r["id"], "")
                lines.append(f"  {r['id']} -> {_clip(str(r['predicted'] or NOTHING), 16):<16} "
                             f"{_clip(message, 60)}")
    per_case_in = s["input_tokens"] / n if n else 0
    per_case_out = s["output_tokens"] / n if n else 0
    stops = ", ".join(f"{k} {v}" for k, v in s["stop_reasons"].items())
    lines += [
        "",
        f"tokens       {s['input_tokens']:,} in, {s['output_tokens']:,} out "
        f"({per_case_in:.0f} in, {per_case_out:.0f} out per case)",
        f"cost         {usd(s['cost_usd'])} on {run['model']}; the same tokens on "
        f"{REFERENCE_MODEL}: {usd(s['reference_cost_usd'])}",
        f"latency      mean {s['latency_mean_s']:.3f} s, p95 {s['latency_p95_s']:.3f} s per call; "
        f"{run['wall_s']:.2f} s for the run",
        f"stop reasons {stops}",
    ]
    return "\n".join(lines)


def compare_runs(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Pair the two runs' results by case id and sort each case into what changed."""
    in_a = {r["id"]: r for r in a["results"]}
    in_b = {r["id"]: r for r in b["results"]}
    shared = [i for i in in_a if i in in_b]
    groups: dict[str, list[str]] = {"fixed": [], "broken": [], "right in both": [],
                                    "wrong in both": []}
    for i in shared:
        ra, rb = in_a[i]["correct"], in_b[i]["correct"]
        key = ("right in both" if ra and rb else "wrong in both" if not (ra or rb)
               else "fixed" if rb else "broken")
        groups[key].append(i)
    return {
        "shared": shared,
        "only_a": [i for i in in_a if i not in in_b],
        "only_b": [i for i in in_b if i not in in_a],
        "groups": groups,
        "p_value": sign_test(len(groups["fixed"]), len(groups["broken"])),
    }


def format_compare(a: dict[str, Any], b: dict[str, Any]) -> str:
    c = compare_runs(a, b)
    lines = []
    for tag, run in (("A", a), ("B", b)):
        s = run["summary"]
        lines.append(f"{tag}  {run['id']:<28} prompt {run['prompt']:<4} {run['backend']:<9} "
                     f"accuracy {s['accuracy']:.3f} ({s['correct']}/{s['n']})")
    if a["prompt"] == b["prompt"] and a["prompt_sha"] != b["prompt_sha"]:
        lines.append(f"note: both runs say prompt {a['prompt']}, but its text changed in between")
    if a["cases_sha"] != b["cases_sha"]:
        lines.append("note: the runs used different case files; only shared ids are compared")
    if c["only_a"] or c["only_b"]:
        lines.append(f"note: {len(c['only_a'])} cases only in A, {len(c['only_b'])} only in B")
    g = c["groups"]
    changed = len(g["fixed"]) + len(g["broken"])
    lines += [
        "",
        f"on the {len(c['shared'])} cases both runs scored:",
        f"  fixed by B     {len(g['fixed']):>3}",
        f"  broken by B    {len(g['broken']):>3}",
        f"  right in both  {len(g['right in both']):>3}",
        f"  wrong in both  {len(g['wrong in both']):>3}",
        f"sign test on the {changed} cases that changed: p = {c['p_value']:.2g}"
        + ("" if not changed else ", unlikely to be chance alone" if c["p_value"] < 0.05
           else ", could easily be chance"),
    ]
    in_a = {r["id"]: r for r in a["results"]}
    in_b = {r["id"]: r for r in b["results"]}
    messages = {**a.get("messages", {}), **b.get("messages", {})}
    for key in ("fixed", "broken", "wrong in both"):
        lines += ["", f"{key}:"]
        if not g[key]:
            lines.append("  (none)")
        for i in g[key]:
            ra, rb = in_a[i], in_b[i]
            lines.append(f"  {i}  {ra['label']:<10} A: {_clip(str(ra['predicted'] or NOTHING), 16):<16} "
                         f"B: {_clip(str(rb['predicted'] or NOTHING), 16):<16} "
                         f"{_clip(messages.get(i, ''), 40)}")
    return "\n".join(lines)


def format_list(runs_dir: Path | str = RUNS) -> str:
    paths = sorted(Path(runs_dir).glob("*.json"))
    if not paths:
        return f"no saved runs in {runs_dir}"
    lines = [f"{'run':<30} {'prompt':<7} {'backend':<10} {'model':<18} {'accuracy':>8} {'json':>6}"]
    for path in paths:
        run = json.loads(path.read_text(encoding="utf-8"))
        s = run["summary"]
        json_rate = s["json_ok"] / s["n"] if s["n"] else 0
        lines.append(f"{path.stem:<30} {run['prompt']:<7} {run['backend']:<10} "
                     f"{run['model']:<18} {s['accuracy']:>8.3f} {json_rate:>6.3f}")
    return "\n".join(lines)


# ---------------------------------------------------------------- command line


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    run_p = sub.add_parser("run", help="run one prompt version over the cases")
    run_p.add_argument("version", help="v1, v2, v3, or a path to a prompt file")
    run_p.add_argument("--cases", default=str(CASES), help="a .jsonl file of labelled cases")
    run_p.add_argument("--limit", type=int, help="use only the first N cases")
    run_p.add_argument("--max-tokens", type=int, default=1024)
    run_p.add_argument("--effort", choices=["low", "medium", "high"], help="Claude only")
    run_p.add_argument("--no-save", action="store_true", help="print the report only")
    run_p.add_argument("-v", "--verbose", action="store_true", help="print every case")
    cmp_p = sub.add_parser("compare", help="compare two saved runs case by case")
    cmp_p.add_argument("a")
    cmp_p.add_argument("b")
    sub.add_parser("list", help="list the saved runs")
    for p in (run_p, cmp_p, sub.choices["list"]):
        p.add_argument("--runs-dir", default=str(RUNS), help="where runs are saved")
    args = parser.parse_args(argv)

    try:
        if args.command == "list":
            print(format_list(args.runs_dir))
            return 0
        if args.command == "compare":
            print(format_compare(load_run(args.a, args.runs_dir), load_run(args.b, args.runs_dir)))
            return 0

        if llm.backend_name() == "fake":
            llm.fake.responder = keyword_router
        cases = load_cases(args.cases)[: args.limit]

        def progress(i: int, row: dict[str, Any]) -> None:
            if args.verbose:
                mark = "ok" if row["correct"] else "WRONG"
                print(f"{row['id']}  {row['label']:<10} -> "
                      f"{_clip(str(row['predicted'] or NOTHING), 20):<20} {mark}")
            elif sys.stderr.isatty():
                print(f"\r{i}/{len(cases)}", end="", file=sys.stderr, flush=True)

        run = run_bench(args.version, cases, max_tokens=args.max_tokens, effort=args.effort,
                        on_case=progress)
        if sys.stderr.isatty() and not args.verbose:
            print("\r", end="", file=sys.stderr)
    except (llm.LLMError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(format_report(run))
    if not args.no_save:
        path = save_run(run, args.runs_dir)
        try:
            shown = path.resolve().relative_to(Path.cwd())
        except ValueError:
            shown = path
        print(f"\nsaved {shown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
