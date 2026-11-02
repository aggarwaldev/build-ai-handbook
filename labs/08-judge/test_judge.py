"""Tests for Lab 8. No key and no network: the judge runs on the fake backend."""

from __future__ import annotations

import pytest

import judge as j
from common import llm


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "fake")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm.fake.reset()
    yield
    llm.fake.reset()


# ---------------------------------------------------------------- parsing


def test_parse_accepts_exactly_the_contract():
    assert j.parse_verdict('{"verdict": "FAIL", "reason": "wrong fee"}') == {"verdict": "FAIL", "reason": "wrong fee"}


@pytest.mark.parametrize("text", [
    'Verdict: {"verdict": "PASS", "reason": "fine"}',          # prose before the JSON
    '```json\n{"verdict": "PASS", "reason": "fine"}\n```',     # a code fence
    '{"verdict": "pass", "reason": "fine"}',                   # wrong case
    '{"verdict": "PASS"}',                                     # missing reason
    '{"verdict": "PASS", "reason": "fine", "score": 2}',       # extra key
    '{"verdict": "PASS", "reason": "says "hi""}',              # unescaped quotes
    '["PASS", "fine"]',                                        # not an object
])
def test_parse_refuses_everything_else(text):
    assert j.parse_verdict(text) is None


def test_parse_pair():
    assert j.parse_pair('{"winner": "2", "reason": "x"}') == {"winner": "2", "reason": "x"}
    assert j.parse_pair('{"winner": 2, "reason": "x"}') is None


# ---------------------------------------------------------------- metrics


def test_kappa_matches_the_worked_example():
    person = ["PASS"] * 6 + ["FAIL"] * 4
    judge = ["PASS"] * 5 + ["FAIL", "FAIL", "FAIL", "PASS", "PASS"]
    # po = 7/10 = 0.70; pe = 0.6 * 0.7 + 0.4 * 0.3 = 0.54; kappa = 0.16 / 0.46
    assert j.cohen_kappa(person, judge) == pytest.approx(0.16 / 0.46)


def test_kappa_is_one_for_perfect_agreement_and_none_when_undefined():
    assert j.cohen_kappa(["PASS", "FAIL"], ["PASS", "FAIL"]) == 1.0
    assert j.cohen_kappa(["PASS", "PASS"], ["PASS", "PASS"]) is None


def test_kappa_can_be_negative():
    assert j.cohen_kappa(["PASS", "FAIL"], ["FAIL", "PASS"]) == pytest.approx(-1.0)


def test_confusion_counts_unparseable_separately():
    cm = j.confusion(["PASS", "FAIL", "FAIL"], ["PASS", None, "PASS"])
    assert cm == {("PASS", "PASS"): 1, ("FAIL", "unparseable"): 1, ("FAIL", "PASS"): 1}


def test_recall_by_defect_does_not_count_unparseable_as_caught():
    items = [{"defect": "rude"}, {"defect": "rude"}, {"defect": None}]
    assert j.recall_by_defect(items, ["FAIL", None, "PASS"]) == {"rude": (1, 2)}


def test_position_flips_maps_winners_back_to_answers():
    # pair 1 consistent on the good answer, pair 2 always picks slot 1, pair 3 unparseable
    assert j.position_flips(["1", "1", None], ["2", "1", "1"]) == {
        "good both times": 1, "flipped": 1, "unparseable": 1}


# ---------------------------------------------------------------- the stand-in and the run


def test_heuristic_catches_a_number_not_in_the_rules():
    assert j.heuristic_problems("How long can I keep a DVD?", "DVDs are lent for 14 days.") == [
        "the answer says 14, which is not in the rules"]


def test_heuristic_judge_breaks_json_when_the_reason_quotes_a_quote():
    req = {"messages": [{"role": "user", "content": j.judge_prompt(
        "Can I reserve a book?", 'Reserved books wait for a month on the "Collect here" shelf.')}]}
    assert j.parse_verdict(j.heuristic_judge(req)) is None


def test_pairwise_tie_goes_to_the_first_answer_shown():
    req = {"messages": [{"role": "user", "content": j.pair_prompt("Q?", "Fine.", "Also fine.")}]}
    assert j.parse_pair(j.heuristic_judge(req))["winner"] == "1"


def test_the_offline_run_gives_the_numbers_on_the_page(capsys):
    r = j.run()
    assert r["unparseable"] == ["q08-fail"]
    assert round(r["kappa"], 3) == 0.535
    assert r["confusion"] == {("PASS", "PASS"): 18, ("PASS", "FAIL"): 2,
                              ("FAIL", "PASS"): 7, ("FAIL", "FAIL"): 12, ("FAIL", "unparseable"): 1}
    assert r["recall"] == {"wrong_number": (3, 5), "unsupported": (2, 5), "off_question": (3, 5), "rude": (4, 5)}
    assert r["flips"] == {"good both times": 12, "flipped": 7, "bad both times": 1}
    assert len(llm.fake.calls) == 80
    assert all(c["system"] in (j.JUDGE_SYSTEM, j.PAIR_SYSTEM) for c in llm.fake.calls)


def test_a_scripted_judge_reply_flows_through_the_parser():
    llm.fake.script('{"verdict": "FAIL", "reason": "fee is wrong"}')
    verdicts, raw, _ = j.judge_items([{"question": "q", "answer": "a"}])
    assert verdicts == ["FAIL"]
