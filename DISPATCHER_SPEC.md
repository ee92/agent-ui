# Dispatcher Spec

## Overview

The dispatcher is an orchestration layer inside serve.mjs that reads the task board, picks up eligible tasks, and spawns agent sessions to work on them. It runs on a cron schedule (configurable, default every 15 minutes).

## TaskNode Schema Changes

```typescript
interface TaskNode {
  // ... existing fields ...
  
  // CHANGED: sessionKey stays as primary active session
  sessionKey: string | null;
  
  // EXISTING: all sessions that worked on this task  
  sessionKeys?: string[];
  
  // NEW: task IDs that must be done before this task can be picked up
  blockedBy?: string[];
  
  // NEW: max concurrent tasks the dispatcher will run (global setting, not per-task)
  // (this lives in config, not on TaskNode)
}
```

Only one new field on TaskNode: `blockedBy: string[]`.

The `sessionKey` field already exists and already tracks linked sessions. The dispatcher will use it.

## Dispatch Cycle

```
dispatch() — called by cron scheduler or manually via API

1. READ tasks.json
2. FILTER eligible tasks:
   - status === 'todo'
   - NOT a child of another todo task (parent-first ordering)
   - blockedBy is empty OR all blockedBy task IDs have status 'done'
   - does NOT already have an active run (check run-manager active runs)
3. SORT by order field (lower = higher priority, same as UI display)
4. LIMIT to maxConcurrent (default: 1, configurable)
5. For each eligible task:
   a. Has sessionKey with existing Claude session?
      → resume: claude --print --verbose --output-format stream-json --resume <sessionId> "<task prompt>"
      No sessionKey?
      → create new: claude --print --verbose --output-format stream-json "<task prompt>"
      → capture sessionId from CLI output, write back to task
   b. Set task status: todo → active
   c. Set task.sessionKey to the session ID
   d. Append to task.sessionKeys[]
   e. Track the run in run-manager
6. WRITE tasks.json
7. RETURN dispatch report: { picked: [...], skipped: [...], blocked: [...] }
```

## Task Prompt Construction

When the dispatcher spawns a session for a task, it builds a prompt from the task data:

```
You are working on task: {task.title}

Description: {task.description}

Notes so far:
{task.notes}

Repo: {task.repo || 'not specified'}
Branch: {task.branch || 'not specified'}

Instructions:
- Work on this task to completion
- When done, update the task status by writing to tasks.json or report what you've accomplished
- If you're blocked or need human input, note what you need
- If the task is too vague, break it down into subtasks
```

## Completion Handling

When a run completes (run-manager emits session.completed):
- If exit code 0: set task status → review
- If exit code non-zero: set task status → blocked, append error to notes
- Append run summary to task notes
- The human reviews and moves to done (never auto-done)

## Where This Fits in serve.mjs

```javascript
// In serve.mjs, alongside existing imports:
import { dispatch, getDispatchStatus } from "./server/dispatcher.mjs";

// New API routes:
// POST /api/dispatch          — trigger dispatch manually
// GET  /api/dispatch/status   — last dispatch report
// POST /api/dispatch/config   — update dispatch settings

// In the cron scheduler, add a built-in "dispatch" job type:
// Instead of command: "shell command", support command: "@dispatch"
// When scheduler sees @dispatch, it calls dispatch() directly
```

## New File: server/dispatcher.mjs

```javascript
// ~80 lines of orchestration logic

import { readFileSync, writeFileSync } from "node:fs";
import { startRun, getRunStatus } from "./claude/run-manager.mjs";

const DEFAULT_CONFIG = {
  maxConcurrent: 1,       // max tasks to work on simultaneously
  taskStatuses: ["todo"],  // which statuses to pick up
  promptTemplate: null,    // custom prompt template (null = default)
};

let lastReport = null;

export async function dispatch(tasksPath, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const file = JSON.parse(readFileSync(tasksPath, "utf8"));
  const tasks = file.tasks;
  
  // 1. Find eligible tasks
  const eligible = tasks
    .filter(t => cfg.taskStatuses.includes(t.status))
    .filter(t => !t.blockedBy?.length || t.blockedBy.every(
      depId => tasks.find(d => d.id === depId)?.status === "done"
    ))
    .filter(t => {
      // Skip if already has an active run
      if (!t.sessionKey) return true;
      const run = getRunStatus(t.sessionKey);
      return !run || run.status !== "running";
    })
    .sort((a, b) => a.order - b.order)
    .slice(0, cfg.maxConcurrent);
  
  if (eligible.length === 0) {
    lastReport = { ts: Date.now(), picked: [], skipped: "no eligible tasks" };
    return lastReport;
  }
  
  // 2. Spawn sessions for each
  const picked = [];
  for (const task of eligible) {
    const prompt = buildPrompt(task);
    
    const run = await startRun(
      task.sessionKey || `task-${task.id}`,
      prompt,
      {
        cwd: task.repo ? findRepoCwd(task.repo) : undefined,
        onEvent: (event) => handleTaskEvent(task.id, event, tasksPath),
      }
    );
    
    // Update task in-place
    task.status = "active";
    task.sessionKey = run.sessionKey;
    task.sessionKeys = [...new Set([...(task.sessionKeys || []), run.sessionKey])];
    task.updatedAt = new Date().toISOString();
    task.history = [...(task.history || []), {
      from: "todo", to: "active", at: task.updatedAt, by: "dispatcher"
    }];
    
    picked.push({ taskId: task.id, title: task.title, runId: run.runId });
  }
  
  // 3. Write back
  writeFileSync(tasksPath, JSON.stringify(file, null, 2));
  
  lastReport = { ts: Date.now(), picked };
  return lastReport;
}

export function getDispatchStatus() {
  return lastReport;
}
```

## Configuration

In `~/.agent-ui/config.json` or `mc.config.json`:

```json
{
  "dispatcher": {
    "enabled": false,
    "maxConcurrent": 1,
    "schedule": "*/15 * * * *",
    "statuses": ["todo"],
    "promptTemplate": null
  }
}
```

Disabled by default. User explicitly enables: `agent-ui dispatch enable` or via UI toggle.

## Safety

- **Disabled by default** — user must opt-in to autonomous task pickup
- **maxConcurrent: 1** — only one task at a time by default
- **Never auto-done** — always goes to review for human approval
- **Blocked on error** — failed runs mark task as blocked, not retry
- **Dispatch report** — every cycle logs what it did and why

## API Summary

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/dispatch | Trigger dispatch now |
| GET | /api/dispatch/status | Last dispatch report |
| PATCH | /api/dispatch/config | Update config |

## UI Changes

- Dashboard shows "Dispatcher: enabled/disabled" status
- Dispatch report visible in activity feed
- Task cards show "Picked up by dispatcher" in notes
- Settings panel to enable/configure dispatcher
