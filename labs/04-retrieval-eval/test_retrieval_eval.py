"""Tests for Lab 4. Every expected number is worked by hand in chapter 25 or 26."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import retrieval_eval as ev  # noqa: E402

rag = ev.rag


# ---------------------------------------------------------------- metrics, chapter 26


def test_metrics_on_the_chapter_26_example():
    # 3 relevant passages; retrieval returns 5 with relevance 0 1 0 1 0
    ranked, relevant = ["x", "a", "y", "b", "z"], {"a", "b", "c"}
    assert ev.precision_at_k(ranked, relevant, 3) == pytest.approx(1 / 3)
    assert ev.precision_at_k(ranked, relevant, 5) == pytest.approx(0.4)
    assert ev.recall_at_k(ranked, relevant, 3) == pytest.approx(1 / 3)
    assert ev.recall_at_k(ranked, relevant, 5) == pytest.approx(2 / 3)
    assert ev.hit_at_k(ranked, relevant, 1) == 0.0
    assert ev.hit_at_k(ranked, relevant, 3) == 1.0
    assert ev.reciprocal_rank(ranked, relevant) == 0.5
    assert ev.ndcg_at_k(ranked, relevant, 5) == pytest.approx(0.498, abs=5e-4)


def test_mrr_over_four_questions():
    # first relevant passage at ranks 1, 3, nowhere and 2: (1 + 1/3 + 0 + 1/2) / 4
    rr = [ev.reciprocal_rank(r, {"a"}) for r in (["a"], ["x", "y", "a"], ["x", "y"], ["x", "a"])]
    assert ev.mean(rr) == pytest.approx(0.458, abs=5e-4)


def test_the_chapter_26_exercise():
    # 2 relevant passages; relevance 1 0 0 1 0
    ranked, relevant = ["a", "x", "y", "b", "z"], {"a", "b"}
    assert ev.precision_at_k(ranked, relevant, 3) == pytest.approx(1 / 3)
    assert ev.recall_at_k(ranked, relevant, 3) == 0.5
    assert ev.reciprocal_rank(ranked, relevant) == 1.0
    assert ev.ndcg_at_k(ranked, relevant, 5) == pytest.approx(0.877, abs=5e-4)


def test_ndcg_is_one_for_the_ideal_order_and_caps_the_ideal_at_k():
    assert ev.ndcg_at_k(["a", "b", "x"], {"a", "b"}, 3) == pytest.approx(1.0)
    # 5 relevant but k = 2: the ideal is two hits, so two hits on top score 1
    assert ev.ndcg_at_k(["a", "b"], {"a", "b", "c", "d", "e"}, 2) == pytest.approx(1.0)
    assert ev.ndcg_at_k(["x", "y"], {"a"}, 2) == 0.0


# ---------------------------------------------------------------- BM25 and fusion, chapter 25


def test_bm25_on_the_chapter_25_example():
    docs = ["fixed deposit rates for one year", "deposit insurance covers your savings",
            "fixed income funds hold bonds"]
    bm25 = ev.BM25(docs, tokenize=str.split)
    assert bm25.idf["fixed"] == pytest.approx(math.log(1.6))  # 0.470
    assert bm25.avglen == pytest.approx(16 / 3)
    assert bm25.scores("fixed deposit") == pytest.approx([0.894, 0.482, 0.482], abs=5e-4)
    assert bm25.top("fixed deposit", 3) == [0, 1, 2]  # d2 and d3 tie, so they keep their order
    assert bm25.top("bonds", 3) == [2]  # passages sharing no word are left out


def test_bm25_counts_a_repeated_word_with_diminishing_returns():
    bm25 = ev.BM25(["fine fine fine fine", "fine other words here", "nothing"], tokenize=str.split)
    four, one, _ = bm25.scores("fine")
    assert four > one
    assert four < 4 * one


def test_rrf_on_the_chapter_25_examples():
    fused = dict(ev.rrf([["A", "B", "x"], ["B", "y", "A"]]))
    assert fused["A"] == pytest.approx(1 / 61 + 1 / 63)  # 0.03227
    assert fused["B"] == pytest.approx(1 / 62 + 1 / 61)  # 0.03252
    assert ev.rrf([["A", "B", "x"], ["B", "y", "A"]])[0][0] == "B"
    # C is 5th by vectors and 2nd by keywords; D is 1st by vectors only
    fused = dict(ev.rrf([["D", "p", "q", "r", "C"], ["s", "C"]]))
    assert fused["C"] == pytest.approx(0.03151, abs=5e-6)
    assert fused["D"] == pytest.approx(0.01639, abs=5e-6)


def test_chunks_map_to_sections_once_at_their_best_rank():
    section_of = {"a#x": "a#x", "a#x-p2": "a#x", "b#y": "b#y"}
    assert ev.sections(["a#x-p2", "b#y", "a#x"], section_of) == ["a#x", "b#y"]


# ---------------------------------------------------------------- uncertainty


def test_bootstrap_interval():
    assert ev.bootstrap_ci([0.5] * 25) == (0.5, 0.5)
    values = [1.0] * 15 + [0.0] * 10
    lo, hi = ev.bootstrap_ci(values, seed=1)
    assert lo < ev.mean(values) < hi
    assert ev.bootstrap_ci(values, seed=1) == (lo, hi)  # the same seed gives the same interval
    wide = ev.bootstrap_ci([1.0] * 3 + [0.0] * 2, seed=1)
    assert wide[1] - wide[0] > hi - lo  # 5 questions tell you less than 25


def test_paired_difference():
    assert ev.paired_difference([0.5, 1.0], [0.5, 1.0]) == (0.0, 0.0, 0.0)
    d, lo, hi = ev.paired_difference([1.0, 1.0, 0.5, 1.0], [1.0, 0.5, 0.5, 1.0], seed=3)
    assert d == pytest.approx(0.125) and lo <= d <= hi


# ---------------------------------------------------------------- the data and the run


def test_every_label_names_a_real_section():
    questions = ev.load_questions()
    sections = {c.section for c in rag.load_chunks()}
    assert 20 <= len(questions) <= 30
    assert len({q["id"] for q in questions}) == len(questions)
    assert {q["kind"] for q in questions} == {"direct", "paraphrase"}
    for q in questions:
        assert q["relevant"] and set(q["relevant"]) <= sections, q["id"]


def test_evaluate_scores_each_question():
    questions = [{"id": "q1", "kind": "direct", "question": "one", "relevant": ["a#x"]},
                 {"id": "q2", "kind": "paraphrase", "question": "two", "relevant": ["b#y", "c#z"]}]
    answers = {"one": ["d#w", "a#x-p2"], "two": ["c#z", "e#v", "b#y"]}
    section_of = {"a#x-p2": "a#x", "b#y": "b#y", "c#z": "c#z", "d#w": "d#w", "e#v": "e#v"}
    rows = ev.evaluate(questions, lambda q: answers[q], section_of)
    assert [r["first"] for r in rows] == [2, 1]
    assert rows[0]["rr"] == 0.5 and rows[0]["hit@1"] == 0.0 and rows[0]["hit@3"] == 1.0
    assert rows[1]["recall@3"] == 1.0


def test_the_report_runs_without_calling_a_model(monkeypatch, capsys):
    def no_model(*args, **kwargs):
        raise AssertionError("Lab 4 must not call a model")

    monkeypatch.setattr(rag.llm, "chat", no_model)
    ev.main(["--sizes", "120", "--resamples", "50", "--per-question"])
    out = capsys.readouterr().out
    assert "No model is called." in out
    for name in ("tfidf", "bm25", "rrf"):
        assert f"\n{name} " in out
    assert "MRR difference from tfidf" in out
    assert "q25" in out
