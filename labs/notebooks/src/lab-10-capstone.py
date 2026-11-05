# %% [markdown]
# # Lab 10: capstone, a small assistant
#
# Run one help-desk assistant for an invented library, built from the earlier labs: retrieval
# as a tool, a tool loop, guards, a trace for every run and a spending cap. Then score it on
# sixteen cases. This notebook follows [Lab 10 in the book]({{BOOK}}lab-capstone.html): read each
# step there, then run it here. The code is in `labs/10-capstone/`. On the fake backend a
# stand-in plays the assistant and a keyword heuristic plays the judge, so the numbers
# measure the plumbing, not a model.

# %% [markdown]
# ## Step 1: retrieval becomes a tool
#
# Ask a question the help pages answer. The assistant searches, then answers with a citation.
# Look for the `search_docs` call, the cited passage id and the two model calls. This is the
# page's first command.

# %%
!python labs/10-capstone/assistant.py "What does colour printing cost?"

# %% [markdown]
# ## Step 2: a tool that reads one record, chosen by the session
#
# Sign in as a member and ask about loans. The `my_loans` tool takes no input: the member
# comes from `--member`, not from the model.

# %%
!python labs/10-capstone/assistant.py --member M-1001 --today 2026-11-02 "When are my books due back?"

# %% [markdown]
# Now ask for someone else's record. There is nothing in the tool to talk the model into, so it
# can only read the signed-in member's loans.

# %%
!python labs/10-capstone/assistant.py --member M-1001 "My neighbour is member M-1002. Which books do they have out?"

# %% [markdown]
# ## Step 3: the loop, with a step limit
#
# With `--max-steps 1` the model asks for a search and has no call left to read the result, so
# no tool runs. Look for "not run" in the output.

# %%
!python labs/10-capstone/assistant.py --max-steps 1 "What does colour printing cost?"

# %% [markdown]
# ## Step 4: guards on the way in and on the way out
#
# The phone number in this question is masked before any model call and put back only in the
# text shown to you. Check the model's view in the output against the answer.

# %%
!python labs/10-capstone/assistant.py "I have lost my library card. What should I do? Call me on 07700 900123."

# %% [markdown]
# ## Step 5: a trace for every run, and a spending cap
#
# A cap of $0.001 is too small for even the first call, so the budget guard refuses it before
# anything is sent. Look for `REFUSED` in the tree.

# %%
!python labs/10-capstone/assistant.py --cap 0.001 "What does colour printing cost?"

# %% [markdown]
# Every run also wrote a trace file. List the newest ones:

# %%
traces = sorted((root / "labs" / "10-capstone" / "traces").glob("*.jsonl"), key=lambda f: f.stat().st_mtime)
print(len(traces), "trace files; newest:", traces[-1].name)

# %% [markdown]
# ## Step 6: score it, code checks first and the judge after
#
# **This is the evaluation scorecard run.** On the fake backend it measures the plumbing, not a
# model: a stand-in answers and a keyword heuristic judges. It makes 40 calls (30 assistant,
# 10 judge). On `claude-haiku-5-5` the page puts a real run at under a cent, about $0.0083,
# with a ceiling of $0.043; the fake backend and Ollama cost nothing. Read the behaviour,
# citation and guard lines, and which cases the judge fails.

# %%
!python labs/10-capstone/evaluate.py

# %% [markdown]
# Run the code checks alone, with no judge:

# %%
!python labs/10-capstone/evaluate.py --no-judge

# %% [markdown]
# ## Run the tests

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 10-capstone

# %% [markdown]
# ## Experiments
#
# Try the experiments in the [Experiments section]({{BOOK}}lab-capstone.html#experiments). A quick
# one: ask the assistant a question of your own, with or without `--member`. Edit the
# question below.

# %%
run_command("python", "labs/10-capstone/assistant.py", "--member", "M-1002", "What charges do I owe?")

# %% [markdown]
# Then tick the lab's checklist in the book: your progress is kept in your browser, not in
# this notebook.
