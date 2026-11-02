"""Talk to server.py in raw JSON-RPC over stdio, so you can see every message on the wire.

    python labs/06-mcp-server/wire.py           # both: the 2025-11-25 handshake, then 2026-07-28
    python labs/06-mcp-server/wire.py legacy    # only the 2025-11-25 handshake
    python labs/06-mcp-server/wire.py modern    # only the 2026-07-28 per-request style

This file uses only the standard library: it starts server.py as a child process, writes one
JSON message per line to its stdin and reads one per line from its stdout, exactly as the stdio
transport specifies. ">>" marks a message the client sends, "<<" one the server sends.
(server.py itself needs the SDK: pip install -r labs/06-mcp-server/requirements.txt.)
"""

from __future__ import annotations

import json
import queue
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLIENT_INFO = {"name": "wire-client", "version": "0.1.0"}
TIMEOUT_S = 15


def request(request_id: str | int, method: str, params: dict[str, object] | None = None) -> dict[str, object]:
    """A JSON-RPC request: it has an id, and the server must answer it with the same id."""
    if not isinstance(request_id, (str, int)) or isinstance(request_id, bool):
        raise ValueError("a request id is a string or an integer, never null")
    message: dict[str, object] = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        message["params"] = params
    return message


def notification(method: str) -> dict[str, object]:
    """A JSON-RPC notification: no id, and no reply ever comes."""
    return {"jsonrpc": "2.0", "method": method}


def request_meta(version: str = "2026-07-28") -> dict[str, object]:
    """What a 2026-07-28 request carries in params._meta instead of a handshake."""
    return {
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
    }


def frame(message: dict[str, object]) -> str:
    """One message as the stdio transport sends it: JSON on one line, then a newline.

    json.dumps writes a newline inside a string as the two characters \\n, so the only real
    newline is the one that ends the message.
    """
    line = json.dumps(message)
    assert "\n" not in line
    return line + "\n"


class Wire:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, str(HERE / "server.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,  # the server may log to stderr; that is not an error
            text=True,
            encoding="utf-8",
        )
        self.lines: queue.Queue[str] = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            self.lines.put(line)

    def send(self, message: dict[str, object]) -> None:
        print(">> " + json.dumps(message))
        assert self.proc.stdin is not None
        self.proc.stdin.write(frame(message))
        self.proc.stdin.flush()

    def wait_for(self, request_id: object) -> dict[str, object]:
        while True:
            try:
                line = self.lines.get(timeout=TIMEOUT_S)
            except queue.Empty:
                raise SystemExit(f"no reply to request {request_id!r} within {TIMEOUT_S} s") from None
            message = json.loads(line)
            print("<< " + json.dumps(message))
            if message.get("id") == request_id:
                return message

    def close(self) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.close()  # end of input tells a stdio server to exit
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.terminate()
            self.proc.wait(timeout=5)


DEPOSIT = {"principal": "10000", "rate_pct": "4.10", "years": 1}


def legacy() -> None:
    print("\n-- 2025-11-25: initialize handshake, then requests")
    wire = Wire()
    try:
        wire.send(request(1, "initialize", {
            "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": CLIENT_INFO}))
        wire.wait_for(1)
        wire.send(notification("notifications/initialized"))
        wire.send(request(2, "tools/list"))
        wire.wait_for(2)
        wire.send(request(3, "tools/call", {"name": "compound_value", "arguments": DEPOSIT}))
        wire.wait_for(3)
    finally:
        wire.close()


def modern() -> None:
    print("\n-- 2026-07-28: no handshake; every request names its version in _meta")
    wire = Wire()
    try:
        wire.send(request("d1", "server/discover", {"_meta": request_meta()}))
        wire.wait_for("d1")
        wire.send(request("c1", "tools/call", {
            "_meta": request_meta(), "name": "compound_value", "arguments": DEPOSIT}))
        wire.wait_for("c1")
    finally:
        wire.close()


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    if which in ("legacy", "both"):
        legacy()
    if which in ("modern", "both"):
        modern()
