# OpenClaw Gateway WebSocket Protocol

## Connection

Connect to `ws://127.0.0.1:18790` (or via Studio proxy at `/api/gateway/ws`).

### Frame Format

All messages are JSON. Three frame types:

```typescript
// Request (client → server)
{ type: "req", id: string, method: string, params?: object }

// Response (server → client)  
{ type: "res", id: string, ok: boolean, result?: object, error?: { code: string, message: string } }

// Event (server → client, unsolicited)
{ type: "evt", event: string, data: object }
```

### Connect Handshake

First message must be a `connect` request:

```json
{
  "type": "req",
  "id": "connect-1",
  "method": "connect",
  "params": {
    "minProtocol": 1,
    "maxProtocol": 1,
    "auth": { "token": "<gateway-token>" },
    "client": {
      "id": "openclaw-control-ui",
      "version": "1.0.0",
      "platform": "web",
      "mode": "ui"
    },
    "caps": ["tool-events"]
  }
}
```

Response includes `ok: true` with gateway info on success.

## Key Methods

### sessions.list
List all sessions.
```json
{
  "method": "sessions.list",
  "params": {
    "limit": 50,
    "includeDerivedTitles": true,
    "includeLastMessage": true
  }
}
```
Returns: `{ sessions: SessionEntry[] }`

### sessions.preview
Get session preview (recent messages).
```json
{
  "method": "sessions.preview",
  "params": { "key": "session-key" }
}
```

### sessions.delete
Delete a session.
```json
{
  "method": "sessions.delete",
  "params": { "key": "session-key" }
}
```

### sessions.reset
Reset/clear a session.
```json
{
  "method": "sessions.reset",
  "params": { "key": "session-key" }
}
```

### chat.history
Get message history for a session.
```json
{
  "method": "chat.history",
  "params": {
    "sessionKey": "session-key",
    "limit": 200
  }
}
```
Returns: `{ sessionKey, sessionId, messages: Message[], thinkingLevel, verboseLevel }`

### chat.send
Send a message in a session. Returns immediately with `status: "started"`, then streams via events.
```json
{
  "method": "chat.send",
  "params": {
    "sessionKey": "session-key",
    "message": "Hello!",
    "idempotencyKey": "<unique-id>",
    "thinking": "low",
    "timeoutMs": 300000
  }
}
```
Response: `{ runId: string, status: "started" | "in_flight" }`

### chat.abort
Abort a running chat.
```json
{
  "method": "chat.abort",
  "params": { "sessionKey": "session-key", "runId": "<optional>" }
}
```

## Events

### "chat" event
Streaming chat responses:
```typescript
{
  event: "chat",
  data: {
    runId: string,
    sessionKey: string,
    seq: number,
    state: "delta" | "final" | "error" | "aborted",
    message?: {
      role: "assistant",
      content: [{ type: "text", text: string }],
      timestamp: number
    },
    errorMessage?: string  // when state === "error"
  }
}
```

- `delta`: partial streaming text (throttled to ~150ms intervals)
- `final`: complete response with full text
- `error`: run failed
- `aborted`: run was cancelled

### "agent" event
Agent lifecycle and tool events:
```typescript
{
  event: "agent",
  data: {
    runId: string,
    sessionKey?: string,
    stream: "lifecycle" | "assistant" | "tool" | "error",
    seq: number,
    data: {
      phase?: "start" | "end" | "error",  // lifecycle
      text?: string,  // assistant stream
      tool?: string,  // tool stream
      // ... other fields
    }
  }
}
```

### "presence" event
System presence updates (agents starting/stopping).

### "tick" event
Periodic keepalive.

## Client IDs

Use `"openclaw-control-ui"` for full UI access (can delete/patch sessions).
Use `"webchat-ui"` for chat-only access (restricted mutations).

## Auth

Token from `~/.openclaw/openclaw-studio/settings.json` → `gateway.token`
Or from `~/.openclaw/openclaw.json` → `gateway.auth.token`

Current token: `e1d47ce3c80c897bb9f6c969f077886d5e5fc0266a3916cf`
