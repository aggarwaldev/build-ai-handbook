# %% [markdown]
# # Lab 2: a prompt test bench
#
# Score prompt versions over 30 labelled cases, save each run and compare two runs case by
# case. This notebook follows [Lab 2 in the book]({{BOOK}}lab-prompt-bench.html): read each
# step there, then run it here. The code is in `labs/02-prompt-bench/bench.py`.
#
# On the fake backend, keyword rules stand in for the model, so the numbers test the
# bench's plumbing, not a prompt. Run on Claude or Ollama to compare prompts.

# %% [markdown]
# ## Step 1: cases with a right answer
#
# Each line of `cases.jsonl` is a message and its correct category. Look at the first few,
# and at how many cases each category has.

# %%
sys.path.insert(0, str(root / "labs" / "02-prompt-bench"))
import bench
from collections import Counter

cases = bench.load_cases()
for case in cases[:3]:
    print(case)
print(len(cases), "cases:", dict(Counter(c["label"] for c in cases)))

# %% [markdown]
# ## Step 2: prompt versions in files
#
# Each version is a text file sent as the system prompt; the message is wrapped the same
# way every time. Print v1, then v2, and see what v2 adds.

# %%
for version in ("v1", "v2"):
    name, prompt = bench.load_prompt(version)
    print(f"--- {name} (sha {bench.fingerprint(prompt)}) ---")
    print(prompt)
print("--- the user turn ---")
print(bench.user_turn("Can I book my bike in?"))

# %% [markdown]
# ## Step 3: score each reply
#
# `parse_reply` reads a reply as `(category, json_ok)`, so format and accuracy are scored
# apart. Try a clean reply, a reply in a code fence and a bare answer.

# %%
for text in ('{"category": "booking"}',
             'Sure! ```json\n{"category": "quote"}\n```',
             "Category: parts.",
             "I think it is an appointment"):
    print(repr(text), "->", bench.parse_reply(text))

# %% [markdown]
# ## Step 4: the report
#
# `run` sends every case, scores every reply and prints a report. On the fake backend this
# is the page's v2 report: 22 of 30 right, quote the worst category.

# %%
!python labs/02-prompt-bench/bench.py run v2

# %% [markdown]
# `-v` shows every case as it is scored, and `--limit` tries a version on the first few
# cases. `--no-save` keeps the run out of `runs/`.

# %%
!python labs/02-prompt-bench/bench.py run v2 --limit 6 --no-save -v

# %% [markdown]
# ## Step 5: the fake model, and what its numbers mean
#
# The fake's keyword rules are in `bench.KEYWORD_RULES`, and the first rule with a matching
# word wins. It cannot read definitions or examples, which is why v2 and v3 will score the
# same in the next step.

# %%
for label, words in bench.KEYWORD_RULES:
    print(f"{label:<10}", ", ".join(words))

# %% [markdown]
# ## Step 6: save runs and compare them case by case
#
# A real model would cost money here: one run is 30 calls, about half a cent on
# `claude-haiku-5-5` (the page works it out), and the fake backend and Ollama cost nothing.
# Run all three versions on the fake backend, then list them. The cell hides their reports,
# which you have seen.

# %%
!python labs/02-prompt-bench/bench.py run v1 > /dev/null 2>&1
!python labs/02-prompt-bench/bench.py run v2 > /dev/null 2>&1
!python labs/02-prompt-bench/bench.py run v3 > /dev/null 2>&1
!python labs/02-prompt-bench/bench.py list

# %% [markdown]
# `compare` needs two run names. This cell picks the newest run of each version from the
# saved runs, then compares v1 with v2: v2 fixes cases and breaks none.

# %%
def latest(version):
    runs = [bench.load_run(p.stem) for p in sorted(bench.RUNS.glob("*.json"))]
    return [r["id"] for r in runs if r["prompt"] == version][-1]

run_v1, run_v2, run_v3 = latest("v1"), latest("v2"), latest("v3")
run_command("python", "labs/02-prompt-bench/bench.py", "compare", run_v1, run_v2)

# %% [markdown]
# v2 against v3 changes nothing on the fake, as step 5 predicts. v3 does cost more input
# tokens per case, for no gain here.

# %%
run_command("python", "labs/02-prompt-bench/bench.py", "compare", run_v2, run_v3)

# %% [markdown]
# ## Step 7: why thirty cases is a small number
#
# `wilson` gives the 95% interval for a score. 22 of 30 is a band about 30 points wide, and
# 23 of 30 is almost the same band, so one more right answer proves nothing. The width
# shrinks only with the square root of the number of cases.

# %%
for k, n in ((22, 30), (23, 30), (75, 100), (225, 300), (900, 1200)):
    lo, hi = bench.wilson(k, n)
    print(f"{k:>4}/{n:<5} {lo:.3f} to {hi:.3f}   width {hi - lo:.3f}")

# %% [markdown]
# The sign test looks only at the cases that changed. Five fixed and none broken is
# still p = 0.0625, the worked example in chapter 26.

# %%
print("18 fixed, 0 broken:", bench.sign_test(18, 0))
print(" 5 fixed, 0 broken:", bench.sign_test(5, 0))

# %% [markdown]
# ## Run the tests

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 02-prompt-bench

# %% [markdown]
# ## Experiments
#
# Try the [experiments on the lab page]({{BOOK}}lab-prompt-bench.html#experiments). A quick one
# is to break the format on purpose: this copy of v2 loses its JSON instruction, so accuracy
# stays while JSON validity falls to nothing. The cell removes the copy afterwards.

# %%
_, v2_text = bench.load_prompt("v2")
lines = v2_text.rstrip("\n").split("\n")
nojson = bench.PROMPTS / "v2-nojson.txt"
nojson.write_text("\n".join(lines[:-2]) + "\n", encoding="utf-8")
try:
    run_command("python", "labs/02-prompt-bench/bench.py", "run", "v2-nojson", "--no-save")
finally:
    nojson.unlink()

# %% [markdown]
# Edit the cells above to try others, such as your own cases with `--cases`. Then tick the
# lab's checklist in the book: your progress is kept in your browser, not in this notebook.
