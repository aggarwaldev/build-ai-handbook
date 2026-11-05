#!/usr/bin/env python3
"""Serve the Build AI handbook on 127.0.0.1.

The book works without this script: double-click book/index.html. Serve it when your
browser keeps no progress for pages opened straight from disk. Chrome and Edge keep it;
Firefox and Safari may refuse storage for such pages, or keep each page separately. Pages
served from http://127.0.0.1 keep progress in every browser.

    python3 tools/serve.py [--port 8765]

Then open http://127.0.0.1:8765/ (the port you chose).

What it serves, and what it refuses:
- It listens on 127.0.0.1 only, so nothing else on your network can reach it.
- It serves files from the book/ folder, and only these kinds: .html .css .js .svg
  .png .jpg .woff2 .json .txt .md .py. A path with any part starting with "." (such as
  .git or .env) is refused, as is anything outside the folder and any directory listing.
- Every request must carry this server's own Host (127.0.0.1:<port> or localhost:<port>).
  Anything else is refused.
- It answers GET and HEAD only, and it holds no keys: Ask AI's answers in the page go from
  the browser straight to Anthropic, with the key the reader typed into the panel.

Standard library only: no packages to install.
"""

from __future__ import annotations

import argparse
import http.server
import json
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

BOOK = Path(__file__).resolve().parent.parent / "book"
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


def make_handler(port: int) -> type[http.server.BaseHTTPRequestHandler]:
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "BuildAIHandbook"
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
                self._json(403, {"error": "refused: this server only answers its own address"}, head_only)
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

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve the Build AI handbook on 127.0.0.1.")
    parser.add_argument("--port", type=int, default=8765, help="port on 127.0.0.1 (default 8765)")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be 1 to 65535")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.port))
    print(f"Serving the Build AI handbook at http://127.0.0.1:{args.port}/", flush=True)
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
