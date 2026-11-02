"""Tests for Lab 5. They run offline on the fake backend and never ask a person anything."""

from __future__ import annotations

import json
from datetime import date

import pytest

import agent
from common import llm

MONDAY = date(2026, 11, 2)


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "fake")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm.fake.reset()
    yield
    llm.fake.reset()


def quiet(_line: str) -> None:
    pass


def results_sent(run: agent.Run) -> list[dict]:
    return [r for m in run.messages if m["role"] == "tool" for r in m["results"]]


# ---------------------------------------------------------------- the calculator


@pytest.mark.parametrize("expression, value", [
    ("2 * 6.49 + 18.50", "31.48"),
    ("0.1 + 0.2", "0.3"),  # exact: binary floats give 0.30000000000000004
    ("(1 + 2) * -3", "-9"),
    ("2 ** 10", "1024"),
    ("7 // 2 + 7 % 2", "4"),
    ("10 / 4", "2.5"),
])
def test_calculator_is_exact(expression, value):
    assert agent.calculate(expression)["value"] == value


@pytest.mark.parametrize("expression", [
    "__import__('os').system('echo hi')",  # a call: never evaluated
    "().__class__",                         # an attribute
    "pi * 2",                               # a name
    "2 x 3",                                # not Python at all
    "True + 1",                             # a bool is not a number here
    "'6' * 3",                              # text
    "1 / 0",
    "2 ** 1000",                            # too big a power
    "2 ** 0.5",                             # not a whole power
    "1 + " * 60 + "1",                      # too long
])
def test_calculator_refuses_anything_but_arithmetic(expression):
    with pytest.raises(agent.ToolInputError):
        agent.calculate(expression)


# ---------------------------------------------------------------- the other tools


def test_lookup_puts_the_best_match_first():
    assert agent.lookup_part("inner tube 700x28")["matches"][0]["sku"] == "TUB-700-28"
    assert agent.lookup_part("disc brake pads")["matches"][0]["sku"] == "PAD-DISC-R"
    assert len(agent.lookup_part("tube")["matches"]) == 3


def test_lookup_with_no_match_says_so():
    found = agent.lookup_part("unicycle")
    assert found["matches"] == [] and "try" in found["note"]


@pytest.mark.parametrize("start, days, expected", [
    ("2026-11-02", 3, "2026-11-05"),  # Monday + 3 = Thursday
    ("2026-11-06", 1, "2026-11-09"),  # Friday + 1 = Monday
    ("2026-11-07", 0, "2026-11-07"),  # zero days: the same day
    ("2026-11-07", 1, "2026-11-09"),  # Saturday + 1 = Monday
])
def test_working_days_skip_the_weekend(start, days, expected):
    assert agent.add_working_days(start, days)["date"] == expected


def test_working_days_need_a_real_date():
    with pytest.raises(agent.ToolInputError):
        agent.add_working_days("next Tuesday", 1)


def test_order_checks_sku_and_stock(capsys):
    with pytest.raises(agent.ToolInputError, match="no part"):
        agent.place_order([{"sku": "NOPE", "quantity": 1}])
    with pytest.raises(agent.ToolInputError, match="in stock"):
        agent.place_order([{"sku": "TUB-26-21", "quantity": 1}])
    order = agent.place_order([{"sku": "TUB-700-28", "quantity": 2}])
    assert order["total"] == "12.98"
    assert "[side effect]" in capsys.readouterr().out


# ---------------------------------------------------------------- checking requests


SCHEMA = agent.REGISTRY["place_order"].input_schema


@pytest.mark.parametrize("value, message", [
    ({}, "input.items is required"),
    ({"items": []}, "input.items needs at least 1"),
    ({"items": [{"sku": "A"}]}, "input.items[0].quantity is required"),
    ({"items": [{"sku": "A", "quantity": "2"}]}, "input.items[0].quantity must be an integer"),
    ({"items": [{"sku": "A", "quantity": True}]}, "input.items[0].quantity must be an integer"),
    ({"items": [{"sku": "A", "quantity": 11}]}, "input.items[0].quantity must be at most 10"),
    ({"items": [{"sku": "A", "quantity": 1}], "rush": True}, "input.rush is not a field"),
    ("items", "input must be an object"),
])
def test_check_input_names_the_field(value, message):
    with pytest.raises(agent.ToolInputError, match=message.replace("[", r"\[").replace("]", r"\]")):
        agent.check_input(SCHEMA, value)


def test_check_input_accepts_a_good_request():
    agent.check_input(SCHEMA, {"items": [{"sku": "TUB-700-28", "quantity": 2}]})


def test_every_tool_definition_has_the_three_fields():
    for tool in agent.TOOLS:
        spec = tool.spec()
        assert set(spec) == {"name", "description", "input_schema"}
        assert spec["input_schema"]["type"] == "object"


# ---------------------------------------------------------------- running one request


def call(name, **args):
    return llm.ToolCall("t1", name, args)


def test_unknown_tool_is_an_error_result():
    res = agent.run_tool(call("delete_everything"))
    assert res["is_error"] and "lookup_part" in res["content"]


def test_bad_input_is_an_error_result_and_the_tool_does_not_run(monkeypatch):
    ran = []
    monkeypatch.setattr(agent.REGISTRY["add_working_days"], "run", lambda **kw: ran.append(kw))
    res = agent.run_tool(call("add_working_days", start="2026-11-02", days=-1))
    assert res["is_error"] and "input.days must be at least 0" in res["content"]
    assert ran == []


def test_a_crashing_tool_becomes_an_error_result(monkeypatch):
    def broken(**kwargs):
        raise RuntimeError("catalogue file is locked")
    monkeypatch.setattr(agent.REGISTRY["lookup_part"], "run", broken)
    res = agent.run_tool(call("lookup_part", query="chain"))
    assert res == {"id": "t1", "name": "lookup_part", "is_error": True,
                   "content": "lookup_part failed: RuntimeError: catalogue file is locked"}


def test_a_side_effect_waits_for_a_yes(capsys):
    order = call("place_order", items=[{"sku": "TUB-700-28", "quantity": 1}])
    asked = []
    declined = agent.run_tool(order, approve=lambda c: asked.append(c.name) or False)
    assert declined["is_error"] and "did not approve" in declined["content"]
    assert "[side effect]" not in capsys.readouterr().out
    approved = agent.run_tool(order, approve=lambda c: True)
    assert not approved["is_error"] and json.loads(approved["content"])["total"] == "6.49"
    assert asked == ["place_order"]


def test_read_only_tools_never_ask():
    def never(c):
        raise AssertionError("asked about a read-only tool")
    assert not agent.run_tool(call("calculate", expression="1 + 1"), approve=never)["is_error"]


def test_no_one_at_the_keyboard_means_no(monkeypatch):
    def no_stdin(prompt):
        raise EOFError
    monkeypatch.setattr("builtins.input", no_stdin)
    assert agent.ask_person(call("place_order", items=[])) is False


# ---------------------------------------------------------------- the loop


def test_the_demo_runs_lookup_then_calculator_then_answer():
    llm.fake.responder = agent.pretend_model
    run = agent.run_agent(agent.DEMOS["quote"], today=MONDAY, say=quiet)
    assert run.stop == "end" and run.calls == 5
    assert "31.48 GBP" in run.answer and "Thursday 2026-11-05" in run.answer
    sent = results_sent(run)
    assert [r["name"] for r in sent] == ["lookup_part", "lookup_part", "calculate", "calculate",
                                         "add_working_days"]
    # the slip went back as an error, and the model's next call fixed it
    assert sent[2]["is_error"] and not sent[3]["is_error"]
    # every call resends the conversation, so input tokens grow step by step
    sizes = [len(json.dumps(c["messages"])) for c in llm.fake.calls]
    assert sizes == sorted(sizes)


def test_the_step_limit_stops_the_loop_without_running_the_last_request():
    llm.fake.responder = agent.pretend_model
    run = agent.run_agent(agent.DEMOS["quote"], today=MONDAY, max_steps=2, say=quiet)
    assert run.stop == "step_limit" and run.calls == 2
    assert [r["name"] for r in results_sent(run)] == ["lookup_part", "lookup_part"]
    assert "stopped after 2 model calls" in run.answer


def test_a_declined_order_is_reported_not_retried(capsys):
    llm.fake.responder = agent.pretend_model
    run = agent.run_agent(agent.DEMOS["order"], today=MONDAY, approve=lambda c: False, say=quiet)
    assert run.stop == "end" and "not placed" in run.answer
    assert [r["name"] for r in results_sent(run)] == ["lookup_part", "place_order"]
    assert "[side effect]" not in capsys.readouterr().out


def test_an_approved_order_runs_once():
    llm.fake.responder = agent.pretend_model
    run = agent.run_agent(agent.DEMOS["order"], today=MONDAY, approve=lambda c: True, say=quiet)
    assert run.answer.startswith("Done: order ORD-") and "12.98 GBP" in run.answer


def test_scripted_unknown_tool_then_answer():
    llm.fake.script(llm.ToolCall("x1", "weather", {"city": "York"}), "I cannot check the weather.")
    run = agent.run_agent("Will it rain?", today=MONDAY, say=quiet)
    assert run.stop == "end" and run.answer == "I cannot check the weather."
    assert results_sent(run)[0]["is_error"]


def test_max_tokens_ends_the_loop_with_what_came_back():
    llm.fake.script(llm.Reply(text="Two inner tubes co", stop_reason="max_tokens"))
    run = agent.run_agent("quote me", today=MONDAY, say=quiet)
    assert (run.stop, run.answer, run.calls) == ("max_tokens", "Two inner tubes co", 1)


def test_the_assistant_turn_is_replayed_as_it_came():
    """The loop appends reply.message(), which carries the provider's raw content."""
    raw = [{"type": "thinking", "thinking": "", "signature": "sig"}, {"type": "tool_use"}]
    llm.fake.script(
        llm.Reply(text="", tool_calls=[llm.ToolCall("t1", "calculate", {"expression": "1 + 1"})],
                  stop_reason="tool_use", raw=raw),
        "2",
    )
    agent.run_agent("1 + 1?", today=MONDAY, say=quiet)
    replayed = llm.fake.calls[1]["messages"][1]
    assert replayed["_raw"]["content"] is raw
    assert llm.fake.calls[1]["messages"][2]["results"][0]["content"] == '{"expression": "1 + 1", "value": "2"}'


def test_the_cli_runs_offline(capsys):
    assert agent.main(["--demo", "order", "--auto-approve", "--today", "2026-11-02"]) == 0
    out = capsys.readouterr().out
    assert "approved by --auto-approve" in out and "answer (end): Done: order ORD-" in out
    assert "the same tokens on claude-haiku-5-5 (adding 3 x" in out
