"""Train a small neural network from scratch with NumPy only.

The network has two inputs, one hidden layer and one sigmoid output, and learns to tell the
two arms of a spiral apart. Everything a deep-learning library would do for you is written out:
the forward pass, binary cross-entropy, backpropagation, mini-batch gradient descent, a train
and validation split, and a gradient check that compares backprop with nudged losses.

From the repository root:

    python labs/numpy-neural-net/train.py                 # train with the defaults, print progress
    python labs/numpy-neural-net/train.py --hidden 32 --epochs 400 --lr 0.5
    python labs/numpy-neural-net/train.py --gradcheck     # check backprop against numerical slopes
    python labs/numpy-neural-net/train.py --plot          # also print the decision regions as text
    python labs/numpy-neural-net/train.py --raw           # skip input standardisation and watch it struggle

Needs only NumPy (see requirements.txt). Runs in a few seconds on a laptop CPU.
"""

from __future__ import annotations

import argparse

import numpy as np


def make_spiral(n_per_class: int, noise: float, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Two interleaved spiral arms in the square [-1, 1] x [-1, 1]; labels 0 and 1."""
    xs, ys = [], []
    for label in (0, 1):
        t = np.linspace(0.0, 1.0, n_per_class)
        radius = 0.1 + 0.85 * t
        angle = 2.5 * np.pi * t + label * np.pi
        points = np.stack([radius * np.cos(angle), radius * np.sin(angle)], axis=1)
        points += rng.normal(0.0, noise, points.shape)
        xs.append(points)
        ys.append(np.full(n_per_class, label))
    return np.concatenate(xs), np.concatenate(ys).astype(np.float64)


def split(x: np.ndarray, y: np.ndarray, val_share: float, rng: np.random.Generator):
    """Shuffle, then hold back val_share of the examples for validation."""
    order = rng.permutation(len(x))
    n_val = int(len(x) * val_share)
    val, train = order[:n_val], order[n_val:]
    return x[train], y[train], x[val], y[val]


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


class TinyNet:
    """inputs -> hidden (tanh) -> 1 output (sigmoid). Weights use Xavier initialisation."""

    def __init__(self, n_in: int, n_hidden: int, rng: np.random.Generator) -> None:
        lim1 = np.sqrt(6.0 / (n_in + n_hidden))
        lim2 = np.sqrt(6.0 / (n_hidden + 1))
        self.W1 = rng.uniform(-lim1, lim1, (n_in, n_hidden))
        self.b1 = np.zeros(n_hidden)
        self.W2 = rng.uniform(-lim2, lim2, (n_hidden, 1))
        self.b2 = np.zeros(1)

    def params(self) -> list[np.ndarray]:
        return [self.W1, self.b1, self.W2, self.b2]

    def forward(self, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Return (hidden activations, output probabilities). x has one example per row."""
        h = np.tanh(x @ self.W1 + self.b1)
        p = sigmoid(h @ self.W2 + self.b2).ravel()
        return h, p

    @staticmethod
    def loss(p: np.ndarray, y: np.ndarray) -> float:
        """Mean binary cross-entropy; the tiny epsilon stops log(0)."""
        eps = 1e-12
        return float(-np.mean(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps)))

    def gradients(self, x: np.ndarray, y: np.ndarray) -> tuple[float, list[np.ndarray]]:
        """Backpropagation for one batch. Returns the loss and one gradient per parameter."""
        n = len(x)
        h, p = self.forward(x)
        # Sigmoid with cross-entropy: d loss / d z_out = p - y (chapter 9), averaged over the batch.
        d_out = ((p - y) / n)[:, None]  # shape (n, 1)
        g_W2 = h.T @ d_out  # each weight's gradient: delta times the input it multiplied
        g_b2 = d_out.sum(axis=0)
        d_h = d_out @ self.W2.T  # back through the output weights
        d_z1 = d_h * (1.0 - h**2)  # back through tanh, whose slope is 1 - tanh^2
        g_W1 = x.T @ d_z1
        g_b1 = d_z1.sum(axis=0)
        return self.loss(p, y), [g_W1, g_b1, g_W2, g_b2]

    def accuracy(self, x: np.ndarray, y: np.ndarray) -> float:
        _, p = self.forward(x)
        return float(np.mean((p > 0.5) == (y > 0.5)))


def gradient_check(net: TinyNet, x: np.ndarray, y: np.ndarray, rng: np.random.Generator) -> float:
    """Compare backprop with (loss(w + e) - loss(w - e)) / 2e on a few random weights."""
    _, grads = net.gradients(x, y)
    worst = 0.0
    eps = 1e-5
    for param, grad in zip(net.params(), grads):
        for _ in range(5):
            idx = tuple(rng.integers(0, s) for s in param.shape)
            old = param[idx]
            param[idx] = old + eps
            up = net.loss(net.forward(x)[1], y)
            param[idx] = old - eps
            down = net.loss(net.forward(x)[1], y)
            param[idx] = old
            numeric = (up - down) / (2 * eps)
            rel = abs(numeric - grad[idx]) / max(1e-8, abs(numeric) + abs(grad[idx]))
            worst = max(worst, rel)
            print(f"  backprop {grad[idx]: .8f}   numerical {numeric: .8f}   relative gap {rel:.2e}")
    return worst


def ascii_plot(net: TinyNet, x: np.ndarray, y: np.ndarray, mu: np.ndarray, sd: np.ndarray, size: int = 31) -> str:
    """Decision regions as text: '.' and ':' for the two classes, 'o' and 'x' for points."""
    grid = np.linspace(-1, 1, size)
    xx, yy = np.meshgrid(grid, grid[::-1])
    _, p = net.forward((np.stack([xx.ravel(), yy.ravel()], axis=1) - mu) / sd)
    rows = [["." if v < 0.5 else ":" for v in p[i * size:(i + 1) * size]] for i in range(size)]
    for (px, py), label in zip(x, y):
        col = int(round((px + 1) / 2 * (size - 1)))
        row = int(round((1 - (py + 1) / 2) * (size - 1)))
        if 0 <= row < size and 0 <= col < size:
            rows[row][col] = "x" if label > 0.5 else "o"
    return "\n".join(" ".join(r) for r in rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--hidden", type=int, default=16, help="neurons in the hidden layer")
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--lr", type=float, default=0.5, help="learning rate")
    ap.add_argument("--batch", type=int, default=32, help="mini-batch size")
    ap.add_argument("--l2", type=float, default=0.0, help="weight decay strength")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--gradcheck", action="store_true", help="check backprop, then stop")
    ap.add_argument("--plot", action="store_true", help="print the decision regions at the end")
    ap.add_argument("--raw", action="store_true", help="do not standardise the inputs")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    x, y = make_spiral(200, noise=0.04, rng=rng)
    x_tr, y_tr, x_val, y_val = split(x, y, val_share=0.2, rng=rng)
    # Standardise with the training set's mean and spread only, then apply the same numbers to
    # validation (chapter 11: anything else leaks validation data into training).
    mu = np.zeros(2) if args.raw else x_tr.mean(axis=0)
    sd = np.ones(2) if args.raw else x_tr.std(axis=0)
    x_tr, x_val = (x_tr - mu) / sd, (x_val - mu) / sd
    net = TinyNet(2, args.hidden, rng)
    print(f"data: {len(x_tr)} training and {len(x_val)} validation points; "
          f"network 2 -> {args.hidden} -> 1 ({sum(p.size for p in net.params())} parameters)")

    if args.gradcheck:
        worst = gradient_check(net, x_tr[:20], y_tr[:20], rng)
        print(f"worst relative gap: {worst:.2e} ({'OK' if worst < 1e-5 else 'CHECK THE BACKPROP CODE'})")
        return

    best_val, best_epoch = float("inf"), 0
    for epoch in range(1, args.epochs + 1):
        order = rng.permutation(len(x_tr))
        for start in range(0, len(order), args.batch):
            batch = order[start:start + args.batch]
            _, grads = net.gradients(x_tr[batch], y_tr[batch])
            for param, grad in zip(net.params(), grads):
                param -= args.lr * (grad + args.l2 * param)  # in-place update
        if epoch == 1 or epoch % 25 == 0 or epoch == args.epochs:
            train_loss = net.loss(net.forward(x_tr)[1], y_tr)
            val_loss = net.loss(net.forward(x_val)[1], y_val)
            if val_loss < best_val:
                best_val, best_epoch = val_loss, epoch
            print(f"epoch {epoch:4d}  train loss {train_loss:.4f}  val loss {val_loss:.4f}  "
                  f"train acc {net.accuracy(x_tr, y_tr):.3f}  val acc {net.accuracy(x_val, y_val):.3f}")
    print(f"lowest validation loss {best_val:.4f} at epoch {best_epoch}")
    if args.plot:
        print(ascii_plot(net, x, y, mu, sd))


if __name__ == "__main__":
    main()
