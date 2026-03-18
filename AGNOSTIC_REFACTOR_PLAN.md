# Agent-Agnostic Refactor — Implementation Plan

## Goal
Decouple Mission Control from OpenClaw so it works with any agent backend (OpenClaw, Claude Code, Copilot, standalone). The adapter layer already exists but isn't used consistently. Fix that.

## Current State
- **Adapter pattern exists** in `src/lib/adapters/` with `BackendAdapter` interface
- **Task store** already uses `getBackendAdapter().files` — good
- **Chat store** already uses adapter sessions — good
- **Broken:** cron-store, agents-store, mission-control.tsx, file-browser.tsx, projects-page.tsx, conversation-sidebar.tsx all bypass the adapter and call `useGatewayStore` / `gatewayClient` directly
- **serve.mjs** hardcodes `~/.openclaw/` paths and gateway port 18790
- **shared.ts** hardcodes default gateway URL and `~/.openclaw/` session path references

---

## Phase 1: Extend BackendAdapter Interface

### File: `src/lib/adapters/types.ts`

Add optional capabilities to `BackendAdapter`:

```typescript
export interface CronAdapter {
  list(): Promise<CronJob[]>;
  runs(jobId?: string): Promise<CronRunEntry[]>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  remove(id: string): Promise<void>;
  run(id: string): Promise<void>;
}

export interface AgentAdapter {
  // Agent presence is event-driven, not request-based
  // This is handled via subscribe() events, not a separate adapter
}

export interface BackendAdapter {
  readonly type: 'openclaw' | 'claude-code' | 'local';
  readonly sessions: SessionAdapter;
  readonly files: FileAdapter;
  readonly crons?: CronAdapter;  // optional — only OpenClaw has native crons
  
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  
  /** What capabilities does this adapter support? */
  capabilities(): { crons: boolean; agents: boolean; realtime: boolean };
}
```

### Implementation in each adapter:

**OpenClawAdapter** (`openclaw-adapter.ts`):
- `crons` → implemented, wraps existing `gatewayClient.request("cron.*")` calls
- `capabilities()` → `{ crons: true, agents: true, realtime: true }`

**ClaudeCodeAdapter** (`claude-code-adapter.ts`):
- `crons` → undefined (not supported)
- `capabilities()` → `{ crons: false, agents: false, realtime: true }` (has WS streaming)

**LocalAdapter** (`local-adapter.ts`):
- `crons` → undefined
- `capabilities()` → `{ crons: false, agents: false, realtime: false }`

---

## Phase 2: Rewire Stores to Use Adapters

### `src/lib/stores/cron-store.ts`
- Remove direct `useGatewayStore.getState().gatewayClient` calls
- Replace with: `getBackendAdapter().crons?.list()` etc.
- If `adapter.crons` is undefined, set `jobs: []` and `error: "Cron jobs not available with this backend"`

### `src/lib/stores/agents-store.ts`
- Agent events come from the gateway event stream (session subscribe)
- Keep the store as-is but make it only populate when the adapter supports agents
- The OpenClaw adapter's `subscribe()` already emits agent events; Claude Code's doesn't
- No code change needed here — just ensure the store doesn't error when no events arrive

### `src/lib/stores/gateway-store.ts`
- Keep as-is but only used by OpenClawAdapter internally
- Remove all imports of `useGatewayStore` from components and other stores (except the OpenClaw adapter itself)

---

## Phase 3: Fix Component Direct-Gateway Calls

### `src/components/mission-control/mission-control.tsx` (line 79)
```typescript
// BEFORE:
const client = useGatewayStore.getState().gatewayClient;

// AFTER: 
// Use adapter.sessions.history() to load session previews
// The session list already comes from the chat store which uses the adapter
```
- Remove `useGatewayStore` import
- Use `useChatStore` which already goes through the adapter
- Session preview loading should call `adapter.sessions.history(key)` with limit

### `src/components/files/file-browser.tsx` (lines 41, 78, 111, 289)
```typescript
// BEFORE:
const gatewayToken = useGatewayStore((state) => state.gatewayToken);
fetch(`/api/files/search?...`, { headers: { Authorization: `Bearer ${gatewayToken}` } })

// AFTER:
// Use adapter.files.list() and add a search method to FileAdapter
```
- Add `search?(query: string): Promise<FileEntry[]>` to `FileAdapter`
- Implement in ClaudeCodeAdapter (calls `/api/files/search`)
- Implement in OpenClawAdapter (calls `/api/files/search` with serve.mjs token)
- Remove direct fetch calls from the component

### `src/components/projects/projects-page.tsx` (lines 185, 198)
```typescript
// BEFORE:
const gatewayToken = useGatewayStore((s) => s.gatewayToken);
fetch("/api/repos", { headers: { Authorization: `Bearer ${gatewayToken}` } })

// AFTER:
// Add repos to the adapter or make the serve.mjs /api/repos auth use the adapter's token
```
- Add `repos?(): Promise<RepoInfo[]>` to `BackendAdapter` (optional capability)
- Or simpler: the repos endpoint is on serve.mjs, not the gateway. Get auth token from `/api/config` (already exists) — same pattern as Claude Code adapter
- Create a shared `useServerToken()` hook that gets the serve.mjs auth token

### `src/components/chat/conversation-sidebar.tsx` (lines 41, 78, 111, 289)
- Same pattern as file-browser — uses `gatewayToken` for `/api/files/` calls
- Replace with adapter's file methods

---

## Phase 4: Make serve.mjs Configurable

### Config resolution order:
1. Environment variables (`MC_WORKSPACE`, `MC_TOKEN`, `MC_GATEWAY_URL`, `MC_GATEWAY_PORT`)
2. Config file: `./mc.config.json` or `~/.mc/config.json`
3. Auto-detect: check for `~/.openclaw/openclaw.json`, `~/.claude/`, etc.
4. Defaults

### Config file format (`mc.config.json`):
```json
{
  "workspace": "~/projects",
  "token": "auto",
  "agent": "auto",
  "gateway": {
    "host": "127.0.0.1",
    "port": 18790
  },
  "notifications": {
    "type": "none"
  }
}
```

### Changes to serve.mjs:
1. Replace hardcoded `WORKSPACE = resolve(homedir(), ".openclaw", "workspace")` with config resolution
2. Replace hardcoded `GATEWAY = { host: "127.0.0.1", port: 18790 }` with config
3. Replace hardcoded `CONFIG_PATH = resolve(homedir(), ".openclaw", "openclaw.json")` with auto-detect
4. Token resolution: `MC_TOKEN` env → config file → `~/.openclaw/openclaw.json` → `~/.claude/` API key → generate random
5. Gateway proxy in upgrade handler: **skip entirely** if no gateway configured
6. Add `/api/config` endpoint that returns capabilities (which agent detected, what features available)

### Changes to `server/claude/run-manager.mjs`:
1. Replace hardcoded `AUTH_PROFILE_PATH` with config-based resolution
2. Check `MC_ANTHROPIC_KEY` env → `ANTHROPIC_API_KEY` env → `~/.openclaw/` auth profiles → `~/.claude/` config

---

## Phase 5: Shared Auth Hook

Create `src/lib/hooks/use-server-auth.ts`:
```typescript
// Single source of truth for serve.mjs auth token
// Fetches from /api/config once, caches in memory
export function useServerToken(): string { ... }
```

All components that call serve.mjs HTTP endpoints directly use this hook instead of `useGatewayStore` for the token. This covers file-browser, projects-page, conversation-sidebar.

---

## Phase 6: UI Capability Gating

Components that depend on optional capabilities should check:
```typescript
const adapter = getBackendAdapter();
const caps = adapter.capabilities();

// In cron panel:
if (!caps.crons) return <div>Cron jobs require OpenClaw gateway</div>;

// In agents panel:
if (!caps.agents) return <div>Agent monitoring requires OpenClaw gateway</div>;
```

---

## File Change Summary

### Modified files:
| File | Changes |
|------|---------|
| `src/lib/adapters/types.ts` | Add `CronAdapter`, `capabilities()`, optional `crons` field, `search` on FileAdapter |
| `src/lib/adapters/openclaw-adapter.ts` | Implement `CronAdapter`, `capabilities()`, `search()` on files |
| `src/lib/adapters/claude-code-adapter.ts` | Add `capabilities()`, `search()` on files |
| `src/lib/adapters/local-adapter.ts` | Add `capabilities()` |
| `src/lib/adapters/index.ts` | No changes needed (already generic) |
| `src/lib/stores/cron-store.ts` | Replace `useGatewayStore` with `getBackendAdapter().crons` |
| `src/lib/stores/shared.ts` | Remove hardcoded `~/.openclaw/` path in DEFAULT_GATEWAY_URL comment, keep defaults configurable |
| `src/components/mission-control/mission-control.tsx` | Replace `useGatewayStore` with chat store / adapter |
| `src/components/files/file-browser.tsx` | Replace `gatewayToken` + direct fetch with adapter.files methods |
| `src/components/chat/conversation-sidebar.tsx` | Replace `gatewayToken` + direct fetch with adapter.files or shared hook |
| `src/components/projects/projects-page.tsx` | Replace `gatewayToken` with shared server auth hook |
| `serve.mjs` | Config resolution, optional gateway proxy, env var support |
| `server/claude/run-manager.mjs` | Configurable API key resolution |

### New files:
| File | Purpose |
|------|---------|
| `src/lib/hooks/use-server-auth.ts` | Shared hook for serve.mjs auth token |
| `mc.config.example.json` | Example config file |

### NOT modified (already clean):
- `src/lib/stores/task-store-v2.ts` — already uses adapter
- `src/lib/stores/files-store.ts` — already uses adapter
- `src/lib/stores/activity-store.ts` — no gateway dependency
- `src/lib/stores/session-flow-store.ts` — no gateway dependency
- `src/lib/link-resolver.ts` — pure functions
- `src/lib/task-engine.ts` — pure functions
- All workflow components — already clean
- All UI components — already clean

---

## Constraints

1. **Do NOT break OpenClaw mode.** Everything must still work exactly as before when gateway is connected.
2. **Do NOT remove gateway.ts or gateway-store.ts.** They're still used by OpenClawAdapter internally.
3. **Do NOT change the task-engine, task-types, or link-resolver.** They're already perfect.
4. **Build must pass** (`npx vite build` — zero errors).
5. **Existing tests must pass** (`npx vitest run`).
6. **Work on branch `feat/agent-agnostic`.** Create from current `feat/claude-code-server`. Do NOT merge to main.

---

## Testing Checklist

After implementation, verify:
- [ ] `npx vite build` succeeds
- [ ] `npx vitest run` passes
- [ ] OpenClaw mode: task board loads, chat works, crons display, agents display
- [ ] Claude Code mode: task board loads, chat works, cron panel shows "not available", sessions list from ~/.claude/
- [ ] Local mode: task board works with localStorage
- [ ] serve.mjs starts without `~/.openclaw/` directory present
- [ ] serve.mjs starts with `MC_WORKSPACE=/tmp/test MC_TOKEN=test123` env vars
- [ ] `/api/config` returns detected agent type and capabilities
- [ ] File browser works in Claude Code mode (no gateway needed)
- [ ] Projects page loads repos in both modes
