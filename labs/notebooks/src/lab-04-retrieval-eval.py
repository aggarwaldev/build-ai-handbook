# %% [markdown]
# # Lab 4: measure your retrieval
#
# Score Lab 3's retriever on 25 labelled questions, add a keyword retriever and fuse the
# two, then put an error bar on every score. This notebook follows
# [Lab 4 in the book]({{BOOK}}lab-retrieval-eval.html): read each step there, then run it
# here. The code is in `labs/04-retrieval-eval/retrieval_eval.py`. No model is called, so it
# costs nothing on any backend.

# %% [markdown]
# ## Before you start: run the tests
#
# 13 tests should pass.

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 04-retrieval-eval

# %% [markdown]
# ## Step 1: labelled questions
#
# Each question names the sections that answer it. Print a direct question and a
# paraphrase, and count the kinds.

# %%
sys.path.insert(0, str(root / "labs" / "04-retrieval-eval"))
import retrieval_eval as ev
import rag
from collections import Counter

questions = ev.load_questions()
print(len(questions), "questions:", dict(Counter(q["kind"] for q in questions)))
for q in questions:
    if q["id"] in ("q13", "q14"):
        print(q)

# %% [markdown]
# ## Step 2: the metrics
#
# Chapter 26's worked example: relevance `0 1 0 1 0` with three relevant passages. Expect
# recall@5 = 0.667, a reciprocal rank of 0.5 and nDCG@5 = 0.498.

# %%
ranked = ["a", "b", "c", "d", "e"]
relevant = {"b", "d", "z"}
print("recall@5 ", round(ev.recall_at_k(ranked, relevant, 5), 3))
print("rr       ", ev.reciprocal_rank(ranked, relevant))
print("nDCG@5   ", round(ev.ndcg_at_k(ranked, relevant, 5), 3))

# %% [markdown]
# ## Step 3: a keyword retriever, BM25
#
# The page's check: chapter 25's three documents, split on whitespace, scored for "fixed
# deposit". Expect 0.894, 0.482 and 0.482.

# %%
docs = ["fixed deposit rates for one year", "deposit insurance covers your savings",
        "fixed income funds hold bonds"]
bm = ev.BM25(docs, tokenize=str.split)
print([round(s, 3) for s in bm.scores("fixed deposit")])

# %% [markdown]
# ## Step 4: fuse the two
#
# Reciprocal rank fusion adds `1 / (60 + rank)` from each list. A passage 1st by vectors
# and 3rd by keywords scores 0.03227 and loses to one 2nd and 1st, at 0.03252.

# %%
fused = dict(ev.rrf([["A", "B", "x"], ["B", "y", "A"]]))
print("A (1st, then 3rd):", round(fused["A"], 5))
print("B (2nd, then 1st):", round(fused["B"], 5))

# %% [markdown]
# ## Step 5: from chunks to sections
#
# Score one question by hand: build the three retrievers at 120 words, take the chunks
# for Lab 3's missed question, and turn them into sections. Look at where `loans#loan-periods`
# comes in each list.

# %%
chunks = rag.load_chunks(max_words=120)
section_of = {c.id: c.section for c in chunks}
retrievers = ev.build_retrievers(chunks)
question = "How long can I keep a book?"
for name, retriever in retrievers.items():
    ranked = ev.sections(retriever(question), section_of)
    print(f"{name:<6}", ranked[:5])
    print("       rank of loans#loan-periods:", ranked.index("loans#loan-periods") + 1)

# %% [markdown]
# ## Run it
#
# The whole report, as on the page: the metrics for each retriever at three chunk sizes,
# the hit rate by kind of question, and the paired MRR differences. It takes a few seconds.

# %%
!python labs/04-retrieval-eval/retrieval_eval.py

# %% [markdown]
# ## Step 6: how sure can you be?
#
# `bootstrap_ci` resamples the questions. This reproduces the TF-IDF row at 120 words: an
# MRR of 0.77 and an interval of roughly 0.63 to 0.90.

# %%
rows = ev.evaluate(questions, retrievers["tfidf"], section_of)
rr = [r["rr"] for r in rows]
low, high = ev.bootstrap_ci(rr)
print(f"tfidf MRR {ev.mean(rr):.2f}  95% CI [{low:.2f}, {high:.2f}]")

bm25_rr = [r["rr"] for r in ev.evaluate(questions, retrievers["bm25"], section_of)]
diff, lo, hi = ev.paired_difference(bm25_rr, rr)
print(f"bm25 - tfidf: {diff:+.3f}, 95% CI [{lo:+.3f}, {hi:+.3f}]  (contains 0: not shown to differ)")

# %% [markdown]
# `--per-question` adds the rank of each question's first relevant section. The questions
# every retriever misses are the ones to read first.

# %%
!python labs/04-retrieval-eval/retrieval_eval.py --per-question

# %% [markdown]
# ## Run the tests

# %%
!cd labs && python -m pytest -q -p no:cacheprovider 04-retrieval-eval

# %% [markdown]
# ## Experiments
#
# Try the [experiments on the lab page]({{BOOK}}lab-retrieval-eval.html#experiments). A quick
# one is to take the heading paths out: run with `--no-headings` and compare hit@1, MRR and
# the paraphrase column with the table above.

# %%
!python labs/04-retrieval-eval/retrieval_eval.py --no-headings

# %% [markdown]
# Then tick the lab's checklist in the book: your progress is kept in your browser, not in
# this notebook.
