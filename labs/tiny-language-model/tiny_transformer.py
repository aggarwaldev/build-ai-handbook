"""A tiny character-level transformer language model in PyTorch.

The same task as bigram.py, predict the next character, but each prediction may look back at
up to --block characters through causal self-attention. Every part of chapter 18 is written out
by hand so you can match it line by line: token and position tables, query/key/value
projections, the scaled scores, the causal mask, several heads, the MLP, pre-norm residual
blocks, and a final layer that scores every character.

From the repository root:

    python labs/tiny-language-model/tiny_transformer.py                         # train with the defaults, then sample
    python labs/tiny-language-model/tiny_transformer.py --steps 500             # a quick first run
    python labs/tiny-language-model/tiny_transformer.py --layers 4 --width 128  # a bigger model; watch validation loss
    python labs/tiny-language-model/tiny_transformer.py --text my_notes.txt     # any plain-text file

Needs PyTorch (see requirements.txt). Uses a CUDA or Apple-silicon GPU when one is available,
otherwise the CPU.
"""

from __future__ import annotations

import argparse
import math
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent


class CausalSelfAttention(nn.Module):
    """Multi-head attention where each position sees only itself and earlier positions."""

    def __init__(self, width: int, heads: int, block: int, dropout: float) -> None:
        super().__init__()
        assert width % heads == 0, "width must divide evenly into heads"
        self.heads = heads
        self.head_size = width // heads
        self.qkv = nn.Linear(width, 3 * width)  # W_Q, W_K and W_V side by side
        self.proj = nn.Linear(width, width)  # W_O, which mixes the heads back together
        self.drop = nn.Dropout(dropout)
        mask = torch.tril(torch.ones(block, block, dtype=torch.bool))
        self.register_buffer("mask", mask.view(1, 1, block, block), persistent=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, t, c = x.shape
        q, k, v = self.qkv(x).split(c, dim=2)
        # (b, t, c) -> (b, heads, t, head_size): each head works in its own smaller space.
        q = q.view(b, t, self.heads, self.head_size).transpose(1, 2)
        k = k.view(b, t, self.heads, self.head_size).transpose(1, 2)
        v = v.view(b, t, self.heads, self.head_size).transpose(1, 2)
        scores = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_size)  # (b, heads, t, t)
        scores = scores.masked_fill(~self.mask[:, :, :t, :t], float("-inf"))  # no peeking ahead
        weights = self.drop(F.softmax(scores, dim=-1))
        out = weights @ v  # weighted sum of values, (b, heads, t, head_size)
        out = out.transpose(1, 2).contiguous().view(b, t, c)  # join the heads end to end
        return self.drop(self.proj(out))


class MLP(nn.Module):
    """Widen to 4 x width, apply GELU, narrow back."""

    def __init__(self, width: int, dropout: float) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(width, 4 * width),
            nn.GELU(),
            nn.Linear(4 * width, width),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class Block(nn.Module):
    """x + attention(norm(x)), then x + mlp(norm(x)): the pre-norm transformer block."""

    def __init__(self, width: int, heads: int, block: int, dropout: float) -> None:
        super().__init__()
        self.norm1 = nn.LayerNorm(width)
        self.attn = CausalSelfAttention(width, heads, block, dropout)
        self.norm2 = nn.LayerNorm(width)
        self.mlp = MLP(width, dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.norm1(x))
        x = x + self.mlp(self.norm2(x))
        return x


class TinyLM(nn.Module):
    def __init__(self, vocab: int, width: int, heads: int, layers: int, block: int, dropout: float) -> None:
        super().__init__()
        self.block = block
        self.tok = nn.Embedding(vocab, width)  # one row per character
        self.pos = nn.Embedding(block, width)  # learned positions, one row per place
        self.drop = nn.Dropout(dropout)
        self.blocks = nn.ModuleList([Block(width, heads, block, dropout) for _ in range(layers)])
        self.norm = nn.LayerNorm(width)
        self.head = nn.Linear(width, vocab, bias=False)
        self.head.weight = self.tok.weight  # tied: the same table reads in and scores out

    def forward(self, idx: torch.Tensor, targets: torch.Tensor | None = None):
        b, t = idx.shape
        positions = torch.arange(t, device=idx.device)
        x = self.drop(self.tok(idx) + self.pos(positions))
        for blk in self.blocks:
            x = blk(x)
        logits = self.head(self.norm(x))  # (b, t, vocab): a score for every next character
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.view(b * t, -1), targets.view(b * t))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx: torch.Tensor, steps: int, temperature: float, top_k: int | None) -> torch.Tensor:
        for _ in range(steps):
            context = idx[:, -self.block:]  # the model only has positions for `block` characters
            logits, _ = self(context)
            logits = logits[:, -1, :] / temperature
            if top_k:
                kth = torch.topk(logits, min(top_k, logits.size(-1))).values[:, -1, None]
                logits = logits.masked_fill(logits < kth, float("-inf"))
            nxt = torch.multinomial(F.softmax(logits, dim=-1), num_samples=1)
            idx = torch.cat([idx, nxt], dim=1)
        return idx


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def batches(data: torch.Tensor, block: int, batch: int, gen: torch.Generator, device: str):
    """Random windows of block + 1 characters: inputs are the first block, targets are shifted by one."""
    starts = torch.randint(len(data) - block - 1, (batch,), generator=gen)
    x = torch.stack([data[i:i + block] for i in starts])
    y = torch.stack([data[i + 1:i + block + 1] for i in starts])
    return x.to(device), y.to(device)


@torch.no_grad()
def estimate(model: TinyLM, splits: dict[str, torch.Tensor], args, gen: torch.Generator, device: str) -> dict[str, float]:
    model.eval()
    out = {}
    for name, data in splits.items():
        losses = [model(*batches(data, args.block, args.batch, gen, device))[1].item() for _ in range(args.eval_batches)]
        out[name] = sum(losses) / len(losses)
    model.train()
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--text", type=Path, default=HERE / "data" / "savings.txt")
    ap.add_argument("--block", type=int, default=64, help="context length in characters")
    ap.add_argument("--width", type=int, default=64, help="model width d")
    ap.add_argument("--heads", type=int, default=4)
    ap.add_argument("--layers", type=int, default=2)
    ap.add_argument("--dropout", type=float, default=0.1)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--eval-every", type=int, default=200)
    ap.add_argument("--eval-batches", type=int, default=20)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--top-k", type=int, default=0, help="0 = no top-k cut")
    ap.add_argument("--length", type=int, default=400, help="characters to generate at the end")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    gen = torch.Generator().manual_seed(args.seed)
    device = pick_device()
    text = args.text.read_text(encoding="utf-8")
    vocab = sorted(set(text))
    stoi = {ch: i for i, ch in enumerate(vocab)}
    data = torch.tensor([stoi[ch] for ch in text], dtype=torch.long)
    cut = int(0.9 * len(data))
    splits = {"train": data[:cut], "val": data[cut:]}
    if len(splits["val"]) <= args.block + 1:
        raise SystemExit("the text is too short for this --block; use a longer text or a smaller block")

    model = TinyLM(len(vocab), args.width, args.heads, args.layers, args.block, args.dropout).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    tokens = args.steps * args.batch * args.block
    print(f"device {device}; {len(text)} characters, vocabulary {len(vocab)}; {n_params:,} parameters")
    print(f"training on {tokens:,} character positions: about 6 x N x D = {6 * n_params * tokens:.2e} operations")
    print(f"uniform guess: loss ln {len(vocab)} = {math.log(len(vocab)):.4f}")

    # AdamW with weight decay on matrices only, a short warmup and cosine decay (chapter 13).
    decay = [p for p in model.parameters() if p.dim() >= 2]
    no_decay = [p for p in model.parameters() if p.dim() < 2]
    opt = torch.optim.AdamW([{"params": decay, "weight_decay": 0.1}, {"params": no_decay, "weight_decay": 0.0}], lr=args.lr)
    warmup = max(1, args.steps // 20)

    def lr_at(step: int) -> float:
        if step < warmup:
            return args.lr * (step + 1) / warmup
        progress = (step - warmup) / max(1, args.steps - warmup)
        return args.lr * 0.5 * (1 + math.cos(math.pi * progress))

    best_val, best_step = float("inf"), 0
    start = time.time()
    for step in range(args.steps):
        for group in opt.param_groups:
            group["lr"] = lr_at(step)
        x, y = batches(splits["train"], args.block, args.batch, gen, device)
        _, loss = model(x, y)
        opt.zero_grad(set_to_none=True)
        loss.backward()  # the whole of chapter 12's backward pass, done for us
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if step % args.eval_every == 0 or step == args.steps - 1:
            est = estimate(model, splits, args, gen, device)
            if est["val"] < best_val:
                best_val, best_step = est["val"], step
            print(f"step {step:5d}  train loss {est['train']:.4f}  val loss {est['val']:.4f}  "
                  f"({time.time() - start:.0f} s)")
    print(f"lowest validation loss {best_val:.4f} (perplexity {math.exp(best_val):.2f}) at step {best_step}")

    model.eval()
    seed_text = text[: min(8, len(text))]
    idx = torch.tensor([[stoi[ch] for ch in seed_text]], dtype=torch.long, device=device)
    out = model.generate(idx, args.length, args.temperature, args.top_k or None)[0].tolist()
    print(f"\nsample at temperature {args.temperature:g}:\n")
    print("".join(vocab[i] for i in out))


if __name__ == "__main__":
    main()
