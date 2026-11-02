# Lab 3: RAG from scratch

Chunk a small set of help pages, embed the chunks with TF-IDF (NumPy only), find the
nearest ones to a question, and ask a model to answer from them with citations that code
checks. The walkthrough is in `lab-rag.html`.

The pages in `docs/` are invented: Brindlemere City Library does not exist.

From the repository root, with no key and no network:

    LLM_BACKEND=fake python labs/03-rag/rag.py "How long can I keep a book?"
    LLM_BACKEND=fake python labs/03-rag/rag.py "What does colour printing cost?" --show-prompt

Options: `-k 5`, `--max-words 40`, `--overlap 10`, `--no-headings`, and `--embedder ollama`
for real embeddings from a local model (`ollama pull nomic-embed-text` first; set
`OLLAMA_EMBED_MODEL` to use another). Use `LLM_BACKEND=anthropic` or `ollama` for a real answer.

Test it: `cd labs && python -m pytest 03-rag`.
