#!/usr/bin/env python3
"""Serve the Build AI handbook on 127.0.0.1, with in-page "Ask AI" answers if you want them.

The book works without this script: double-click book/index.html. Serve it when you want
- progress tracking that every browser keeps (some browsers refuse storage, or keep each
  page apart, for pages opened straight from disk), and
- "Ask AI" answers inside the page. Those use YOUR Anthropic key, so each answer costs a
  little. Without a key the server still serves the book.

    python3 tools/serve.py [--port 8765] [--cap 50] [--model claude-haiku-5-5]
    ANTHROPIC_API_KEY=... python3 tools/serve.py      # with in-page answers

Then open http://127.0.0.1:8765/ (the port you chose).

What it serves, and what it refuses:
- It listens on 127.0.0.1 only, so nothing else on your network can reach it.
- It serves files from the book/ folder, and only these kinds: .html .css .js .svg
  .png .jpg .woff2 .json .txt .md .py. A path with any part starting with "." (such as
  .git or .env) is refused, as is anything outside the folder and any directory listing.
- GET /health says the helper is running, whether a key is set (never the key), the
  model, and how many questions are left in this run.
- POST /ask sends the chapter title, the selected text and the question to the Anthropic
  Messages API and returns the answer text.
- Every request must carry this server's own Host (127.0.0.1:<port> or localhost:<port>),
  and /ask must also carry this server's own Origin. Anything else, including a missing or
  "null" Origin, is refused. There are no CORS headers, so no other site can call it.
- At most --cap questions per run (default 50).
- The key is read from the ANTHROPIC_API_KEY environment variable only. It is never sent to
  the page, written to a file, printed or logged.

About the model call: current Claude models think before they answer, and the thinking
counts toward max_tokens, so the limit is 2048 rather than a few hundred. They also reject
the temperature setting, so the request does not send one. Only the "text" blocks of the
reply are shown.

Standard library only: no packages to install.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlsplit

BOOK = Path(__file__).resolve().parent.parent / "book"
API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-haiku-5-5"
MAX_TOKENS = 2048
MAX_BODY_BYTES = 16_384
FIELD_LIMITS = {"title": 200, "selection": 4000, "question": 1000}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".woff2": "font/woff2",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".py": "text/plain; charset=utf-8",
}
SYSTEM_PROMPT = (
    "You are a patient tutor for a reader of the Build AI handbook, a free book that teaches "
    "how AI works and how to build with it, from school algebra to agents, with hands-on labs "
    "in Python. The reader selected a passage and asks about it. Answer in plain English with "
    "short sentences, show worked numbers before symbols, and keep to the question. If a small "
    "code example helps, keep it short and runnable. If you are not sure of something, say so."
)
NO_KEY_MESSAGE = (
    "no API key set: start tools/serve.py with ANTHROPIC_API_KEY in its environment, "
    "or use Copy prompt or Open in Claude"
)


class _Budget:
    def __init__(self, cap: int) -> None:
        self.cap = cap
        self.remaining = cap
        self._lock = threading.Lock()

    def take(self) -> bool:
        with self._lock:
            if self.remaining <= 0:
                return False
            self.remaining -= 1
            return True

    def give_back(self) -> None:
        with self._lock:
            self.remaining = min(self.cap, self.remaining + 1)


def _api_key() -> str:
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def static_target(request_path: str) -> Path | None:
    """The file a GET may serve for this URL path, or None if it must be refused.

    Refused: any path part starting with "." (.git, .env, "..", ".venv"), a file type not in
    CONTENT_TYPES, anything that resolves outside BOOK (symbolic links included), a missing
    file, and directories other than one holding index.html.
    """
    path = unquote(urlsplit(request_path).path)
    if "\x00" in path or "\\" in path:
        return None
    parts = [p for p in path.split("/") if p]
    if any(p.startswith(".") for p in parts):
        return None
    if not parts or path.endswith("/"):
        parts.append("index.html")
    candidate = BOOK.joinpath(*parts)
    if candidate.suffix.lower() not in CONTENT_TYPES:
        return None
    try:
        resolved = candidate.resolve(strict=True)
        rel = resolved.relative_to(BOOK)
    except (OSError, ValueError):
        return None
    if any(p.startswith(".") for p in rel.parts) or resolved.suffix.lower() not in CONTENT_TYPES:
        return None
    return resolved if resolved.is_file() else None


def _call_anthropic(key: str, model: str, title: str, selection: str, question: str) -> str:
    user_text = (
        f"Chapter: {title}\n\nSelected passage:\n\"\"\"\n{selection}\n\"\"\"\n\n"
        f"Question: {question or 'Please explain this passage in plain English.'}"
    )
    body = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_text}],
    }
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-api-key": key,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        reply = json.loads(response.read().decode("utf-8"))
    blocks = reply.get("content") or []
    # A reply can also hold "thinking" blocks; only "text" blocks are the answer.
    parts = [b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"]
    text = "\n\n".join(p.strip() for p in parts if isinstance(p, str) and p.strip())
    if text:
        return text
    stop = reply.get("stop_reason")
    if stop == "max_tokens":
        return "(The model used its whole token allowance, thinking included, before it wrote an answer. Try a narrower question.)"
    if stop == "refusal":
        return "(The model declined to answer this question.)"
    return "(The model returned no text.)"


def _api_error_message(exc: urllib.error.HTTPError) -> str:
    """The API's own error message, if it sent one. It never contains the key."""
    try:
        data = json.loads(exc.read().decode("utf-8"))
        message = str(data.get("error", {}).get("message", ""))[:300]
    except (ValueError, AttributeError, OSError):
        message = ""
    return f"the Anthropic API answered with HTTP {exc.code}" + (f": {message}" if message else "")


def make_handler(port: int, budget: _Budget, model: str) -> type[http.server.BaseHTTPRequestHandler]:
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "BuildAIHandbookHelper"
        sys_version = ""

        # Log the request line and status only: never headers or bodies.
        def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), format % args))

        def end_headers(self) -> None:
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            super().end_headers()

        def _json(self, status: int, payload: dict, head_only: bool = False) -> None:
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if not head_only:
                self.wfile.write(data)

        def _host_ok(self) -> bool:
            return (self.headers.get("Host") or "") in allowed_hosts

        def _serve(self, head_only: bool) -> None:
            if not self._host_ok():
                self._json(403, {"error": "refused: this helper only answers its own address"}, head_only)
                return
            if urlsplit(self.path).path == "/health":
                self._json(
                    200,
                    {
                        "service": "build-ai-handbook-helper",
                        "ask": True,
                        "key_set": bool(_api_key()),
                        "remaining": budget.remaining,
                        "cap": budget.cap,
                        "model": model,
                    },
                    head_only,
                )
                return
            target = static_target(self.path)
            if target is None:
                self._json(404, {"error": "not found"}, head_only)
                return
            try:
                data = target.read_bytes()
            except OSError:
                self._json(404, {"error": "not found"}, head_only)
                return
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPES[target.suffix.lower()])
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            if not head_only:
                self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802 - stdlib name
            self._serve(head_only=False)

        def do_HEAD(self) -> None:  # noqa: N802 - stdlib name
            self._serve(head_only=True)

        def do_POST(self) -> None:  # noqa: N802 - stdlib name
            if urlsplit(self.path).path != "/ask":
                self._json(404, {"error": "not found"})
                return
            host = self.headers.get("Host") or ""
            if host not in allowed_hosts:
                self._json(403, {"error": "refused: wrong Host"})
                return
            origin = self.headers.get("Origin") or ""
            if origin != f"http://{host}":
                self._json(403, {"error": "refused: the request must come from this page's own origin"})
                return
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                self._json(415, {"error": "send JSON"})
                return
            try:
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BODY_BYTES:
                self._json(413, {"error": f"the request body must be 1 to {MAX_BODY_BYTES} bytes"})
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._json(400, {"error": "the request body is not valid JSON"})
                return
            if not isinstance(payload, dict):
                self._json(400, {"error": "send a JSON object"})
                return
            fields: dict[str, str] = {}
            for name, limit in FIELD_LIMITS.items():
                value = payload.get(name, "")
                if not isinstance(value, str) or len(value) > limit:
                    self._json(400, {"error": f"{name} must be text of at most {limit} characters"})
                    return
                fields[name] = value.strip()
            if not fields["selection"]:
                self._json(400, {"error": "select some text first"})
                return
            key = _api_key()
            if not key:
                self._json(503, {"error": NO_KEY_MESSAGE})
                return
            if not budget.take():
                self._json(429, {"error": f"this run's cap of {budget.cap} questions is used up; restart the helper"})
                return
            try:
                answer = _call_anthropic(key, model, fields["title"], fields["selection"], fields["question"])
            except urllib.error.HTTPError as exc:
                budget.give_back()
                self._json(502, {"error": _api_error_message(exc)})
                return
            except (urllib.error.URLError, TimeoutError, OSError):
                budget.give_back()
                self._json(502, {"error": "could not reach the Anthropic API"})
                return
            except (ValueError, KeyError, AttributeError):
                self._json(502, {"error": "the Anthropic API reply could not be read"})
                return
            self._json(200, {"answer": answer, "remaining": budget.remaining})

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve the Build AI handbook on 127.0.0.1, with in-page Ask AI answers.")
    parser.add_argument("--port", type=int, default=8765, help="port on 127.0.0.1 (default 8765)")
    parser.add_argument("--cap", type=int, default=50, help="questions allowed per run (default 50)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Claude model for Ask AI answers (default {DEFAULT_MODEL})")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be 1 to 65535")
    if args.cap < 0:
        parser.error("--cap must be 0 or more")
    if not args.model.strip():
        parser.error("--model must name a model")
    budget = _Budget(args.cap)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.port, budget, args.model.strip()))
    key_note = (
        f"key set; Ask AI answers with {args.model.strip()}, cap {args.cap} questions"
        if _api_key()
        else "no ANTHROPIC_API_KEY: Ask AI offers Copy prompt and the Claude links instead"
    )
    print(f"Serving the Build AI handbook at http://127.0.0.1:{args.port}/  ({key_note})", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
