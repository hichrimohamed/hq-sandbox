#!/usr/bin/env node
// PreToolUse guard for Bash. Blocks what only the manager may do, so agents
// cannot do it even in an autonomous run. Exit 2 blocks the command and shows
// the reason to the agent; exit 0 lets it run.
//
// Blocked:
//   - commits, merges or pushes to main, and every force push
//   - gh pr merge (merges only happen through the HQ office and /hq-sync)
//   - releases and publishing (gh release create, npm publish)
//   - destructive commands: hard reset, git clean -f, deleting main or remote
//     branches, gh repo/release delete, DELETE API calls, rm -rf outside the repo
//   - reading .env files
//   - while .hq/STOP exists (the manager paused agents): anything not read-only
//
// Every block is appended to .hq/audit.log.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const command = String(input.tool_input?.command ?? "");
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = process.env.CLAUDE_PROJECT_DIR || cwd;

const PROTECTED = /^(main|master)$/;
let branch = null;
try {
  branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {}

// Split on shell separators so each part of a compound command is checked
const segments = command.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);

const READ_ONLY = new RegExp(
  "^(cd\\s|git\\s+(status|log|diff|show|rev-parse|describe|remote|fetch|branch(\\s+(--list|-a|-r|--show-current))?\\s*$)|" +
  "ls\\b|cat\\s|head\\s|tail\\s|wc\\s|grep\\s|rg\\s|find\\s|pwd\\b|echo\\s|jq\\s|" +
  "node\\s+--check|node\\s+scripts/hq-(state|apply)\\.mjs|npm\\s+(test|run\\s+(check|typecheck|test))|" +
  "gh\\s+(pr|issue|run)\\s+(view|list|checks|diff|watch)|gh\\s+repo\\s+view)"
);

function check() {
  const paused = existsSync(join(root, ".hq", "STOP"));
  let current = branch;
  for (const seg of segments) {
    // Track branch switches earlier in the same command (git switch -c feat/x && git commit ...)
    const sw = seg.match(/^git\s+(?:switch|checkout)\s+(?:-[cCbB]\s+)?([^\s-][^\s]*)/);
    if (sw) { current = sw[1]; continue; }

    if (paused && !READ_ONLY.test(seg)) {
      return "Agents are paused by the manager (.hq/STOP exists). Only read-only commands run until the manager resumes agents from the HQ office.";
    }
    if (/^git\s+push\b/.test(seg)) {
      if (/\s(--force(-with-lease)?|-f)\b|\s\+\S/.test(seg)) return "Force pushes are not allowed.";
      if (/\s--delete\b|\s-d\b|\s:\S/.test(seg)) return "Deleting remote branches is not allowed.";
      if (/[\s:](main|master)\b/.test(seg)) return "Pushing to main is not allowed. Push a feat/ branch and open a pull request.";
      // On main, only an explicit "git push <remote> <non-main branch>" is allowed
      const positional = seg.split(/\s+/).slice(2).filter((a) => !a.startsWith("-"));
      if (current && PROTECTED.test(current) && (positional.length < 2 || /(^|:)(HEAD|main|master)$/.test(positional[1]))) {
        return "You are on main: pushing from it is not allowed. Create a feat/ branch first.";
      }
    }
    if (/^git\s+commit\b/.test(seg) && current && PROTECTED.test(current)) {
      return "Committing on main is not allowed. Create a feat/<slug> branch and commit there.";
    }
    if (/^git\s+merge\b/.test(seg) && current && PROTECTED.test(current)) {
      return "Merging into main is not allowed. Open a pull request; the manager approves the merge in the HQ office.";
    }
    if (/^gh\s+pr\s+merge\b/.test(seg)) {
      return "Merging pull requests is the manager's decision. It happens when the manager approves in the HQ office and /hq-sync runs.";
    }
    if (/^gh\s+release\s+(create|delete|edit)\b/.test(seg) || /^npm\s+publish\b/.test(seg)) {
      return "Releasing and publishing are the manager's decision. Ask in the HQ office instead.";
    }
    if (/^git\s+reset\s+.*--hard\b/.test(seg) || /^git\s+clean\s+.*-[a-zA-Z]*f/.test(seg)) {
      return "Hard resets and git clean -f can destroy work and are not allowed. Use git stash or a new commit.";
    }
    if (/^git\s+branch\s+.*-[dD]\s+(main|master)\b/.test(seg)) return "Deleting main is not allowed.";
    if (/^gh\s+(repo|release)\s+delete\b/.test(seg)) return "Deleting repositories or releases is not allowed.";
    if (/^gh\s+api\b/.test(seg) && /(-X|--method)\s*DELETE/i.test(seg)) return "DELETE calls to the GitHub API are not allowed.";
    if (/^rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r)\b/.test(seg)) {
      const targets = seg.split(/\s+/).slice(1).filter((t) => !t.startsWith("-"));
      for (const t of targets) {
        const abs = isAbsolute(t) || t.startsWith("~") ? t.replace(/^~/, process.env.HOME ?? "~") : resolve(cwd, t);
        if (t === "*" || t === "." || !abs.startsWith(resolve(root) + "/")) {
          return `rm -rf on "${t}" is outside this repo or too broad, and is not allowed.`;
        }
      }
    }
    if (/^(cat|less|more|head|tail|bat|cp|scp)\b.*[\s/]\.env(\.[\w-]+)?(\s|$)/.test(seg)) {
      return "Reading .env files is not allowed; they hold secrets.";
    }
  }
  return null;
}

const reason = check();
if (reason) {
  try {
    mkdirSync(join(root, ".hq"), { recursive: true });
    appendFileSync(join(root, ".hq", "audit.log"), JSON.stringify({ ts: Date.now(), session: input.session_id ?? null, tool: "Bash", event: "blocked", command: command.slice(0, 300), reason }) + "\n");
  } catch {}
  process.stderr.write(`Blocked by hq-sandbox guardrails: ${reason}\n`);
  process.exit(2);
}
process.exit(0);
