# %% [markdown]
# # Lab 6: build an MCP server
#
# A tiny MCP server with two tools, a resource and a prompt, and two ways to talk to it. This
# notebook follows [Lab 6 in the book]({{BOOK}}lab-mcp.html): read each step there, then run
# it here. The code is in `labs/06-mcp-server/`. The lab makes no model calls and costs nothing.

# %%
# The MCP SDK is not in the shared requirements: install it only when it is missing.
try:
    import mcp  # noqa: F401
except ImportError:
    run_command("python", "-m", "pip", "install", "--quiet", "-r", "labs/06-mcp-server/requirements.txt")

# %% [markdown]
# ## Step 1: keep the logic plain
#
# `deposits.py` has no MCP in it, so call it directly. Ten thousand at 4.10% for one year is
# 10,410.00, and for two years 10,836.81. See [Step 1]({{BOOK}}lab-mcp.html#logic).

# %%
sys.path.insert(0, str(root / "labs" / "06-mcp-server"))
import deposits

print(deposits.RATES)
for years in (1, 2):
    print(deposits.compound_value("10000", "4.10", years))

# %% [markdown]
# A bad request raises the lab's own `InputError`, which the server will turn into a result
# the model can read.

# %%
try:
    deposits.compound_value("10000", "4.10", 99)
except deposits.InputError as err:
    print("InputError:", err)

# %% [markdown]
# ## Step 2: what a server exposes
#
# `server.py` builds two tools, a resource and a prompt with decorators. Print the decorators
# and the function names to see the three kinds side by side. See
# [Step 2]({{BOOK}}lab-mcp.html#server).

# %%
!grep -n -A1 "^@server\." labs/06-mcp-server/server.py

# %% [markdown]
# ## Step 3: the messages on the wire
#
# `wire.py` prints every raw JSON-RPC message, `>>` for the client and `<<` for the server,
# for both protocol revisions. Look for the handshake in the first half and the `_meta` block
# in the second. Each line is cut to 220 characters here. See
# [Step 3]({{BOOK}}lab-mcp.html#wire).

# %%
def run_cut(script, width):
    """Run a lab script, print each line of its output cut to `width` characters, and stop if it fails."""
    done = subprocess.run([sys.executable, script], capture_output=True, text=True)
    for line in done.stdout.splitlines():
        print(line[:width] + (" ..." if len(line) > width else ""))
    if done.returncode:
        print(done.stderr)
        raise RuntimeError(f"{script} failed")


run_cut("labs/06-mcp-server/wire.py", 220)

# %% [markdown]
# ## Step 4: use it through the SDK
#
# `client.py` starts the server and uses every primitive. The last call breaks a rule on
# purpose: look for `isError: True` and the reason beside it. See
# [Step 4]({{BOOK}}lab-mcp.html#client).

# %%
run_cut("labs/06-mcp-server/client.py", 300)

# %% [markdown]
# ## Step 5: the same server over HTTP
#
# Start the server on a spare port, send it a request from Python, then stop it. The second
# request carries a foreign `Origin` header and should get a 403. See
# [Step 5]({{BOOK}}lab-mcp.html#http).

# %%
import json, urllib.error, urllib.request

PORT = 8799
server = subprocess.Popen(
    [sys.executable, "labs/06-mcp-server/server.py", "--http", "--port", str(PORT)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
URL = f"http://127.0.0.1:{PORT}/mcp"
meta = {"io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": {"name": "notebook", "version": "0"}}
body = json.dumps({"jsonrpc": "2.0", "id": "d1", "method": "server/discover", "params": {"_meta": meta}}).encode()
headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
           "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover"}


def post(extra=None):
    request = urllib.request.Request(URL, data=body, headers={**headers, **(extra or {})}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read().decode()[:160]
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()[:160]


try:
    for _ in range(30):  # wait for the server to start listening
        try:
            first = post()
            break
        except OSError:
            time.sleep(0.5)
    print("plain request:  ", first)
    print("foreign Origin: ", post({"Origin": "https://attacker.example"}))
finally:
    server.terminate()
    server.wait(timeout=10)

# %% [markdown]
# ## Step 6: connect it to an MCP host
#
# A host is a separate application, so there is nothing to run here. Print the settings a
# host would need, using full paths and the Python that has `mcp` installed. See
# [Step 6]({{BOOK}}lab-mcp.html#host).

# %%
print(json.dumps({"mcpServers": {"handbook-rates": {
    "command": sys.executable,
    "args": [str(root / "labs" / "06-mcp-server" / "server.py")],
}}}, indent=2))

# %% [markdown]
# ## Run the tests

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 06-mcp-server

# %% [markdown]
# ## Experiments
#
# Try the experiments on the [lab page]({{BOOK}}lab-mcp.html#experiments), such as adding a
# tool of your own. To start, here is the sum for a deposit of your choice: change the numbers
# and run it, then try a principal the server should refuse. Then tick the lab's checklist in
# the book: your progress is kept in your browser, not in this notebook.

# %%
print(deposits.compound_value("2500", deposits.RATES["bank-c"], 5))
