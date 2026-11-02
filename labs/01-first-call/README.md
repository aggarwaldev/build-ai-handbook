# Lab 1: your first model call

Send one message, add a system prompt, hold a conversation, and read every field of the reply:
the text, why the model stopped, the tokens, the latency and the cost. The walk-through is
`lab-first-call.html` in the book.

From the repository root:

    python labs/01-first-call/first_call.py "Say hello in five words"
    python labs/01-first-call/first_call.py --show-request --system "Answer in one sentence." "What is a token?"
    python labs/01-first-call/first_call.py --chat
    python labs/01-first-call/first_call.py --max-tokens 8 "Explain tokens in three paragraphs"

Tests, from `labs/`: `python -m pytest 01-first-call`. They use the fake backend.

Choose the backend first (`lab-setup.html`); `export LLM_BACKEND=fake` costs nothing.
