# Lab 9: tracing and cost

The page that explains this lab is `lab-tracing.html` at the root of the book.

- `tracing.py`: nested spans, one span per model call (through `llm.add_listener`), traces
  written as JSON lines with personal data masked (Lab 7's masker), a summary with a span
  tree and p50/p95 latency, and a budget guard that refuses a call before it could pass a cap.
- `traces/`: where runs are written; git ignores it.
- `test_tracing.py`: the tests; they need no key and no network.

From the repository root:

```
LLM_BACKEND=fake python labs/09-tracing/tracing.py demo
LLM_BACKEND=fake python labs/09-tracing/tracing.py demo --cap 0.001
python labs/09-tracing/tracing.py summary
cd labs && python -m pytest 09-tracing
```
