"""LoRA from scratch: adapt a trained network to a new task by training two thin matrices.

1. Pretrain a network (2 -> 64 -> 64 -> 3) on task A: three spiral arms.
2. Task B is the same spirals turned by 50 degrees, with only a few labelled examples, the way a
   model meets a slightly different kind of data after training.
3. Adapt to task B in three ways and compare: train every weight (full fine-tuning), train only
   the last layer, or freeze everything and train low-rank updates (LoRA).

LoRA replaces a frozen weight matrix W with W + (alpha / r) * A @ B, where A is (rows x r) and
B is (r x columns). B starts at zero, so training starts exactly from the pretrained network,
and only A and B change. With r much smaller than the matrix, that is far fewer numbers.

    python labs/finetune-distil/lora_numpy.py               # rank 2, the defaults
    python labs/finetune-distil/lora_numpy.py --rank 1      # how small can the update be?
    python labs/finetune-distil/lora_numpy.py --rank 8 --shots 20

Run these from the repository root. Needs only NumPy. Runs in well under a minute on a laptop CPU.
"""

from __future__ import annotations

import argparse

import numpy as np

from ftcommon import Adam, accuracy, backward, count, cross_entropy, forward, init_mlp, softmax, spiral

SIZES = [2, 64, 64, 3]


def train(params, x, y, names, lr, steps, values=None, weights_fn=None, grads_fn=None, rng=None):
    """Mini-batch training of the named arrays in `values` (default: the network itself).

    The two hooks let LoRA compute W from its parts and turn W's gradient into A's and B's.
    """
    opt = Adam(names, lr)
    rng = rng or np.random.default_rng(0)
    batch = min(64, len(x))
    for _ in range(steps):
        idx = rng.choice(len(x), batch, replace=False)
        weights = weights_fn() if weights_fn else None
        logits, acts = forward(params, x[idx], weights)
        dlogits = softmax(logits)
        dlogits[np.arange(batch), y[idx]] -= 1.0
        dlogits /= batch
        grads = backward(params, acts, dlogits, weights)
        if grads_fn:
            grads = grads_fn(grads)
        opt.step(values if values is not None else params, grads)


class Lora:
    """Low-rank updates for the chosen weight matrices of a frozen network."""

    def __init__(self, params, targets, rank, alpha, rng):
        self.params, self.targets, self.scale = params, targets, alpha / rank
        self.store = {}
        for name in targets:
            rows, cols = params[name].shape
            self.store[f"{name}_A"] = rng.normal(0.0, 1.0 / np.sqrt(rows), (rows, rank))
            self.store[f"{name}_B"] = np.zeros((rank, cols))  # zero: start from the pretrained W

    def weights(self):
        w = {k: v for k, v in self.params.items() if k.startswith("W")}
        for name in self.targets:
            w[name] = self.params[name] + self.scale * self.store[f"{name}_A"] @ self.store[f"{name}_B"]
        return w

    def grads(self, g):
        """Chain rule: dLoss/dA = scale * dW @ B.T and dLoss/dB = scale * A.T @ dW."""
        out = {}
        for name in self.targets:
            a, b = self.store[f"{name}_A"], self.store[f"{name}_B"]
            out[f"{name}_A"] = self.scale * g[name] @ b.T
            out[f"{name}_B"] = self.scale * a.T @ g[name]
        return out

    def merged(self):
        """After training, fold the update into W: no extra cost at inference time."""
        merged = {k: v.copy() for k, v in self.params.items()}
        merged.update({k: v for k, v in self.weights().items()})
        return merged


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rank", type=int, default=2)
    parser.add_argument("--alpha", type=float, default=4.0)
    parser.add_argument("--shots", type=int, default=30, help="labelled task-B examples per class")
    parser.add_argument("--steps", type=int, default=600)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    rng = np.random.default_rng(args.seed)

    xa, ya = spiral(300, 3, 0.03, rng)
    xa_test, ya_test = spiral(200, 3, 0.03, rng)
    xb, yb = spiral(args.shots, 3, 0.03, rng, turn_degrees=50)
    xb_test, yb_test = spiral(200, 3, 0.03, rng, turn_degrees=50)

    base = init_mlp(SIZES, rng)
    all_names = [k for k in base]
    train(base, xa, ya, all_names, lr=0.01, steps=3000, rng=rng)
    print(f"pretrained on task A: accuracy A {accuracy(base, xa_test, ya_test):.3f}, "
          f"B {accuracy(base, xb_test, yb_test):.3f}  ({count(base, all_names):,} weights)")
    print(f"task B training set: {len(xb)} examples\n")
    print(f"{'method':<34}{'trained':>9}{'acc B':>8}{'acc A':>8}")

    def report(label, model_params, trained, weights=None):
        acc_b = accuracy(model_params, xb_test, yb_test, weights)
        acc_a = accuracy(model_params, xa_test, ya_test, weights)
        print(f"{label:<34}{trained:>9,}{acc_b:>8.3f}{acc_a:>8.3f}")

    full = {k: v.copy() for k, v in base.items()}
    train(full, xb, yb, all_names, lr=0.01, steps=args.steps, rng=np.random.default_rng(2))
    report("full fine-tuning (every weight)", full, count(full, all_names))

    head = {k: v.copy() for k, v in base.items()}
    train(head, xb, yb, ["W3", "b3"], lr=0.01, steps=args.steps, rng=np.random.default_rng(2))
    report("last layer only", head, count(head, ["W3", "b3"]))

    frozen = {k: v.copy() for k, v in base.items()}
    lora = Lora(frozen, ["W1", "W2"], args.rank, args.alpha, np.random.default_rng(3))
    # The optimiser updates only the LoRA arrays; the network's own weights stay frozen.
    train(frozen, xb, yb, list(lora.store), lr=0.01, steps=args.steps, values=lora.store,
          weights_fn=lora.weights, grads_fn=lora.grads, rng=np.random.default_rng(2))
    report(f"LoRA rank {args.rank} on W1 and W2", frozen, count(lora.store, list(lora.store)),
           lora.weights())
    unchanged = all(np.array_equal(frozen[k], base[k]) for k in base)
    merged = lora.merged()
    same = np.allclose(forward(merged, xb_test)[0], forward(frozen, xb_test, lora.weights())[0])
    print(f"\nbase weights unchanged by LoRA training: {unchanged}; "
          f"merged model gives the same outputs: {same}")
    print(f"adapter removed again: task A accuracy {accuracy(frozen, xa_test, ya_test):.3f} "
          f"(the pretrained model is still there; keep one small adapter per task)")


if __name__ == "__main__":
    main()
