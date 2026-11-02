"""Tests for Lab 6.

The first half needs only the standard library: the sums in deposits.py and the JSON-RPC
helpers in wire.py. The second half talks to the real server through the MCP SDK and is
skipped when the SDK is not installed (pip install -r labs/06-mcp-server/requirements.txt).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


def load(name: str):
    """Import a file from this folder under a name no other lab's module can clash with."""
    spec = importlib.util.spec_from_file_location(f"mcp_lab_{name}", HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


deposits = load("deposits")
wire = load("wire")


# ---------------------------------------------------------------- no SDK needed


@pytest.mark.parametrize("principal, rate, years, value", [
    ("10000", "4.10", 1, "10410.00"),
    ("10000", "4.10", 2, "10836.81"),  # 10000 x 1.041 x 1.041
    ("10000", "4.10", 0, "10000.00"),
    ("0.125", "0", 0, "0.12"),          # half to even, so 0.125 rounds down
])
def test_compound_value(principal, rate, years, value):
    assert deposits.compound_value(principal, rate, years)["value"] == value


@pytest.mark.parametrize("principal, rate, years, message", [
    ("10000", "4.10", 99, "principal and rate_pct must be >= 0, and years between 0 and 50"),
    ("-5", "4.10", 1, "must be >= 0"),
    ("ten thousand", "4.10", 1, "must be decimal strings"),
    ("NaN", "4.10", 1, "must be decimal strings"),
    ("10000", "Infinity", 1, "must be decimal strings"),
    ("1e999999", "4.10", 50, "too large"),
])
def test_bad_arguments_get_a_message_the_model_can_act_on(principal, rate, years, message):
    with pytest.raises(deposits.InputError, match=message):
        deposits.compound_value(principal, rate, years)


def test_rate_rows_are_sorted_and_strings():
    rows = deposits.rate_rows()
    assert [r["bank"] for r in rows] == sorted(deposits.RATES)
    assert all(isinstance(r["rate_pct"], str) for r in rows)


def test_a_frame_is_one_line_even_when_the_text_has_newlines():
    message = wire.request(7, "tools/call", {"name": "echo", "arguments": {"text": "line one\nline two"}})
    framed = wire.frame(message)
    assert framed.count("\n") == 1 and framed.endswith("\n")
    assert json.loads(framed) == message


def test_requests_have_ids_and_notifications_do_not():
    assert wire.request(1, "tools/list") == {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    assert wire.request("d1", "server/discover", {})["id"] == "d1"
    assert "id" not in wire.notification("notifications/initialized")
    for bad in (None, True, 1.5):
        with pytest.raises(ValueError):
            wire.request(bad, "tools/list")


def test_the_modern_meta_names_version_capabilities_and_client():
    meta = wire.request_meta()
    assert meta["io.modelcontextprotocol/protocolVersion"] == "2026-07-28"
    assert set(meta) == {"io.modelcontextprotocol/protocolVersion",
                         "io.modelcontextprotocol/clientCapabilities",
                         "io.modelcontextprotocol/clientInfo"}


# ---------------------------------------------------------------- with the SDK


def dump(value) -> dict:
    """An SDK result as it travels on the wire (camelCase names, no empty fields)."""
    return value.model_dump(mode="json", by_alias=True, exclude_none=True)


def test_every_primitive_through_the_sdk_in_memory():
    pytest.importorskip("mcp")
    from mcp import Client

    server = load("server")

    async def session():
        async with Client(server.server) as client:
            tools = dump(await client.list_tools())["tools"]
            good = dump(await client.call_tool("compound_value",
                                               {"principal": "10000", "rate_pct": "4.10", "years": 1}))
            bad = dump(await client.call_tool("compound_value",
                                              {"principal": "10000", "rate_pct": "4.10", "years": 99}))
            resource = dump(await client.read_resource("rates://all"))
            prompt = dump(await client.get_prompt("compare_banks", {"amount": "500"}))
            return tools, good, bad, resource, prompt

    tools, good, bad, resource, prompt = asyncio.run(session())
    by_name = {t["name"]: t for t in tools}
    assert set(by_name) == {"list_rates", "compound_value"}
    schema = by_name["compound_value"]["inputSchema"]
    assert schema["required"] == ["principal", "rate_pct", "years"]
    assert by_name["compound_value"]["annotations"]["readOnlyHint"] is True
    assert good["isError"] is False and good["structuredContent"]["value"] == "10410.00"
    # an expected failure comes back as a result marked isError, with the reason in it
    assert bad["isError"] is True and "years between 0 and 50" in bad["content"][0]["text"]
    assert json.loads(resource["contents"][0]["text"])["rates_pct"] == deposits.RATES
    assert "500" in prompt["messages"][0]["content"]["text"]


def run_script(name: str, *args: str) -> str:
    done = subprocess.run([sys.executable, str(HERE / name), *args], capture_output=True,
                          text=True, timeout=120)
    assert done.returncode == 0, done.stderr[-2000:]
    return done.stdout


def test_wire_script_speaks_both_revisions_over_stdio():
    pytest.importorskip("mcp")
    lines = [line for line in run_script("wire.py").splitlines() if line.startswith("<< ")]
    replies = {json.loads(line[3:])["id"]: json.loads(line[3:]) for line in lines}
    assert replies[1]["result"]["protocolVersion"] == "2025-11-25"
    assert "2026-07-28" in replies["d1"]["result"]["supportedVersions"]
    for call_id in (3, "c1"):
        assert replies[call_id]["result"]["structuredContent"]["value"] == "10410.00"


def test_client_script_ends_with_the_error_result():
    pytest.importorskip("mcp")
    out = run_script("client.py")
    assert "compound_value with years=99 isError: True" in out
