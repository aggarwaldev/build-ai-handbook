"""A character-level bigram language model in pure Python (no packages at all).

A bigram model predicts the next character from the current one only. It is the smallest
possible language model, and every idea of a large one is already here: a vocabulary, a table
of next-token probabilities, a cross-entropy loss on held-out text, perplexity, and sampling
with a temperature.

From the repository root:

    python labs/tiny-language-model/bigram.py                    # count, evaluate, then sample
    python labs/tiny-language-model/bigram.py --alpha 1          # more smoothing; compare the validation loss
    python labs/tiny-language-model/bigram.py --temperature 0.5  # calmer samples; try 1.5 for wilder ones
    python labs/tiny-language-model/bigram.py --after t          # the most likely characters after "t"
    python labs/tiny-language-model/bigram.py --learn            # learn the same table by gradient descent

The default text is data/savings.txt next to this file. Any plain-text file works with --text.
"""

from __future__ import annotations

import argparse
import math
import random
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def split_text(text: str, val_share: float) -> tuple[str, str]:
    """Keep the last val_share of the text for validation, so the two parts do not overlap."""
    cut = int(len(text) * (1 - val_share))
    return text[:cut], text[cut:]


class BigramModel:
    """Next-character probabilities from counts, with add-alpha smoothing.

    p(b | a) = (count(a, b) + alpha) / (count(a) + alpha * V)

    alpha = 0 is the plain maximum-likelihood estimate; it gives probability 0 to any pair
    never seen in training, and a single unseen pair in the validation text makes its loss
    infinite. alpha = 1 is the classic "add one" rule.
    """

    def __init__(self, vocab: list[str], alpha: float) -> None:
        self.vocab = vocab
        self.index = {ch: i for i, ch in enumerate(vocab)}
        self.alpha = alpha
        self.counts = Counter()
        self.row_totals = Counter()

    def fit(self, text: str) -> None:
        for a, b in zip(text, text[1:]):
            self.counts[(a, b)] += 1
            self.row_totals[a] += 1

    def prob(self, a: str, b: str) -> float:
        v = len(self.vocab)
        return (self.counts[(a, b)] + self.alpha) / (self.row_totals[a] + self.alpha * v)

    def row(self, a: str) -> list[float]:
        return [self.prob(a, b) for b in self.vocab]

    def loss(self, text: str) -> float:
        """Mean cross-entropy in nats per character: the average of -ln p(next | current)."""
        pairs = [(a, b) for a, b in zip(text, text[1:]) if a in self.index and b in self.index]
        total = 0.0
        for a, b in pairs:
            p = self.prob(a, b)
            if p == 0.0:
                return math.inf
            total -= math.log(p)
        return total / len(pairs)


def sample(row: list[float], temperature: float, rng: random.Random) -> int:
    """Draw an index from a probability row after applying a temperature.

    Dividing log-probabilities by T and renormalising is the same as raising each probability
    to the power 1/T: T < 1 sharpens the row, T > 1 flattens it.
    """
    logits = [math.log(p) / temperature if p > 0 else -math.inf for p in row]
    top = max(logits)
    weights = [math.exp(z - top) for z in logits]
    total = sum(weights)
    u = rng.random() * total
    acc = 0.0
    for i, w in enumerate(weights):
        acc += w
        if u < acc:
            return i
    return len(weights) - 1


def generate(model: BigramModel, start: str, length: int, temperature: float, rng: random.Random) -> str:
    out = [start]
    current = start
    for _ in range(length):
        nxt = model.vocab[sample(model.row(current), temperature, rng)]
        out.append(nxt)
        current = nxt
    return "".join(out)


def learn_by_gradient_descent(model: BigramModel, text: str, steps: int, lr: float) -> list[list[float]]:
    """Learn a V x V table of logits W so that softmax(W[a]) predicts the next character.

    This is a one-layer neural network whose input is a one-hot character. The loss is the
    mean cross-entropy over all training pairs, and its gradient for row a is

        (count(a) * softmax(W[a]) - counts of each b after a) / number of pairs

    which is "predicted minus actual" (chapter 9), added up over every pair starting with a.
    Without smoothing, the optimum is exactly the counting model with alpha = 0, so the loss
    should fall towards that model's training loss.
    """
    v = len(model.vocab)
    n_pairs = sum(model.row_totals.values())
    weights = [[0.0] * v for _ in range(v)]
    for step in range(1, steps + 1):
        total_loss = 0.0
        for i, a in enumerate(model.vocab):
            n_a = model.row_totals[a]
            if n_a == 0:
                continue
            row = weights[i]
            top = max(row)
            exps = [math.exp(z - top) for z in row]
            s = sum(exps)
            probs = [e / s for e in exps]
            for j, b in enumerate(model.vocab):
                c = model.counts[(a, b)]
                if c:
                    total_loss -= c * math.log(probs[j])
                grad = (n_a * probs[j] - c) / n_pairs
                row[j] -= lr * grad
        if step == 1 or step % max(1, steps // 10) == 0:
            print(f"  step {step:5d}  training loss {total_loss / n_pairs:.4f}")
    return weights


def show(ch: str) -> str:
    return {"\n": "\\n", " ": "\u2423"}.get(ch, ch)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--text", type=Path, default=HERE / "data" / "savings.txt", help="plain-text training file")
    ap.add_argument("--alpha", type=float, default=0.1, help="add-alpha smoothing (0 = none)")
    ap.add_argument("--val-share", type=float, default=0.1, help="share of the text kept for validation")
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--length", type=int, default=300, help="characters to generate")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--after", type=str, default=None, help="print the likeliest characters after this one")
    ap.add_argument("--learn", action="store_true", help="also learn the table by gradient descent")
    ap.add_argument("--steps", type=int, default=300, help="gradient-descent steps for --learn")
    ap.add_argument("--lr", type=float, default=50.0, help="learning rate for --learn")
    args = ap.parse_args()

    text = load_text(args.text)
    train, val = split_text(text, args.val_share)
    vocab = sorted(set(text))
    model = BigramModel(vocab, alpha=args.alpha)
    model.fit(train)
    v = len(vocab)
    print(f"text: {len(text)} characters, {v} distinct; training on {len(train)}, validating on {len(val)}")
    print(f"uniform guess: loss ln {v} = {math.log(v):.4f} nats, perplexity {v}")
    tr, va = model.loss(train), model.loss(val)
    print(f"bigram (alpha={args.alpha:g}): training loss {tr:.4f}, validation loss {va:.4f}, "
          f"validation perplexity {math.exp(va):.2f}" if math.isfinite(va) else
          f"bigram (alpha={args.alpha:g}): training loss {tr:.4f}, validation loss infinite "
          f"(an unseen pair got probability 0; use alpha > 0)")
    common = Counter({k: c for k, c in model.counts.items()}).most_common(8)
    print("most common pairs: " + ", ".join(f"'{show(a)}{show(b)}' {c}" for (a, b), c in common))

    if args.after is not None:
        a = args.after[:1] if args.after else " "
        if a not in model.index:
            print(f"'{a}' never appears in the text")
        else:
            ranked = sorted(zip(model.row(a), vocab), reverse=True)[:8]
            print(f"after '{show(a)}': " + ", ".join(f"{show(b)} {p:.3f}" for p, b in ranked))

    if args.learn:
        print(f"learning a {v} x {v} table of logits by gradient descent (lr {args.lr:g}, {args.steps} steps):")
        learn_by_gradient_descent(model, train, args.steps, args.lr)
        ml = BigramModel(vocab, alpha=0.0)
        ml.fit(train)
        print(f"  the counting model with alpha=0 has training loss {ml.loss(train):.4f}: the floor to aim for")

    rng = random.Random(args.seed)
    print(f"\nsample at temperature {args.temperature:g}:\n")
    print(generate(model, "T", args.length, args.temperature, rng))


if __name__ == "__main__":
    main()
