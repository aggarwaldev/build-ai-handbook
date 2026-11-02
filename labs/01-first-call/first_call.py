"""Lab 1: your first model call.

Send one message, add a system prompt, hold a conversation, and read every field of the
reply: the text, why the model stopped, how many tokens it read and wrote, how long it
took and what it cost.

    python labs/01-first-call/first_call.py "Say hello in five words"
    python labs/01-first-call/first_call.py --system "Answer in one sentence." "What is a token?"
    python labs/01-first-call/first_call.py --max-tokens 8 "Explain tokens in three paragraphs"
    python labs/01-first-call/first_call.py --show-request "Hello"
    python labs/01-first-call/first_call.py --chat

Which model answers is set by LLM_BACKEND (anthropic, ollama or fake) and LLM_MODEL; see
lab-setup.html. With the fake backend nothing leaves your computer and nothing is charged.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # labs/
from common import llm  # noqa: E402

# Costs are also shown at this model's prices, whatever answered, so runs can be compared.
REFERENCE_MODEL = "claude-haiku-5-5"
DEFAULT_MAX_TOKENS = 1024


def ask(
    prompt: str,
    *,
    system: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    effort: str | None = None,
    temperature: float | None = None,
) -> llm.Reply:
    """Send one user message and return the reply. The whole conversation is one turn."""
    messages = [{"role": "user", "content": prompt}]
    return llm.chat(messages, system=system, max_tokens=max_tokens, effort=effort,
                    temperature=temperature)


def reference_cost(input_tokens: int, output_tokens: int) -> float:
    """What these token counts would cost on the reference model."""
    return llm.estimate_cost(REFERENCE_MODEL, input_tokens, output_tokens)


def usd(amount: float) -> str:
    """Small amounts need more decimal places: $0.000016 rather than $0.00."""
    if amount == 0:
        return "$0"
    return f"${amount:.6f}" if amount < 0.01 else f"${amount:.4f}"


def describe(reply: llm.Reply) -> str:
    """Every field of a reply, one per line, as the lab page explains them."""
    lines = [
        f"reply        {reply.text}",
        f"stop_reason  {reply.stop_reason}",
        f"tokens       {reply.input_tokens} in, {reply.output_tokens} out",
        f"latency      {reply.latency_s:.3f} s",
        f"model        {reply.model} ({reply.backend} backend)",
        f"cost         {usd(reply.cost_usd)}",
    ]
    if reply.model != REFERENCE_MODEL:
        same = reference_cost(reply.input_tokens, reply.output_tokens)
        lines.append(f"             the same tokens on {REFERENCE_MODEL} would cost {usd(same)}")
    if reply.tool_calls:
        lines.append(f"tool_calls   {[c.name for c in reply.tool_calls]}")
    if reply.stop_reason == "max_tokens":
        lines.append("note         the reply hit max_tokens and was cut off; raise --max-tokens. "
                     "On Claude, thinking counts toward max_tokens, so the text can even be empty.")
    return "\n".join(lines)


class Conversation:
    """A multi-turn chat. The model remembers nothing between calls: every call sends
    the whole of `messages`, which is why the input tokens grow with every turn."""

    def __init__(self, system: str | None = None, max_tokens: int = DEFAULT_MAX_TOKENS,
                 effort: str | None = None, temperature: float | None = None) -> None:
        self.system = system
        self.max_tokens = max_tokens
        self.effort = effort
        self.temperature = temperature
        self.reset()

    def reset(self) -> None:
        self.messages: list[dict[str, Any]] = []
        self.turns = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.cost_usd = 0.0

    def send(self, text: str) -> llm.Reply:
        self.messages.append({"role": "user", "content": text})
        # Send a copy, so a record of this request is not changed by later turns.
        reply = llm.chat(list(self.messages), system=self.system, max_tokens=self.max_tokens,
                         effort=self.effort, temperature=self.temperature)
        self.messages.append(reply.message())
        self.turns += 1
        self.input_tokens += reply.input_tokens
        self.output_tokens += reply.output_tokens
        self.cost_usd += reply.cost_usd
        return reply

    def usage_line(self, reply: llm.Reply) -> str:
        line = (f"(turn {self.turns}: {reply.input_tokens} in + {reply.output_tokens} out tokens, "
                f"{reply.latency_s:.3f} s, {usd(reply.cost_usd)}; "
                f"so far {self.input_tokens + self.output_tokens} tokens, {usd(self.cost_usd)}")
        if reply.model != REFERENCE_MODEL:
            same = reference_cost(self.input_tokens, self.output_tokens)
            line += f"; on {REFERENCE_MODEL} about {usd(same)}"
        line += ")"
        if reply.stop_reason != "end":
            line += f"\n(stop_reason {reply.stop_reason})"
        return line


HELP = "Empty line or /quit to stop, /reset to start again, /history to see what is sent."


def run_chat(lines: Iterable[str], conversation: Conversation,
             out: Callable[[str], None] = print) -> Conversation:
    """Read user lines and answer each one, keeping the conversation between turns."""
    for raw in lines:
        line = raw.strip()
        if line in ("", "/quit", "/exit"):
            break
        if line == "/reset":
            conversation.reset()
            out("(conversation cleared)")
            continue
        if line == "/history":
            shown = [{k: ("(the provider's own blocks, sent back as they came)" if k == "_raw" else v)
                      for k, v in m.items()} for m in conversation.messages]
            out(json.dumps(shown, indent=2))
            continue
        reply = conversation.send(line)
        out(f"model> {reply.text}")
        out(conversation.usage_line(reply))
    return conversation


def _stdin_lines() -> Iterable[str]:
    """Prompt for lines until end of input. Piped input is echoed so a transcript reads well."""
    echo = not sys.stdin.isatty()
    while True:
        try:
            line = input("you> ")
        except EOFError:
            print()
            return
        if echo:
            print(line)
        yield line


def fake_model(request: dict[str, Any]) -> Any:
    """Stand in for a model when LLM_BACKEND=fake, so every code path runs offline.

    It says what it received (how many messages, whether there was a system prompt) and
    repeats your last message. Like a real model it stops at max_tokens, counting about
    four characters per token. It understands nothing: it shows the plumbing, not a mind.
    """
    messages = request["messages"]
    said = messages[-1]["content"] if messages else ""
    system = request["system"]
    count = f"{len(messages)} message" + ("" if len(messages) == 1 else "s")
    seen = f'system prompt: "{system[:40]}"' if system else "no system prompt."
    text = f"[fake model] I received {count}; {seen} You said: {said}"
    limit = request["max_tokens"] * 4
    if len(text) > limit:
        return llm.Reply(text=text[:limit], stop_reason="max_tokens",
                         output_tokens=request["max_tokens"])
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("prompt", nargs="?", help="the message to send (leave out with --chat)")
    parser.add_argument("--system", help="a system prompt: standing instructions for the model")
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS,
                        help=f"the most tokens the reply may use (default {DEFAULT_MAX_TOKENS})")
    parser.add_argument("--effort", choices=["low", "medium", "high"],
                        help="Claude only: how hard to think before answering")
    parser.add_argument("--temperature", type=float,
                        help="Ollama only: sampling temperature (Claude ignores it)")
    parser.add_argument("--chat", action="store_true", help="hold a conversation")
    parser.add_argument("--show-request", action="store_true",
                        help="print what is sent before sending it")
    args = parser.parse_args(argv)

    try:
        backend = llm.backend_name()
    except llm.LLMError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if backend == "fake":
        llm.fake.responder = fake_model

    try:
        if args.chat:
            conversation = Conversation(args.system, args.max_tokens, args.effort, args.temperature)
            model = os.environ.get("LLM_MODEL", "").strip() or llm.DEFAULT_MODELS[backend]
            print(f"Chatting with {model} ({backend} backend). {HELP}")
            run_chat(_stdin_lines(), conversation)
            return 0
        if not args.prompt:
            parser.error("give a prompt, or use --chat")
        if args.show_request:
            request = {"system": args.system, "max_tokens": args.max_tokens,
                       "messages": [{"role": "user", "content": args.prompt}]}
            print("request", json.dumps(request, indent=2))
        reply = ask(args.prompt, system=args.system, max_tokens=args.max_tokens,
                    effort=args.effort, temperature=args.temperature)
    except llm.LLMError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(describe(reply))
    return 0


if __name__ == "__main__":
    sys.exit(main())
