# %% [markdown]
# # Lab 5: tools and an agent loop
#
# Give a model four tools and a loop, and watch every step go by: the tool definitions, the
# checks on each request, the approval in front of an order, and the step limit. This notebook
# follows [Lab 5 in the book]({{BOOK}}lab-agent.html): read each step there, then run it here.
# The code is in `labs/05-agent/agent.py`.

# %% [markdown]
# ## Step 1: describe the tools
#
# Import the lab's module and print what the model sees of each tool: a name, a description
# and an input schema. The function behind each tool is never shown to it. See
# [Step 1]({{BOOK}}lab-agent.html#tools).

# %%
sys.path.insert(0, str(root / "labs" / "05-agent"))
import json
import agent
from common import llm

for tool in agent.TOOLS:
    spec = tool.spec()
    print(f"{spec['name']:<18} side effect: {tool.side_effect!s:<5} | {spec['description'][:70]}...")

# %% [markdown]
# ## Step 2: a calculator that cannot run code
#
# Call `calculate` directly. The sum is exact, and anything that is not arithmetic comes back
# as an error, however it is dressed up. See [Step 2]({{BOOK}}lab-agent.html#calculator).

# %%
for expression in ["2 * 6.49 + 18.50", "0.1 + 0.2", "2 x 6.49 + 18.50", "__import__('os').system('echo hi')", "1 / 0"]:
    try:
        print(f"{expression!r:<42} ->", agent.calculate(expression)["value"])
    except agent.ToolInputError as err:
        print(f"{expression!r:<42} -> error:", err)

# %% [markdown]
# ## Step 3: check every request before it runs
#
# `run_tool` turns every failure into an error result the model can read. Send it a request
# with a bad quantity and one for a tool that does not exist. See
# [Step 3]({{BOOK}}lab-agent.html#check).

# %%
bad_quantity = llm.ToolCall("t1", "place_order", {"items": [{"sku": "TUB-700-28", "quantity": 99}]})
unknown_tool = llm.ToolCall("t2", "weather", {"city": "York"})
for call in (bad_quantity, unknown_tool):
    out = agent.run_tool(call, approve=lambda c: False)
    print(out["is_error"], "|", out["content"])

# %% [markdown]
# ## Step 4: a person approves side effects
#
# The lab asks `y/N` on the keyboard. A notebook cannot wait for a keyboard, so these cells
# pipe the answer in: `n` first, then `y`. Look for the error result after the refusal and the
# order reference after the yes. See [Step 4]({{BOOK}}lab-agent.html#approval).

# %%
!printf 'n\n' | python labs/05-agent/agent.py --demo order --today 2026-11-02

# %%
!printf 'y\n' | python labs/05-agent/agent.py --demo order --today 2026-11-02

# %% [markdown]
# ## Step 5: the loop
#
# Run the demo question: the model asks for tools, the code runs them and sends the results
# back, until it answers. Watch the bad sum in step 2 come back as an error and be corrected,
# and the input tokens climb with every call. See [Step 5]({{BOOK}}lab-agent.html#loop).

# %%
!python labs/05-agent/agent.py --today 2026-11-02

# %% [markdown]
# Now the step limit. With `--max-steps 2` the loop stops before running the second request.

# %%
!python labs/05-agent/agent.py --max-steps 2 --today 2026-11-02

# %% [markdown]
# ## Step 6: a stand-in model for offline runs
#
# On the fake backend the lab plays the model with `pretend_model`, set the way the script
# does it. Run the loop from Python and read the `Run` it returns. See
# [Step 6]({{BOOK}}lab-agent.html#fake).

# %%
from datetime import date

if llm.backend_name() == "fake":
    llm.fake.responder = agent.pretend_model

run = agent.run_agent(agent.DEMOS["quote"], today=date(2026, 11, 2), say=lambda line: None)
print("stop:   ", run.stop)
print("answer: ", run.answer)
print("calls:  ", run.calls, "| tokens in/out:", run.input_tokens, "/", run.output_tokens)

# %% [markdown]
# ## Run the tests

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 05-agent

# %% [markdown]
# ## Experiments
#
# Try the experiments on the [lab page]({{BOOK}}lab-agent.html#experiments). To start the
# first one, predict which request is left unrun with `--max-steps 3`, then run it here. The
# fake backend costs nothing, and neither does Ollama.

# %%
!python labs/05-agent/agent.py --max-steps 3 --today 2026-11-02

# %% [markdown]
# Then tick the lab's checklist in the book: your progress is kept in your browser, not in
# this notebook.
