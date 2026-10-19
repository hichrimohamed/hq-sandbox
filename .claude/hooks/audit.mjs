#!/usr/bin/env node
// PostToolUse audit log: one JSON line per shell command or file edit an agent
// made, in .hq/audit.log. /hq-sync shows the latest entries in the HQ office.
// Never blocks: any error is swallowed.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  const detail = tool === "Bash" ? String(ti.command ?? "").slice(0, 300) : ti.file_path ? relative(root, ti.file_path) : "";
  mkdirSync(join(root, ".hq"), { recursive: true });
  appendFileSync(join(root, ".hq", "audit.log"), JSON.stringify({ ts: Date.now(), session: input.session_id ?? null, tool, event: "ran", detail }) + "\n");
} catch {}
process.exit(0);
