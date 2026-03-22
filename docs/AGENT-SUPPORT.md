# Broader Agent Support Plan

agent-ui works with any agent that can run shell commands (`task` CLI). But the observability layer (conversations, timeline) only reads from OpenClaw and Claude Code today.

## Current State

| Feature | OpenClaw | Claude Code | Others |
|---------|----------|-------------|--------|
| Task board | ✅ | ✅ | ✅ (via `task` CLI) |
| Conversations | ✅ (live gateway) | ✅ (transcript files) | ❌ |
| Timeline | ✅ | ✅ | ❌ |
| System Flow | ✅ | ❌ | ❌ |
| Auto-detect (`init`) | ✅ | ✅ | Falls back to "standalone" |
| Projects/repos | ✅ | ✅ | ✅ |

## Target Agents

### Codex (OpenAI)
- Config: `~/.codex/`
- Sessions: `~/.codex/sessions/*.jsonl` — structured JSONL, similar to OpenClaw transcripts
- Auth: OAuth via ChatGPT Plus (`~/.codex/auth.json`)
- Complexity: Low — JSONL parser, similar shape to what we already have

### Cursor
- Config: `~/.cursor/` + workspace `.cursor/` dirs
- Sessions: SQLite-based workspace storage (VS Code derivative)
- Complexity: Medium — need SQLite reader, different data model

### Copilot (GitHub)
- Config: VS Code extension state
- Sessions: Extension logs, no clean transcript format
- Complexity: High — tightly coupled to VS Code, no standalone session files

### Pi
- Config: `~/.pi/` (TBD)
- Sessions: TBD — need to investigate
- Complexity: Unknown

## Implementation Order

### Phase 1: Codex
Lowest hanging fruit. JSONL format is close to what we already parse.

1. Add `~/.codex/` detection to `detectAgent()` in `agent-ui.mjs`
2. Write a Codex transcript parser (similar to `transcript-parser.mjs`)
3. Wire it into the conversations/timeline views
4. Test with real Codex sessions (we have them on this machine)

### Phase 2: Generic adapter interface
Before adding more agents one-by-one, define a clean adapter interface:

```js
// adapter interface
{
  detect(): boolean,                    // does this agent exist on the system?
  workspace(): string,                  // where does it work?
  sessions(): SessionMeta[],            // list available sessions
  transcript(id: string): Message[],    // read a session's messages
}
```

Then each agent is just an implementation of this interface. OpenClaw and Claude Code get refactored into it, new agents plug in.

### Phase 3: Cursor + others
With the adapter interface in place, adding new agents becomes mechanical:
- Implement `detect()`, `sessions()`, `transcript()`
- Register the adapter
- Done

## Non-goals
- **Controlling agents from the UI** — agents are launched externally (terminal, cron, CI). agent-ui is read-only + task board.
- **Live streaming from non-OpenClaw agents** — would need each agent to support a push protocol. Not realistic short-term.
- **System Flow for other agents** — that's an OpenClaw gateway concept, doesn't translate.
