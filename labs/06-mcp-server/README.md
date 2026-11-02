# Lab 6: build an MCP server

A tiny MCP server with two read-only tools, one resource and one prompt over invented deposit
rates, and two ways to talk to it. The walkthrough is `lab-mcp.html` in the book.

- `deposits.py`: the rates and the compound-interest sum, plain Python with no MCP in it.
- `server.py`: exposes them over MCP with the official Python SDK (`mcp` 2.3.0).
- `client.py`: starts the server and uses every primitive through the SDK's `Client`.
- `wire.py`: standard library only; prints every raw JSON-RPC message, for both protocol revisions.

Run from the repository root (Python 3.10 or newer):

    pip install -r labs/06-mcp-server/requirements.txt
    python labs/06-mcp-server/client.py
    python labs/06-mcp-server/wire.py
    python labs/06-mcp-server/server.py --http      # Streamable HTTP at http://127.0.0.1:8000/mcp

Tests: `cd labs && python -m pytest 06-mcp-server`. Without the `mcp` package the three tests
that talk to the server are skipped; the rest still run.
