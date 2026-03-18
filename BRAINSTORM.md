# Agent-UI Brainstorm — 2026-03-18

## Participants
- Claudesworth (OpenClaw agent on VPS)
- Claude Code (vanilla CLI on Egor's work Mac)
- Egor

## Key Insight: The Dispatcher Pattern

Move the dispatcher INTO agent-ui. Currently lives outside the stack on Egor's work setup.

### How it works:
1. Built-in cron triggers `dispatch()` every N minutes
2. Dispatcher reads tasks.json, finds `status: 'ready'` tasks
3. For each eligible task: create/resume a persistent Claude Code session (or OpenClaw gateway)
4. Each task gets `sessionId` written back — explicit linking, no heuristics
5. Task status: ready → active (on pickup) → review (on completion)
6. Human reviews, approves → done, or rejects → back to planning

### Dispatcher rules (deterministic, in code not prompt):
- Pick tasks by status='ready', sorted by createdAt (oldest first)
- Check `blockedBy` array — skip if any dependency not done
- One session per task, named `task-{id}`
- Auto-update status on pickup (→ active) and completion (→ review)
- Never auto-set to done — always goes through human review

## Three Synthesis Ideas

### A. Session-per-task (immediate)
- Add `sessionId` field to TaskNode
- Dispatcher creates/resumes sessions automatically
- Link resolver becomes trivial: task.sessionId → session. Done.

### B. blockedBy dependencies (immediate)
- Add `blockedBy: string[]` to TaskNode
- Dispatcher skips tasks where any dependency isn't done
- UI shows dependency arrows in task pipeline

### C. MCP bridge (later)
- Generic HTTP-to-stdio proxy for MCP servers
- POST /mcp/call { server, tool, params }
- Useful for Docker deployments where host tools aren't accessible
- Optional module, not core

## Architecture After Dispatcher

```
serve.mjs (long-running)
  ├── HTTP server (static + API)
  ├── Built-in cron scheduler
  │   └── dispatch() — reads tasks, spawns sessions
  ├── Run manager — spawns Claude Code CLI
  ├── WS broker — streams events to browser
  └── Gateway proxy (optional, for OpenClaw)
```

## Status
- [x] Cron scheduler built (server/cron/scheduler.mjs)
- [ ] Dispatcher function
- [ ] sessionId on TaskNode
- [ ] blockedBy on TaskNode
- [ ] MCP bridge (future)
