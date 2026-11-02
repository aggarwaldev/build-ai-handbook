"""Tests for Lab 9. No key and no network: every call goes to the fake backend."""

from __future__ import annotations

import json

import pytest

import tracing as tr
from common import llm


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "fake")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm.fake.reset()
    yield
    llm.fake.reset()


def ask(t: tr.Tracer, text: str, **kw) -> llm.Reply:
    return t.chat([{"role": "user", "content": text}], **kw)


# ---------------------------------------------------------------- spans


def test_spans_nest_and_model_calls_hang_under_the_innermost(tmp_path):
    with tr.Tracer("t", out_dir=tmp_path) as t:
        with t.span("outer"):
            with t.span("inner"):
                ask(t, "hello")
            ask(t, "again")
    by_name = {}
    for r in t.records:
        by_name.setdefault(r["name"], []).append(r)
    outer, inner = by_name["outer"][0], by_name["inner"][0]
    first, second = by_name["llm fake"]
    assert outer["parent_id"] is None
    assert inner["parent_id"] == outer["span_id"]
    assert first["parent_id"] == inner["span_id"]
    assert second["parent_id"] == outer["span_id"]
    assert len({r["trace_id"] for r in t.records}) == 1


def test_a_model_span_carries_model_tokens_cost_latency_and_stop_reason(tmp_path):
    llm.fake.script(llm.Reply(text="ok", input_tokens=1000, output_tokens=200, model="claude-haiku-5-5"))
    with tr.Tracer("t", out_dir=tmp_path) as t, t.span("step"):
        ask(t, "hi", max_tokens=300)
    a = next(r for r in t.records if r["kind"] == "llm")["attrs"]
    assert (a["model"], a["input_tokens"], a["output_tokens"], a["stop_reason"], a["max_tokens"]) == (
        "claude-haiku-5-5", 1000, 200, "end", 300)
    assert a["cost_usd"] == pytest.approx((1000 * 0.10 + 200 * 0.50) / 1e6)
    assert a["latency_s"] >= 0


def test_every_span_is_written_as_one_json_line(tmp_path):
    with tr.Tracer("t", out_dir=tmp_path) as t, t.span("step"):
        ask(t, "hi")
    lines = t.path.read_text().splitlines()
    assert [json.loads(line)["name"] for line in lines] == ["llm fake", "step"]
    assert tr.load_trace(t.path) == t.records


def test_a_failing_span_records_the_error_and_reraises(tmp_path):
    with tr.Tracer("t", out_dir=tmp_path) as t:
        with pytest.raises(ZeroDivisionError):
            with t.span("boom"):
                1 / 0
    assert t.records[0]["status"] == "error: ZeroDivisionError"


def test_closing_the_tracer_removes_its_listener(tmp_path):
    with tr.Tracer("t", out_dir=tmp_path) as t:
        assert t._on_call in llm._listeners
    assert t._on_call not in llm._listeners


# ---------------------------------------------------------------- masking


def test_traces_never_hold_personal_data(tmp_path):
    with tr.Tracer("t", out_dir=tmp_path) as t, t.span("plan", note="mail sam@example.com"):
        ask(t, "Call +44 20 7946 0958 or pay with 4111 1111 1111 1111")
    written = t.path.read_text()
    for value in ("sam@example.com", "+44 20 7946 0958", "4111 1111 1111 1111"):
        assert value not in written
    assert "<EMAIL_A>" in written and "<PHONE_A>" in written and "<CARD_A>" in written


def test_sensitive_keys_are_masked_whole_and_token_counts_survive():
    out = tr.scrub({"email": "x", "Name": "Ada Lovelace", "input_tokens": 12, "note": "ring 07700 900123"})
    assert out == {"email": "<masked>", "Name": "<masked>", "input_tokens": 12, "note": "ring <PHONE_A>"}


def test_a_span_that_cannot_be_written_is_dropped_and_the_run_goes_on(tmp_path):
    with tr.Tracer("t", out_dir=tmp_path) as t:
        t.path = tmp_path / "missing-folder" / "trace.jsonl"     # every write now fails
        with t.span("step"):
            reply = ask(t, "hi")
    assert reply.text.startswith("[fake model]")
    assert t.dropped == 2 and t.records == []


def test_rollup_adds_model_calls_up_through_their_parents():
    recs = [
        {"span_id": "r", "parent_id": None, "kind": "span"},
        {"span_id": "a", "parent_id": "r", "kind": "span"},
        {"span_id": "l1", "parent_id": "a", "kind": "llm", "attrs": {"input_tokens": 10, "output_tokens": 1, "cost_usd": 0.5}},
        {"span_id": "l2", "parent_id": "r", "kind": "llm", "attrs": {"input_tokens": 5, "output_tokens": 2, "cost_usd": 0.25}},
    ]
    assert tr.rollup(recs) == {"a": (10, 1, 0.5), "r": (15, 3, 0.75)}


def test_preview_masks_before_it_cuts():
    text = "x" * (tr.PREVIEW_CHARS - 5) + " sam.taylor@example.com"
    cut = tr.preview(text)
    assert "sam." not in cut and cut.endswith("...")


# ---------------------------------------------------------------- the summary


def test_percentile_uses_nearest_rank():
    values = [0.5, 0.1, 0.4, 0.2, 0.3]
    assert tr.percentile(values, 50) == 0.3
    assert tr.percentile(values, 95) == 0.5
    assert tr.percentile(list(range(1, 21)), 95) == 19


def test_summary_counts_and_draws_the_tree(tmp_path, capsys):
    llm.fake.script(llm.Reply(text="a", input_tokens=100, output_tokens=10),
                    llm.Reply(text="b", input_tokens=200, output_tokens=20))
    with tr.Tracer("t", out_dir=tmp_path) as t:
        with t.span("root"):
            with t.span("one"):
                ask(t, "x")
            with t.span("two"):
                ask(t, "y")
    s = tr.summarise(tr.load_trace(t.path))
    assert (s["calls"], s["input_tokens"], s["output_tokens"]) == (2, 300, 30)
    assert s["haiku_usd"] == pytest.approx((300 * 0.10 + 30 * 0.50) / 1e6)
    tree = capsys.readouterr().out.splitlines()[-5:]
    expected = ["root ", "├─ one ", "│  └─ llm fake ", "└─ two ", "   └─ llm fake "]
    assert all(line.startswith(want) for line, want in zip(tree, expected)), tree


# ---------------------------------------------------------------- the budget guard


def test_guard_refuses_before_the_call_is_made(tmp_path):
    guard = tr.BudgetGuard(0.0001)                    # max_tokens 1000 at $0.50/M is $0.0005
    with tr.Tracer("t", out_dir=tmp_path, guard=guard) as t:
        with pytest.raises(tr.BudgetExceeded):
            ask(t, "hi", max_tokens=1000)
    assert llm.fake.calls == []                       # nothing was sent
    assert t.records[0]["kind"] == "refused"


def test_guard_lets_calls_through_under_the_cap_and_adds_up_spend(tmp_path):
    llm.fake.script(llm.Reply(text="a", input_tokens=1000, output_tokens=100),
                    llm.Reply(text="b", input_tokens=1000, output_tokens=100))
    guard = tr.BudgetGuard(0.001)
    with tr.Tracer("t", out_dir=tmp_path, guard=guard) as t:
        ask(t, "one", max_tokens=200)
        ask(t, "two", max_tokens=200)
    assert len(llm.fake.calls) == 2
    assert guard.spent == pytest.approx(2 * (1000 * 0.10 + 100 * 0.50) / 1e6)


def test_guard_stops_a_run_once_spend_builds_up(tmp_path):
    # each call: about $0.00015 spent; worst case of the next is about $0.0001
    guard = tr.BudgetGuard(0.0004)
    with tr.Tracer("t", out_dir=tmp_path, guard=guard) as t:
        made = 0
        with pytest.raises(tr.BudgetExceeded):
            for _ in range(10):
                llm.fake.script(llm.Reply(text="a", input_tokens=1000, output_tokens=100))
                ask(t, "x", max_tokens=200)
                made += 1
    assert made == 2 and len(llm.fake.calls) == 2


def test_guard_fails_closed_without_a_price():
    with pytest.raises(ValueError):
        tr.BudgetGuard(1.0, price_model="a-model-with-no-price")
    with pytest.raises(ValueError):
        tr.BudgetGuard(0)


def test_a_call_that_raises_keeps_its_worst_case_counted(tmp_path, monkeypatch):
    def broken(req):
        raise llm.LLMError("connection dropped")
    monkeypatch.setattr(llm.fake, "respond", broken)
    guard = tr.BudgetGuard(1.0)
    with tr.Tracer("t", out_dir=tmp_path, guard=guard) as t:
        with pytest.raises(llm.LLMError):
            ask(t, "hi", max_tokens=1000)
    assert guard.spent >= 1000 * 0.50 / 1e6


def test_demo_runs_offline_and_masks_its_trace(tmp_path, capsys):
    t = tr.demo(out_dir=tmp_path)
    assert sum(r["kind"] == "llm" for r in t.records) == 4
    assert "sam.taylor@example.com" not in t.path.read_text()


def test_demo_with_a_small_cap_stops_before_the_last_call(tmp_path, capsys):
    t = tr.demo(cap=0.001, out_dir=tmp_path)
    assert [r["kind"] for r in t.records].count("llm") == 3
    assert "stopped: spent" in capsys.readouterr().out
