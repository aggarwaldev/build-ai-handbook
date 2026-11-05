# %% [markdown]
# # Lab 9: tracing and cost
#
# Build a small tracer: every model call becomes a span with its tokens, cost and latency,
# spans nest into a tree, personal data is masked before anything is written, and a budget
# guard refuses a call before it could pass a cap. This notebook follows
# [Lab 9 in the book]({{BOOK}}lab-tracing.html): read each step there, then run it here. The
# code is in `labs/09-tracing/tracing.py`. On the fake backend every latency is tiny: read
# the shape of the tree and the token counts.

# %% [markdown]
# ## Step 1: a span is a context manager
#
# Open two nested spans with `with`, and read the file the tracer wrote. Each line is one
# span; the inner one names the outer one as its parent. This writes to a temporary folder.

# %%
import json, tempfile
sys.path.insert(0, str(root / "labs" / "09-tracing"))
import tracing
from common import llm

folder = Path(tempfile.mkdtemp())
with tracing.Tracer("notebook", out_dir=folder) as t:
    with t.span("outer"):
        with t.span("inner", note="hello"):
            pass
for line in t.path.read_text().splitlines():
    rec = json.loads(line)
    print(rec["name"], "| span", rec["span_id"], "| parent", rec["parent_id"], "|", rec["status"])

# %% [markdown]
# ## Step 2: every model call becomes a span
#
# Make a model call inside a span, without telling the tracer. The listener records it, and the
# span carries the fields the page lists.

# %%
with tracing.Tracer("one-call", out_dir=folder) as t:
    with t.span("ask"):
        llm.chat([{"role": "user", "content": "Say hello"}], max_tokens=64, effort="low")
spans = tracing.load_trace(t.path)
call = [s for s in spans if s["kind"] == "llm"][0]
print(json.dumps(call["attrs"], indent=2))

# %% [markdown]
# ## Step 3: one JSON line per span
#
# The file is plain JSON lines, so you can search it with `grep`. Children are written before
# their parents, because a span is written when it ends.

# %%
print([s["name"] for s in spans])
print(t.path.read_text().splitlines()[0][:200], "...")

# %% [markdown]
# ## Step 4: mask before you write
#
# `scrub` replaces values stored under sensitive key names whole, and runs a detector over
# every other string. Note that `input_tokens` survives: keys are matched exactly.

# %%
print(tracing.scrub({
    "email": "sam@example.com",
    "input_tokens": 48,
    "note": "Call me on 07700 900123 or write to sam@example.com",
}))

# %% [markdown]
# ## Step 5: summarise a run
#
# `percentile` uses the nearest-rank method. The page's worked example: five latencies give a
# p50 of 0.3 and a p95 of 0.5.

# %%
latencies = [0.5, 0.1, 0.4, 0.2, 0.3]
print(tracing.percentile(latencies, 50), tracing.percentile(latencies, 95))

# %% [markdown]
# ## Step 6: a budget guard that fails closed
#
# Ask the guard what one call could cost at worst, then try a cap that is too small. The guard
# raises before the call is made.

# %%
guard = tracing.BudgetGuard(cap_usd=0.0001)
messages = [{"role": "user", "content": "Plan a trip " * 20}]
print("worst case: $%.6f" % guard.worst_case(messages, None, 1024, "claude-haiku-5-5"))
try:
    guard.check(messages, None, 1024, "claude-haiku-5-5")
except tracing.BudgetExceeded as err:
    print("refused:", err)

# %% [markdown]
# ## Step 7: trace a run
#
# The page's demo: a small travel planner in four model calls. Read the tree top down; each
# model call hangs under the step that made it.

# %%
!LLM_BACKEND=fake python labs/09-tracing/tracing.py demo

# %% [markdown]
# Now the same demo with a cap of $0.001. The guard stops the run before the fourth call.

# %%
!LLM_BACKEND=fake python labs/09-tracing/tracing.py demo --cap 0.001

# %% [markdown]
# Summarise the most recent trace file:

# %%
!python labs/09-tracing/tracing.py summary

# %% [markdown]
# ## Run the tests

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 09-tracing

# %% [markdown]
# ## Experiments
#
# Try the experiments in the [Experiments section]({{BOOK}}lab-tracing.html#experiments). A quick
# one: find the smallest cap that lets the whole demo finish, by editing the numbers below.

# %%
for cap in (0.0005, 0.001, 0.002, 0.005):
    print("cap", cap)
    out = subprocess.run([sys.executable, "labs/09-tracing/tracing.py", "demo", "--cap", str(cap)],
                         check=True, stdout=subprocess.PIPE, text=True).stdout
    print("  ", [l for l in out.splitlines() if l.startswith(("calls:", "stopped:"))])

# %% [markdown]
# Then tick the lab's checklist in the book: your progress is kept in your browser, not in
# this notebook.
