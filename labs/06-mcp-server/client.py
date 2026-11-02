"""Connect to server.py over stdio with the official SDK and use every primitive it offers.

    python labs/06-mcp-server/client.py

The client launches server.py as a child process, the way a desktop host launches a local MCP
server, then lists and calls its tools, reads its resource and fetches its prompt. The last call
breaks a rule on purpose, to show how a tool error comes back: as a normal result marked as an
error, which the model can read and recover from.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from mcp import Client, StdioServerParameters

HERE = Path(__file__).resolve().parent


def wire(value: object) -> dict:
    """The message as it travels on the wire: camelCase field names, no empty fields."""
    return value.model_dump(mode="json", by_alias=True, exclude_none=True)  # type: ignore[attr-defined]


def text_of(result: dict) -> str:
    return "".join(block.get("text", "") for block in result.get("content", []))


async def main() -> None:
    params = StdioServerParameters(command=sys.executable, args=[str(HERE / "server.py")])
    async with Client(params) as client:
        print("protocol version:", client.protocol_version)
        info = client.server_info
        print("server:", info.name if info else None, info.version if info else None)

        tools = wire(await client.list_tools())["tools"]
        for tool in tools:
            print(f"tool {tool['name']}: {tool['description'].splitlines()[0]}")
            print("   hints:", json.dumps(tool.get("annotations", {}), sort_keys=True))
        schema = next(t["inputSchema"] for t in tools if t["name"] == "compound_value")
        print("compound_value inputSchema:", json.dumps(schema, sort_keys=True))

        rates = wire(await client.call_tool("list_rates", {}))
        print("\nlist_rates isError:", rates["isError"])
        print(text_of(rates))

        value = wire(await client.call_tool(
            "compound_value", {"principal": "10000", "rate_pct": "4.10", "years": 1}
        ))
        print("\ncompound_value isError:", value["isError"])
        print(text_of(value))

        resource = wire(await client.read_resource("rates://all"))
        print("\nresource rates://all:", resource["contents"][0]["text"])

        prompt = wire(await client.get_prompt("compare_banks", {"amount": "10000"}))
        print("\nprompt compare_banks:", prompt["messages"][0]["content"]["text"])

        broken = wire(await client.call_tool(
            "compound_value", {"principal": "10000", "rate_pct": "4.10", "years": 99}
        ))
        print("\ncompound_value with years=99 isError:", broken["isError"])
        print(text_of(broken))


if __name__ == "__main__":
    asyncio.run(main())
