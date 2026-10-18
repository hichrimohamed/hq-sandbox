#!/usr/bin/env node
// Reads where the spec-to-ship work actually stands (files, git, GitHub) and
// prints it as JSON for /hq-sync to write into the Spec to Ship HQ office.
//
// Usage: node scripts/hq-state.mjs [repo-dir]
// Output: { meta, live: { <stage>: {now, checklist, links} }, validations: [...] }
// Needs git; uses the gh CLI for PRs and CI when it is installed and logged in.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? process.cwd();
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
const gh = (args) => {
  const out = run("gh", args);
  try { return out ? JSON.parse(out) : null; } catch { return null; }
};
const read = (rel) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), "utf8") : null);

const repo = gh(["repo", "view", "--json", "nameWithOwner,url,defaultBranchRef"]);
const main = repo?.defaultBranchRef?.name ?? "main";
const fileUrl = (path, ref = main) => (repo ? `${repo.url}/blob/${ref}/${path}` : null);
const current = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const isApproved = (text) => /^\s*(\*\*)?status(\*\*)?\s*:\s*(\*\*)?\s*approved/im.test(text);
const firstHeading = (text) => text.match(/^#\s+(.+)$/m)?.[1].trim() ?? "Untitled";
const firstParagraph = (text) =>
  text.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith("#") && !/^\s*(\*\*)?status/i.test(p))?.replace(/\s+/g, " ").slice(0, 280) ?? "";
const checkboxes = (text) =>
  [...text.matchAll(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/gm)].map((m) => ({ done: m[1] !== " ", text: m[2].trim() }));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";

const live = {};
const validations = [];

// /spec: SPEC.md in the working tree, checked against the six areas the spec skill requires
const spec = read("SPEC.md");
if (spec) {
  const title = firstHeading(spec);
  const approved = isApproved(spec);
  const areas = [
    ["Objective", /objective|goal/i],
    ["Commands", /commands?/i],
    ["Project structure", /structure/i],
    ["Code style", /style/i],
    ["Testing strategy", /test/i],
    ["Boundaries", /boundar/i],
  ];
  const headings = [...spec.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1]);
  live.spec = {
    now: `SPEC.md “${title}”: ${approved ? "approved" : "waiting for your approval"}`,
    checklist: areas.map(([label, re]) => ({ done: headings.some((h) => re.test(h)), text: label })),
    links: [{ label: "SPEC.md", url: fileUrl("SPEC.md", current) }],
  };
  if (!approved) {
    validations.push({
      id: `spec-${slugify(title)}`, kind: "spec", from: "spec_pm", stage: "spec",
      title: `Approve SPEC.md: ${title}`, detail: firstParagraph(spec),
      bullets: live.spec.checklist.filter((c) => !c.done).map((c) => `Missing section: ${c.text}`),
      url: fileUrl("SPEC.md", current), action: { type: "approve-file", path: "SPEC.md", branch: current },
    });
  }
} else {
  live.spec = { now: "No spec in progress. Pass an idea, then run /spec in the repo.", checklist: [], links: [] };
}

// /plan: tasks/plan.md and the checkbox list in tasks/todo.md
const plan = read("tasks/plan.md");
const todo = read("tasks/todo.md");
const tasks = todo ? checkboxes(todo) : [];
if (plan || todo) {
  const done = tasks.filter((t) => t.done).length;
  const approved = plan ? isApproved(plan) : false;
  live.plan = {
    now: `${tasks.length ? `${done} of ${tasks.length} tasks done` : "Plan written"} · ${approved ? "plan approved" : "plan waiting for your approval"}`,
    checklist: tasks.slice(0, 12),
    links: [plan && { label: "tasks/plan.md", url: fileUrl("tasks/plan.md", current) }, todo && { label: "tasks/todo.md", url: fileUrl("tasks/todo.md", current) }].filter(Boolean),
  };
  if (plan && !approved) {
    validations.push({
      id: `plan-${slugify(spec ? firstHeading(spec) : firstHeading(plan))}`, kind: "plan", from: "plan_lead", stage: "plan",
      title: `Approve the plan: ${tasks.length} tasks`, detail: firstParagraph(plan),
      bullets: tasks.slice(0, 6).map((t) => t.text),
      url: fileUrl("tasks/plan.md", current), action: { type: "approve-file", path: "tasks/plan.md", branch: current },
    });
  }
} else {
  live.plan = { now: spec ? "Spec exists, no plan yet. Run /plan." : "Waiting for a spec.", checklist: [], links: [] };
}

// /build: feature branches and their commits ahead of main
const branches = (run("git", ["branch", "--format=%(refname:short)", "--list", "feat/*"]) ?? "").split("\n").filter(Boolean);
const active = branches.includes(current) ? current : branches[0];
if (active) {
  const ahead = Number(run("git", ["rev-list", "--count", `${main}..${active}`]) ?? 0);
  const log = (run("git", ["log", "--format=%s", "-n", "6", `${main}..${active}`]) ?? "").split("\n").filter(Boolean);
  live.build = {
    now: `${active}: ${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${main}${log[0] ? ` · last: “${log[0]}”` : ""}`,
    checklist: log.map((s) => ({ done: true, text: s })),
    links: repo ? [{ label: active, url: `${repo.url}/tree/${active}` }] : [],
  };
} else {
  live.build = { now: "No feature branch yet.", checklist: [], links: [] };
}

// /test: latest CI runs
const runs = gh(["run", "list", "--limit", "5", "--json", "headBranch,status,conclusion,displayTitle,url,createdAt"]) ?? [];
const latest = runs.find((r) => r.headBranch === active) ?? runs[0];
const ciWord = (r) => (r.status !== "completed" ? "running" : r.conclusion === "success" ? "passing" : r.conclusion ?? "unknown");
live.test = latest
  ? {
      now: `CI on ${latest.headBranch}: ${ciWord(latest)}`,
      checklist: runs.slice(0, 5).map((r) => ({ done: r.conclusion === "success", text: `${r.headBranch}: ${ciWord(r)} · ${r.displayTitle}` })),
      links: [{ label: "Latest CI run", url: latest.url }],
    }
  : { now: repo ? "No CI runs yet." : "GitHub not reachable; CI status unknown.", checklist: [], links: [] };

// /review: open pull requests
const prs = gh(["pr", "list", "--state", "open", "--json", "number,title,url,isDraft,reviewDecision,headRefName,statusCheckRollup,body"]) ?? [];
const checksOk = (pr) => (pr.statusCheckRollup ?? []).every((c) => (c.conclusion ?? c.state) === "SUCCESS");
const reviewWord = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };
live.review = prs.length
  ? {
      now: `${prs.length} open pull request${prs.length === 1 ? "" : "s"}`,
      checklist: prs.map((pr) => ({ done: pr.reviewDecision === "APPROVED", text: `#${pr.number} ${pr.title} · ${pr.isDraft ? "draft" : reviewWord[pr.reviewDecision] ?? "no review yet"}` })),
      links: prs.slice(0, 3).map((pr) => ({ label: `PR #${pr.number}`, url: pr.url })),
    }
  : { now: "No open pull requests.", checklist: [], links: [] };
for (const pr of prs) {
  if (pr.isDraft) continue;
  validations.push({
    id: `pr-${pr.number}`, kind: "merge", from: "ship_release", stage: "ship",
    title: `Merge PR #${pr.number}: ${pr.title}`,
    detail: (pr.body ?? "").replace(/\s+/g, " ").slice(0, 280),
    bullets: [`Checks: ${checksOk(pr) ? "passing" : "not all passing"}`, `Review: ${reviewWord[pr.reviewDecision] ?? "none yet"}`, `Branch: ${pr.headRefName}`],
    url: pr.url, action: { type: "merge-pr", number: pr.number },
  });
}

// /ship: latest tag and recently merged pull requests
const tag = run("git", ["describe", "--tags", "--abbrev=0"]);
const merged = gh(["pr", "list", "--state", "merged", "--limit", "5", "--json", "number,title,mergedAt,url"]) ?? [];
live.ship = {
  now: tag ? `Latest release: ${tag}` : merged.length ? `Nothing tagged yet · ${merged.length} merged pull request${merged.length === 1 ? "" : "s"}` : "Nothing shipped yet.",
  checklist: merged.map((pr) => ({ done: true, text: `#${pr.number} ${pr.title}` })),
  links: merged[0] ? [{ label: `PR #${merged[0].number}`, url: merged[0].url }] : [],
};

const syncedAt = Date.now();
for (const s of Object.values(live)) s.links = s.links.filter((l) => l && l.url);
console.log(JSON.stringify({
  meta: { repo: repo?.nameWithOwner ?? dir, url: repo?.url ?? null, branch: current, syncedAt },
  live,
  validations: validations.map((v) => ({ ...v, source: "github" })),
}, null, 2));
