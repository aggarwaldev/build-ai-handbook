# Lab 7: guardrails you can test

The page that explains this lab is `book/lab-guardrails.html`.

- `guardrails.py`: masks emails, phone numbers and card numbers before a model call, flags
  and fences retrieved passages, checks the model's JSON reply, and fails closed.
- `data/`: three small invented labelled sets (personal data, passages, model replies).
- `test_guardrails.py`: the tests; they need no key and no network.

From the repository root:

```
python labs/07-guardrails/guardrails.py harness          # catch and false-alarm rates, no model
LLM_BACKEND=fake python labs/07-guardrails/guardrails.py ask "How much are late fees?"
cd labs && python -m pytest 07-guardrails
```
