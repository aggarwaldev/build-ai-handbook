"""Lab 9: tracing and cost.

A trace is a tree of spans. A span is one piece of work with a name, a start, a duration
and some attributes; its parent is the work that started it. Here:

  Tracer.span(name)   a context manager that opens a span; spans nest
  model calls         every llm.chat() call becomes a span of its own, through
                      llm.add_listener: model, tokens, cost, latency and stop reason
  masking             attributes whose key names personal data or a secret are replaced
                      whole; every other string goes through Lab 7's masker, so a trace
                      never holds an email, phone or card number
  never blocking      a span that cannot be written is dropped and counted; the run goes on
  JSON lines          one finished span per line in labs/09-tracing/traces/ (git ignores it)
  BudgetGuard         refuses a call before it is made when the run's spend plus the call's
                      worst case would pass a cap (fail closed)

    python labs/09-tracing/tracing.py demo               # a small traced run, then its summary
    python labs/09-tracing/tracing.py demo --cap 0.001   # the same with a spend cap
    python labs/09-tracing/tracing.py summary [file]     # summarise a trace (default: the newest)

On the fake backend every call takes microseconds, so the latencies are tiny; the shape
of the tree and the token counts are the part to read.
"""

from __future__ import annotations

import contextvars
import json
import math
import os
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

LABS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LABS))                       # labs/, for common.llm
sys.path.insert(0, str(LABS / "07-guardrails"))     # Lab 7's masker
from common import llm  # noqa: E402
from guardrails import mask  # noqa: E402

HERE = Path(__file__).resolve().parent
TRACE_DIR = HERE / "traces"
PREVIEW_CHARS = 200
# Exact key names, compared in lower case. A substring rule such as "contains token" would
# also hide input_tokens and output_tokens, the counts you most need.
SENSITIVE_KEYS = {"name", "full_name", "email", "phone", "address", "card_number",
                  "password", "api_key", "token", "secret", "cookie"}


# ---------------------------------------------------------------- masking


def scrub(value: Any) -> Any:
    """Mask a span's attributes: a value under a sensitive key is replaced whole (exact),
    and every other string goes through the masker (a detector, so not exact). The
    mapping is thrown away: a trace never needs the real values back."""
    if isinstance(value, str):
        return mask(value).text
    if isinstance(value, dict):
        return {k: "<masked>" if str(k).lower() in SENSITIVE_KEYS else scrub(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(v) for v in value]
    return value


def preview(text: str) -> str:
    """Mask first, then cut. Cutting first could split an email in two and leave half of
    it in a shape the masker no longer recognises."""
    masked = mask(text).text
    return masked if len(masked) <= PREVIEW_CHARS else masked[:PREVIEW_CHARS] + "..."


def _last_input(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m["role"] == "user":
            return m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])
        if m["role"] == "tool":
            return "; ".join(str(r["content"]) for r in m["results"])
    return ""


# ---------------------------------------------------------------- the budget guard


class BudgetExceeded(RuntimeError):
    """The next call could pass the run's spending cap, so it was not made."""


class BudgetGuard:
    """Keeps a run's spend under cap_usd, checked before every call.

    Worst case of a call = its input tokens, estimated pessimistically at three characters
    per token, plus max_tokens of output, at the model's prices. Calls on a model with no
    price (fake, Ollama) are priced as price_model, so you can test the guard offline.
    A call that raised after it was sent may still have been billed, so its worst case
    stays counted as spent.
    """

    def __init__(self, cap_usd: float, price_model: str = "claude-haiku-5-5") -> None:
        if not cap_usd > 0:
            raise ValueError("the cap must be a positive number of dollars")
        if price_model not in llm.PRICES_PER_MTOK:
            raise ValueError(f"no price for {price_model!r}: the guard could not price a call")
        self.cap, self.price_model, self.spent = cap_usd, price_model, 0.0

    def _price_as(self, model: str) -> str:
        return model if model in llm.PRICES_PER_MTOK else self.price_model

    def worst_case(self, messages: list[dict[str, Any]], system: str | None, max_tokens: int, model: str) -> float:
        chars = len(system or "") + len(json.dumps(messages, default=str))
        return llm.estimate_cost(self._price_as(model), math.ceil(chars / 3), max_tokens)

    def check(self, messages: list[dict[str, Any]], system: str | None, max_tokens: int, model: str) -> float:
        worst = self.worst_case(messages, system, max_tokens, model)
        if self.spent + worst > self.cap:
            raise BudgetExceeded(f"spent ${self.spent:.6f} + this call at most ${worst:.6f} "
                                 f"would pass the cap of ${self.cap:.6f}")
        return worst

    def record(self, reply: llm.Reply) -> None:
        self.spent += llm.estimate_cost(self._price_as(reply.model), reply.input_tokens, reply.output_tokens)


# ---------------------------------------------------------------- the tracer


class Tracer:
    """Writes one JSON line per finished span to `path`. Use it as a context manager so
    its listener is removed when the run ends."""

    def __init__(self, run_name: str = "run", out_dir: Path = TRACE_DIR, guard: BudgetGuard | None = None) -> None:
        self.trace_id = uuid.uuid4().hex[:16]
        self.guard = guard
        self.records: list[dict[str, Any]] = []
        self.dropped = 0  # spans that could not be written
        self._current: contextvars.ContextVar[str | None] = contextvars.ContextVar(f"span_{self.trace_id}", default=None)
        out_dir.mkdir(parents=True, exist_ok=True)
        self.path = out_dir / f"{time.strftime('%Y%m%d-%H%M%S')}-{run_name}-{self.trace_id[:6]}.jsonl"
        llm.add_listener(self._on_call)

    def close(self) -> None:
        llm.remove_listener(self._on_call)

    def __enter__(self) -> "Tracer":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    @contextmanager
    def span(self, name: str, **attrs: Any) -> Iterator[dict[str, Any]]:
        """Open a span; the dict it yields can take more attributes before the span ends."""
        parent = self._current.get()
        span_id = uuid.uuid4().hex[:8]
        token = self._current.set(span_id)
        wall, started = time.time(), time.perf_counter()
        status = "ok"
        try:
            yield attrs
        except BaseException as exc:
            status = f"error: {type(exc).__name__}"
            raise
        finally:
            self._current.reset(token)
            self._write({"span_id": span_id, "parent_id": parent, "name": name, "kind": "span",
                         "start": wall, "duration_s": time.perf_counter() - started,
                         "status": status, "attrs": attrs})

    def chat(self, messages: list[dict[str, Any]], **kwargs: Any) -> llm.Reply:
        """llm.chat with the budget guard in front of it. The span comes from the listener."""
        worst = 0.0
        if self.guard:
            model = (kwargs.get("model") or os.environ.get("LLM_MODEL", "").strip()
                     or llm.DEFAULT_MODELS[llm.backend_name()])
            try:
                worst = self.guard.check(messages, kwargs.get("system"), kwargs.get("max_tokens", 2048), model)
            except BudgetExceeded as exc:
                self._write({"span_id": uuid.uuid4().hex[:8], "parent_id": self._current.get(),
                             "name": "refused", "kind": "refused", "start": time.time(),
                             "duration_s": 0.0, "status": "refused", "attrs": {"reason": str(exc)}})
                raise
        try:
            return llm.chat(messages, **kwargs)
        except Exception:
            if self.guard:
                self.guard.spent += worst
            raise

    def _on_call(self, request: dict[str, Any], reply: llm.Reply) -> None:
        """Called by llm.chat after every call: the span ends now and began latency_s ago."""
        now = time.time()
        self._write({
            "span_id": uuid.uuid4().hex[:8], "parent_id": self._current.get(),
            "name": f"llm {reply.model}", "kind": "llm",
            "start": now - reply.latency_s, "duration_s": reply.latency_s, "status": "ok",
            "attrs": {
                "backend": reply.backend, "model": reply.model,
                "input_tokens": reply.input_tokens, "output_tokens": reply.output_tokens,
                "cost_usd": reply.cost_usd, "latency_s": reply.latency_s,
                "stop_reason": reply.stop_reason, "max_tokens": request["max_tokens"],
                "effort": request["effort"],
                "tool_calls": [c.name for c in reply.tool_calls],
                "input": preview(_last_input(request["messages"])), "output": preview(reply.text),
            },
        })
        if self.guard:
            self.guard.record(reply)

    def _write(self, record: dict[str, Any]) -> None:
        """Tracing must never break the run it watches: a span that cannot be written is
        dropped and counted. (The budget guard is the opposite: when in doubt, it stops.)"""
        try:
            record = {"trace_id": self.trace_id, **record, "attrs": scrub(record["attrs"])}
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, default=str) + "\n")
        except Exception:  # noqa: BLE001 - a full disk or a bad attribute must not stop the answer
            self.dropped += 1
            return
        self.records.append(record)


# ---------------------------------------------------------------- the summary


def percentile(values: list[float], p: float) -> float:
    """Nearest rank: sort, then take the value at rank ceil(p/100 * n), counting from 1.
    With 20 values, p95 is the 19th smallest; with 5 values it is the largest."""
    if not values:
        raise ValueError("no values")
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def load_trace(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def rollup(records: list[dict[str, Any]]) -> dict[str, tuple[int, int, float]]:
    """For every span: (input tokens, output tokens, cost) of all the model calls under it."""
    by_id = {r["span_id"]: r for r in records}
    totals: dict[str, list[float]] = {}
    for r in records:
        if r["kind"] != "llm":
            continue
        a = r["attrs"]
        parent = r["parent_id"]
        while parent in by_id:
            t = totals.setdefault(parent, [0, 0, 0.0])
            t[0] += a["input_tokens"]
            t[1] += a["output_tokens"]
            t[2] += a["cost_usd"]
            parent = by_id[parent]["parent_id"]
    return {k: (int(v[0]), int(v[1]), v[2]) for k, v in totals.items()}


def tree_lines(records: list[dict[str, Any]]) -> list[str]:
    children: dict[str | None, list[dict[str, Any]]] = {}
    for r in records:
        children.setdefault(r["parent_id"], []).append(r)
    for kids in children.values():
        kids.sort(key=lambda r: r["start"])
    sums = rollup(records)
    lines: list[str] = []

    def label(r: dict[str, Any]) -> str:
        ms = f"{r['duration_s'] * 1000:.2f} ms"
        if r["kind"] == "llm":
            a = r["attrs"]
            return (f"{r['name']}  {a['input_tokens']} in / {a['output_tokens']} out  "
                    f"${a['cost_usd']:.6f}  {ms}  stop={a['stop_reason']}")
        if r["kind"] == "refused":
            return f"REFUSED  {r['attrs']['reason']}"
        tin, tout, cost = sums.get(r["span_id"], (0, 0, 0.0))
        return (f"{r['name']}  {ms}" + (f"  (under it: {tin} in / {tout} out  ${cost:.6f})" if tin else "")
                + ("" if r["status"] == "ok" else f"  [{r['status']}]"))

    def walk(parent: str | None, prefix: str) -> None:
        kids = children.get(parent, [])
        for i, r in enumerate(kids):
            last = i == len(kids) - 1
            lines.append(prefix + ("└─ " if last else "├─ ") + label(r))
            walk(r["span_id"], prefix + ("   " if last else "│  "))

    for root in children.get(None, []):
        lines.append(label(root))
        walk(root["span_id"], "")
    return lines


def summarise(records: list[dict[str, Any]], show: bool = True) -> dict[str, Any]:
    calls = [r for r in records if r["kind"] == "llm"]
    tin = sum(r["attrs"]["input_tokens"] for r in calls)
    tout = sum(r["attrs"]["output_tokens"] for r in calls)
    lat = [r["attrs"]["latency_s"] for r in calls]
    out = {
        "calls": len(calls), "input_tokens": tin, "output_tokens": tout,
        "cost_usd": sum(r["attrs"]["cost_usd"] for r in calls),
        "haiku_usd": llm.estimate_cost("claude-haiku-5-5", tin, tout),
        "p50_s": percentile(lat, 50) if lat else 0.0, "p95_s": percentile(lat, 95) if lat else 0.0,
        "refused": sum(r["kind"] == "refused" for r in records),
    }
    if show:
        models = sorted({r["attrs"]["model"] for r in calls})
        print(f"calls: {out['calls']} ({', '.join(models)}); tokens: {tin} in, {tout} out")
        print(f"cost: ${out['cost_usd']:.6f} as run; on claude-haiku-5-5 these tokens cost ${out['haiku_usd']:.6f}")
        print(f"latency per call: p50 {out['p50_s'] * 1000:.3f} ms, p95 {out['p95_s'] * 1000:.3f} ms")
        if out["refused"]:
            print(f"refused by the budget guard: {out['refused']}")
        print("\n".join(tree_lines(records)))
    return out


# ---------------------------------------------------------------- the demo


QUESTION = ("I'm going from Leeds to Edinburgh on 14 March for two nights. "
            "Send the plan to sam.taylor@example.com or text 07700 900123.")


def _show(path: Path) -> Path:
    path = path.resolve()
    return path.relative_to(LABS.parent) if path.is_relative_to(LABS.parent) else path


def demo(cap: float | None = None, out_dir: Path = TRACE_DIR) -> Tracer:
    """A small travel planner in four model calls: understand, research two legs, write."""
    guard = BudgetGuard(cap) if cap else None
    with Tracer("demo", out_dir=out_dir, guard=guard) as t:
        try:
            with t.span("plan-trip", question=QUESTION):
                # Claude's thinking counts toward max_tokens, so each call leaves room for it.
                with t.span("understand"):
                    legs = t.chat([{"role": "user", "content": f"List the parts of this trip to plan: {QUESTION}"}],
                                  max_tokens=1024, effort="low").text
                notes = []
                with t.span("research"):
                    for part in ("train", "hotel"):
                        with t.span(f"research-{part}", part=part):
                            notes.append(t.chat([{"role": "user", "content":
                                                  f"Suggest a {part} for this trip: {QUESTION}\nParts: {legs}"}],
                                                max_tokens=1024, effort="low").text)
                with t.span("write"):
                    t.chat([{"role": "user", "content":
                             "Write a short plan from these notes:\n" + "\n".join(notes)}],
                           max_tokens=2048, effort="low")
        except BudgetExceeded as exc:
            print(f"stopped: {exc}")
        print(f"trace: {_show(t.path)}" + (f" ({t.dropped} spans dropped)" if t.dropped else ""))
        summarise(t.records)
        if guard:
            print(f"guard: cap ${guard.cap:.6f}, spent ${guard.spent:.6f} (priced as {guard.price_model})")
    return t


def main(argv: list[str]) -> int:
    if argv[:1] == ["demo"]:
        cap = float(argv[argv.index("--cap") + 1]) if "--cap" in argv else None
        demo(cap)
    elif argv[:1] == ["summary"]:
        files = sorted(TRACE_DIR.glob("*.jsonl"), key=lambda f: f.stat().st_mtime)
        path = Path(argv[1]) if len(argv) > 1 else (files[-1] if files else None)
        if path is None:
            print("no traces yet: run `python labs/09-tracing/tracing.py demo` first")
            return 1
        print(f"trace: {_show(path)}")
        summarise(load_trace(path))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
