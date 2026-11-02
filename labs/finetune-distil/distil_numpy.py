"""Knowledge distillation from scratch: a small student learns from a big teacher's probabilities.

1. Train a teacher (2 -> 128 -> 128 -> 3) on plenty of labelled spiral points.
2. Give a much smaller student (2 -> 16 -> 3 by default) only a few labelled points.
3. Train the student three ways and compare on the same test set:
   a. hard labels only: the few labelled points, nothing else;
   b. hard labels from the teacher: unlabelled points, each given the teacher's top class;
   c. soft targets: the same unlabelled points, each given the teacher's full probability list
      at temperature T, so the student also learns which wrong classes are "nearly right".

The unlabelled "transfer set" is just random points in the square: no person labelled them.
That is the practical point of distillation: the teacher labels as much data as you can afford
to run it on.

    python labs/finetune-distil/distil_numpy.py                    # defaults: T = 4, 5 labels per class, twist 6
    python labs/finetune-distil/distil_numpy.py --temperature 1    # soft targets without softening
    python labs/finetune-distil/distil_numpy.py --hidden 8         # an even smaller student
    python labs/finetune-distil/distil_numpy.py --labels 30        # with more labels, does the teacher still help?

Run these from the repository root. Needs only NumPy. Runs in well under a minute on a laptop CPU.
"""

from __future__ import annotations

import argparse

import numpy as np

from ftcommon import Adam, accuracy, backward, count, forward, init_mlp, softmax, spiral


def fit(params, x, targets, steps, lr, rng, temperature=1.0):
    """Train on probability targets (one-hot for hard labels) with cross-entropy at temperature T.

    The gradient of the softened cross-entropy at the logits is (p_student - p_target) / T.
    Multiplying by T * T, as Hinton and colleagues suggest, keeps the step size similar for any T.
    """
    names = list(params)
    opt = Adam(names, lr)
    batch = min(128, len(x))
    for _ in range(steps):
        idx = rng.choice(len(x), batch, replace=False)
        logits, acts = forward(params, x[idx])
        dlogits = (softmax(logits, temperature) - targets[idx]) / temperature
        dlogits *= temperature * temperature / batch
        opt.step(params, backward(params, acts, dlogits))


def one_hot(y, classes=3):
    out = np.zeros((len(y), classes))
    out[np.arange(len(y)), y] = 1.0
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--temperature", type=float, default=4.0)
    parser.add_argument("--labels", type=int, default=5, help="labelled examples per class for the student")
    parser.add_argument("--transfer", type=int, default=3000, help="unlabelled points the teacher labels")
    parser.add_argument("--hidden", type=int, default=16, help="student hidden width")
    parser.add_argument("--steps", type=int, default=4000)
    parser.add_argument("--twist", type=float, default=6.0, help="how far each spiral arm winds")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    rng = np.random.default_rng(args.seed)

    x_train, y_train = spiral(400, 3, 0.03, rng, twist=args.twist)
    x_test, y_test = spiral(300, 3, 0.03, rng, twist=args.twist)
    x_few, y_few = spiral(args.labels, 3, 0.03, rng, twist=args.twist)
    x_transfer = rng.uniform(-1.1, 1.1, (args.transfer, 2))

    teacher = init_mlp([2, 128, 128, 3], rng)
    fit(teacher, x_train, one_hot(y_train), 3000, 0.005, rng)
    print(f"teacher: {count(teacher, list(teacher)):,} weights, test accuracy {accuracy(teacher, x_test, y_test):.3f}")

    teacher_logits, _ = forward(teacher, x_transfer)
    soft = softmax(teacher_logits, args.temperature)
    hard = one_hot(teacher_logits.argmax(axis=1))
    sample = soft[0]
    print(f"one transfer point: teacher probabilities at T = {args.temperature:g}: "
          f"{', '.join(f'{p:.3f}' for p in sample)}")

    sizes = [2, args.hidden, 3]
    print(f"\nstudent: 2 -> {args.hidden} -> 3, {count(init_mlp(sizes, rng), ['W1', 'b1', 'W2', 'b2']):,} weights")
    print(f"{'student trained on':<48}{'examples':>9}{'test acc':>10}")

    def run(label, x, targets, temperature=1.0):
        student = init_mlp(sizes, np.random.default_rng(args.seed + 10))
        fit(student, x, targets, args.steps, 0.01, np.random.default_rng(args.seed + 20), temperature)
        print(f"{label:<48}{len(x):>9,}{accuracy(student, x_test, y_test):>10.3f}")

    run(f"a. {len(x_few)} hand-labelled points (hard labels)", x_few, one_hot(y_few))
    run("b. teacher's top class on unlabelled points", x_transfer, hard)
    run(f"c. teacher's probabilities at T = {args.temperature:g}", x_transfer, soft, args.temperature)
    print("\nAll three students share the same size, starting weights and number of steps.")


if __name__ == "__main__":
    main()
