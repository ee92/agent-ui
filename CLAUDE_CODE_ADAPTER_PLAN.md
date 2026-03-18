# Claude Code Browser Adapter Implementation Plan

## Scope and Goal
Build a production-ready client/server split so `claude-code` works from browser-only React UI:
- Browser adapter calls HTTP/WS APIs only
- `serve.mjs` runs Claude CLI and filesystem operations
- Preserve existing `BackendAdapter` interfaces in `src/lib/adapters/types.ts`

This plan assumes March 18, 2026 code state of this repo.

---

## Research Summary (for implementation assumptions)

### What we could verify
- Current browser adapter (`src/lib/adapters/claude-code-adapter.ts`) attempts Node imports and CLI execution directly; it cannot run in browser.
- `claude` binary is not installed in this environment, so direct local `claude --help` and `claude --print ...` validation was not possible.
- Existing `serve.mjs` already has authenticated file endpoints (`/api/files/read`, `/api/files/write`, `/api/files/list`) and WS upgrade handling for OpenClaw.

### CLI behavior from official docs (must validate on target machine during implementation)
- Claude CLI reference documents `--print/-p`, `--output-format text|json|stream-json`, and session resume flags `--resume/-r` and `--continue/-c`.
- Official current docs show `--resume` (not `--session`) for specific session ID reuse.
- Official Agent SDK docs describe persisted transcript path pattern:
  - `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
- Hooks docs also show transcript paths under `~/.claude/projects/...`.

Implementation implication:
- Treat `--session` as legacy/unknown.
- Default to `--resume <id>` and detect CLI capabilities at server startup.
- Discover sessions from `~/.claude/projects` first, with configurable fallback roots.

---

## 1. Architecture Diagram (ASCII)

```text
+----------------------------- Browser (React UI) -----------------------------+
|                                                                              |
|  Chat Store / Files Store                                                    |
|      |                                                                       |
|      v                                                                       |
|  ClaudeCodeAdapter (browser-safe)                                            |
|    - sessions.list/history/create/send/rename/delete -> HTTP                |
|    - files.read/write/list/exists/delete -> HTTP                            |
|    - subscribe() -> WebSocket (/ws/claude-code/events)                      |
|                                                                              |
+-------------------------------|----------------------------------------------+
                                | HTTP + WS (same origin, bearer token)
+-------------------------------v----------------------------------------------+
|                         serve.mjs (Node runtime)                             |
|                                                                              |
|  ClaudeCodeSessionService                                                    |
|   - CLI capability probe (`claude --help`)                                   |
|   - Session index + transcript parsing                                       |
|   - Spawn Claude runs (`claude -p --output-format stream-json ...`)         |
|   - Multiplex stream events to browser via WS                                |
|                                                                              |
|  WorkspaceFileService                                                        |
|   - Read/write/list/delete/exists with path sandboxing                       |
|                                                                              |
|  In-memory runtime state                                                     |
|   - activeRuns[runId]                                                        |
|   - subscribers[clientId]                                                    |
|                                                                              |
+-------------------------------|----------------------------------------------+
                                |
                                v
                    Local machine resources
                    - Claude CLI binary
                    - ~/.claude/projects/**.jsonl
                    - Workspace files
```

---

## 2. Server API Spec

All routes require:
- `Authorization: Bearer <token>` (reuse existing `checkAuth` behavior)
- JSON responses
- Standard error envelope:

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

### 2.1 Sessions: List
`GET /api/claude-code/sessions`

Query params:
- `limit` (optional, default 100)
- `cursor` (optional for pagination)
- `workspace` (optional absolute path; defaults configured workspace)

Response:
```json
{
  "sessions": [
    {
      "key": "session-id",
      "title": "Derived or user title",
      "preview": "Last assistant/user line",
      "updatedAt": "2026-03-18T03:00:00.000Z",
      "createdAt": "2026-03-18T02:00:00.000Z",
      "isStreaming": false,
      "runId": null,
      "cwd": "/abs/project/path",
      "transcriptPath": "/home/user/.claude/projects/.../session-id.jsonl"
    }
  ],
  "nextCursor": null
}
```

Server behavior:
- Discover transcripts by scanning roots (in order):
  1. `process.env.CLAUDE_PROJECTS_DIR`
  2. `~/.claude/projects`
  3. optional fallback roots from config
- Parse metadata from each `.jsonl` (first/last timestamps, preview, optional title markers).
- Cache index with mtime-based invalidation.

### 2.2 Session History
`GET /api/claude-code/sessions/:sessionKey/history`

Query params:
- `limit` (optional, default 500)
- `before` (optional timestamp/cursor)

Response:
```json
{
  "session": {
    "key": "session-id",
    "title": "...",
    "updatedAt": "...",
    "createdAt": "..."
  },
  "messages": [
    {
      "id": "msg-id",
      "role": "user",
      "content": "text",
      "timestamp": "2026-03-18T03:00:00.000Z",
      "thinking": null
    }
  ]
}
```

Server behavior:
- Resolve `sessionKey -> transcriptPath` via index.
- Parse JSONL safely line-by-line.
- Normalize to adapter `Message` shape.
- Ignore malformed lines; include parse warning count in logs.

### 2.3 Create Session
`POST /api/claude-code/sessions`

Request:
```json
{
  "workspace": "/abs/project/path",
  "title": "New Chat"
}
```

Response:
```json
{
  "session": {
    "key": "new-session-id",
    "title": "New Chat",
    "preview": "",
    "updatedAt": "2026-03-18T03:00:00.000Z",
    "createdAt": "2026-03-18T03:00:00.000Z",
    "isStreaming": false,
    "runId": null
  }
}
```

Server behavior:
- Prefer explicit create via lightweight CLI invocation with `-p` prompt (for guaranteed real session ID), OR deferred-create on first send.
- If deferred, generate temporary key `pending-<uuid>` and remap after first CLI result event returns true `session_id`.

### 2.4 Rename Session
`PATCH /api/claude-code/sessions/:sessionKey`

Request:
```json
{ "title": "New title" }
```

Response:
```json
{ "ok": true }
```

Server behavior:
- Since native Claude session rename may not exist in CLI, store title overrides in server metadata file:
  - `~/.openclaw/claude-session-overrides.json`

### 2.5 Delete Session
`DELETE /api/claude-code/sessions/:sessionKey`

Response:
```json
{ "ok": true }
```

Server behavior:
- Soft delete by default: move transcript to trash/archive dir
  - `~/.openclaw/.trash/claude-sessions/...`
- Remove title override.

### 2.6 Send Message (start run)
`POST /api/claude-code/sessions/:sessionKey/messages`

Request:
```json
{
  "message": "User prompt",
  "cwd": "/abs/project/path",
  "stream": true,
  "model": "optional",
  "maxTurns": 10
}
```

Response (immediate ack):
```json
{
  "runId": "run-uuid",
  "sessionKey": "session-id-or-pending",
  "acceptedAt": "2026-03-18T03:00:00.000Z"
}
```

Server behavior:
- Spawn child process and stream CLI output parsing into WS events.
- Use capability-aware args:
  - `claude -p --output-format stream-json`
  - resume flag chosen by probe (`--resume` preferred)
- Track `activeRuns[runId]` state.

### 2.7 Run Status / Cancel
`GET /api/claude-code/runs/:runId`
- returns current state (`queued|running|completed|error|aborted`)

`POST /api/claude-code/runs/:runId/cancel`
- sends SIGINT/SIGTERM to child and emits aborted event

### 2.8 Files API for Claude adapter
Use existing generic file APIs, but fill missing pieces and document canonical use:
- `GET /api/files/list?path=`
- `GET /api/files/read?path=`
- `POST /api/files/write`
- `POST /api/files/delete` (must be added; currently referenced by adapter but not implemented)
- `GET /api/files/exists?path=` (recommended add)

---

## 3. WebSocket Protocol for Streaming

Endpoint:
- `GET /ws/claude-code/events`
- Auth via query token or `Authorization` on initial HTTP upgrade (prefer header)

### 3.1 Client -> Server messages

```json
{ "type": "subscribe", "sessionKey": "abc123" }
```
```json
{ "type": "unsubscribe", "sessionKey": "abc123" }
```
```json
{ "type": "ping", "ts": 1234567890 }
```

### 3.2 Server -> Client messages

Base envelope:
```json
{
  "type": "event",
  "event": "session.streaming",
  "sessionKey": "abc123",
  "runId": "run-uuid",
  "ts": "2026-03-18T03:00:00.000Z",
  "payload": {}
}
```

Event types:
1. `session.streaming`
```json
{ "isStreaming": true }
```

2. `session.delta`
```json
{
  "messageId": "msg-uuid",
  "role": "assistant",
  "delta": "partial text chunk",
  "accumulated": "full text so far"
}
```

3. `session.message`
```json
{
  "message": {
    "id": "msg-uuid",
    "role": "assistant",
    "content": "final text",
    "timestamp": "...",
    "thinking": null
  }
}
```

4. `session.remap`
```json
{
  "fromSessionKey": "pending-uuid",
  "toSessionKey": "real-session-id"
}
```

5. `session.error`
```json
{
  "code": "cli_error",
  "message": "Human-readable",
  "stderr": "raw stderr excerpt"
}
```

6. `session.completed`
```json
{ "usage": { "inputTokens": 0, "outputTokens": 0, "costUsd": 0 } }
```

### 3.3 Mapping to existing `SessionEvent`
- `session.message` -> `{ type: "message" }`
- `session.streaming` -> `{ type: "streaming" }`
- `session.remap|session.completed|session.error` -> `{ type: "updated" }` plus local store-specific handling

### 3.4 Stream parsing strategy
- Parse each stdout line as JSON; ignore non-JSON lines.
- For `stream-json`, detect text deltas and emit `session.delta`.
- On final/result message, emit `session.message` then `session.streaming=false` and `session.completed`.

---

## 4. File Structure Changes Needed

### Server-side
- Update: `serve.mjs`
  - add Claude Code HTTP routes
  - add Claude Code WS endpoint branch in `upgrade`
  - add `POST /api/files/delete` and `GET /api/files/exists`
- Add: `server/claude/cli-capabilities.mjs`
  - probes CLI flags once at startup
- Add: `server/claude/session-index.mjs`
  - scans and indexes transcripts
- Add: `server/claude/transcript-parser.mjs`
  - parse JSONL -> normalized messages/session metadata
- Add: `server/claude/run-manager.mjs`
  - spawn/track/cancel CLI runs
- Add: `server/claude/ws-broker.mjs`
  - publish/subscribe for session/run events

### Browser-side
- Replace internals: `src/lib/adapters/claude-code-adapter.ts`
  - remove Node dynamic imports and localStorage pseudo-fallback behavior
  - implement HTTP + WS client
- Optional add: `src/lib/adapters/claude-code-client.ts`
  - API client + event decoding utilities

### Shared types (recommended)
- Add: `src/lib/adapters/claude-code-protocol.ts`
  - typed request/response/event interfaces for HTTP/WS contract

### Tests
- Add: `src/lib/adapters/claude-code-adapter.test.ts`
- Add: `server/claude/*.test.mjs`
- Add: `e2e/claude-code-adapter.spec.ts`

---

## 5. Implementation Order

1. CLI capability probe + session discovery spike
- Implement probe utility and session indexer first.
- Validate on target machine with real `claude --help` and real transcript files.

2. Transcript parser + session list/history endpoints
- Ship read-only functionality first (`list`, `history`).
- Wire browser adapter methods `list()` and `history()`.

3. Run manager + send endpoint (non-streaming first)
- Start with `--output-format json` and return final response only.
- Ensure `send()` path is stable before streaming.

4. WS broker + streaming events
- Upgrade send path to `stream-json` and publish `delta/final/error` events.
- Wire `subscribe()` in browser adapter.

5. Session lifecycle endpoints
- `create`, `rename`, `delete`, session key remapping.

6. File API completion
- Add missing `/api/files/delete`, `/api/files/exists`.
- Confirm Claude adapter `FileAdapter` parity.

7. Reliability hardening
- timeouts, process cleanup, path safety, backpressure limits.

8. End-to-end tests + docs update
- E2E run against machine with Claude CLI installed.

---

## 6. Edge Cases and Error Handling

### CLI not installed
- Probe failure at startup -> mark Claude backend unavailable.
- Sessions endpoints return `503` with code `claude_unavailable`.
- UI should show explicit adapter error state.

### Flag mismatch (`--session` vs `--resume`)
- Probe `claude --help` output once.
- Select resume arg dynamically.
- If both unsupported, fail fast with actionable error.

### Session path variance
- Handle multiple roots and encoded cwd directory names.
- Keep root list configurable via env.

### Corrupt/partial JSONL lines
- Skip malformed lines, do not fail whole history.
- Report parsing warnings in logs/metrics.

### Concurrent sends on same session
- Policy: serialize per session by default.
- If second send arrives while running, either queue or return 409 `session_busy`.

### Server restart during active run
- On startup, clear stale in-memory run state.
- No attempt to reattach dead child processes.
- Client reconnect should re-fetch history.

### WS disconnect during run
- Continue run server-side.
- Client can reconnect and pull latest history or run status.

### Large transcript files
- Stream parse line-by-line, avoid whole-file reads.
- Apply `limit` and pagination to history endpoint.

### File safety
- Reuse/extend existing workspace path sandbox checks.
- Reject path traversal and symlink escapes.

### Windows/macOS path normalization
- Normalize separators before encoding/decoding cwd keys.

### Auth
- Enforce token on both HTTP and WS upgrade.
- Reject unauthorized with 401 before establishing stream.

---

## 7. How to Test Each Component

## 7.1 CLI capability probe
- Unit: feed fixture help outputs and assert detected flags.
- Manual: run server on machine with Claude CLI; verify logged capabilities.

## 7.2 Session indexing and parsing
- Unit: fixture transcripts with:
  - normal user/assistant flow
  - tool events
  - malformed JSON lines
- Assert metadata extraction (`createdAt`, `updatedAt`, `preview`, roles).

## 7.3 HTTP sessions API
- Integration tests against local server:
  - `GET /sessions` returns sorted sessions
  - `GET /history` pagination works
  - invalid session key returns 404

## 7.4 Run manager (send)
- Integration with mocked `child_process.spawn`:
  - success final
  - stderr noise + success
  - non-zero exit
  - timeout
  - cancel

## 7.5 WS protocol
- Integration WS client test:
  - subscribe -> receive `streaming=true`, `delta*`, `message`, `completed`, `streaming=false`
  - error path emits `session.error`
  - heartbeat/ping behavior

## 7.6 Browser adapter contract tests
- Mock fetch + WS server in Vitest:
  - methods satisfy `SessionAdapter` / `FileAdapter` contracts
  - `subscribe()` maps protocol events to `SessionEvent`

## 7.7 File operations
- Integration tests:
  - read/write/list/delete/exists
  - traversal attack inputs
  - large file limits

## 7.8 End-to-end UI behavior
- Playwright scenario with Claude adapter selected:
  - list existing sessions
  - open history
  - send message and observe streaming update in chat UI
  - create session and verify remap/persistence
  - edit a workspace file and verify persisted content

---

## Recommended Implementation Notes
- Keep Claude protocol isolated to `server/claude/*` to avoid bloating `serve.mjs`.
- Add a single source of truth for protocol types to prevent client/server drift.
- Prefer explicit states (`queued`, `running`, `completed`, `error`, `aborted`) for run lifecycle.
- Build read-only features first so session browsing is usable before send-stream is complete.

---

## Source References Used for This Plan
- Claude CLI flags and commands:
  - https://docs.anthropic.com/en/docs/claude-code/cli-reference
- Claude session path and resume semantics (Agent SDK docs):
  - https://platform.claude.com/docs/en/agent-sdk/sessions
- Streaming event model (Agent SDK docs):
  - https://platform.claude.com/docs/en/agent-sdk/streaming-output
- Transcript path examples via hooks docs:
  - https://docs.anthropic.com/en/docs/claude-code/hooks

