# hq-sandbox

Invoice API in TypeScript, run directly by Node 24+ (type stripping, no build step). Zero runtime dependencies; tests use `node:test`.

- Check everything: `npm run check` (type-check + tests). It must pass before any commit.
- Only erasable TypeScript syntax: no `enum`, `namespace` or parameter properties. Import local files with the `.ts` extension.

## Agent workflow

Work moves through the agent-skills commands in order. Each stage reads the previous stage's output from the repo, never from chat memory.

| Stage | Reads | Writes |
|---|---|---|
| `/spec` | the idea or request | `SPEC.md` |
| `/plan` | `SPEC.md` | `tasks/plan.md`, `tasks/todo.md` |
| `/build` | `tasks/todo.md` | code, tests, one commit per task on branch `feat/<slug>` |
| `/test` | `SPEC.md` acceptance criteria | tests |
| `/agent-skills:review` | the branch diff | review findings |
| `/ship` | the pull request | go / no-go report |

- Never commit to `main`. Work on `feat/<slug>` and open a pull request.
- One feature in flight at a time. After it ships, move `SPEC.md` to `docs/specs/<slug>.md` and clear `tasks/`.
- Stop and ask the manager before anything irreversible: merging, deploying, deleting data, or touching secrets.

## Guardrails

A PreToolUse hook (`.claude/hooks/guard.mjs`) blocks these, so don't try them or work around them:

- commits, merges and pushes on `main`, and force pushes anywhere
- `gh pr merge`: the manager approves merges in the HQ office and `/hq-sync` performs them
- releases and publishing, hard resets, `git clean -f`, deleting branches, repos or releases, `rm -rf` outside the repo, reading `.env` files
- everything except read-only commands while `.hq/STOP` exists (the manager paused agents)

When a command is blocked, stop and say what you needed; don't look for another way to do it. Every command and edit is logged to `.hq/audit.log`, which the office shows. `npm run check` also runs `evals/guardrails.test.ts`.

For unattended runs (`claude -p`), always set a spend cap and a turn limit, e.g. `--max-budget-usd 3 --max-turns 40`.
