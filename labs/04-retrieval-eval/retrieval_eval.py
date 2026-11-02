"""Lab 4: measure your retrieval.

Score retrievers on labelled questions about Lab 3's help pages: hit@k, recall@k, MRR and
nDCG@k, for TF-IDF, BM25 and their reciprocal rank fusion, at several chunk sizes. A
bootstrap interval shows how much 25 questions can and cannot tell you.

    python labs/04-retrieval-eval/retrieval_eval.py

No model is called. Everything here is counting and arithmetic, so it costs nothing and
gives the same numbers on every run. (--ollama adds Lab 3's optional local embedder.)
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "03-rag"))
import rag  # noqa: E402  (Lab 3's module)

QUESTIONS = Path(__file__).resolve().parent / "questions.jsonl"
DEPTH = 10  # each retriever returns its top 10 chunks; MRR counts 0 when nothing relevant is in them


# ---------------------------------------------------------------- metrics
# `ranked` is a list of section ids, best first, each at most once; `relevant` is a set.


def hit_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    """1 if any relevant section is in the top k, else 0."""
    return 1.0 if any(r in relevant for r in ranked[:k]) else 0.0


def precision_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    """Relevant sections in the top k, divided by k."""
    return sum(r in relevant for r in ranked[:k]) / k


def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    """Relevant sections in the top k, divided by all relevant sections."""
    return sum(r in relevant for r in ranked[:k]) / len(relevant)


def reciprocal_rank(ranked: list[str], relevant: set[str]) -> float:
    """1 / the rank of the first relevant section; 0 if there is none."""
    for rank, r in enumerate(ranked, start=1):
        if r in relevant:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    """Discounted gain of the top k (gain 1 per relevant section) over the best possible."""
    dcg = sum(1 / math.log2(rank + 1) for rank, r in enumerate(ranked[:k], start=1) if r in relevant)
    ideal = sum(1 / math.log2(rank + 1) for rank in range(1, min(len(relevant), k) + 1))
    return dcg / ideal


# ---------------------------------------------------------------- BM25


class BM25:
    """Keyword scoring, as worked by hand in chapter 25. Pure Python.

    For each query word: idf x f(k1 + 1) / (f + k1(1 - b + b len/avglen)), where
    idf = ln(1 + (N - n + 0.5) / (n + 0.5)), f is the word's count in the passage, N the
    number of passages and n the number containing the word.
    """

    def __init__(self, texts: list[str], k1: float = 1.2, b: float = 0.75,
                 tokenize: Callable[[str], list[str]] = rag.tokens):
        self.k1, self.b, self.tokenize = k1, b, tokenize
        docs = [tokenize(t) for t in texts]
        self.counts = [Counter(d) for d in docs]
        self.lengths = [len(d) for d in docs]
        self.avglen = sum(self.lengths) / len(docs)
        df = Counter(w for d in docs for w in set(d))
        n = len(docs)
        self.idf = {w: math.log(1 + (n - c + 0.5) / (c + 0.5)) for w, c in df.items()}

    def scores(self, query: str) -> list[float]:
        words = self.tokenize(query)
        out = []
        for counts, length in zip(self.counts, self.lengths):
            norm = self.k1 * (1 - self.b + self.b * length / self.avglen)
            out.append(sum(self.idf[w] * counts[w] * (self.k1 + 1) / (counts[w] + norm)
                           for w in words if counts[w]))
        return out

    def top(self, query: str, k: int) -> list[int]:
        """Positions of the k best passages that share at least one word with the query."""
        s = self.scores(query)
        order = sorted(range(len(s)), key=lambda i: -s[i])  # stable: ties keep passage order
        return [i for i in order if s[i] > 0][:k]


# ---------------------------------------------------------------- fusion


def rrf(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
    """Reciprocal rank fusion: each list gives an item 1 / (k + rank); add them up.

    Scores are ignored, only ranks count, so lists on different scales can be merged.
    """
    total: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            total[item] += 1 / (k + rank)
    return sorted(total.items(), key=lambda kv: -kv[1])


# ---------------------------------------------------------------- retrievers

Retriever = Callable[[str], list[str]]  # question -> chunk ids, best first


def build_retrievers(chunks: list[rag.Chunk], headings: bool = True,
                     use_ollama: bool = False) -> dict[str, Retriever]:
    """TF-IDF and BM25 over the same chunk texts, and their fusion."""
    ids = [c.id for c in chunks]
    tfidf_index = rag.Index(chunks, rag.TfidfEmbedder(), headings)
    bm25 = BM25([c.embed_text(headings) for c in chunks])

    def vector(index: rag.Index) -> Retriever:
        return lambda q: [h.chunk.id for h in index.search(q, DEPTH) if h.score > 0]

    retrievers: dict[str, Retriever] = {
        "tfidf": vector(tfidf_index),
        "bm25": lambda q: [ids[i] for i in bm25.top(q, DEPTH)],
    }
    retrievers["rrf"] = lambda q: [i for i, _ in rrf([retrievers["tfidf"](q), retrievers["bm25"](q)])][:DEPTH]
    if use_ollama:
        retrievers["ollama"] = vector(rag.Index(chunks, rag.OllamaEmbedder(), headings))
        retrievers["rrf-ollama"] = lambda q: [
            i for i, _ in rrf([retrievers["ollama"](q), retrievers["bm25"](q)])][:DEPTH]
    return retrievers


def sections(chunk_ids: list[str], section_of: dict[str, str]) -> list[str]:
    """Map chunks to their sections and keep each section once, at its best rank."""
    return list(dict.fromkeys(section_of[c] for c in chunk_ids))


# ---------------------------------------------------------------- evaluation


def load_questions(path: Path = QUESTIONS) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def score_question(ranked: list[str], relevant: set[str]) -> dict[str, float]:
    return {
        "hit@1": hit_at_k(ranked, relevant, 1),
        "hit@3": hit_at_k(ranked, relevant, 3),
        "recall@3": recall_at_k(ranked, relevant, 3),
        "rr": reciprocal_rank(ranked, relevant),
        "ndcg@5": ndcg_at_k(ranked, relevant, 5),
    }


def evaluate(questions: list[dict], retriever: Retriever, section_of: dict[str, str]) -> list[dict]:
    """One row per question: its metrics and the rank of its first relevant section."""
    rows = []
    for q in questions:
        ranked = sections(retriever(q["question"]), section_of)
        relevant = set(q["relevant"])
        first = next((n for n, s in enumerate(ranked, 1) if s in relevant), None)
        rows.append({"id": q["id"], "kind": q["kind"], "first": first, **score_question(ranked, relevant)})
    return rows


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def bootstrap_ci(values: list[float], n: int = 2000, seed: int = 0, level: float = 0.95) -> tuple[float, float]:
    """A percentile bootstrap interval for the mean.

    Draw len(values) questions with replacement, n times, and take the mean of each draw.
    The middle `level` of those means is the interval: how much the score could move with
    a different sample of questions of the same kind.
    """
    rng = random.Random(seed)
    m = len(values)
    means = sorted(mean([values[rng.randrange(m)] for _ in range(m)]) for _ in range(n))
    tail = (1 - level) / 2
    return means[int(n * tail)], means[int(n * (1 - tail)) - 1]


def paired_difference(a: list[float], b: list[float], n: int = 2000, seed: int = 0) -> tuple[float, float, float]:
    """Mean of a - b over the same questions, with a bootstrap interval for it."""
    diffs = [x - y for x, y in zip(a, b)]
    lo, hi = bootstrap_ci(diffs, n, seed)
    return mean(diffs), lo, hi


# ---------------------------------------------------------------- report


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Score retrievers on labelled questions about Lab 3's pages.")
    p.add_argument("--sizes", type=int, nargs="+", default=[20, 40, 120],
                   help="largest chunk in words, one run per size (default 20 40 120)")
    p.add_argument("--overlap", type=int, default=0, help="words shared by neighbouring pieces")
    p.add_argument("--no-headings", action="store_true", help="index the body without its heading path")
    p.add_argument("--ollama", action="store_true", help="also score Lab 3's Ollama embedder (needs Ollama)")
    p.add_argument("--per-question", action="store_true", help="show each question's first relevant rank")
    p.add_argument("--resamples", type=int, default=2000, help="bootstrap resamples (default 2000)")
    p.add_argument("--seed", type=int, default=0)
    a = p.parse_args(argv)

    questions = load_questions()
    kinds = Counter(q["kind"] for q in questions)
    print(f"{len(questions)} questions ({kinds['direct']} direct, {kinds['paraphrase']} paraphrase), "
          f"heading paths {'off' if a.no_headings else 'on'}, overlap {a.overlap}. No model is called.\n")

    results: dict[tuple[str, int], list[dict]] = {}
    print(f"{'retriever':<11}{'max words':>9}{'chunks':>8}{'hit@1':>7}{'hit@3':>7}{'recall@3':>10}"
          f"{'MRR':>7}  {'MRR 95% CI':<14}{'nDCG@5':>7}")
    for size in a.sizes:
        chunks = rag.load_chunks(max_words=size, overlap=a.overlap)
        section_of = {c.id: c.section for c in chunks}
        for name, retriever in build_retrievers(chunks, not a.no_headings, a.ollama).items():
            rows = results[(name, size)] = evaluate(questions, retriever, section_of)
            col = lambda key: [r[key] for r in rows]  # noqa: E731
            lo, hi = bootstrap_ci(col("rr"), a.resamples, a.seed)
            print(f"{name:<11}{size:>9}{len(chunks):>8}{mean(col('hit@1')):>7.2f}{mean(col('hit@3')):>7.2f}"
                  f"{mean(col('recall@3')):>10.2f}{mean(col('rr')):>7.2f}  [{lo:.2f}, {hi:.2f}]  "
                  f"{mean(col('ndcg@5')):>7.2f}")

    size = max(a.sizes)
    names = [n for (n, s) in results if s == size]
    print(f"\nhit@3 by kind of question, max words {size}")
    print(f"{'retriever':<11}{'direct':>8}{'paraphrase':>12}")
    for name in names:
        by_kind = {k: mean([r["hit@3"] for r in results[(name, size)] if r["kind"] == k]) for k in kinds}
        print(f"{name:<11}{by_kind['direct']:>8.2f}{by_kind['paraphrase']:>12.2f}")

    base = names[0]
    print(f"\nMRR difference from {base}, same {len(questions)} questions, max words {size}, "
          f"{a.resamples} resamples")
    for name in names[1:]:
        d, lo, hi = paired_difference([r["rr"] for r in results[(name, size)]],
                                      [r["rr"] for r in results[(base, size)]], a.resamples, a.seed)
        print(f"  {name} - {base}: {d:+.3f}, 95% CI [{lo:+.3f}, {hi:+.3f}]")

    if a.per_question:
        print(f"\nrank of the first relevant section (- = not in the top {DEPTH}), max words {size}")
        print(f"{'id':<5}{'kind':<12}" + "".join(f"{n:>11}" for n in names) + "  question")
        for i, q in enumerate(questions):
            ranks = "".join(f"{results[(n, size)][i]['first'] or '-':>11}" for n in names)
            print(f"{q['id']:<5}{q['kind']:<12}{ranks}  {q['question']}")


if __name__ == "__main__":
    try:
        main()
    except rag.llm.LLMError as exc:
        sys.exit(f"error: {exc}")
