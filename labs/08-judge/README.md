# Lab 8: an LLM judge you can trust

The page that explains this lab is `lab-judge.html` at the root of the book.

- `judge.py`: a pass/fail judge with a rubric and strict JSON parsing, measured against
  human labels: agreement, Cohen's kappa, a confusion matrix, recall per defect type and a
  position-bias test for a pairwise judge.
- `data/`: an invented rule card for a city library and 40 labelled answers, half of them
  with one planted defect.
- `test_judge.py`: the tests; they need no key and no network.

On the fake backend a keyword heuristic stands in for the model, so the numbers measure
the plumbing, not a model. From the repository root:

```
LLM_BACKEND=fake python labs/08-judge/judge.py run
python labs/08-judge/judge.py kappa-example
cd labs && python -m pytest 08-judge
```
