# %% [markdown]
# # Lab 0: set up your workbench
#
# Check that the labs can talk to a model, and see what they cost. This notebook follows
# [Lab 0 in the book]({{BOOK}}lab-setup.html): read each step there, then run it here.
# There is no lab folder for this lab: the shared adapter is `labs/common/llm.py`.

# %% [markdown]
# ## Step 1: Python and a virtual environment
#
# The setup cell below already did this part for you: it found Python, installed the three
# packages in `labs/requirements.txt` (`anthropic`, `numpy`, `pytest`) and put `labs/` on the
# path, so there is no virtual environment to create or activate. This cell only shows the
# Python version (the book asks for 3.10 or newer) and that the packages import.

# %%
import numpy, anthropic

print("python   ", sys.version.split()[0])
print("numpy    ", numpy.__version__)
print("anthropic", anthropic.__version__)
print("repo     ", root)

# %% [markdown]
# ## Step 2: choose who answers
#
# The setup cell set `LLM_BACKEND` from the `BACKEND` choice at its top. Which adapter is in
# use, and what answered, is what the labs print next to every reply. Look for the backend
# name and the model. To switch, change `BACKEND` in the setup cell and run it again.
# The [backend table]({{BOOK}}lab-setup.html#backend) compares the three.

# %%
from common import llm

print("LLM_BACKEND:", os.environ.get("LLM_BACKEND"))
print("adapter in use:", llm.backend_name())
print("model:", os.environ.get("LLM_MODEL") or llm.DEFAULT_MODELS[llm.backend_name()])

# %% [markdown]
# The labs read a few settings from the environment. Print them, hiding the key: this cell
# says only whether a key is set, never what it is.
# See [the settings table]({{BOOK}}lab-setup.html#settings).

# %%
print("LLM_BACKEND      ", os.environ.get("LLM_BACKEND", "(not set)"))
print("LLM_MODEL        ", os.environ.get("LLM_MODEL", "(not set: the backend's default)"))
print("ANTHROPIC_API_KEY", "set" if os.environ.get("ANTHROPIC_API_KEY") else "not set")
print("OLLAMA_HOST      ", os.environ.get("OLLAMA_HOST", "(not set: http://localhost:11434)"))

# %% [markdown]
# ## Step 3: prove it works
#
# First the tests. They run on the fake backend whatever you chose, so this costs nothing.
# The last line should say how many passed and none failed.

# %%
!cd labs && python -m pytest -q -p no:cacheprovider

# %% [markdown]
# Then one real call through the backend you chose, exactly as the page shows it. On the fake
# backend the reply repeats your words. On Claude or Ollama it is a real greeting. Check that
# `stop_reason` is `end` and that the `model` line names the model you meant.

# %%
!python labs/01-first-call/first_call.py "Say hello in five words"

# %% [markdown]
# ## What the labs cost
#
# Providers charge per token, with a higher price for the tokens the model writes. The
# adapter keeps the prices in `llm.PRICES_PER_MTOK`, and `llm.estimate_cost` turns token counts
# into dollars. This reproduces the page's worked example, a call that sends 1,000 tokens and
# gets 600 back, on each Claude model. See [what the labs cost]({{BOOK}}lab-setup.html#costs).

# %%
for model, (price_in, price_out) in llm.PRICES_PER_MTOK.items():
    cost = llm.estimate_cost(model, 1000, 600)
    print(f"{model:<20} ${price_in:>5.2f} in, ${price_out:>5.2f} out per million   1,000 in + 600 out = ${cost:.4f}")

# %% [markdown]
# The page's table gives an estimate for each lab on `claude-haiku-5-5`. Here is the idea in
# code: a lab's cost is its number of calls times the cost of one call. Change the numbers
# to budget your own run. Ollama and the fake backend cost nothing.

# %%
calls = 30            # for example, one Lab 2 run
input_tokens = 270    # per call
output_tokens = 300   # per call, allowing for the model's thinking
per_call = llm.estimate_cost("claude-haiku-5-5", input_tokens, output_tokens)
print(f"{calls} calls on claude-haiku-5-5: ${calls * per_call:.4f}")

# %% [markdown]
# ## Experiments
#
# If something does not work, the book's [troubleshooting table]({{BOOK}}lab-setup.html#troubleshooting)
# lists what each message means. Switch `BACKEND` in the setup cell and run the cells above
# again to compare the answers. Then tick the lab's checklist in the book: your progress is
# kept in your browser, not in this notebook.
