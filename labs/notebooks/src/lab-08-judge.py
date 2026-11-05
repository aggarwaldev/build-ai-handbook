# %% [markdown]
# # Lab 8: an LLM judge you can trust
#
# Grade answers with a rubric, then test the judge against labels a person wrote, on defects
# you planted, and with each pair shown in both orders. This notebook follows
# [Lab 8 in the book]({{BOOK}}lab-judge.html): read each step there, then run it here. The
# code is in `labs/08-judge/judge.py`. On the fake backend a keyword heuristic stands in for
# the model, so the numbers measure the plumbing, not a model.

# %% [markdown]
# ## Step 1: a task, and labels you trust
#
# Look at one planted defect: the good answer and its copy with a wrong number, and the label
# a person gave each. The labels are the truth every number below is measured against.
# [Step 1]({{BOOK}}lab-judge.html#step-1) lists the four defect types.

# %%
sys.path.insert(0, str(root / "labs" / "08-judge"))
import judge
from common import llm

items = judge.load_items()
print(len(items), "labelled answers")
for item in items[:2]:
    print(item["id"], item["human_label"], item.get("defect"), "|", item["question"], "|", item["answer"])

# %% [markdown]
# ## Step 2: the judge prompt
#
# The rubric has four tests, the reason comes before the verdict, and the reply is one JSON
# object. Print the system prompt and the message the judge receives for one answer.

# %%
print(judge.JUDGE_SYSTEM)
print()
print(judge.judge_prompt(items[0]["question"], items[0]["answer"])[-300:])

# %% [markdown]
# ## Step 3: parse strictly, count what does not parse
#
# `parse_verdict` accepts exactly one JSON object with a `reason` and a `verdict`, and
# returns `None` for anything else. Try the replies the page lists; only the first is accepted.

# %%
replies = {
    "good": '{"reason": "all four tests hold", "verdict": "PASS"}',
    "prose first": 'Here you go: {"reason": "ok", "verdict": "PASS"}',
    "code fence": '```json\n{"reason": "ok", "verdict": "PASS"}\n```',
    "lower case": '{"reason": "ok", "verdict": "pass"}',
    "no reason": '{"verdict": "PASS"}',
    "extra key": '{"reason": "ok", "verdict": "PASS", "score": 9}',
}
for name, text in replies.items():
    print(f"{name:12}", judge.parse_verdict(text))

# %% [markdown]
# ## Step 4: agreement and Cohen's kappa
#
# The page's worked example: seven of ten verdicts agree, yet kappa is only 0.348. This is the
# page's own command.

# %%
!python labs/08-judge/judge.py kappa-example

# %% [markdown]
# Call `cohen_kappa` yourself. Perfect agreement gives 1, and a rater who gives one label to
# everything makes kappa undefined (`None`).

# %%
person = list("PPPPPPFFFF")
print(judge.cohen_kappa(person, list("PPPPPFFFPP")))
print(judge.cohen_kappa(person, person))
print(judge.cohen_kappa(list("PPPP"), list("PPPP")))

# %% [markdown]
# ## Step 5: which way does the judge err?
#
# The full run below prints the confusion matrix, recall per defect type and the position-bias
# count. **Cost:** it makes 80 calls. On `claude-haiku-5-5` the page puts that at about
# $0.0035, and at most $0.0848 if every reply used its whole `max_tokens`. The fake backend and
# Ollama cost nothing. Look for the one unparseable reply, and which defect types are missed.

# %%
!LLM_BACKEND=fake python labs/08-judge/judge.py run

# %% [markdown]
# ## Step 6: position bias in a pairwise judge
#
# Each (good, bad) pair was judged twice, once in each order. `position_flips` maps both
# replies back to the answer chosen and counts the pairs where the order decided. Try it on
# made-up replies: a "1" then a "2" means the same answer won both times.

# %%
print(judge.position_flips(["1", "1", "2", None], ["2", "1", "1", "2"]))

# %% [markdown]
# ## Run the tests
#
# The tests need no key and no network.

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 08-judge

# %% [markdown]
# ## Experiments
#
# Try the experiments in the [Experiments section]({{BOOK}}lab-judge.html#experiments). A quick one:
# edit the rubric in the cell below to a vague one and re-run the page's `run` command on a
# real model, then compare kappa. On the fake backend the heuristic ignores the rubric, so
# nothing changes there.

# %%
judge.JUDGE_SYSTEM = judge.JUDGE_SYSTEM.split("The answer passes only")[0] + (
    'Is this a good answer? Reply with one JSON object and nothing else:\n'
    '{"reason": "one short sentence", "verdict": "PASS" or "FAIL"}'
)
print(judge.JUDGE_SYSTEM)

# %% [markdown]
# Then tick the lab's checklist in the book: your progress is kept in your browser, not in
# this notebook.
