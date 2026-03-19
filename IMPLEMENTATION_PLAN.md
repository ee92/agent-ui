# Implementation Plan: Task System Restructure

## Vision

A task management system with a clean separation of concerns:

1. **App** — data layer + API + UI + CLI (dumb CRUD, deterministic guardrails)
2. **Skill** — agent behavior protocol (how agents should use the system)
3. **Adapters** — agent-specific glue (OpenClaw vs Claude Code vs standalone)

The dispatcher is NOT a code module. It's an agent reading the skill, checking the board, and picking up work — triggered by a cron tick.

---

## Current State

### What exists and works:
- `tasks.json` — flat task storage with tree rendering (parentId)
- `task` CLI (535 lines) — add/start/block/review/done/note/edit/rm/stats
- CLI has: transition validation, history recording, Telegram notifications, session linking
- `task-engine.ts` — pure functions for tree operations, used by UI
- `task-types.ts` — TypeScript types with TASK_TRANSITIONS map
- UI — task board with create/edit modals, pipeline view, context cards
- `serve.mjs` — HTTP server with task CRUD API, file browser, session viewer, cron, dispatch
- `server/dispatcher.mjs` — 212 lines, eligibility logic + Claude CLI spawning
- `server/cron/scheduler.mjs` — built-in cron with `@dispatch` magic command
- `server/claude/run-manager.mjs` — spawns `claude --print`, parses stream-json

### What's wrong:
- dispatcher.mjs duplicates rules that should be in the skill
- run-manager.mjs duplicates session management that agents already have
- scheduler.mjs duplicates OpenClaw cron
- No blockedBy enforcement in CLI `task start`
- No max concurrent enforcement in CLI
- No file locking for concurrent access
- No setup wizard / `agent-ui init`
- Dispatcher not configurable from UI
- TASKS_FILE in CLI is hardcoded to `~/.openclaw/workspace/tasks.json`

---

## Architecture After Restructure

```
┌─────────────────────────────────────────────────────────┐
│                      agent-ui                           │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ tasks.json│  │ HTTP API │  │    UI    │  │  CLI   │  │
│  │  (data)   │←→│  (CRUD)  │←→│(human)   │  │(agent) │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│                      ↑                          ↑       │
│              ┌───────┴──────────────────────────┘       │
│              │  Guardrails (in code):                    │
│              │  - State machine transitions              │
│              │  - blockedBy enforcement                  │
│              │  - Max concurrent enforcement             │
│              │  - File locking                           │
│              │  - Mandatory history/audit trail          │
│              └──────────────────────────────────────────┘
└─────────────────────────────────────────────────────────┘
                          ↑
                    CLI interface
                          ↑
┌─────────────────────────────────────────────────────────┐
│                   SKILL.md                              │
│                                                         │
│  Protocol for agents:                                   │
│  - How to check the board and pick up work              │
│  - How to approach tasks (read desc, check notes)       │
│  - Git conventions (branch, commit, don't merge main)   │
│  - When to block yourself vs push through               │
│  - How to write good review notes                       │
│  - Communication style                                  │
│  - Dispatcher behavior (the cron-triggered pickup)      │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          ↑
                  reads & follows
                          ↑
┌─────────────────────────────────────────────────────────┐
│                    Agent                                │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Adapter layer (thin):                            │   │
│  │                                                  │   │
│  │ OpenClaw:     sessions_spawn, openclaw cron,     │   │
│  │               auth from openclaw.json            │   │
│  │                                                  │   │
│  │ Claude Code:  claude --resume, built-in cron,    │   │
│  │               auth from ~/.claude/               │   │
│  │                                                  │   │
│  │ Standalone:   any CLI agent, system cron or      │   │
│  │               built-in scheduler                 │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 1: Harden the CLI (Guardrails)

The CLI is the single source of truth for state transitions. Make it bulletproof.

### 1.1 blockedBy enforcement on `task start`

**File:** `~/workspace/bin/task` (the CLI)

Before transitioning to `active`, check:
```javascript
if (task.blockedBy?.length) {
  const unresolved = task.blockedBy.filter(depId => {
    const dep = tasks.find(t => t.id === depId);
    return !dep || dep.status !== "done";
  });
  if (unresolved.length > 0) {
    console.error(`Blocked by unfinished tasks: ${unresolved.join(", ")}`);
    process.exit(1);
  }
}
```

Also add to `task list --json` output so agents can see dependencies without guessing.

### 1.2 Max concurrent enforcement on `task start`

Config in `tasks.json` metadata or a separate `~/.agent-ui/config.json`:
```json
{ "maxConcurrent": 3 }
```

In `task start`:
```javascript
const activeCount = tasks.filter(t => t.status === "active").length;
const maxConcurrent = data.config?.maxConcurrent ?? Infinity;
if (activeCount >= maxConcurrent) {
  console.error(`Max concurrent tasks reached (${maxConcurrent}). Finish or block an active task first.`);
  process.exit(1);
}
```

Add `--force` flag to bypass for human override.

### 1.3 File locking

Use `proper-lockfile` or a simple `.lock` file strategy:
```javascript
const lockfile = TASKS_FILE + ".lock";
// Acquire lock before read-modify-write
// Release after save
// Fail fast if locked (don't queue — agent can retry)
```

This prevents two agents from clobbering each other's writes.

### 1.4 Parent-child enforcement

On `task start`, reject if any ancestor has status `todo`:
```javascript
let parent = tasks.find(t => t.id === task.parentId);
while (parent) {
  if (parent.status === "todo") {
    console.error(`Parent task ${parent.id} ("${parent.title}") is still todo. Start parent first or remove dependency.`);
    process.exit(1);
  }
  parent = tasks.find(t => t.id === parent.parentId);
}
```

### 1.5 Session auto-detection from environment

```javascript
// In task start:
const sessionKey = flag("--session") 
  || process.env.OPENCLAW_SESSION_KEY   // OpenClaw injects this
  || process.env.CLAUDE_SESSION_ID      // Claude Code could set this
  || `task-${task.id}`;                 // fallback
```

### 1.6 Make TASKS_FILE configurable

```javascript
const TASKS_FILE = process.env.TASK_FILE 
  || flag("--file")
  || path.join(process.env.MC_WORKSPACE || path.join(process.env.HOME, ".openclaw/workspace"), "tasks.json");
```

### 1.7 `task eligible` command

New command for agents to quickly see what they can pick up:
```bash
task eligible [--json]
```

Returns tasks that are:
- status = todo (or plan, if approved)
- blockedBy all resolved
- no ancestor in todo
- under maxConcurrent limit

This is the deterministic query the skill tells agents to run.

### 1.8 `task claim ID`

Atomic operation: check eligibility + start + lock in one step. Fails if task was claimed between read and write. Replaces the need for agents to do `task eligible` then `task start` as separate steps (race window).

```bash
task claim ID [--session KEY]
# Equivalent to: check eligible → start → record session
# Atomic: fails if task was modified since read
```

---

## Phase 2: Write the Skill

**File:** `skills/task-board/SKILL.md`

This is the agent-facing protocol. What the agent reads to understand how to use the system.

### Structure:
```markdown
# Task Board Skill

## Overview
You manage work through a task board. The `task` CLI is your interface.

## Quick Reference
- `task list` — see the board
- `task eligible --json` — what can you pick up right now
- `task claim ID` — claim a task (atomic start + session link)
- `task note ID "progress"` — log progress
- `task review ID "what was done"` — submit for human review
- `task block ID "reason"` — flag a blocker

## Picking Up Work
1. Run `task eligible --json` to see available tasks
2. Read the task's description and notes before starting
3. Run `task claim ID` to claim it
4. If the description is vague, break it into subtasks with `task add`

## Working on a Task
- Log progress with `task note ID "what you did"` periodically
- If you need something from the human, use `task block ID "what you need"`
- Link your branch: `task edit ID --branch feat/whatever`
- Commit often with clear messages

## Completing Work
- Run tests. Include evidence (commit hash, test output, screenshot)
- Submit with `task review ID "summary of changes, commit abc1234"`
- Never skip straight to done. Always go through review.

## Git Conventions
- Create a branch: `git checkout -b feat/<short-desc>` or `fix/<short-desc>`
- Never merge to main. Push the branch, let the human merge.
- Include commit hash in your review note.

## Dependencies
- The CLI enforces blockedBy — you can't start a task with unfinished dependencies
- If you need to do A before B, tell the human to set blockedBy
- You can also use `task edit ID --blocked-by OTHER_ID` (proposed new flag)

## What NOT to do
- Don't edit tasks.json directly. Always use the CLI.
- Don't set a task to done. Only review.
- Don't start multiple tasks simultaneously (maxConcurrent is enforced)
- Don't guess at requirements. Block yourself and ask.
```

### Adapter-specific sections:

The skill can include conditional sections or reference adapter docs:

```markdown
## Agent-Specific Setup

### OpenClaw
The task board cron runs via OpenClaw's cron config. Your session key is
auto-detected from the environment. No extra setup needed.

### Claude Code
Run `agent-ui start` to get the dashboard. The built-in scheduler can
trigger task checks on an interval. Set your API key in ~/.claude/ config.

### Standalone
Use system cron to periodically run your agent with the task check prompt.
The CLI works with any agent that can execute shell commands.
```

---

## Phase 3: Refactor agent-ui Server

### 3.1 Delete dispatcher.mjs

The dispatcher logic moves to the skill. The agent IS the dispatcher. Delete:
- `server/dispatcher.mjs` (212 lines)
- All dispatcher imports/routes in `serve.mjs`
- `~/.agent-ui/dispatcher.json` config

### 3.2 Simplify run-manager.mjs (keep for standalone mode only)

For OpenClaw users: not needed. `sessions_spawn` handles everything.

For standalone Claude Code users: keep a slimmed-down version that:
- Spawns `claude --print` for a task
- Captures session ID
- Calls `task review ID` or `task block ID` on completion/failure
- Removes all the eligibility/filtering logic (that's in the CLI now)

Rename to `server/standalone-runner.mjs` to make the scope clear.

### 3.3 Keep the cron scheduler (for standalone mode)

OpenClaw users don't need it. Claude Code standalone users do. Keep it but:
- Remove the `@dispatch` magic command
- Cron jobs just run shell commands (e.g., trigger the agent with a prompt)
- Make it clearly optional in the setup flow

### 3.4 API routes stay

The HTTP API for tasks stays as-is. It's the same CRUD the CLI does, over HTTP for the UI:
- `GET /api/tasks` — list
- `POST /api/tasks` — create
- `PATCH /api/tasks/:id` — update
- `DELETE /api/tasks/:id` — delete

But the API should call the same guardrail functions as the CLI (shared validation). 
Extract the transition/validation logic into a shared module.

### 3.5 Shared validation module

**New file:** `lib/task-guards.mjs`

Extracted from the CLI, used by both CLI and HTTP API:
```javascript
export function validateTransition(task, newStatus) { ... }
export function checkBlockedBy(task, allTasks) { ... }
export function checkMaxConcurrent(allTasks, config) { ... }
export function checkParentReady(task, allTasks) { ... }
export function findEligible(allTasks, config) { ... }
```

The CLI imports this. The HTTP API imports this. Same rules everywhere.

---

## Phase 4: UI Improvements

### 4.1 Dispatcher panel → Task Settings panel

Replace the dispatcher status display with a simpler settings panel:
- Max concurrent slider (1-10)
- Eligible tasks count (live from `findEligible()`)
- No more enable/disable toggle (there's no dispatcher to toggle — agents just check the board)

### 4.2 blockedBy editor in task edit modal

Currently the edit modal doesn't expose blockedBy. Add:
- Dropdown/typeahead to select dependency tasks
- Visual indicator on task cards showing dependency chains
- "Blocked by X" badge on task cards

### 4.3 Claim history in task detail

Show the full audit trail: who claimed it, when, which session, status changes. Already have `history[]` on tasks — just need UI to render it.

### 4.4 Agent activity indicator

Show which tasks are currently being worked on by agents. The `sessionKey` field already exists — the UI can check if there's an active session for that key and show a "🤖 Agent working" badge.

---

## Phase 5: Adapter Layer

### 5.1 Define the adapter interface

**File:** `src/lib/adapters/types.ts` (already exists, update it)

```typescript
interface AgentAdapter {
  // Identity
  name: string;  // "openclaw" | "claude-code" | "standalone"
  
  // Session operations
  listSessions(): Promise<Session[]>;
  getSession(key: string): Promise<Session | null>;
  getTranscript(key: string): Promise<Message[]>;
  
  // Cron (optional — OpenClaw has its own)
  hasCron: boolean;
  
  // Auth
  resolveAuth(): Promise<{ apiKey?: string }>;
  
  // Workspace
  getWorkspacePath(): string;
  getTasksPath(): string;
}
```

### 5.2 OpenClaw adapter

- Sessions: read from `~/.openclaw/agents/main/sessions/`
- Cron: not needed (OpenClaw handles it)
- Auth: from `~/.openclaw/openclaw.json` or auth-profiles
- Workspace: from `~/.openclaw/workspace/`

### 5.3 Claude Code adapter

- Sessions: read from `~/.claude/projects/` or `~/.claude/sessions/`
- Cron: uses built-in scheduler
- Auth: from `~/.claude/settings.json` or `ANTHROPIC_API_KEY`
- Workspace: from config or `$HOME`

### 5.4 Standalone adapter

- Sessions: none (or custom)
- Cron: uses built-in scheduler or system cron
- Auth: from env var
- Workspace: from config

---

## Phase 6: Setup & Onboarding

### 6.1 `agent-ui init` command

Interactive setup wizard:
```
$ agent-ui init

Agent UI Setup
──────────────

Detected agent: OpenClaw ✓

Workspace: ~/.openclaw/workspace
Tasks file: ~/.openclaw/workspace/tasks.json

? Max concurrent tasks [3]: 
? Set up task board cron? (checks for eligible tasks every N minutes) [y/N]: 

✓ Configuration saved to ~/.agent-ui/config.json
✓ Task board ready

Next steps:
  1. Open http://localhost:18789 to see the dashboard
  2. Run `task add "My first task"` to create a task
  3. Install the task skill for your agent (see docs)
```

### 6.2 Install skill from ClawHub

The skill should be publishable to ClawHub:
```bash
clawhub install task-board
```

This gives any OpenClaw agent the ability to manage tasks autonomously.

### 6.3 README update

Rewrite README to reflect the new architecture:
- What it is (task board + dashboard, not a dispatcher)
- How to install
- How agents interact with it (skill + CLI)
- How the adapter layer works
- How to set up autonomous task pickup (cron + skill)

---

## Phase 7: Publish & Share

### 7.1 npm package

Already has `bin.agent-ui` in package.json. Ensure:
- `npx agent-ui` works out of the box
- `npm install -g agent-ui` works
- Post-install message points to `agent-ui init`

### 7.2 Skill on ClawHub

Publish `skills/task-board/` to ClawHub:
- SKILL.md (the protocol)
- CLI reference
- Adapter notes

### 7.3 Standalone bundle

For non-OpenClaw users:
- Single `npx agent-ui` gets everything
- Built-in scheduler covers the cron gap
- Standalone runner covers the session gap
- Works with any agent that can run shell commands

---

## Implementation Order

| # | Task | Effort | Priority |
|---|------|--------|----------|
| 1.1 | blockedBy enforcement in CLI | 30 min | P0 |
| 1.2 | maxConcurrent enforcement in CLI | 30 min | P0 |
| 1.7 | `task eligible` command | 30 min | P0 |
| 1.8 | `task claim` command | 45 min | P0 |
| 2 | Write SKILL.md | 1 hr | P0 |
| 3.5 | Extract shared validation module | 1 hr | P0 |
| 1.3 | File locking | 45 min | P1 |
| 1.4 | Parent-child enforcement | 30 min | P1 |
| 1.5 | Session auto-detection | 15 min | P1 |
| 1.6 | Configurable TASKS_FILE | 15 min | P1 |
| 3.1 | Delete dispatcher.mjs | 30 min | P1 |
| 3.2 | Slim down run-manager | 1 hr | P1 |
| 4.2 | blockedBy editor in UI | 1 hr | P2 |
| 4.3 | Claim history in UI | 45 min | P2 |
| 6.1 | `agent-ui init` command | 1 hr | P2 |
| 6.3 | README rewrite | 1 hr | P2 |
| 5 | Adapter cleanup | 2 hr | P2 |
| 4.1 | Task settings panel | 45 min | P3 |
| 4.4 | Agent activity indicator | 30 min | P3 |
| 6.2 | Publish skill to ClawHub | 30 min | P3 |
| 7 | npm publish + standalone bundle | 1 hr | P3 |

**Total estimated effort: ~15 hours**

P0 items (~3.5 hrs) make the system correct and usable.
P1 items (~3 hrs) make it robust.
P2 items (~5.5 hrs) make it polished.
P3 items (~3 hrs) make it shareable.

---

## Key Principles

1. **CLI is the guardrail.** All state integrity rules are enforced in code by the CLI and shared validation module. Agents can't corrupt the board even with bad instructions.

2. **Skill is the brain.** How to approach work, when to block, how to write good notes — these are judgment calls that live in SKILL.md, not in code.

3. **Adapters are thin glue.** Different agents have different session/cron/auth mechanisms. The adapter translates, nothing more.

4. **No magic dispatcher.** There's no 200-line module deciding what to run. An agent reads the board, picks eligible work, does it. The "dispatch" is just a cron tick that says "hey agent, check the board."

5. **agent-ui is a dashboard, not an orchestrator.** It shows the board, provides the API, renders the UI. It doesn't tell agents what to do — the skill does that.
