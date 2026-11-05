# Labs

The runnable code for the book. Each numbered lab has a page in Part V, "Build it" (open
`book/index.html`), and a folder here. Start with Lab 0, `book/lab-setup.html`.

## Set up once

    python3 -m venv .venv
    source .venv/bin/activate          # Windows: .venv\Scripts\activate
    python -m pip install -r labs/requirements.txt

## Choose who answers

Every lab talks to a model through `common/llm.py`. The `LLM_BACKEND` environment variable
chooses which one:

| `LLM_BACKEND` | Needs | Cost |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` in your shell | per token; default model `claude-haiku-5-5` |
| `ollama` | Ollama running and `ollama pull llama3.2` | free, on your computer |
| `fake` | nothing | free; scripted replies for reading code and for tests |

`LLM_MODEL` picks a model inside the backend, for example `claude-sonnet-5-5` or `llama3.1:8b`.
With neither `LLM_BACKEND` nor a key set, the labs use the fake backend and say so. Never put a
key in any file inside the repository.

## Run the tests

    cd labs
    python -m pytest

The tests always use the fake backend: no key, no network, no cost.

## The labs

Run each from the repository root.

| Lab | Page | Folder | Run |
| --- | --- | --- | --- |
| 0. Set up your workbench | `lab-setup.html` | | `python labs/01-first-call/first_call.py "Say hello in five words"` |
| 1. Your first model call | `lab-first-call.html` | `01-first-call/` | `python labs/01-first-call/first_call.py --chat` |
| 2. A prompt test bench | `lab-prompt-bench.html` | `02-prompt-bench/` | `python labs/02-prompt-bench/bench.py run v2` |
| 3. RAG from scratch | `lab-rag.html` | `03-rag/` | see the folder's README |
| 4. Measure your retrieval | `lab-retrieval-eval.html` | `04-retrieval-eval/` | see the folder's README |
| 5. Tools and an agent loop | `lab-agent.html` | `05-agent/` | see the folder's README |
| 6. Build an MCP server | `lab-mcp.html` | `06-mcp-server/` | see the folder's README |
| 7. Guardrails you can test | `lab-guardrails.html` | `07-guardrails/` | see the folder's README |
| 8. An LLM judge you can trust | `lab-judge.html` | `08-judge/` | see the folder's README |
| 9. Tracing and cost | `lab-tracing.html` | `09-tracing/` | see the folder's README |
| 10. Capstone: a small assistant | `lab-capstone.html` | `10-capstone/` | see the folder's README |

## Projects from earlier chapters

These have their own `requirements.txt` files.

| Chapter | Folder |
| --- | --- |
| 15. Project: train your own neural network | `numpy-neural-net/` |
| 20. Project: train your own tiny language model | `tiny-language-model/` |
| 30. MCP, basic and advanced | `06-mcp-server/` |
| 31. Skills | `skill-example/` |
| 41. Projects: LoRA fine-tune and distillation | `finetune-distil/` |
