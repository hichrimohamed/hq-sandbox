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
