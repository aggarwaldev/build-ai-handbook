# Lab 4: measure your retrieval

Score Lab 3's retrieval on 25 labelled questions (`questions.jsonl`, invented): hit@k,
recall@k, MRR and nDCG@5 for TF-IDF, a pure-Python BM25 and their reciprocal rank fusion,
at several chunk sizes, with a bootstrap interval for MRR. No model is called, so it costs
nothing. The walkthrough is in `lab-retrieval-eval.html`.

From the repository root:

    python labs/04-retrieval-eval/retrieval_eval.py
    python labs/04-retrieval-eval/retrieval_eval.py --no-headings --per-question

Options: `--sizes 20 40 120`, `--overlap 10`, `--resamples 2000`, `--seed 0`, and `--ollama`
to add Lab 3's local embedder (needs Ollama running with `nomic-embed-text` pulled).

Test it: `cd labs && python -m pytest 04-retrieval-eval`.
