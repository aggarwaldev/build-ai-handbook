"""Tests for the shared model adapter. They need no key and no network."""

from __future__ import annotations

import json

import pytest

from common import llm


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "fake")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm.fake.reset()
    yield
    llm.fake.reset()


def test_default_fake_reply_echoes_the_user():
    reply = llm.chat([{"role": "user", "content": "hello there"}])
    assert reply.text == "[fake model] You said: hello there"
    assert reply.backend == "fake"
    assert reply.input_tokens > 0 and reply.output_tokens > 0
    assert reply.cost_usd == 0.0


def test_scripted_tool_call_round_trip():
    llm.fake.script(llm.ToolCall("t1", "add", {"a": 2, "b": 3}), "The sum is 5.")
    messages = [{"role": "user", "content": "What is 2 + 3?"}]
    first = llm.chat(messages, tools=[{"name": "add", "description": "Add two numbers",
                                       "input_schema": {"type": "object"}}])
    assert first.stop_reason == "tool_use"
    assert first.tool_calls[0].input == {"a": 2, "b": 3}
    messages.append(first.message())
    messages.append(llm.tool_results([{"id": "t1", "name": "add", "content": "5"}]))
    second = llm.chat(messages)
    assert second.text == "The sum is 5."
    assert llm.fake.calls[1]["messages"][-1]["results"][0]["content"] == "5"


def test_listener_sees_every_call():
    seen = []
    listener = lambda req, reply: seen.append((req["model"], reply.text))
    llm.add_listener(listener)
    try:
        llm.chat([{"role": "user", "content": "x"}])
    finally:
        llm.remove_listener(listener)
    assert seen == [("fake", "[fake model] You said: x")]


def test_tool_results_need_an_id():
    with pytest.raises(ValueError):
        llm.tool_results([{"content": "no id"}])


def test_unknown_backend_is_refused(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "gpt")
    with pytest.raises(llm.LLMError):
        llm.chat([{"role": "user", "content": "x"}])


def test_cost_uses_the_price_table():
    assert llm.estimate_cost("claude-haiku-5-5", 1_000_000, 1_000_000) == pytest.approx(0.60)
    assert llm.estimate_cost("llama3.2", 1_000_000, 1_000_000) == 0.0


def test_conversation_converts_to_anthropic_blocks():
    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "checking", "tool_calls": [{"id": "t1", "name": "add", "input": {"a": 1}}]},
        llm.tool_results([{"id": "t1", "name": "add", "content": 2, "is_error": False}]),
    ]
    out = llm._to_anthropic(msgs)
    assert out[1]["content"][1] == {"type": "tool_use", "id": "t1", "name": "add", "input": {"a": 1}}
    assert out[2] == {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t1", "content": "2", "is_error": False}]}


def test_conversation_converts_to_ollama_messages():
    msgs = [
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t1", "name": "add", "input": {"a": 1}}]},
        llm.tool_results([{"id": "t1", "name": "add", "content": "2"}]),
    ]
    out = llm._to_ollama(msgs)
    assert out[0]["tool_calls"] == [{"function": {"name": "add", "arguments": {"a": 1}}}]
    assert out[1] == {"role": "tool", "content": "2", "tool_name": "add"}


def test_anthropic_backend_against_a_recorded_response(monkeypatch):
    """Send one request through the real SDK to a fake HTTP server and read the reply."""
    anthropic = pytest.importorskip("anthropic")
    httpx = pytest.importorskip("httpx2")
    sent = {}

    def handler(request):
        sent.update(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
            "content": [
                {"type": "thinking", "thinking": "", "signature": "sig"},
                {"type": "text", "text": "Paris."},
            ],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 12, "output_tokens": 30},
        })

    client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setenv("LLM_BACKEND", "anthropic")
    monkeypatch.setattr(llm, "_anthropic_client", client)
    reply = llm.chat([{"role": "user", "content": "Capital of France?"}], system="Be brief.",
                     temperature=0.7, effort="low")
    assert reply.text == "Paris."
    assert reply.stop_reason == "end"
    assert (reply.input_tokens, reply.output_tokens) == (12, 30)
    assert sent["system"] == "Be brief."
    assert sent["output_config"] == {"effort": "low"}
    assert "temperature" not in sent
    # the thinking block is kept for replay on the next call
    assert [b.type for b in reply.message()["_raw"]["content"]] == ["thinking", "text"]
