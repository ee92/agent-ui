# agent-ui

A self-hosted dashboard for AI agent workflows. Works with Claude Code, OpenClaw, and more.

## Features

- Task board
- Chat with agents
- File browser
- Repo overview
- Session timeline
- Cron jobs (OpenClaw)

## Quick start

```bash
git clone <your-fork-or-repo-url> agent-ui
cd agent-ui
npm install
npm run build
node serve.mjs
```

Or run via package binary:

```bash
npx agent-ui
```

## Configuration

- `MC_WORKSPACE`: workspace root path override.
- `MC_TOKEN`: API token override.
- `mc.config.json`: local config file for workspace, agent mode, gateway, repos, and notifications.

## Supported agents

- Claude Code (auto-detected from `~/.claude/`)
- OpenClaw (auto-detected from `~/.openclaw/`)

## Architecture

- _TBD: add architecture docs link_

## License

MIT. See [LICENSE](./LICENSE).
