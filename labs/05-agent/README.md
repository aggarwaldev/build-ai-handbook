# Lab 5: tools and an agent loop

A parts-desk agent for an invented bike shop, with four tools (a catalogue lookup, a safe
calculator, a working-days date helper and a pretend order that a person must approve) and a
tool loop written out by hand. The walkthrough is `lab-agent.html` in the book.

Run from the repository root (Python 3.10 or newer, `pip install -r labs/requirements.txt`):

    python labs/05-agent/agent.py                     # the demo question, offline on the fake backend
    python labs/05-agent/agent.py --demo order        # an order: you are asked y/N before it runs
    python labs/05-agent/agent.py --max-steps 2       # the step limit stops the loop
    LLM_BACKEND=anthropic python labs/05-agent/agent.py "Do you have an 11-speed chain?"

Tests (offline): `cd labs && python -m pytest 05-agent`
