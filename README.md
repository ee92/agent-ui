# agent-ui

A dashboard for humans working with AI coding agents.

You give agents tasks. They work in the background. **agent-ui** is how you see what's happening — a single page that shows your task board, agent conversations, project files, and repo status.

## Why

Coding agents (Claude Code, OpenClaw, Codex) run in terminals and log files. When you have multiple agents working across repos, you lose track fast:

- What's each agent doing right now?
- Which tasks are blocked?
- Did that last commit break anything?
- What did the agent say 20 minutes ago?

agent-ui gives you one place to see all of it. No switching between terminals, no grepping through logs.

## What You Get

- **Task Board** — kanban view of all agent tasks. Create, assign, track status (todo → active → review → done). Agents update tasks via CLI; you see changes in real time.
- **Conversations** — read agent chat history as it happens. Click into any session to see the full thread.
- **Files** — browse your workspace files directly in the UI. Quick access without switching to your editor.
- **Timeline** — chronological feed of everything: task transitions, commits, agent activity.
- **Projects** — auto-discovers all git repos under your home directory. Shows branch, dirty files, ahead/behind, stash count — a quick health check across all your code.
- **System Flow** — (OpenClaw) live view of gateway connections and agent routing.

## Install

```bash
npm install -g agent-ui
```

## Setup

```bash
agent-ui init
```

This auto-detects your environment:
- Finds your agent type (OpenClaw, Claude Code, or standalone)
- Sets your workspace path
- Creates config at `~/.agent-ui/config.json`
- Creates `tasks.json` in your workspace if it doesn't exist

## Run

```bash
agent-ui start
```

Opens at [http://localhost:18789](http://localhost:18789).

The server installs itself as a system service (systemd on Linux, launchd on macOS) so it survives reboots. File changes auto-restart the server.

## CLI Reference

```
agent-ui init        Set up config and workspace
agent-ui start       Start the dashboard (installs as service)
agent-ui stop        Stop the dashboard
agent-ui status      Check if it's running
agent-ui logs        View server logs
agent-ui config      Print current configuration
agent-ui uninstall   Remove the service (keeps your data)
```

## Task CLI

Agents interact with the board through the `task` CLI. Humans can too.

```bash
task list                        # show the board
task add "Build auth module"     # create a task
task start 3                     # mark as active
task note 3 "halfway done"       # log progress
task review 3 "PR ready"         # submit for review
task done 3 "merged in abc123"   # mark complete
```

Full commands: `list`, `eligible`, `claim`, `start`, `plan`, `block`, `review`, `done`, `note`, `edit`, `stats`, `rm`.

The CLI enforces state transitions (you can't skip from todo to done), dependency ordering, and concurrency limits.

## How Agents Use It

Agents don't use the UI — they use the `task` CLI and follow the protocol defined in [`skills/task-board/SKILL.md`](skills/task-board/SKILL.md):

1. Check for available work → `task eligible --json`
2. Claim a task → `task claim ID`
3. Do the work, log progress → `task note ID "update"`
4. Submit for human review → `task review ID "summary + evidence"`
5. Human approves → `task done ID`

This keeps agents on-protocol without needing API integrations. The skill doc is the interface.

## Project Discovery

By default, agent-ui scans your home directory for git repos, skipping noise directories (`node_modules`, `.cache`, etc.) and stopping at the first `.git` it finds in each tree (no duplicates from submodules or nested repos).

To override, set `repos.roots` in your config:

```json
{
  "repos": {
    "roots": ["~/projects", "~/work"],
    "depth": 4
  }
}
```

## Configuration

Config lives at `~/.agent-ui/config.json`:

```json
{
  "workspace": "/home/you/.openclaw/workspace",
  "agent": "openclaw",
  "maxConcurrent": 3
}
```

| Key | Description |
|-----|-------------|
| `workspace` | Path to your agent workspace (auto-detected) |
| `agent` | Agent adapter: `openclaw`, `claude-code`, or `none` |
| `maxConcurrent` | Max tasks an agent can work on simultaneously |
| `repos.roots` | Directories to scan for git repos (optional) |
| `repos.depth` | Max directory depth for repo scan (default: 4) |

## File Locations

```
~/.agent-ui/config.json       Config
~/.agent-ui/agent-ui.log      Server logs
~/.agent-ui/agent-ui.pid      PID file (fallback)
<workspace>/tasks.json         Task board data
skills/task-board/SKILL.md     Agent protocol definition
```

## Supported Agents

- **OpenClaw** — full integration (gateway connection, live sessions, system flow)
- **Claude Code** — task board + file browser
- **Standalone** — any agent that can shell out to `task` CLI

## License

MIT. See [LICENSE](./LICENSE).
