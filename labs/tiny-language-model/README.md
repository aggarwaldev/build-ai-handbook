# A tiny language model

`bigram.py` counts which character follows which (standard library only).
`tiny_transformer.py` is a small transformer in PyTorch. Both train on
`data/savings.txt`. The walkthrough is in `project-tiny-lm.html` (chapter 20).

From the repository root:

    python labs/tiny-language-model/bigram.py --after t
    pip install -r labs/tiny-language-model/requirements.txt   # PyTorch, for the transformer
    python labs/tiny-language-model/tiny_transformer.py --steps 500
