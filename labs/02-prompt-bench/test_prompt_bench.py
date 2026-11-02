"""Tests for Lab 2. They run on the fake backend: no key, no network, no cost."""

from __future__ import annotations

import json
import re

import pytest

import bench
from common import llm


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "fake")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    llm.fake.reset()
    llm.fake.responder = bench.keyword_router
    yield
    llm.fake.reset()


# ---------------------------------------------------------------- the data


def test_cases_are_labelled_and_balanced():
    cases = bench.load_cases()
    assert len(cases) == 30
    assert len({c["id"] for c in cases}) == 30
    assert {c["label"] for c in cases} == set(bench.CATEGORIES)
    for label in bench.CATEGORIES:
        assert sum(c["label"] == label for c in cases) == 5


def test_repeated_ids_are_refused(tmp_path):
    path = tmp_path / "cases.jsonl"
    row = json.dumps({"id": "x", "message": "hi", "label": "other"})
    path.write_text(row + "\n" + row + "\n")
    with pytest.raises(ValueError, match="repeated"):
        bench.load_cases(path)


def test_prompts_differ_in_what_the_fake_can_see():
    names = {v: bench.load_prompt(v)[1] for v in ("v1", "v2", "v3")}
    for c in bench.CATEGORIES:
        assert not re.search(rf"\b{c}\b", names["v1"])
        assert re.search(rf"\b{c}\b", names["v2"]) and re.search(rf"\b{c}\b", names["v3"])
    assert "JSON" not in names["v1"] and "JSON" in names["v2"]


def test_prompt_examples_are_not_test_cases():
    examples = re.findall(r"<message>(.*?)</message>", bench.load_prompt("v3")[1])
    messages = {c["message"] for c in bench.load_cases()}
    assert examples and not set(examples) & messages


def test_unknown_prompt_is_reported():
    with pytest.raises(FileNotFoundError):
        bench.load_prompt("v99")


# ---------------------------------------------------------------- scoring


@pytest.mark.parametrize("text, expected", [
    ('{"category": "booking"}', ("booking", True)),
    ('  {"category": "Parts"}\n', ("parts", True)),
    ('```json\n{"category": "quote"}\n```', ("quote", False)),
    ('Sure! {"category": "status"}', ("status", False)),
    ("Category: complaint.", ("complaint", False)),
    ("other", ("other", False)),
    ('{"label": "booking"}', ('{"label": "booking"}', False)),
    ("", (None, False)),
])
def test_parse_reply_scores_format_and_answer_separately(text, expected):
    assert bench.parse_reply(text) == expected


def test_wilson_matches_the_worked_numbers():
    # chapter 26: 5 of 10 gives 0.237 to 0.763; 10 of 10 gives 0.722 to 1
    assert bench.wilson(5, 10) == pytest.approx((0.237, 0.763), abs=0.001)
    assert bench.wilson(10, 10) == pytest.approx((0.722, 1.0), abs=0.001)
    # the glossary: 3 failures in 50 gives about 2.1% to 16.2%
    assert bench.wilson(3, 50) == pytest.approx((0.021, 0.162), abs=0.001)
    assert bench.wilson(0, 0) == (0.0, 1.0)


def test_sign_test():
    assert bench.sign_test(5, 0) == pytest.approx(0.0625)  # 2 x 0.5^5
    assert bench.sign_test(0, 5) == pytest.approx(0.0625)
    assert bench.sign_test(3, 3) == 1.0
    assert bench.sign_test(0, 0) == 1.0
    assert bench.sign_test(18, 0) < 0.0001


def test_percentile_is_nearest_rank():
    assert bench.percentile([0.1, 0.2, 0.3, 0.4], 0.5) == 0.2
    assert bench.percentile([5.0] * 19 + [9.0], 0.95) == 5.0
    assert bench.percentile([], 0.95) == 0.0


# ---------------------------------------------------------------- the fake model


def test_keyword_rules():
    assert bench.keyword_label("Can I book a service?") == "booking"
    assert bench.keyword_label("My gears slip again after the service") == "complaint"
    assert bench.keyword_label("Hello there") == "other"


def test_keyword_router_follows_what_the_prompt_asks_for():
    def ask(system):
        return bench.keyword_router({"system": system, "messages": [
            {"role": "user", "content": bench.user_turn("Is my bike ready?")}]})
    names = " ".join(bench.CATEGORIES)
    assert ask("Say the category.") == "Category: repair update."
    assert ask(f"Pick one of {names}.") == "Category: status."
    assert ask(f"Pick one of {names}. Reply with JSON.") == '{"category": "status"}'


# ---------------------------------------------------------------- runs


def test_v2_run_on_the_fake_backend():
    run = bench.run_bench("v2", bench.load_cases())
    s = run["summary"]
    assert (s["correct"], s["n"], s["json_ok"]) == (22, 30, 30)
    assert bench.worst_category(s) == "quote"
    assert s["per_category"]["quote"]["answered_as"] == {"quote": 2, "booking": 2, "other": 1}
    assert s["cost_usd"] == 0.0 and s["reference_cost_usd"] > 0
    assert s["stop_reasons"] == {"end": 30}
    assert run["backend"] == "fake" and run["prompt"] == "v2"
    assert len(llm.fake.calls) == 30
    assert llm.fake.calls[0]["messages"][0]["content"].startswith("<message>\n")


def test_v1_names_no_categories_so_its_own_words_miss():
    s = bench.run_bench("v1", bench.load_cases())["summary"]
    assert s["json_ok"] == 0
    assert s["correct"] == 4  # only "complaint" is the word a model would use anyway


def test_report_lists_the_worst_category_and_the_fake_warning():
    report = bench.format_report(bench.run_bench("v2", bench.load_cases()))
    assert "accuracy     0.733  (22/30)" in report
    assert "worst: quote (2/5)" in report
    assert "c13 -> booking" in report
    assert "not a model or a prompt" in report


def test_scripted_replies_are_scored_and_counted():
    llm.fake.script(
        llm.Reply(text='{"category": "booking"}', input_tokens=100, output_tokens=20),
        llm.Reply(text="It is about a booking.", input_tokens=100, output_tokens=30,
                  stop_reason="max_tokens"),
    )
    cases = bench.load_cases()[:2]
    run = bench.run_bench("v2", cases)
    first, second = run["results"]
    assert first["correct"] and first["json_ok"]
    assert not second["correct"] and second["stop_reason"] == "max_tokens"
    assert run["summary"]["input_tokens"] == 200 and run["summary"]["output_tokens"] == 50
    assert run["summary"]["stop_reasons"] == {"end": 1, "max_tokens": 1}


def test_a_failed_call_is_recorded_and_the_run_goes_on():
    def flaky(request):
        if "book my bike" in request["messages"][-1]["content"]:
            raise llm.LLMError("connection dropped")
        return bench.keyword_router(request)
    llm.fake.responder = flaky
    run = bench.run_bench("v2", bench.load_cases()[:3])
    assert run["summary"]["errors"] == 1
    assert run["results"][0]["error"] == "connection dropped"
    assert [r["correct"] for r in run["results"]] == [False, True, True]


def test_save_load_and_compare(tmp_path):
    cases = bench.load_cases()
    v1 = bench.load_run(str(bench.save_run(bench.run_bench("v1", cases), tmp_path)))
    v2 = bench.load_run(bench.save_run(bench.run_bench("v2", cases), tmp_path).stem, tmp_path)
    c = bench.compare_runs(v1, v2)
    g = c["groups"]
    assert (len(g["fixed"]), len(g["broken"]), len(g["right in both"]), len(g["wrong in both"])) \
        == (18, 0, 4, 8)
    assert c["p_value"] == pytest.approx(2 / 2 ** 18)
    text = bench.format_compare(v1, v2)
    assert "fixed by B      18" in text
    assert "c01  booking    A: appointment" in text


def test_compare_warns_when_the_prompt_text_changed(tmp_path):
    cases = bench.load_cases()[:4]
    a = bench.run_bench("v2", cases)
    edited = tmp_path / "v2.txt"
    edited.write_text(bench.load_prompt("v2")[1] + "\nBe careful.")
    b = bench.run_bench(str(edited), cases)
    assert "its text changed" in bench.format_compare(a, b)


def test_two_saves_in_the_same_second_keep_both(tmp_path):
    run = bench.run_bench("v2", bench.load_cases()[:2])
    first, second = bench.save_run(run, tmp_path), bench.save_run(run, tmp_path)
    assert first != second and first.exists() and second.exists()


def test_command_line_run_list_and_compare(tmp_path, capsys):
    assert bench.main(["run", "v1", "--runs-dir", str(tmp_path)]) == 0
    assert bench.main(["run", "v2", "--runs-dir", str(tmp_path), "-v"]) == 0
    out = capsys.readouterr().out
    assert "c13  quote      -> booking" in out and "accuracy     0.733" in out
    names = sorted(p.stem for p in tmp_path.glob("*.json"))
    assert len(names) == 2
    assert bench.main(["list", "--runs-dir", str(tmp_path)]) == 0
    assert "0.733" in capsys.readouterr().out
    assert bench.main(["compare", names[0], names[1], "--runs-dir", str(tmp_path)]) == 0
    assert "fixed by B" in capsys.readouterr().out


def test_command_line_reports_a_missing_run(tmp_path, capsys):
    assert bench.main(["compare", "nope", "nada", "--runs-dir", str(tmp_path)]) == 2
    assert "no run" in capsys.readouterr().err
