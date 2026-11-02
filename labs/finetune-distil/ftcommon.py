"""Shared pieces for the two scripts: data, a small multi-layer network, softmax and Adam.

Everything is written out in NumPy so that each gradient can be read line by line.
"""

from __future__ import annotations

import numpy as np


def spiral(n_per_class: int, classes: int, noise: float, rng: np.random.Generator,
           turn_degrees: float = 0.0, twist: float = 3.0) -> tuple[np.ndarray, np.ndarray]:
    """Interleaved spiral arms, one per class, optionally turned by turn_degrees.

    `twist` is how far each arm winds, in radians: a larger twist makes a harder problem.
    """
    xs, ys = [], []
    for label in range(classes):
        t = np.linspace(0.05, 1.0, n_per_class)
        angle = twist * t + label * 2 * np.pi / classes
        points = np.stack([t * np.cos(angle), t * np.sin(angle)], axis=1)
        points += rng.normal(0.0, noise, points.shape)
        xs.append(points)
        ys.append(np.full(n_per_class, label))
    x, y = np.concatenate(xs), np.concatenate(ys)
    if turn_degrees:
        a = np.radians(turn_degrees)
        turn = np.array([[np.cos(a), np.sin(a)], [-np.sin(a), np.cos(a)]])
        x = x @ turn
    order = rng.permutation(len(x))
    return x[order], y[order]


def softmax(z: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = z / temperature
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def init_mlp(sizes: list[int], rng: np.random.Generator) -> dict[str, np.ndarray]:
    """Weights W1..Wn and biases b1..bn for a network with tanh hidden layers."""
    params = {}
    for i, (fan_in, fan_out) in enumerate(zip(sizes[:-1], sizes[1:]), start=1):
        params[f"W{i}"] = rng.normal(0.0, np.sqrt(1.0 / fan_in), (fan_in, fan_out))
        params[f"b{i}"] = np.zeros(fan_out)
    return params


def layers(params: dict[str, np.ndarray]) -> int:
    return sum(1 for k in params if k.startswith("W"))


def forward(params: dict[str, np.ndarray], x: np.ndarray,
            weights: dict[str, np.ndarray] | None = None) -> tuple[np.ndarray, list[np.ndarray]]:
    """Logits and the activations backprop needs. `weights` can override the W matrices."""
    weights = weights or params
    acts = [x]
    h = x
    n = layers(params)
    for i in range(1, n + 1):
        z = h @ weights[f"W{i}"] + params[f"b{i}"]
        h = np.tanh(z) if i < n else z
        acts.append(h)
    return h, acts


def backward(params: dict[str, np.ndarray], acts: list[np.ndarray], dlogits: np.ndarray,
             weights: dict[str, np.ndarray] | None = None) -> dict[str, np.ndarray]:
    """Gradients of the loss for every W and b, given the gradient at the logits."""
    weights = weights or params
    grads = {}
    n = layers(params)
    delta = dlogits
    for i in range(n, 0, -1):
        grads[f"W{i}"] = acts[i - 1].T @ delta
        grads[f"b{i}"] = delta.sum(axis=0)
        if i > 1:
            delta = (delta @ weights[f"W{i}"].T) * (1.0 - acts[i - 1] ** 2)  # tanh' = 1 - tanh^2
    return grads


def cross_entropy(probs: np.ndarray, y: np.ndarray) -> float:
    return float(-np.mean(np.log(probs[np.arange(len(y)), y] + 1e-12)))


def accuracy(params: dict[str, np.ndarray], x: np.ndarray, y: np.ndarray,
             weights: dict[str, np.ndarray] | None = None) -> float:
    logits, _ = forward(params, x, weights)
    return float(np.mean(logits.argmax(axis=1) == y))


class Adam:
    """The Adam optimiser (chapter 13) for a dict of arrays, updating only the names it is given."""

    def __init__(self, names: list[str], lr: float) -> None:
        self.names, self.lr, self.t = names, lr, 0
        self.m: dict[str, np.ndarray] = {}
        self.v: dict[str, np.ndarray] = {}

    def step(self, values: dict[str, np.ndarray], grads: dict[str, np.ndarray]) -> None:
        self.t += 1
        for k in self.names:
            g = grads[k]
            self.m[k] = 0.9 * self.m.get(k, np.zeros_like(g)) + 0.1 * g
            self.v[k] = 0.999 * self.v.get(k, np.zeros_like(g)) + 0.001 * g * g
            m_hat = self.m[k] / (1 - 0.9 ** self.t)
            v_hat = self.v[k] / (1 - 0.999 ** self.t)
            values[k] -= self.lr * m_hat / (np.sqrt(v_hat) + 1e-8)


def count(arrays: dict[str, np.ndarray], names: list[str]) -> int:
    return int(sum(arrays[k].size for k in names))
