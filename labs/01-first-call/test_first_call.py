"""Tests for Lab 1. They run on the fake backend: no key, no network, no cost."""

from __future__ import annotations

import json

import pytest

import first_call
from common import llm


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "fake")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm.fake.reset()
    llm.fake.responder = first_call.fake_model
    yield
    llm.fake.reset()


def test_one_message_comes_back_with_every_field():
    reply = first_call.ask("Say hello in five words")
    assert reply.text.endswith("You said: Say hello in five words")
    assert reply.stop_reason == "end"
    assert reply.backend == "fake" and reply.model == "fake"
    assert reply.input_tokens > 0 and reply.output_tokens > 0
    assert reply.latency_s >= 0
    assert reply.cost_usd == 0.0
    sent = llm.fake.calls[-1]
    assert sent["messages"] == [{"role": "user", "content": "Say hello in five words"}]
    assert sent["max_tokens"] == first_call.DEFAULT_MAX_TOKENS


def test_system_prompt_travels_beside_the_messages():
    reply = first_call.ask("What is a token?", system="Answer in one sentence.")
    assert llm.fake.calls[-1]["system"] == "Answer in one sentence."
    assert llm.fake.calls[-1]["messages"][0]["role"] == "user"  # not inside the messages
    assert 'system prompt: "Answer in one sentence."' in reply.text


def test_describe_shows_the_fields_and_the_reference_cost():
    llm.fake.script(llm.Reply(text="Hello there, nice to meet!", input_tokens=1000, output_tokens=2000))
    text = first_call.describe(first_call.ask("hi"))
    assert "stop_reason  end" in text
    assert "1000 in, 2000 out" in text
    # 1,000 x $0.10 + 2,000 x $0.50 per million tokens
    assert "on claude-haiku-5-5 would cost $0.001100" in text


def test_reference_cost_uses_haiku_prices():
    assert first_call.reference_cost(1_000_000, 0) == pytest.approx(0.10)
    assert first_call.reference_cost(0, 1_000_000) == pytest.approx(0.50)


def test_usd_keeps_small_amounts_readable():
    assert first_call.usd(0) == "$0"
    assert first_call.usd(0.0000123) == "$0.000012"
    assert first_call.usd(0.25) == "$0.2500"


def test_a_small_max_tokens_cuts_the_reply_off():
    reply = first_call.ask("Explain tokens in three paragraphs", max_tokens=8)
    assert reply.stop_reason == "max_tokens"
    assert reply.output_tokens == 8
    assert len(reply.text) == 8 * 4
    assert "hit max_tokens" in first_call.describe(reply)


def test_conversation_resends_the_whole_history():
    chat = first_call.Conversation(system="Be brief.")
    first = chat.send("My name is Sam.")
    second = chat.send("What is my name?")
    assert [m["role"] for m in chat.messages] == ["user", "assistant", "user", "assistant"]
    sent = llm.fake.calls[-1]["messages"]
    assert len(sent) == 3 and sent[0]["content"] == "My name is Sam."
    assert "I received 3 messages" in second.text
    assert second.input_tokens > first.input_tokens
    assert chat.turns == 2
    assert chat.input_tokens == first.input_tokens + second.input_tokens
    assert chat.output_tokens == first.output_tokens + second.output_tokens


def test_run_chat_stops_on_quit_and_can_reset():
    out: list[str] = []
    chat = first_call.Conversation()
    first_call.run_chat(["hello", "/reset", "again", "/quit", "never sent"], chat, out.append)
    assert chat.turns == 1  # reset cleared the first turn
    assert len(chat.messages) == 2 and chat.messages[0]["content"] == "again"
    assert "(conversation cleared)" in out
    assert not any("never sent" in line for line in out)
    assert out[-1].startswith("(turn 1:")


def test_history_shows_what_is_sent():
    out: list[str] = []
    first_call.run_chat(["hello", "/history"], first_call.Conversation(), out.append)
    shown = json.loads(out[-1])
    assert [m["role"] for m in shown] == ["user", "assistant"]
    assert shown[0]["content"] == "hello"


def test_usage_line_reports_turn_and_running_totals():
    chat = first_call.Conversation()
    reply = chat.send("hi")
    line = chat.usage_line(reply)
    assert line.startswith(f"(turn 1: {reply.input_tokens} in + {reply.output_tokens} out tokens")
    assert "on claude-haiku-5-5 about $" in line


def test_command_line_prints_the_reply(capsys):
    assert first_call.main(["--system", "Be brief.", "Say hello"]) == 0
    printed = capsys.readouterr().out
    assert "You said: Say hello" in printed
    assert "stop_reason  end" in printed


def test_command_line_needs_a_prompt_or_chat():
    with pytest.raises(SystemExit):
        first_call.main([])


def test_unknown_backend_is_reported(monkeypatch, capsys):
    monkeypatch.setenv("LLM_BACKEND", "gpt")
    assert first_call.main(["hi"]) == 2
    assert "LLM_BACKEND" in capsys.readouterr().err
