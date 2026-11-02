# Example skill: keeping environment-variable docs in step

An example Agent Skill for chapter 31 of the book (`skills.html`). The skill is the folder
`keeping-env-docs-in-step/`: a `SKILL.md` plus a standard-library checker script. The `demo/`
folders are an invented project to run it against: `in-step` passes, `drifted` has two mistakes.

Run it from the repository root:

    python labs/skill-example/keeping-env-docs-in-step/scripts/check_env_docs.py --repo labs/skill-example/demo/in-step
    python labs/skill-example/keeping-env-docs-in-step/scripts/check_env_docs.py --repo labs/skill-example/demo/drifted

Test it: `cd labs && python -m pytest skill-example`. To use the skill itself with Claude Code,
copy `keeping-env-docs-in-step/` into `.claude/skills/` in a project of your own.
