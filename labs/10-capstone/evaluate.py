"""Lab 10: score the capstone assistant.

    python labs/10-capstone/evaluate.py              # every case: code checks, then the judge
    python labs/10-capstone/evaluate.py --no-judge   # code checks only
    python labs/10-capstone/evaluate.py --cap 0.002  # stop the whole evaluation at this spend

cases.jsonl holds 16 invented questions. Each names the behaviour expected (answer,
not_found or refuse), the ids an answer should cite, the member signed in, if any, and how
many pieces of personal data the question carries.

Code checks run first, on every case:

  behaviour   the run ended the way the case expects
  citation    an answer cites at least one of the expected ids
  guards      the personal data was masked, and none of it reached a model request or
              the trace file

Then Lab 8's judge grades the answers that passed every code check, using the sources
each answer cited in place of Lab 8's rule card. A code check costs nothing and gives the
same result every time; a judge costs a call and can be wrong. So code settles everything
it can, and the judge only sees what code cannot settle: whether a checked, cited answer
is correct, supported, on the question and courteous.

On the fake backend a stand-in plays the assistant (assistant.fake_model) and a keyword
heuristic plays the judge (fake_judge below), so the numbers measure the plumbing.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "08-judge"))
import assistant  # noqa: E402  (puts labs/ and the other labs' folders on the path)
import judge  # noqa: E402  Lab 8
import tracing  # noqa: E402  Lab 9
from common import llm  # noqa: E402

CASES = HERE / "cases.jsonl"
EVAL_TODAY = date(2026, 11, 2)  # fixed, so the account answers are the same on every run
DEFAULT_CAP = 0.05              # US dollars for the whole evaluation, judge included


def load_cases(path: Path = CASES) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


# ---------------------------------------------------------------- code checks


def code_checks(case: dict[str, Any], r: assistant.Result) -> dict[str, Any]:
    """The deterministic checks. citation is None when the case expects no answer."""
    behaviour = r.kind == case["expect"]
    citation = None
    if case["expect"] == "answer":
        citation = bool(set(case["cites"]) & set(r.citations))
    guards = r.masked_values == case.get("masks", 0) and not r.leaked and not r.traced
    return {"behaviour": behaviour, "citation": citation, "guards": guards,
            "passed": behaviour and citation is not False and guards}


# ---------------------------------------------------------------- the judge


def judge_prompt(question: str, answer: str, sources: dict[str, str]) -> str:
    """Lab 8's judge prompt, with the sources the answer cited where the rule card was."""
    rules = "\n".join(f"[{sid}] {text}" for sid, text in sources.items())
    return f"<rules>\n{rules}\n</rules>\n<question>{question}</question>\n<answer>{answer}</answer>"


def judge_problems(rules: str, question: str, answer: str) -> list[str]:
    """Lab 8's four keyword rules (judge.heuristic_problems), reading `rules` instead of
    Lab 8's rule card: a number not in the sources, a sentence mostly made of words the
    sources and the question do not use, no word shared with the question, a rude phrase."""
    problems = []
    known = set(judge.NUMBER.findall(rules))
    wrong = [n for n in judge.NUMBER.findall(answer) if n not in known]
    if wrong:
        problems.append(f"the answer says {wrong[0]}, which is not in the sources")
    rule_words = judge._words(rules) | judge._words(question)
    for sentence in re.split(r"(?<=[.!?])\s+", answer):
        words = judge._words(sentence) - {judge._stem(n) for n in judge.NUMBER.findall(sentence)}
        if len(words) >= 4 and len(words & rule_words) / len(words) < 0.6:
            problems.append(f"this claim is not in the sources: {sentence}")
            break
    if not judge._words(question) & judge._words(answer):
        problems.append("the answer does not address the question")
    rude = [m for m in judge.RUDE_MARKERS if m in answer.lower()]
    if rude:
        problems.append(f"the tone is not courteous ('{rude[0]}')")
    return problems


def fake_judge(request: dict[str, Any]) -> str:
    """Plays Lab 8's judge on the fake backend."""
    prompt = request["messages"][-1]["content"]
    problems = judge_problems(judge._tag(prompt, "rules"), judge._tag(prompt, "question"),
                              judge._tag(prompt, "answer"))
    return json.dumps({"reason": problems[0] if problems else "passes all four tests",
                       "verdict": "FAIL" if problems else "PASS"})


def use_stand_ins() -> bool:
    """On the fake backend one responder plays both parts, told apart by the system prompt."""
    if llm.backend_name() == "fake" and llm.fake.responder is llm.fake.default_responder:
        llm.fake.responder = lambda req: (fake_judge(req) if req["system"] == judge.JUDGE_SYSTEM
                                          else assistant.fake_model(req))
        return True
    return False


# ---------------------------------------------------------------- the run


def evaluate(
    cases: list[dict[str, Any]] | None = None,
    *,
    cap: float = DEFAULT_CAP,
    use_judge: bool = True,
    out_dir: Path = assistant.TRACE_DIR,
    say: Callable[[str], None] = print,
) -> dict[str, Any]:
    cases = cases if cases is not None else load_cases()
    stand_ins = use_stand_ins()
    guard = assistant.Budget(cap)  # one budget for every run and every judge call
    quiet = lambda _line: None  # noqa: E731
    rows = []
    for case in cases:
        r = assistant.run(case["question"], member=case.get("member"), guard=guard, today=EVAL_TODAY,
                          name=f"eval-{case['id']}", out_dir=out_dir, say=quiet)
        rows.append({"case": case, "result": r, **code_checks(case, r), "verdict": None, "reason": ""})

    judge_replies: list[llm.Reply] = []
    to_judge = [row for row in rows if row["passed"] and row["result"].kind == "answer"]
    traces = len(rows)
    if use_judge and to_judge:
        with tracing.Tracer("eval-judge", out_dir=out_dir, guard=guard) as t:
            traces += 1
            for row in to_judge:
                r = row["result"]
                cited = {sid: r.sources[sid] for sid in r.citations}
                try:
                    with t.span("judge", case=row["case"]["id"]):
                        reply = t.chat([{"role": "user", "content": judge_prompt(r.masked, r.answer, cited)}],
                                       system=judge.JUDGE_SYSTEM, max_tokens=judge.MAX_TOKENS, effort="low")
                except tracing.BudgetExceeded:
                    row["verdict"] = "over_budget"
                    continue
                judge_replies.append(reply)
                parsed = judge.parse_verdict(reply.text)
                row["verdict"] = parsed["verdict"] if parsed else "unparseable"
                row["reason"] = parsed["reason"] if parsed else reply.text

    summary = scorecard(rows, judge_replies, guard, stand_ins, use_judge, traces, out_dir, say)
    return summary


def every_check_passed(row: dict[str, Any], use_judge: bool) -> bool:
    """Every code check passed and, for an answer the judge graded, the judge said PASS."""
    if not row["passed"]:
        return False
    if use_judge and row["result"].kind == "answer":
        return row["verdict"] == "PASS"
    return True


def _ratio(rows: list[dict[str, Any]], key: str) -> tuple[int, int]:
    counted = [row for row in rows if row[key] is not None]
    return sum(bool(row[key]) for row in counted), len(counted)


def scorecard(rows, judge_replies, guard, stand_ins, use_judge, traces, out_dir, say) -> dict[str, Any]:
    backend = llm.backend_name()
    say(f"Capstone evaluation: {len(rows)} cases on the {backend} backend")
    if stand_ins:
        say("(stand-ins play the assistant and the judge: these numbers measure the plumbing, not a model)")
    say(f"\n{'case':<5}{'expect':<11}{'got':<13}{'citation':<10}{'guards':<8}{'judge':<13}cited")
    for row in rows:
        c, r = row["case"], row["result"]
        cite = "-" if row["citation"] is None else ("hit" if row["citation"] else "MISS")
        verdict = row["verdict"] or "-"
        say(f"{c['id']:<5}{c['expect']:<11}{r.kind:<13}{cite:<10}{'ok' if row['guards'] else 'FAIL':<8}"
            f"{verdict:<13}{', '.join(r.citations)}".rstrip())

    b_ok, b_n = _ratio(rows, "behaviour")
    c_ok, c_n = _ratio(rows, "citation")
    g_ok, g_n = _ratio(rows, "guards")
    by_kind = []
    for kind in ("answer", "not_found", "refuse"):
        group = [row for row in rows if row["case"]["expect"] == kind]
        if group:
            by_kind.append(f"{kind} {sum(row['behaviour'] for row in group)} of {len(group)}")
    masked = [row["result"].masked_values for row in rows]
    blocked = sum(row["result"].kind == "blocked" for row in rows)
    say(f"\ncode checks, on all {len(rows)} cases")
    say(f"  behaviour     {b_ok} of {b_n}   ({', '.join(by_kind)})")
    say(f"  citation hit  {c_ok} of {c_n}   (the cases that expect an answer)")
    say(f"  guards        {g_ok} of {g_n}   ({sum(masked)} values masked in {sum(m > 0 for m in masked)} cases; "
        f"{sum(row['result'].leaked for row in rows)} reached a model, {sum(row['result'].traced for row in rows)} "
        f"reached a trace; {blocked} replies blocked by the output guard)")

    judged = [row for row in rows if row["verdict"]]
    verdicts = [row["verdict"] for row in judged]
    if use_judge:
        counts = ", ".join(f"{v} {verdicts.count(v)}" for v in ("PASS", "FAIL", "unparseable", "over_budget")
                           if verdicts.count(v) or v in ("PASS", "FAIL"))
        say(f"judge, on the {len(judged)} answers that passed every code check: {counts}")
    passed = [row for row in rows if every_check_passed(row, use_judge)]
    say(f"every check passed: {len(passed)} of {len(rows)} cases")

    look = [row for row in rows if row not in passed]
    if look:
        say("\nlook at:")
        for row in look:
            c, r = row["case"], row["result"]
            if r.kind == "over_budget":
                say(f"  {c['id']}  the budget guard stopped the run before it could answer")
            elif not row["behaviour"]:
                said = f': "{assistant._short(r.answer, 90)}"' if r.kind == "answer" else ""
                say(f"  {c['id']}  expected {c['expect']}, got {r.kind}{said}")
            elif not row["guards"]:
                say(f"  {c['id']}  guards: masked {r.masked_values} (expected {c.get('masks', 0)}), "
                    f"reached a model {r.leaked}, reached the trace {r.traced}")
            elif row["citation"] is False:
                say(f"  {c['id']}  cited {', '.join(r.citations)}; expected {', '.join(c['cites'])}")
            elif row["verdict"] == "over_budget":
                say(f"  {c['id']}  the budget guard refused the judge call")
            else:
                say(f"  {c['id']}  judge {row['verdict']}: {row['reason']}")
            if c["expect"] == "answer" and row["citation"] is False and r.sources:
                say(f"        retrieved, best first: {', '.join(r.sources)}")

    calls = sum(row["result"].calls for row in rows)
    tin = sum(row["result"].input_tokens for row in rows) + sum(rp.input_tokens for rp in judge_replies)
    tout = sum(row["result"].output_tokens for row in rows) + sum(rp.output_tokens for rp in judge_replies)
    n = calls + len(judge_replies)
    as_run = sum(row["result"].cost_usd for row in rows) + sum(rp.cost_usd for rp in judge_replies)
    say(f"\ncalls: {n} ({calls} assistant, {len(judge_replies)} judge); tokens: {tin} in, {tout} out "
        f"({backend}); cost as run ${as_run:.6f}")
    if backend == "fake":
        tool_tokens = assistant.TOOL_CHARS // 4
        total_in = tin + calls * tool_tokens
        cost = llm.estimate_cost(assistant.REFERENCE_MODEL, total_in, tout)
        worst = llm.estimate_cost(assistant.REFERENCE_MODEL, total_in, n * assistant.MAX_TOKENS)
        say(f"on {assistant.REFERENCE_MODEL}, adding {calls} x {tool_tokens} tokens of tool definitions: "
            f"{total_in} in, {tout} out = ${cost:.6f}; at most ${worst:.6f} if every call used "
            f"max_tokens={assistant.MAX_TOKENS}")
    say(f"budget: cap ${guard.cap:.6f}, spent ${guard.spent:.6f} (priced as {guard.price_model})")
    say(f"traces: {traces} files in {assistant._show(out_dir)}/")
    return {
        "cases": len(rows), "behaviour": (b_ok, b_n), "citation": (c_ok, c_n), "guards": (g_ok, g_n),
        "verdicts": verdicts, "passed": [row["case"]["id"] for row in passed],
        "kinds": {row["case"]["id"]: row["result"].kind for row in rows},
        "calls": n, "input_tokens": tin, "output_tokens": tout, "spent": guard.spent,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Score the capstone assistant on cases.jsonl.")
    p.add_argument("--cap", type=float, default=DEFAULT_CAP,
                   help=f"spending cap for the whole evaluation in US dollars (default {DEFAULT_CAP})")
    p.add_argument("--no-judge", action="store_true", help="run the code checks only")
    a = p.parse_args(argv)
    evaluate(cap=a.cap, use_judge=not a.no_judge)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except llm.LLMError as exc:
        sys.exit(f"error: {exc}")
