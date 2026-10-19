# hq-sandbox

A small invoice API that the Spec to Ship HQ agents (`/spec → /plan → /build → /test → /review → /ship`) work on end to end. It exists to prove the workflow, the approvals and the guardrails before pointing the agents at a real product.

## Run

```sh
npm install
npm start          # http://localhost:3000
npm run check      # type-check + tests
```

## API

| Method | Path | Body |
|---|---|---|
| GET | `/health` | |
| GET | `/invoices` | |
| POST | `/invoices` | `{ customer, amountCents, currency?, issuedAt? }` |
| GET | `/invoices/:id` | |
| POST | `/invoices/:id/status` | `{ status: "draft" \| "sent" \| "paid" }` |

Data is in memory and resets on restart.

## Spec to Ship HQ

The office at the link in `.hq.json` shows where this repo's work stands and collects the manager's decisions. Run `/hq-sync` in Claude Code to sync both ways:

1. **Apply decisions** (`scripts/hq-apply.mjs`). Approving a spec or plan marks the file approved on its feature branch. Approving a pull request merges it, only when it is open, not a draft, mergeable and every check is green. Approving an idea opens a GitHub issue labelled `idea` for `/spec`. Sending something back posts the note on the PR, or writes it into the file with "Changes requested". It never commits to `main` or force-pushes, and it stops if the working tree has uncommitted changes.
2. **Push state** (`scripts/hq-state.mjs`). Reads `SPEC.md`, `tasks/`, `feat/` branches, CI runs, pull requests and `idea` issues, and works out what is waiting on the manager. A revised file or a pull request with new commits becomes a new item to approve.

## Testing the agents

- `npm run check` also runs `evals/guardrails.test.ts`, which checks what the guard hook blocks. Free, runs in CI.
- `node evals/agents/run.mjs [spec plan build review guardrail enforced] [--budget 2.5]` runs the real agent-skills commands headless on throwaway copies of this repo (their `origin` is a local bare repo, so nothing reaches GitHub) and grades the result with scripts. Spends tokens, capped per case. Results land in `evals/results/`.
