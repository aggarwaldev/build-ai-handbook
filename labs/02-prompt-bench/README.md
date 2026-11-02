# Lab 2: a prompt test bench

Score prompt versions over 30 labelled cases (support-desk messages for an invented bike repair
shop, sorted into six categories as JSON), save each run, and compare two runs case by case.
The walk-through is `lab-prompt-bench.html` in the book.

- `cases.jsonl`: the labelled cases. Leave it as it is (the tests check it); put your own cases
  in another file and pass `--cases`.
- `prompts/v1.txt`, `v2.txt`, `v3.txt`: the prompt versions, sent as the system prompt.
- `bench.py`: `run`, `list` and `compare`. Runs are saved in `runs/`, which git ignores.

From the repository root:

    python labs/02-prompt-bench/bench.py run v2
    python labs/02-prompt-bench/bench.py run v3 --limit 5 -v
    python labs/02-prompt-bench/bench.py list
    python labs/02-prompt-bench/bench.py compare <run A> <run B>

Tests, from `labs/`: `python -m pytest 02-prompt-bench`.

With `LLM_BACKEND=fake`, keyword rules stand in for the model: the numbers then test the
bench's plumbing, not a model or a prompt. Run on Claude or Ollama to compare prompts.
