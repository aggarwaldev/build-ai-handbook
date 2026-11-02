"""Tests for the example skill's checker. Run: cd labs && python -m pytest skill-example"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "keeping-env-docs-in-step" / "scripts" / "check_env_docs.py"


def run(repo: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--repo", str(repo)], capture_output=True, text=True
    )


def test_demo_project_in_step():
    result = run(HERE / "demo" / "in-step")
    assert result.returncode == 0
    assert ".env.example: 6 names; README tables: 6 names" in result.stdout
    assert "in step" in result.stdout


def test_drifted_demo_names_both_differences():
    result = run(HERE / "demo" / "drifted")
    assert result.returncode == 1
    assert "only in .env.example: DATABASE_POOL_SIZE" in result.stdout
    assert "only in README: CACHE_TTL_SECONDS" in result.stdout


def test_missing_files_exit_with_two(tmp_path):
    result = run(tmp_path)
    assert result.returncode == 2
    assert "missing file" in result.stdout


def test_readme_without_the_section_exits_with_two(tmp_path):
    (tmp_path / ".env.example").write_text("PORT=1\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("# Title\n\nNo environment section here.\n", encoding="utf-8")
    result = run(tmp_path)
    assert result.returncode == 2
    assert "Environment variables" in result.stdout


def test_values_never_reach_the_output(tmp_path):
    (tmp_path / ".env.example").write_text("API_KEY=sk-pasted-by-mistake\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("## Environment variables\n\n| `OTHER` | x |\n", encoding="utf-8")
    result = run(tmp_path)
    assert result.returncode == 1
    assert "only in .env.example: API_KEY" in result.stdout
    assert "sk-pasted-by-mistake" not in result.stdout + result.stderr
