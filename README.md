# agent-ui

`agent-ui` is a task board and dashboard for AI agent workflows.

It gives humans a UI and gives agents a deterministic task protocol via the `task` CLI and skill docs.

## Architecture

- App: data (`tasks.json`) + HTTP API + web UI + `agent-ui` CLI
- Skill: [`skills/task-board/SKILL.md`](skills/task-board/SKILL.md) defines agent operating protocol
- Adapters: agent-specific glue for OpenClaw, Claude Code, or standalone CLI agents

This system is not a separate dispatcher service. The agent reads the skill and uses CLI guardrails.

## Quick Start

```bash
git clone https://github.com/ee92/agent-ui.git
cd agent-ui
npm install
npm run build
agent-ui init
agent-ui start
```

Then open:

```text
http://localhost:18789
```

## Setup Wizard (`agent-ui init`)

`agent-ui init` runs non-interactively and sets up local defaults:

- Detects agent mode (`openclaw`, `claude-code`, or standalone)
- Detects workspace path
- Creates `~/.agent-ui/config.json` if missing
- Creates `<workspace>/tasks.json` if missing
- Checks whether `claude` CLI is on `PATH`
- Prints setup summary and next steps

If config already exists, it prints current config and reports that it is already configured.

## Task CLI Reference

Use `task` to operate board state safely.

```bash
task list [--status STATUS] [--json]
task eligible [--json]
task claim ID [--session KEY] [--branch NAME]
task start ID [--session KEY] [--branch NAME]
task plan ID "summary"
task block ID "reason"
task review ID "summary + evidence"
task done ID "summary + evidence"
task note ID "progress note"
task edit ID [--title ...] [--desc ...] [--status ...] [--branch ...]
task stats
task rm ID
```

## How Agents Interact

Agents follow the skill + CLI protocol:

1. Inspect board state (`task list` / `task eligible --json`)
2. Claim work atomically (`task claim ID`)
3. Implement and log progress (`task note`)
4. Submit for review (`task review`)
5. Human marks final completion (`task done`)

The CLI enforces transition, dependency, and concurrency guardrails.

## Autonomous Pickup Pattern

Typical autonomous loop:

1. A scheduler (cron/OpenClaw trigger) starts the agent
2. Agent runs `task eligible --json`
3. Agent claims highest-priority eligible task via `task claim ID`
4. Agent executes work and posts `task review` with evidence
5. Human reviews and later sets `done`

## Configuration

Primary config:

- `~/.agent-ui/config.json`
- Keys:
  - `workspace`: absolute workspace path
  - `agent`: detected adapter mode
  - `maxConcurrent`: concurrent active task cap

Task board file:

- `<workspace>/tasks.json`
- Includes board metadata and task records
- Default includes `config.maxConcurrent`

## Supported Agents

- OpenClaw
- Claude Code
- Standalone CLI agent workflows

## File Locations

```text
~/.agent-ui/config.json          # agent-ui local config
~/.agent-ui/agent-ui.log         # service/background logs
~/.agent-ui/agent-ui.pid         # fallback process pid
<workspace>/tasks.json           # task board data
skills/task-board/SKILL.md       # agent protocol
```

## License

MIT. See [LICENSE](./LICENSE).
