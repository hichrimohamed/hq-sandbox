#!/usr/bin/env node
// Applies the manager's decisions from the Spec to Ship HQ office to this repo.
//
// Usage: node scripts/hq-apply.mjs <validations-dir> [--dry-run]
// <validations-dir> holds one JSON file per office validation (<id>.json), as
// exported by /hq-sync. Only decided items with an `action` and no `appliedAt`
// are applied. For each one, writes <validations-dir>/../results/<id>.json with
// { applyResult: { ok, message, url } }, plus appliedAt when it succeeded. A
// failed item keeps no appliedAt, so the next sync retries it (every check runs
// before any change, so a retry never acts twice).
//
// Safety: never commits to main, never force-pushes, never merges a pull
// request whose checks are not all green, and stops if the working tree has
// uncommitted changes.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const inDir = args.find((a) => !a.startsWith("--"));
if (!inDir || !existsSync(inDir)) {
  console.error("Usage: node scripts/hq-apply.mjs <validations-dir> [--dry-run]");
  process.exit(2);
}
const outDir = join(dirname(inDir), "results");
const today = new Date().toISOString().slice(0, 10);

const sh = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
const tryJson = (cmd, cmdArgs) => {
  try { return JSON.parse(sh(cmd, cmdArgs)); } catch { return null; }
};
const mainBranch = tryJson("gh", ["repo", "view", "--json", "defaultBranchRef"])?.defaultBranchRef?.name ?? "main";

function cleanTree() {
  const dirty = sh("git", ["status", "--porcelain"]).split("\n").filter((l) => l && !l.includes(".claude/"));
  return dirty.length === 0;
}

// approve-file / send back a file: set its status line, add feedback, commit on the feature branch
function applyFile(v, approved) {
  const { path, branch } = v.action;
  if (!branch || branch === mainBranch) return { ok: false, message: `Refusing to commit to ${mainBranch}; no feature branch given.` };
  if (!cleanTree()) return { ok: false, message: "The repo has uncommitted changes. Commit or stash them, then sync again." };
  const start = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const exists = sh("git", ["branch", "--list", branch]) !== "";
  if (dryRun) return { ok: true, message: `Would ${approved ? "approve" : "send back"} ${path} on ${branch}` };
  try {
    sh("git", exists ? ["switch", branch] : ["switch", "-c", branch]);
    if (!existsSync(path)) return { ok: false, message: `${path} is not on ${branch}.` };
    const lines = readFileSync(path, "utf8").split("\n");
    const statusLine = approved
      ? `**Status:** Approved by the manager on ${today}`
      : `**Status:** Changes requested by the manager on ${today}`;
    const kept = lines.filter((l) => !/^\s*(\*\*)?status(\*\*)?\s*:/i.test(l));
    const h1 = kept.findIndex((l) => /^#\s+/.test(l));
    const insert = ["", statusLine];
    if (!approved && v.note) insert.push("", `> Manager feedback (${today}): ${v.note.replace(/\s+/g, " ")}`);
    kept.splice(h1 >= 0 ? h1 + 1 : 0, 0, ...insert);
    writeFileSync(path, kept.join("\n").replace(/\n{3,}/g, "\n\n"));
    sh("git", ["add", path]);
    sh("git", ["commit", "-m", `${approved ? "Approve" : "Request changes to"} ${path} (manager decision from the HQ office)`]);
    sh("git", ["push", "-u", "origin", branch]);
    const repoUrl = tryJson("gh", ["repo", "view", "--json", "url"])?.url;
    return { ok: true, message: `${approved ? "Marked approved" : "Sent back with your note"} in ${path} on ${branch}`, url: repoUrl ? `${repoUrl}/blob/${branch}/${path}` : null };
  } finally {
    if (start !== sh("git", ["rev-parse", "--abbrev-ref", "HEAD"])) sh("git", ["switch", start]);
  }
}

// merge-pr: merge only when it is open, not a draft, mergeable and every check is green
function applyMerge(v, approved) {
  const n = String(v.action.number);
  const pr = tryJson("gh", ["pr", "view", n, "--json", "state,isDraft,mergeable,statusCheckRollup,url"]);
  if (!pr) return { ok: false, message: `Could not read PR #${n} from GitHub.` };
  if (!approved) {
    if (dryRun) return { ok: true, message: `Would comment on PR #${n}`, url: pr.url };
    sh("gh", ["pr", "comment", n, "--body", `**Sent back by the manager from the HQ office:**\n\n${v.note || "No note given."}`]);
    return { ok: true, message: `Posted your note on PR #${n}`, url: pr.url };
  }
  if (pr.state === "MERGED") return { ok: true, message: `PR #${n} was already merged`, url: pr.url };
  if (pr.state !== "OPEN") return { ok: false, message: `PR #${n} is ${pr.state.toLowerCase()}, not open.`, url: pr.url };
  if (pr.isDraft) return { ok: false, message: `PR #${n} is still a draft.`, url: pr.url };
  const checks = pr.statusCheckRollup ?? [];
  const green = (c) => ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(c.conclusion ?? c.state);
  if (!checks.length) return { ok: false, message: `PR #${n} has no checks reported yet. Wait for CI, then sync again.`, url: pr.url };
  const red = checks.filter((c) => !green(c));
  if (red.length) return { ok: false, message: `Not merged: ${red.length} check${red.length === 1 ? "" : "s"} not passing (${red.map((c) => c.name ?? c.context).join(", ")}).`, url: pr.url };
  if (pr.mergeable !== "MERGEABLE") return { ok: false, message: `Not merged: GitHub reports PR #${n} as ${String(pr.mergeable).toLowerCase()}.`, url: pr.url };
  if (dryRun) return { ok: true, message: `Would merge PR #${n}`, url: pr.url };
  sh("gh", ["pr", "merge", n, "--squash", "--delete-branch"]);
  return { ok: true, message: `Merged PR #${n}`, url: pr.url };
}

// create-issue: an approved idea becomes a GitHub issue ready for /spec
function applyIdea(v, approved) {
  if (!approved) return { ok: true, message: "Sent back to Maya in the office; nothing to change in the repo." };
  const title = `Idea: ${(v.title || "").replace(/^(Approve spec|Start a spec):\s*/i, "")}`;
  const body = [
    `> ${v.action.ideaText || v.title}`,
    "",
    v.detail ? `**Problem.** ${v.detail}` : "",
    v.bullets?.length ? `**Draft acceptance criteria**\n${v.bullets.map((b) => `- ${b}`).join("\n")}` : "",
    v.extra || "",
    "",
    `Approved by the manager in the HQ office on ${today}. Next step: run \`/spec\` with this issue as input.`,
  ].filter((x) => x !== "").join("\n\n");
  if (dryRun) return { ok: true, message: `Would open issue “${title}”` };
  try { sh("gh", ["label", "create", "idea", "--color", "0E8080", "--description", "Approved in the HQ office, waiting for /spec", "--force"]); } catch {}
  const url = sh("gh", ["issue", "create", "--title", title, "--body", body, "--label", "idea"]);
  return { ok: true, message: `Opened issue #${url.split("/").pop()}`, url };
}

const handlers = { "approve-file": applyFile, "merge-pr": applyMerge, "create-issue": applyIdea };
const results = [];
mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(inDir).filter((f) => f.endsWith(".json"))) {
  const id = basename(file, ".json");
  const v = JSON.parse(readFileSync(join(inDir, file), "utf8"));
  if (!v.action || v.appliedAt || !["approved", "changes"].includes(v.status)) continue;
  const handler = handlers[v.action.type];
  let applyResult;
  try {
    applyResult = handler ? handler(v, v.status === "approved") : { ok: false, message: `Unknown action ${v.action.type}` };
  } catch (err) {
    applyResult = { ok: false, message: `Failed: ${(err.stderr || err.message || String(err)).toString().trim().split("\n").pop()}` };
  }
  applyResult.url ??= null;
  results.push({ id, ...applyResult });
  if (!dryRun) writeFileSync(join(outDir, `${id}.json`), JSON.stringify(applyResult.ok ? { appliedAt: Date.now(), applyResult } : { applyResult }));
}
console.log(JSON.stringify({ dryRun, applied: results }, null, 2));
