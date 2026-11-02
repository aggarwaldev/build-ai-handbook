---
name: keeping-env-docs-in-step
description: Adds, renames or removes an environment variable in a project and keeps .env.example and the README's "Environment variables" tables in step with the code that reads it. Use when a change introduces, renames or drops an environment variable, or when .env.example and the README disagree.
---

# Keeping environment-variable docs in step

Every variable the code, the scripts, the container files or the CI config reads is listed twice:
once in `.env.example` (the name with a blank or default value) and once as a row in a README
table under "## Environment variables", in the same group. This skill keeps the two lists in step.

## Rules

- Never open, read or print `.env`. Work from `.env.example`, the README and the code only.
- A secret (a key, a password, a connection string with a password) gets a blank value in
  `.env.example` and "yes" in the README's Secret column. Never write a real value anywhere.
- Put the name under the same group in both files: the `# group` comment in `.env.example` and
  the matching `###` table in the README.

## Steps

1. Find every place the variable is read: search for its exact name in the source folders, the
   scripts, the container files and the CI config. Note its default when unset, whether it is
   required, and whether it is a secret.
2. Edit `.env.example`: add the name under the matching group comment, with a one-line comment
   saying what it does and a blank value (or the code default, if it is not a secret).
3. Edit the README: add a row to the matching table, in the table's own column order:
   `` | `NAME` | default | required | secret | purpose | ``.
4. Run the checker from the project root. The path below assumes the skill is installed in the
   project's `.claude/skills/` folder; change it if you installed the skill elsewhere:

   ```
   python .claude/skills/keeping-env-docs-in-step/scripts/check_env_docs.py
   ```

   It prints each name found in one file but not the other and exits with 1 if there is any.
   To check a project somewhere else, add `--repo PATH`.
5. Show the user the two changed hunks and the checker's output.

## When the checker reports a difference

- **Only in the README.** `.env.example` lost the line by mistake, or the code no longer reads
  the variable. Search the code (step 1) before removing either.
- **Only in `.env.example`.** Add its README row. Do not delete the line to make the check pass.
- **Renamed variable.** Old and new names both appear in the report. Change the code, both files
  and any container file in the same commit, and say in the commit message that the old name
  stops working.
