# Lab 10: capstone, a small assistant

The page that explains this lab is `lab-capstone.html` at the root of the book.

A help-desk assistant for the invented Brindlemere City Library, built from the earlier labs:
Lab 3's retrieval over `labs/03-rag/docs/`, a Lab 5 tool loop with two read-only tools
(`search_docs` and `my_loans`), Lab 7's guards, and Lab 9's tracer and budget guard. The
evaluation scores it with code checks first and Lab 8's judge after.

- `assistant.py`: the assistant; every run writes a trace to `traces/` (git ignores it).
- `evaluate.py`: 16 invented cases, code checks, then the judge, then a scorecard.
- `members.json`: three invented member records; `cases.jsonl`: the test cases.
- `test_capstone.py`: the tests; they need no key and no network.

On the fake backend a stand-in plays the model and a keyword heuristic plays the judge,
so the numbers measure the plumbing, not a model. From the repository root:

```
export LLM_BACKEND=fake
python labs/10-capstone/assistant.py "What does colour printing cost?"
python labs/10-capstone/assistant.py --member M-1001 "When are my books due back?"
python labs/10-capstone/assistant.py --cap 0.001 "What does colour printing cost?"
python labs/10-capstone/evaluate.py
cd labs && python -m pytest 10-capstone
```
