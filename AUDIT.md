# OpenClaw UI — Architecture Audit

**Date:** 2026-03-01  
**State:** v1 working prototype, ~3700 lines total

---

## Summary

The UI works. Gateway connects, chat streams, sessions list, files browse, tasks persist. But it's a prototype that was built in one shot by Codex — it needs restructuring before we invest more into it. The core problems are: **everything in one file**, **store is a god object**, and **no error boundaries or tests**.

---

## File Inventory

| File | Lines | Role | Health |
|------|-------|------|--------|
| `src/app.tsx` | 1762 | ALL UI components | 🔴 Monolith |
| `src/lib/store.ts` | 1317 | ALL state + logic | 🔴 God object |
| `src/lib/gateway.ts` | 226 | WS client | 🟢 Clean |
| `src/lib/types.ts` | 105 | Type definitions | 🟢 Clean |
| `src/main.tsx` | 18 | Entry point | 🟢 Fine |
| `src/styles/globals.css` | 81 | Tailwind + custom | 🟢 Fine |
| `serve.mjs` | 144 | Static server + file API + WS proxy | 🟡 Doing too much |
| `vite.config.ts` | 8 | Build config | 🟢 Fine |

---

## Critical Issues

### 1. 🔴 app.tsx is a 1762-line monolith

Every component lives in one file: icons, markdown renderer, message bubbles, composer, sidebar, task board, file browser, agent transcript, and the root App component. This makes it:
- Hard to find anything
- Impossible to lazy-load
- Merge conflicts on every change
- No component isolation for testing

**Fix:** Split into ~15 focused component files:
```
src/
  components/
    chat/
      message-card.tsx      (~100 lines)
      chat-composer.tsx      (~180 lines)
      conversation-sidebar.tsx (~200 lines)
      markdown.tsx           (~100 lines)
    tasks/
      task-board.tsx         (~190 lines)
      task-card.tsx           (extracted from board)
    files/
      file-browser.tsx       (~280 lines)
    agents/
      agent-transcript.tsx    (~50 lines)
    ui/
      icon-button.tsx
      icons.tsx              (all SVG icons)
  app.tsx                    (~200 lines — layout shell only)
```

### 2. 🔴 store.ts is a 1317-line god object

One massive Zustand store with everything: connection state, conversations, messages, tasks, files, agents, UI state, drafts, attachments. This means:
- Every state change re-renders everything (no selector isolation)
- Business logic mixed with UI state
- Impossible to test individual features
- Can't reason about data flow

**Fix:** Split into domain stores:
```
src/lib/
  stores/
    gateway-store.ts    — connection, config
    chat-store.ts       — conversations, messages, streaming
    tasks-store.ts      — task CRUD, persistence
    files-store.ts      — file browsing, preview
    agents-store.ts     — agent monitoring
    ui-store.ts         — panels, mobile state, drafts
```
Each store is independent, uses Zustand slices or separate stores. Components subscribe to only what they need.

### 3. 🔴 No error boundaries

A single React error anywhere crashes the entire app. No recovery, no fallback UI.

**Fix:** Add `<ErrorBoundary>` wrappers around each major section (chat, tasks, files, agents). Use a generic fallback: "Something went wrong. [Retry]".

### 4. 🟡 serve.mjs doing three jobs

It's a static file server, a WebSocket proxy, AND a file API server. These should be separate concerns, and the file API has no rate limiting, no path traversal hardening beyond `startsWith`, and no request size limits.

**Fix:**
- Extract file API to `src/server/file-api.mjs`
- Add `path.resolve()` + realpath checks for path traversal
- Add basic rate limiting (100 req/min per endpoint)
- Consider using the gateway's own exec or file methods long-term instead of a sidecar API

### 5. 🟡 No loading/error states in many places

- Conversations list: no skeleton while loading
- Chat history: no loading indicator on conversation switch
- Tasks: no save indicator
- Connection loss: no offline banner (only the dot color changes)

### 6. 🟡 Hardcoded token in serve.mjs

The gateway token is hardcoded. Should read from `~/.openclaw/openclaw.json` or environment variable.

### 7. 🟡 No keyboard shortcuts

No Cmd+K, no Cmd+N for new chat, no Escape to close sidebar. These matter for power users on desktop.

### 8. 🟡 CONNECT_PROTOCOLS array has two identical entries

```ts
const CONNECT_PROTOCOLS = [
  { minProtocol: 3, maxProtocol: 3 },
  { minProtocol: 3, maxProtocol: 3 }  // duplicate
];
```
The fallback logic tries the next protocol on handshake failure, but both entries are the same. Either remove the fallback or make them different (e.g., protocol 2 as fallback).

---

## What's Good

- **gateway.ts** is well-structured: clean class, proper reconnect with jitter, typed frames
- **types.ts** is comprehensive and well-organized
- **The file browser** (post-rewrite) has proper lazy loading, breadcrumbs, search
- **Tailwind usage** is consistent with the design spec's color palette
- **Mobile layout** (post-fixes) uses proper `100dvh` flex, safe-area-inset, good touch targets
- **Chat streaming** works correctly with delta/final/error states
- **The overall UX flow** is solid for v1

---

## Recommended Refactor Plan

### Phase 1: Structure (1 session)
1. Split app.tsx into component files
2. Split store.ts into domain stores
3. Add error boundaries
4. Add loading skeletons

### Phase 2: Reliability (1 session)
1. Offline banner + message queue (send when reconnected)
2. Optimistic UI for task operations
3. Path traversal hardening in serve.mjs
4. Read token from config file
5. Add basic health check endpoint

### Phase 3: Polish (1 session)
1. Keyboard shortcuts (Cmd+K, Cmd+N, Escape)
2. Chat search within conversation
3. Markdown code block copy button
4. Conversation rename
5. PWA manifest + icons (without the problematic service worker)

### Phase 4: Testing (1 session)
1. Vitest setup
2. Unit tests for stores (gateway, chat, tasks)
3. Component tests for critical flows (send message, create task)
4. E2E smoke test with Playwright

---

## Architecture Target

```
src/
  components/
    chat/           — message rendering, composer, sidebar
    tasks/          — task board, cards
    files/          — file browser, preview
    agents/         — agent list, transcript
    ui/             — shared primitives (button, input, icons, error-boundary)
    layout/         — app shell, mobile nav, panels
  lib/
    gateway.ts      — WebSocket client (unchanged)
    types.ts        — shared types (unchanged)
    stores/         — domain-specific Zustand stores
    hooks/          — useGateway, useSessions, useTasks, useFiles
    utils/          — formatters, markdown, time
  server/
    serve.mjs       — static + WS proxy
    file-api.mjs    — workspace file endpoints
  app.tsx           — root layout, routing between surfaces
  main.tsx          — entry point
```

Each component file: 50-300 lines max. Each store: 100-300 lines max. Total will be more files but each is comprehensible in isolation.
