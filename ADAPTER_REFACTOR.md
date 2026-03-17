# Adapter Refactor Plan

## Goal
Make openclaw-ui agent-agnostic by introducing a BackendAdapter interface between stores and the gateway.

## New Files Created
- `src/lib/adapters/types.ts` — Interface definitions (DONE)

## Files to Create
- `src/lib/adapters/openclaw-adapter.ts` — Wraps existing GatewayClient
- `src/lib/adapters/claude-code-adapter.ts` — Uses `claude --print --session`
- `src/lib/adapters/local-adapter.ts` — Direct fs, no agent
- `src/lib/adapters/index.ts` — Factory + singleton

## Files to Modify

### src/lib/stores/chat-store.ts (504 lines)
Current coupling:
- Line 5: `import { useGatewayStore } from "./gateway-store"`
- Line 43: `client.request<{ sessions?: SessionsListEntry[] }>("sessions.list", ...)`
- Line 82: `client.request<{ key?: string }>("sessions.patch", ...)`
- Line ~200: `client.request("sessions.send", ...)`
- Line ~230: `client.request("sessions.history", ...)`

Changes needed:
1. Import adapter instead of gateway store
2. Replace `client.request("sessions.X")` with `adapter.sessions.X()`
3. Handle subscribe/unsubscribe for real-time updates

### src/lib/stores/task-store-v2.ts (269 lines)
Current coupling:
- Line 19: `import { useGatewayStore } from "./gateway-store"`
- Line 87-93: `fetch("/api/files/write", ...)` with gateway token
- Line 104-114: `fetch("/api/files/read", ...)` with gateway token

Changes needed:
1. Import adapter instead of gateway store
2. Replace fetch calls with `adapter.files.read/write()`
3. Remove token handling (adapter handles auth)

### src/lib/stores/files-store.ts (70 lines)
Current coupling:
- Uses gateway for file listing/reading

Changes needed:
1. Replace with `adapter.files.list/read()`

### src/lib/stores/gateway-store.ts (53 lines)
Keep as-is but make it internal to OpenClawAdapter.

## Adapter Implementation Details

### OpenClawAdapter
- Wraps existing GatewayClient
- WebSocket for real-time updates
- sessions.* and files.* already exist

### ClaudeCodeAdapter
Sessions:
```typescript
async send(sessionKey: string, message: string, options?: { cwd?: string }): Promise<Message> {
  const { stdout } = await execa('claude', [
    '--session', sessionKey,
    '--print',
    '--output-format', 'json',
    message
  ], { 
    cwd: options?.cwd ?? this.defaultCwd,
    timeout: 300_000
  });
  return this.parseResponse(stdout);
}

async history(sessionKey: string): Promise<Message[]> {
  // Read from ~/.claude/sessions/{sessionKey}/
  // Parse JSONL conversation file
}
```

Files:
```typescript
async read(path: string): Promise<string> {
  return fs.readFile(this.resolvePath(path), 'utf-8');
}

async write(path: string, content: string): Promise<void> {
  await fs.writeFile(this.resolvePath(path), content);
}
```

### LocalAdapter
- Files: direct fs operations
- Sessions: no-op or local storage only

## Configuration

```typescript
// src/lib/adapters/index.ts
export function createAdapter(config: AdapterConfig): BackendAdapter {
  switch (config.type) {
    case 'openclaw':
      return new OpenClawAdapter(config.gatewayUrl, config.gatewayToken);
    case 'claude-code':
      return new ClaudeCodeAdapter(config.workspace);
    case 'local':
      return new LocalAdapter(config.workspace);
  }
}

// Read from localStorage or env
const ADAPTER_CONFIG_KEY = 'mission-control-adapter';
```

## UI Changes Needed
- Settings panel: adapter type selector
- Connection status: show which adapter is active
- No changes to task-list.tsx, chat-composer.tsx, etc.

## Testing
1. Start with LocalAdapter (no dependencies)
2. Verify tasks CRUD works
3. Add OpenClawAdapter, verify parity
4. Add ClaudeCodeAdapter, test with real claude CLI

## Migration Path
1. Create adapters + factory
2. Create adapter-store.ts (holds current adapter singleton)
3. Update task-store-v2.ts to use adapter
4. Update files-store.ts to use adapter  
5. Update chat-store.ts to use adapter
6. Add adapter selector to settings UI
7. Test all three adapters
8. Remove direct gateway dependencies from stores
