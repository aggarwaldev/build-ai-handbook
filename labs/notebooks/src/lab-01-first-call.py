# %% [markdown]
# # Lab 1: your first model call
#
# Send one message, add a system prompt, hold a conversation and read every field of the
# reply. This notebook follows [Lab 1 in the book]({{BOOK}}lab-first-call.html): read each
# step there, then run it here. The code is in `labs/01-first-call/first_call.py`.

# %% [markdown]
# ## Step 1: send one message
#
# The same command you would type in a terminal. On the fake backend the reply repeats what
# it received, which proves the message travelled.

# %%
!python labs/01-first-call/first_call.py "Say hello in five words"

# %% [markdown]
# ## Step 2: read the reply
#
# Call the lab's `ask()` from Python and look at the fields of the `Reply` it returns. On the
# fake backend, use the lab's own stand-in model, as the script does.

# %%
sys.path.insert(0, str(root / "labs" / "01-first-call"))
import first_call
from common import llm

if llm.backend_name() == "fake":
    llm.fake.responder = first_call.fake_model

reply = first_call.ask("What is a token? Answer in one sentence.")
print("text:       ", reply.text)
print("stop_reason:", reply.stop_reason)
print("tokens:     ", reply.input_tokens, "in,", reply.output_tokens, "out")
print("cost:       ", first_call.usd(reply.cost_usd))
print("on claude-haiku-5-5:", first_call.usd(first_call.reference_cost(reply.input_tokens, reply.output_tokens)))

# %% [markdown]
# ## Step 3: add a system prompt
#
# `--show-request` prints what is sent before sending it.

# %%
!python labs/01-first-call/first_call.py --show-request --system "Answer in one sentence." "What is a token?"

# %% [markdown]
# ## Step 4: hold a conversation
#
# A model remembers nothing between calls: the conversation is a list you keep and send
# whole every time. Watch the input tokens climb from turn to turn.

# %%
chat = first_call.Conversation(system="You are a friendly travel planner.")
_ = first_call.run_chat([
    "I am planning a three-day cycling trip.",
    "What should I pack?",
    "What did I say I was planning?",
], chat)

# %% [markdown]
# Print what the third call actually sent:

# %%
for message in chat.messages:
    print(message["role"], "|", str(message["content"])[:80])

# %% [markdown]
# ## Step 5: when max_tokens is too small
#
# The reply stops at the ceiling, mid-word if need be, and `stop_reason` says so.

# %%
!python labs/01-first-call/first_call.py --max-tokens 8 "Explain tokens in three paragraphs"

# %% [markdown]
# ## Step 6: compare backends
#
# Change `BACKEND` in the setup cell, run it again, then run the cells above. Compare the
# words, the token counts, the latency and the cost.
#
# ## Run the tests

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 01-first-call

# %% [markdown]
# ## Experiments
#
# Try the experiments on the lab page, for example a longer conversation or `effort="low"`
# on Claude, and edit the cells above to run them. Then tick the lab's checklist in the
# book: your progress is kept in your browser, not in this notebook.
