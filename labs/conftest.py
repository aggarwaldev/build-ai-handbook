"""Make `from common import llm` work in every lab's tests, and keep tests offline."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ["LLM_BACKEND"] = "fake"
