"""Lab 8: an LLM judge you can trust, or at least one you have measured.

The task: a city library's help desk answers borrowers' questions from a rule card
(data/library_rules.txt). data/items.json holds 40 answers to 20 questions, each labelled
PASS or FAIL by a person. Every question has one good answer and one copy with a single
planted defect: wrong_number, unsupported, off_question or rude (five of each).

The judge reads the rules, the question and one answer, and must reply with JSON
{"reason": "...", "verdict": "PASS" | "FAIL"}, the reason first so the verdict follows
from it. This file measures it against the labels:

  unparseable replies   strict parsing, counted, never guessed at
  agreement and kappa   how often the judge matches the person, and how much of that is
                        more than chance (Cohen's kappa)
  confusion matrix      which way the disagreements go
  recall per defect     which kinds of defect the judge catches
  position bias         a pairwise judge sees each (good, bad) pair in both orders; a fair
                        judge picks the same answer both times

    python labs/08-judge/judge.py run            # all of the above
    python labs/08-judge/judge.py kappa-example  # the small worked example from the page

On the fake backend a keyword heuristic stands in for the model (heuristic_judge below),
so the offline run prints real numbers. They measure the plumbing, not a model.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Hashable, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # labs/
from common import llm  # noqa: E402

HERE = Path(__file__).resolve().parent
RULES = (HERE / "data" / "library_rules.txt").read_text(encoding="utf-8").strip()
MAX_TOKENS = 2048  # Claude's thinking counts toward this, so leave room

JUDGE_SYSTEM = """You grade answers written by a city library's help desk.
Read the library's rules, the borrower's question and the answer. The answer passes only
if all four tests hold:
1. Correct: every number, time and price in it matches the rules.
2. Supported: it claims nothing that the rules do not say.
3. On the question: it answers what was asked.
4. Courteous: no sarcasm, no blame, no talking down.
If any test fails, the answer fails. Write the reason first, then the verdict. Reply with
one JSON object and nothing else:
{"reason": "one short sentence naming the test that failed, if any", "verdict": "PASS" or "FAIL"}"""

PAIR_SYSTEM = """You compare two answers written by a city library's help desk to the same
borrower's question. Use the library's rules and the same four tests: correct, supported,
on the question, courteous. Pick the better answer. Reply with one JSON object and nothing else:
{"reason": "one short sentence", "winner": "1" or "2"}"""


def judge_prompt(question: str, answer: str) -> str:
    return f"<rules>\n{RULES}\n</rules>\n<question>{question}</question>\n<answer>{answer}</answer>"


def pair_prompt(question: str, first: str, second: str) -> str:
    return (f"<rules>\n{RULES}\n</rules>\n<question>{question}</question>\n"
            f"<answer_1>{first}</answer_1>\n<answer_2>{second}</answer_2>")


# ---------------------------------------------------------------- strict parsing


def parse_verdict(text: str) -> dict[str, str] | None:
    """The reply must be exactly one JSON object with a verdict and a reason. Anything else
    (prose around it, a code fence, a missing key, a verdict of "pass") is unparseable.
    Guessing would hide how often the judge breaks the contract."""
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if (not isinstance(data, dict) or set(data) != {"verdict", "reason"}
            or data["verdict"] not in ("PASS", "FAIL") or not isinstance(data["reason"], str)):
        return None
    return data


def parse_pair(text: str) -> dict[str, str] | None:
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if (not isinstance(data, dict) or set(data) != {"winner", "reason"}
            or data["winner"] not in ("1", "2") or not isinstance(data["reason"], str)):
        return None
    return data


# ---------------------------------------------------------------- metrics


def cohen_kappa(a: Sequence[Hashable], b: Sequence[Hashable]) -> float | None:
    """Agreement beyond chance between two raters of the same items.

    po = share of items where they agree; pe = sum over labels of (share a gave it) times
    (share b gave it); kappa = (po - pe) / (1 - pe). None when pe is 1 (both raters gave
    one label to everything), where kappa is not defined.
    """
    if len(a) != len(b) or not a:
        raise ValueError("need two equal, non-empty lists of labels")
    n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum((ca[label] / n) * (cb[label] / n) for label in set(ca) | set(cb))
    return None if pe == 1 else (po - pe) / (1 - pe)


def confusion(human: Sequence[str], judge: Sequence[str | None]) -> dict[tuple[str, str], int]:
    """Counts of (human label, judge verdict); an unparseable verdict is 'unparseable'."""
    return Counter((h, j or "unparseable") for h, j in zip(human, judge))


def recall_by_defect(items: Sequence[dict[str, Any]], judge: Sequence[str | None]) -> dict[str, tuple[int, int]]:
    """For each defect type: (caught, planted). Caught means the judge said FAIL;
    an unparseable reply is not a catch."""
    out: dict[str, list[int]] = {}
    for item, verdict in zip(items, judge):
        if item["defect"]:
            row = out.setdefault(item["defect"], [0, 0])
            row[0] += verdict == "FAIL"
            row[1] += 1
    return {k: (v[0], v[1]) for k, v in out.items()}


def position_flips(first_order: Sequence[str | None], swapped: Sequence[str | None]) -> dict[str, int]:
    """Each pair was shown (good, bad) and then (bad, good). Map both replies back to the
    answer they chose: the same answer both times is consistent; otherwise the order decided."""
    out = Counter()
    for w1, w2 in zip(first_order, swapped):
        if w1 is None or w2 is None:
            out["unparseable"] += 1
            continue
        chose_1 = "good" if w1 == "1" else "bad"
        chose_2 = "good" if w2 == "2" else "bad"
        out[f"{chose_1} both times" if chose_1 == chose_2 else "flipped"] += 1
    return dict(out)


# ---------------------------------------------------------------- a stand-in judge for the fake backend

_STOP = set("a about all also an and any are as at be been by can could do does for from get "
            "had has have how i if in is it its me more most my no not of on one or our so than "
            "that the their there these they this to up us was we what when where which who will "
            "with yes you your".split())
RUDE_MARKERS = ["obviously", "as i already said", "as i said", "not hard", "seriously",
                "figure it out", "not my problem", "read the sign"]
NUMBER = re.compile(r"£?\d+(?:[.:]\d+)?p?")


def _stem(word: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


def _words(text: str) -> set[str]:
    return {_stem(w) for w in re.findall(r"[a-z]+", text.lower()) if w not in _STOP}


def heuristic_problems(question: str, answer: str) -> list[str]:
    """Keyword rules, one per test. Crude on purpose: you can read every rule in a minute."""
    problems = []
    known = set(NUMBER.findall(RULES))
    wrong = [n for n in NUMBER.findall(answer) if n not in known]
    if wrong:
        problems.append(f"the answer says {wrong[0]}, which is not in the rules")
    rule_words = _words(RULES) | _words(question)
    for sentence in re.split(r"(?<=[.!?])\s+", answer):
        words = _words(sentence) - {_stem(n) for n in NUMBER.findall(sentence)}
        if len(words) >= 4 and len(words & rule_words) / len(words) < 0.6:
            problems.append(f"this claim is not in the rules: {sentence}")
            break
    if not _words(question) & _words(answer):
        problems.append("the answer does not address the question")
    lower = answer.lower()
    rude = [m for m in RUDE_MARKERS if m in lower]
    if rude:
        problems.append(f"the tone is not courteous ('{rude[0]}')")
    return problems


def _tag(text: str, name: str) -> str:
    m = re.search(rf"<{name}>(.*?)</{name}>", text, re.S)
    return m.group(1) if m else ""


def heuristic_judge(request: dict[str, Any]) -> str:
    """Answers judge and pairwise prompts on the fake backend.

    Like a model writing token by token, it pastes its reason into a JSON template rather
    than building the JSON with a library. So when a reason quotes an answer that holds a
    double quote, the JSON breaks: a real failure mode, and the reason parsing is strict.
    """
    prompt = request["messages"][-1]["content"]
    question = _tag(prompt, "question")
    if "<answer_2>" in prompt:
        a1 = heuristic_problems(question, _tag(prompt, "answer_1"))
        a2 = heuristic_problems(question, _tag(prompt, "answer_2"))
        # Fewer problems wins. On a tie it cannot tell them apart and picks the first shown.
        winner = "2" if len(a2) < len(a1) else "1"
        return '{"reason": "answer %s has fewer problems", "winner": "%s"}' % (winner, winner)
    problems = heuristic_problems(question, _tag(prompt, "answer"))
    verdict = "FAIL" if problems else "PASS"
    reason = problems[0] if problems else "passes all four tests"
    return '{"reason": "%s", "verdict": "%s"}' % (reason, verdict)


# ---------------------------------------------------------------- the run


def load_items() -> list[dict[str, Any]]:
    return json.loads((HERE / "data" / "items.json").read_text(encoding="utf-8"))


def _use_heuristic_on_fake() -> bool:
    if llm.backend_name() == "fake" and llm.fake.responder is llm.fake.default_responder:
        llm.fake.responder = heuristic_judge
        return True
    return False


def judge_items(items: Sequence[dict[str, Any]]) -> tuple[list[str | None], list[str], list[llm.Reply]]:
    verdicts, raw, replies = [], [], []
    for item in items:
        reply = llm.chat([{"role": "user", "content": judge_prompt(item["question"], item["answer"])}],
                         system=JUDGE_SYSTEM, max_tokens=MAX_TOKENS, effort="low")
        parsed = parse_verdict(reply.text)
        verdicts.append(parsed["verdict"] if parsed else None)
        raw.append(reply.text)
        replies.append(reply)
    return verdicts, raw, replies


def judge_pairs(items: Sequence[dict[str, Any]]) -> tuple[list[str | None], list[str | None], list[llm.Reply]]:
    """Each question's good and bad answers, shown in both orders."""
    by_question: dict[str, dict[str, dict[str, Any]]] = {}
    for item in items:
        by_question.setdefault(item["id"].rsplit("-", 1)[0], {})[item["human_label"]] = item
    first, swapped, replies = [], [], []
    for pair in by_question.values():
        good, bad = pair["PASS"], pair["FAIL"]
        for out, (one, two) in ((first, (good, bad)), (swapped, (bad, good))):
            reply = llm.chat([{"role": "user", "content": pair_prompt(good["question"], one["answer"], two["answer"])}],
                             system=PAIR_SYSTEM, max_tokens=MAX_TOKENS, effort="low")
            parsed = parse_pair(reply.text)
            out.append(parsed["winner"] if parsed else None)
            replies.append(reply)
    return first, swapped, replies


def run() -> dict[str, Any]:
    items = load_items()
    stand_in = _use_heuristic_on_fake()
    verdicts, raw, replies = judge_items(items)
    human = [i["human_label"] for i in items]
    parsed = [(h, v) for h, v in zip(human, verdicts) if v is not None]
    bad = [i["id"] for i, v in zip(items, verdicts) if v is None]

    backend = replies[0].backend
    print(f"Judge run: {len(items)} items on the {backend} backend"
          + (" (keyword heuristic: these numbers measure the plumbing, not a model)" if stand_in else ""))
    print(f"unparseable replies: {len(bad)} of {len(items)} {bad}")
    for item_id, text in zip([i['id'] for i in items], raw):
        if item_id in bad:
            print(f"  {item_id}: {text}")
    agree = sum(h == v for h, v in parsed)
    print(f"agreement on the {len(parsed)} parsed: {agree}/{len(parsed)} = {agree / len(parsed):.3f}; "
          f"counting unparseable as wrong: {agree}/{len(items)} = {agree / len(items):.3f}")
    kappa = cohen_kappa([h for h, _ in parsed], [v for _, v in parsed])
    print(f"Cohen's kappa on the parsed: {'undefined' if kappa is None else f'{kappa:.3f}'}")

    cm = confusion(human, verdicts)
    print("confusion matrix (rows: person, columns: judge)")
    print(f"  {'':<12}{'PASS':>6}{'FAIL':>6}{'unparseable':>13}")
    for h in ("PASS", "FAIL"):
        print(f"  {'person ' + h:<12}{cm.get((h, 'PASS'), 0):>6}{cm.get((h, 'FAIL'), 0):>6}"
              f"{cm.get((h, 'unparseable'), 0):>13}")
    print("recall per defect type (planted defects the judge called FAIL)")
    for defect, (caught, planted) in recall_by_defect(items, verdicts).items():
        print(f"  {defect:<14}{caught} of {planted}")
    wrong = [(i["id"], v) for i, v in zip(items, verdicts) if v is not None and v != i["human_label"]]
    print(f"disagreements: {', '.join(f'{i} (judge {v})' for i, v in wrong) or 'none'}")

    first, swapped, pair_replies = judge_pairs(items)
    flips = position_flips(first, swapped)
    print(f"position bias: {len(first)} pairs, each judged in both orders: "
          + ", ".join(f"{k} {v}" for k, v in sorted(flips.items())))

    every = replies + pair_replies
    tin = sum(r.input_tokens for r in every)
    tout = sum(r.output_tokens for r in every)
    cost = llm.estimate_cost("claude-haiku-5-5", tin, tout)
    worst = llm.estimate_cost("claude-haiku-5-5", tin, MAX_TOKENS * len(every))
    print(f"calls: {len(every)}, {tin} input and {tout} output tokens ({backend}); on claude-haiku-5-5 "
          f"about ${cost:.4f}, at most ${worst:.4f} if every reply used max_tokens={MAX_TOKENS}")
    return {"verdicts": verdicts, "kappa": kappa, "confusion": cm, "flips": flips,
            "recall": recall_by_defect(items, verdicts), "unparseable": bad}


def kappa_example() -> None:
    """The ten-answer example worked by hand on the lab page."""
    person = ["PASS"] * 6 + ["FAIL"] * 4
    judge = ["PASS"] * 5 + ["FAIL"] + ["FAIL", "FAIL", "PASS", "PASS"]
    print("person:", " ".join(p[0] for p in person))
    print("judge: ", " ".join(j[0] for j in judge))
    print(f"kappa = {cohen_kappa(person, judge):.3f}")


def main(argv: list[str]) -> int:
    if argv[:1] == ["run"]:
        run()
    elif argv[:1] == ["kappa-example"]:
        kappa_example()
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
