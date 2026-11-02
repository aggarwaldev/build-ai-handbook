"""One small doorway to a language model, shared by every lab.

Every lab talks to a model through chat(). Which model answers is chosen by the
LLM_BACKEND environment variable, so the same lab code runs three ways:

  anthropic  Claude, through the official Anthropic Python SDK. Needs ANTHROPIC_API_KEY.
  ollama     A model running on your own computer through Ollama (https://ollama.com).
             Free and private; needs `ollama serve` running and the model pulled.
  fake       A scripted stand-in that needs nothing at all. The tests use it, and you
             can use it to read a lab's code path before you spend a cent.

If LLM_BACKEND is not set, the anthropic backend is used when ANTHROPIC_API_KEY is set,
and the fake backend otherwise (with a one-line note on stderr, so it is never a surprise).

LLM_MODEL picks the model inside the backend. The defaults are a small, cheap model for
each: claude-haiku-5-5 and llama3.2.

The conversation format is the same for every backend:

  {"role": "user", "content": "text"}
  reply.message()                       the assistant's turn, to append after a call
  tool_results([...])                   your answers to the assistant's tool calls

Keeping one format means a lab never needs to know which provider answered.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable

DEFAULT_MODELS = {"anthropic": "claude-haiku-5-5", "ollama": "llama3.2", "fake": "fake"}

# US dollars per million tokens (input, output), as published by each provider. Prices
# change: check https://platform.claude.com/docs/en/about-claude/pricing before you budget.
# Claude Haiku 5.5 has a second, higher rate card for prompts over 100K tokens; the labs
# never send prompts that long, so only the first card is listed.
PRICES_PER_MTOK = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-fable-5-1": (10.00, 50.00),
}


class LLMError(RuntimeError):
    """The model could not be reached, or the backend is set up wrongly."""


@dataclass
class ToolCall:
    """The model asks you to run the tool `name` with the arguments in `input`."""

    id: str
    name: str
    input: dict[str, Any]


@dataclass
class Reply:
    """What came back from one call to chat()."""

    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str = "end"  # end, tool_use, max_tokens, refusal, or the provider's own word
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""
    backend: str = ""
    latency_s: float = 0.0
    raw: Any = None  # the provider's own content, replayed as-is on the next call

    @property
    def cost_usd(self) -> float:
        return estimate_cost(self.model, self.input_tokens, self.output_tokens)

    def message(self) -> dict[str, Any]:
        """The assistant turn to append to `messages` before the next call."""
        msg: dict[str, Any] = {"role": "assistant", "content": self.text}
        if self.tool_calls:
            msg["tool_calls"] = [
                {"id": c.id, "name": c.name, "input": c.input} for c in self.tool_calls
            ]
        if self.raw is not None:
            msg["_raw"] = {"backend": self.backend, "content": self.raw}
        return msg


def tool_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Wrap your tool outputs as one turn.

    Each result is {"id": call.id, "name": call.name, "content": "text"}, plus
    "is_error": True when the tool failed, so the model can see the failure and recover.
    """
    for r in results:
        if "id" not in r or "content" not in r:
            raise ValueError("each tool result needs an 'id' and a 'content'")
    return {"role": "tool", "results": results}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Dollar cost of one call; 0.0 for local and fake models."""
    price = PRICES_PER_MTOK.get(model)
    if price is None:
        return 0.0
    return (input_tokens * price[0] + output_tokens * price[1]) / 1_000_000


Listener = Callable[[dict[str, Any], Reply], None]
_listeners: list[Listener] = []


def add_listener(fn: Listener) -> None:
    """Call fn(request, reply) after every chat() call. Lab 9 uses this for tracing."""
    _listeners.append(fn)


def remove_listener(fn: Listener) -> None:
    if fn in _listeners:
        _listeners.remove(fn)


def backend_name() -> str:
    name = os.environ.get("LLM_BACKEND", "").strip().lower()
    if name:
        if name not in DEFAULT_MODELS:
            raise LLMError(f"LLM_BACKEND={name!r}: use anthropic, ollama or fake")
        return name
    if os.environ.get("ANTHROPIC_API_KEY", "").strip():
        return "anthropic"
    if not getattr(backend_name, "_warned", False):
        print("llm: no ANTHROPIC_API_KEY and no LLM_BACKEND, so using the fake backend",
              file=sys.stderr)
        backend_name._warned = True  # type: ignore[attr-defined]
    return "fake"


def chat(
    messages: list[dict[str, Any]],
    *,
    system: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    max_tokens: int = 2048,
    temperature: float | None = None,
    effort: str | None = None,
    model: str | None = None,
) -> Reply:
    """Send the conversation and return the model's reply.

    tools use Anthropic's shape: {"name", "description", "input_schema"}.

    temperature is passed to Ollama only. Current Claude models fix their own sampling
    and reject a temperature, so the anthropic backend ignores it; use `effort`
    ("low", "medium", "high") there to trade depth of thinking for speed and cost.
    max_tokens covers the model's thinking as well as its answer, which is why the
    default leaves room.
    """
    name = backend_name()
    model = model or os.environ.get("LLM_MODEL", "").strip() or DEFAULT_MODELS[name]
    # A copy, so appending to your list after the call does not rewrite what listeners saw.
    request = {
        "backend": name, "model": model, "messages": list(messages), "system": system,
        "tools": tools, "max_tokens": max_tokens, "temperature": temperature, "effort": effort,
    }
    started = time.perf_counter()
    if name == "anthropic":
        reply = _anthropic(request)
    elif name == "ollama":
        reply = _ollama(request)
    else:
        reply = fake.respond(request)
    reply.latency_s = time.perf_counter() - started
    reply.backend, reply.model = name, reply.model or model
    for fn in list(_listeners):
        fn(request, reply)
    return reply


# ---------------------------------------------------------------- anthropic

_anthropic_client = None


def _anthropic(req: dict[str, Any]) -> Reply:
    global _anthropic_client
    try:
        import anthropic
    except ImportError as exc:
        raise LLMError("pip install -r labs/requirements.txt to use the anthropic backend") from exc
    if _anthropic_client is None:
        if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
            raise LLMError("set ANTHROPIC_API_KEY, or use LLM_BACKEND=ollama or fake")
        _anthropic_client = anthropic.Anthropic()

    params: dict[str, Any] = {
        "model": req["model"],
        "max_tokens": req["max_tokens"],
        "messages": _to_anthropic(req["messages"]),
    }
    if req["system"]:
        params["system"] = req["system"]
    if req["tools"]:
        params["tools"] = req["tools"]
    if req["effort"]:
        params["output_config"] = {"effort": req["effort"]}
    try:
        resp = _anthropic_client.messages.create(**params)
    except anthropic.APIError as exc:
        raise LLMError(f"anthropic: {exc}") from exc

    # Read blocks by type: a reply can open with thinking blocks before any text.
    text = "".join(b.text for b in resp.content if b.type == "text")
    calls = [ToolCall(b.id, b.name, dict(b.input)) for b in resp.content if b.type == "tool_use"]
    stop = {"end_turn": "end", "tool_use": "tool_use"}.get(resp.stop_reason, resp.stop_reason)
    return Reply(
        text=text, tool_calls=calls, stop_reason=stop or "end",
        input_tokens=resp.usage.input_tokens, output_tokens=resp.usage.output_tokens,
        model=resp.model, raw=resp.content,
    )


def _to_anthropic(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for m in messages:
        role = m["role"]
        if role == "user":
            out.append({"role": "user", "content": m["content"]})
        elif role == "assistant":
            raw = m.get("_raw")
            if raw and raw["backend"] == "anthropic":
                # Thinking blocks must go back unchanged, so replay the reply as it came.
                out.append({"role": "assistant", "content": raw["content"]})
                continue
            blocks: list[dict[str, Any]] = []
            if m.get("content"):
                blocks.append({"type": "text", "text": m["content"]})
            for c in m.get("tool_calls", []):
                blocks.append({"type": "tool_use", "id": c["id"], "name": c["name"], "input": c["input"]})
            out.append({"role": "assistant", "content": blocks})
        elif role == "tool":
            out.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": r["id"], "content": str(r["content"]),
                 "is_error": bool(r.get("is_error", False))}
                for r in m["results"]
            ]})
        else:
            raise ValueError(f"unknown role {role!r}")
    return out


# ---------------------------------------------------------------- ollama


def _ollama(req: dict[str, Any]) -> Reply:
    host = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
    if not host.startswith("http"):
        host = "http://" + host
    msgs = []
    if req["system"]:
        msgs.append({"role": "system", "content": req["system"]})
    msgs.extend(_to_ollama(req["messages"]))
    body: dict[str, Any] = {
        "model": req["model"], "messages": msgs, "stream": False,
        "options": {"num_predict": req["max_tokens"]},
    }
    if req["temperature"] is not None:
        body["options"]["temperature"] = req["temperature"]
    if req["tools"]:
        body["tools"] = [
            {"type": "function", "function": {
                "name": t["name"], "description": t.get("description", ""),
                "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
            }}
            for t in req["tools"]
        ]
    http_req = urllib.request.Request(
        host + "/api/chat", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(http_req, timeout=300) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise LLMError(f"ollama {exc.code}: {detail} (did you `ollama pull {req['model']}`?)") from exc
    except urllib.error.URLError as exc:
        raise LLMError(f"ollama is not answering at {host}: start it with `ollama serve`") from exc

    msg = data.get("message", {})
    calls = [
        ToolCall(f"call_{i}", c["function"]["name"], _as_dict(c["function"].get("arguments")))
        for i, c in enumerate(msg.get("tool_calls") or [])
    ]
    stop = "tool_use" if calls else {"stop": "end", "length": "max_tokens"}.get(
        data.get("done_reason", "stop"), data.get("done_reason", "end"))
    return Reply(
        text=msg.get("content", ""), tool_calls=calls, stop_reason=stop,
        input_tokens=data.get("prompt_eval_count", 0), output_tokens=data.get("eval_count", 0),
        model=data.get("model", req["model"]),
    )


def _as_dict(args: Any) -> dict[str, Any]:
    if isinstance(args, dict):
        return args
    try:
        return json.loads(args or "{}")
    except (TypeError, ValueError):
        return {}


def _to_ollama(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for m in messages:
        if m["role"] == "user":
            out.append({"role": "user", "content": m["content"]})
        elif m["role"] == "assistant":
            msg: dict[str, Any] = {"role": "assistant", "content": m.get("content", "")}
            if m.get("tool_calls"):
                msg["tool_calls"] = [{"function": {"name": c["name"], "arguments": c["input"]}}
                                     for c in m["tool_calls"]]
            out.append(msg)
        elif m["role"] == "tool":
            for r in m["results"]:
                out.append({"role": "tool", "content": str(r["content"]), "tool_name": r.get("name", "")})
    return out


# ---------------------------------------------------------------- fake


def _rough_tokens(text: str) -> int:
    """About four characters per token for English: an estimate, not a tokenizer."""
    return max(1, len(text) // 4)


class FakeBackend:
    """A stand-in model for tests and for reading a lab without a key.

    Queue replies with script(); each queued item is a string (a text reply), a ToolCall,
    a list of ToolCalls, or a Reply. With nothing queued, `responder` answers; the default
    responder says it is fake and repeats the start of the last user message, so you can
    see the plumbing work. A lab can set its own responder to imitate a real model.
    """

    def __init__(self) -> None:
        self.queue: list[Any] = []
        self.calls: list[dict[str, Any]] = []
        self.responder: Callable[[dict[str, Any]], Any] = self.default_responder

    def script(self, *items: Any) -> None:
        self.queue.extend(items)

    def reset(self) -> None:
        self.queue.clear()
        self.calls.clear()
        self.responder = self.default_responder

    @staticmethod
    def default_responder(req: dict[str, Any]) -> str:
        last = next((m for m in reversed(req["messages"]) if m["role"] in ("user", "tool")), None)
        if last is None:
            said = ""
        elif last["role"] == "user":
            said = last["content"] if isinstance(last["content"], str) else json.dumps(last["content"])
        else:
            said = "; ".join(str(r["content"]) for r in last["results"])
        return f"[fake model] You said: {said[:200]}"

    def respond(self, req: dict[str, Any]) -> Reply:
        self.calls.append(req)
        item = self.queue.pop(0) if self.queue else self.responder(req)
        if isinstance(item, Reply):
            reply = item
        elif isinstance(item, ToolCall):
            reply = Reply(text="", tool_calls=[item], stop_reason="tool_use")
        elif isinstance(item, list):
            reply = Reply(text="", tool_calls=list(item), stop_reason="tool_use")
        else:
            reply = Reply(text=str(item))
        prompt = (req["system"] or "") + json.dumps(req["messages"], default=str)
        reply.input_tokens = reply.input_tokens or _rough_tokens(prompt)
        reply.output_tokens = reply.output_tokens or _rough_tokens(reply.text or " ")
        reply.model = reply.model or req["model"]
        return reply


fake = FakeBackend()
