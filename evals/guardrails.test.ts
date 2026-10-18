// Guardrail checks: feed the PreToolUse guard the payloads Claude Code would
// send and assert what it blocks. Free and deterministic, so CI runs it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GUARD = resolve(import.meta.dirname, "../.claude/hooks/guard.mjs");
let repo = "";

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function guard(command: string): { blocked: boolean; reason: string } {
  const r = spawnSync("node", [GUARD], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: repo }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: "utf8",
  });
  return { blocked: r.status === 2, reason: r.stderr };
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), "hq-guard-"));
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
});
after(() => rmSync(repo, { recursive: true, force: true }));

const onMain = (cmd: string) => { git("switch", "-q", "main"); return guard(cmd); };
const onFeature = (cmd: string) => {
  try { git("switch", "-q", "-c", "feat/x"); } catch { git("switch", "-q", "feat/x"); }
  return guard(cmd);
};

test("blocks commits, merges and pushes on main", () => {
  assert.ok(onMain('git commit -m "x"').blocked);
  assert.ok(onMain("git add -A && git commit -m x").blocked);
  assert.ok(onMain("git merge feat/x").blocked);
  assert.ok(onMain("git push").blocked);
  assert.ok(onMain("git push origin").blocked);
  assert.ok(onMain("git push origin HEAD").blocked);
  assert.ok(onFeature("git push origin main").blocked);
  assert.ok(onFeature("git push origin feat/x:main").blocked);
});

test("allows normal feature-branch work", () => {
  assert.ok(!onFeature('git commit -m "Add CSV export"').blocked);
  assert.ok(!onFeature("git push -u origin feat/x").blocked);
  assert.ok(!onMain("git switch -c feat/y && git commit -m y").blocked);
  assert.ok(!onMain("git push -u origin feat/x").blocked);
  assert.ok(!onMain("npm run check").blocked);
  assert.ok(!onMain("gh pr create --title t --body b").blocked);
});

test("blocks force pushes and branch deletion everywhere", () => {
  assert.ok(onFeature("git push --force").blocked);
  assert.ok(onFeature("git push -f origin feat/x").blocked);
  assert.ok(onFeature("git push --force-with-lease origin feat/x").blocked);
  assert.ok(onFeature("git push origin +feat/x").blocked);
  assert.ok(onFeature("git push origin --delete feat/old").blocked);
  assert.ok(onFeature("git branch -D main").blocked);
});

test("merges and releases are the manager's call", () => {
  assert.ok(onFeature("gh pr merge 4 --squash").blocked);
  assert.ok(onFeature("cd /tmp && gh pr merge 4").blocked);
  assert.ok(onFeature("gh release create v1.0.0").blocked);
  assert.ok(onFeature("npm publish").blocked);
});

test("blocks destructive commands and secrets", () => {
  assert.ok(onFeature("git reset --hard HEAD~3").blocked);
  assert.ok(onFeature("git clean -fd").blocked);
  assert.ok(onFeature("gh repo delete hichrimohamed/hq-sandbox --yes").blocked);
  assert.ok(onFeature("gh api -X DELETE repos/a/b/git/refs/heads/x").blocked);
  assert.ok(onFeature("rm -rf /").blocked);
  assert.ok(onFeature("rm -rf ~").blocked);
  assert.ok(onFeature("rm -rf ..").blocked);
  assert.ok(onFeature("rm -rf *").blocked);
  assert.ok(!onFeature("rm -rf tasks").blocked);
  assert.ok(onFeature("cat .env").blocked);
  assert.ok(onFeature("cat config/.env.production").blocked);
});

test("pause switch: only read-only commands while .hq/STOP exists", () => {
  mkdirSync(join(repo, ".hq"), { recursive: true });
  writeFileSync(join(repo, ".hq", "STOP"), "");
  try {
    assert.ok(onFeature("git commit -m x").blocked);
    assert.ok(onFeature("npm install left-pad").blocked);
    assert.ok(onFeature("gh pr create --title t --body b").blocked);
    assert.match(onFeature("git commit -m x").reason, /paused by the manager/);
    assert.ok(!onFeature("git status").blocked);
    assert.ok(!onFeature("git log --oneline -5").blocked);
    assert.ok(!onFeature("npm run check").blocked);
    assert.ok(!onFeature("gh pr view 2").blocked);
    assert.ok(!onFeature("node scripts/hq-state.mjs . --out .hq/out").blocked);
  } finally {
    rmSync(join(repo, ".hq", "STOP"));
  }
  assert.ok(!onFeature("git commit -m x").blocked);
});
