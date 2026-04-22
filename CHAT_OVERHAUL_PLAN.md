# CHAT OVERHAUL PLAN — agent-ui

Single-shot implementation plan for making chat seamless: token-level streaming, full tool-use rendering, lossless session navigation, sub-agent fidelity, robust errors. Scoped to ~14 focused hours / 12 commits / 1–2 days.

## Spike findings (validated 2026-04-20 against SDK 0.2.114, claude CLI 2.1.114)

Two pre-implementation spikes were run in `/tmp/sdk-spike/`. Both passed.

**R1 — OAuth fallback works.** With `ANTHROPIC_API_KEY` deleted from env, `query()` succeeded via `~/.claude/.credentials.json`. `includePartialMessages: true` produces real `text_delta` events inside `stream_event` messages. Total cost for 1 prompt: $0.095 (one-shot cache_creation cost; subsequent prompts in same session reuse cache).

**R4 — sub-agent attribution works.** Every assistant/user message produced inside a sub-agent carries `parent_tool_use_id` matching the parent's `tool_use.id`. Boundary is clean: top-level messages have `parent_tool_use_id: null`; the sub-agent's final result is delivered as a top-level `user` `tool_result` referencing the parent Agent's `tool_use_id`.

**R5 — resume works and session_id is stable.** `options.resume: <sessionId>` on a follow-up `query()` correctly carries context across turns. **Critical finding: SDK keeps the same `session_id` on resume — does NOT fork the transcript.** This simplifies our remap logic: only the *first* message of a *new* session needs canonical remap; resumes are idempotent on session_id.

**Cancel — instant and clean.** `controller.abort()` causes the for-await loop to throw `"Claude Code process aborted by user"` within ~2ms. Subprocess is reaped within 500ms with no leak. No SIGINT fallback needed.

**Three plan corrections incorporated below:**

1. **Tool name is `Agent`, not `Task`.** Renderer branches and any tool-name matching must use `name === "Agent"`. (Or match both for safety against future renames.)
2. **Three new `system` subtypes** observed: `system.task_started`, `system.task_progress`, `system.task_notification`. These give status info for the sub-agent card header. We'll forward them as `session.subagent.{started,progress,notification}` events. Optional to render — minimum scope can ignore them.
3. **`rate_limit_event` message type** appears in the stream — add to ignore list.

Bonus: `system.init` is always message #1, confirming R7 mitigation (remap fires before any block events; no out-of-order risk). `thinking` blocks confirmed present in default mode for Opus 4.7.

---

## Section 1 — Goals & Non-Goals

### "Seamless" means, concretely

1. **Token-level streaming.** Text appears in the assistant bubble as each `content_block_delta` arrives, not as a single block at the end.
2. **Full block rendering.** `tool_use`, `tool_result`, `thinking`, and text blocks each render as their own visual element, in the order the model produced them, preserving interleave (text → tool_use → tool_result → text).
3. **Lossless navigation.** Switching sessions mid-stream never corrupts the source session, never bleeds events into the destination, and never duplicates the stream in history when you come back.
4. **First-message session creation that doesn't flicker.** When the user types into a brand-new chat, the session key transitions from a local `pending-` placeholder to the real transcript key with no message loss, no sidebar duplicate, and URL hash update.
5. **Reliable resume.** Opening an existing session loads transcript, and the next send correctly resumes that session ID on the backend (no new UUID fork).
6. **Sub-agent fidelity.** When Claude invokes the `Agent` tool, the child events are attributed to the parent `tool_use` block via `parent_tool_use_id` and render as an indented sibling trace right after the parent Agent card.
7. **Robust errors.** CLI missing, auth failure, and timeouts surface as a visible error chip on the message plus an error banner — they never leave a spinner stuck forever.
8. **Multiple concurrent streams.** Streaming in session A while viewing session B just works; both transcripts update independently.
9. **Cancel actually cancels.** The existing `/cancel` endpoint must be wired to a stop button in the UI; pressing it transitions the bubble to "aborted" within ~250 ms.

### Explicitly out of scope (deferred)

- Replacing the hand-rolled `ws-broker.mjs` with the `ws` npm library. The broker's `tryDecodeFrame` handles single-frame text messages fine; it does not handle fragmentation (FIN bit ignored) or compression, but the browser client never sends either for our payloads. No user-visible bug was found here.
- Modularizing `serve.mjs`. The monolith is stable; touching it per-feature is fine.
- Auth/permission layers, DB persistence, frontend framework replacement.
- Rewriting `transcript-parser.mjs` to surface tool blocks in history. (It currently collapses them to `[tool_use:Name]` lines. Nice-to-have; punt to a follow-up — covered as optional Step 13.)
- Rich image/attachment upload path into the SDK (current path is text-only; keep that limitation for this pass).
- Replacing the OpenClaw adapter path — only the ClaudeCode adapter is in scope.

---

## Section 2 — Current State Audit (concrete bugs / gaps)

### 2.1 Streaming is effectively broken (not just chunky)

- `server/claude/standalone-runner.mjs:240-250` — on `type: "assistant"`, code sets `state.accumulated = text` (replaces, not appends) and emits `session.delta { delta: text, accumulated: text }`. Because the CLI in `--print --verbose` emits **whole assistant messages** per step, each "delta" is actually the full message re-sent. If we actually used this, the UI would show the whole message at once, then again.
- `src/lib/adapters/claude-code-adapter.ts:217-222` — on `session.delta`, adapter emits only `{ type: "updated" }` and drops the delta payload entirely. The streaming text never reaches the store. The assistant stub bubble stays empty until `session.message` replaces it at the end.
- `src/lib/stores/chat-store.ts:50-51` — `applySessionEventToChatStore` treats `updated` as a no-op. So on the current path, `delta` → `updated` → no-op → empty spinner until final.
- Net effect: the user sees "Streaming" chip appear, blank bubble for entire generation, then the full reply pops in at once. This matches the "chunky" complaint.

### 2.2 Tool blocks never render

- `server/claude/standalone-runner.mjs:64-100` — `extractText` flattens `message.content[]`: maps each block to `block.text` if it exists, joins with `\n`. Tool blocks have no `.text` so they produce empty strings and drop out. `tool_result`, `thinking`, and `tool_use` are all lost before the runner emits anything.
- `src/components/chat/message-card.tsx:37-59` — only `text` and `image` `MessageContentPart` types render meaningfully. The third discriminant (`attachment`) renders only `part.name`. There are no `tool_use` / `tool_result` / `thinking` branches.
- `src/lib/types.ts:24-27` — `MessageContentPart` union has no `tool_use` / `tool_result` / `thinking` variants. Types must be extended before renderer changes compile.
- `server/claude/transcript-parser.mjs:26-32` — transcript history also flattens tool blocks to the string `[tool_use:Name] {json}`. Even if we fix live streaming, reopening a finished session will still show the ugly bracketed form. (Deferred per scope.)

### 2.3 Session lifecycle / "New Chat" remap race

- `src/lib/stores/chat-store.ts:150-193` — `createConversation` generates `web-xxxxxxxx` locally, POSTs to `/api/claude-code/sessions`, and the server returns a `pending-<uuid>` key. The frontend never persists that `pending-` key; it stays at `web-xxxxxxxx` or whatever the server returned.
- `serve.mjs:640` — server returns `requestedKey = body.key || pending-<uuid>`, so when the frontend posts `{ key: "web-abc123" }`, the server echoes `web-abc123` back. Fine so far.
- On send, the frontend calls `POST /api/claude-code/sessions/web-abc123/messages`. The runner checks `sessionKey.startsWith("pending-")` to decide whether to resume — but the key isn't `pending-`, it's `web-abc123`. So `canResume` evaluates `String(sessionKey).includes("::")` → false. `resumeSessionId` stays empty. Good.
- Runner spawns CLI without `--resume` → CLI creates a fresh session, emits `session_id: <uuid>` on first stream-json line. Runner emits `session.remap { from: "web-abc123", to: "<encoded-cwd>::<uuid>" }`.
- `src/lib/adapters/claude-code-adapter.ts:196-206` — on remap, stores `remappedSessionKeys.set(toSessionKey, fromSessionKey)` i.e. **maps real → pending** so subsequent real events get rerouted back to the pending conversation in the store. This works to deliver delta events, but **never renames the conversation key** in the Zustand store. Result: the sidebar still shows the conversation under `web-abc123`. After a `refreshSessions()` call, the real session appears as a separate entry under `<cwd>::<uuid>`. Two rows for one chat, until the user reloads.
- `src/lib/stores/chat-store.ts:483-520` — `handleChatEvent` has real-key remap logic, but it's only called for OpenClaw gateway events (via `processGatewayEvent`), not for ClaudeCode adapter events.
- **Race**: if the user clicks "New Chat" twice quickly, two `web-*` conversations get created locally. If they send into the first one, then click New Chat *while the stream is in flight*, the old remap still fires against the (now non-selected) old key — the store gets the remap event but the URL is already at the new chat. No data loss, but the sidebar will show one ghost `web-*` until reload.

### 2.4 Navigating away mid-stream

- `src/app.tsx:225-229` — `useEffect` on `chatSessionKey` change calls `selectConversation` for the new key. There is **no cancel** of the run in the old session; the runner keeps going and events keep publishing.
- This is actually fine behavior (user probably wants it to complete in the background), but the *pending assistant stub* stays marked `pending:true` forever if the user navigates away before `session.message` arrives — because the stub ID is local, and when final `session.message` arrives for a different session (the pending→real remap), the stub-lookup logic (`chat-store.ts:55-57`) finds the stub in the *old* session and replaces it there. That part works.
- However: if `session.message` fires while the user is looking at session A, `event.sessionKey` is A, and the adapter has `remappedSessionKeys.get(A) = pending-foo`. The store then sets messages for `pending-foo`. But the URL is at A. So A looks empty, and `pending-foo` has the message. **Bug.** Happens when user navigates from a fresh chat (`pending-` or `web-`) to an existing session, then the stream completes. User sees nothing in the new view.
- The fix is: once we remap, canonicalize both ways — rename the conversation key globally, update URL hash, update selected key.

### 2.5 Concurrent streams

- Runner correctly tracks `activeRuns` by `runId`, so multiple runs can coexist on the server. Broker publishes every event to every subscribed client. The subscribe logic is `{ sessionKey: "*" }` always (adapter line 156), so the client gets everything — fine.
- Frontend-side, the pending-stub lookup uses *last pending assistant in the targeted conversation*, not a runId match. If two streams are running in two different sessions, each has its own conversation state keyed on sessionKey. OK.
- Edge case: if the same session is resumed twice (two simultaneous runs on the same real session key), their delta streams will both target the most-recent-pending stub. Claude won't do this normally, but the UI's "Retry" button sends a duplicate. Low priority.

### 2.6 Resume after page reload

- `localStorage.openclaw-ui-selected-conversation` stores the last selected key. On reload, `refreshSessions` loads session list, picks up stored key, calls `selectConversation`, which fetches transcript via `/history`. Works.
- In-flight stream recovery: **not supported.** If the page reloads during a stream, the runner keeps running server-side but the WS reconnect doesn't re-subscribe to the in-flight `runId`. After reload, there's no pending stub, and when `session.message` arrives it goes to a conversation that doesn't exist in messagesByConversation → it creates a new message. Functional (message appears), not seamless (no streaming indicator, appears as if magic).
- Acceptable for this pass; note as a known gap.

### 2.7 Sub-agents (Task tool)

- No code path anywhere in `src/` or `server/` looks for `parent_tool_use_id`. No UI for sub-agent cards. No routing of sub-agent events to a specific parent tool_use block.
- The current runner would lose sub-agent events entirely because they arrive as assistant messages with `parent_tool_use_id` set and `extractText` would either dedupe them with the parent message or emit them as another full replace.

### 2.8 Error handling

- On runner spawn error or non-zero exit, `session.error` is emitted with `code` and `message`. The ClaudeCode adapter at `claude-code-adapter.ts:194-236` has no branch for `session.error` — falls through to `this.emit({ type: "updated", ... })`, which is a no-op in the store. User sees a stuck spinner.
- Timeout is hardcoded at 5 minutes (`standalone-runner.mjs:200`). Fine, but unsurfaced.
- `chat-store.ts:sendMessage` wraps the `POST /messages` in try/catch — catches HTTP errors but not runtime runner errors. HTTP returns 202 immediately after `startRun` returns `{ runId }`, so the HTTP response never reflects the actual error.

### 2.9 Cancel button missing

- `serve.mjs:757-767` — `/api/claude-code/runs/:runId/cancel` exists and works. No UI code calls it.

### 2.10 Auth fragility

- `standalone-runner.mjs:18-62` — resolves API key from `MC_ANTHROPIC_KEY` → `ANTHROPIC_API_KEY` → `~/.openclaw/...` → `~/.claude/settings.json` → `~/.claude/config.json`. If any of those *happens to contain* an OAuth subscription token that starts with `sk-ant-oat`, the runner carefully strips it (line 161) so the CLI falls back to `~/.claude/.credentials.json`. That's the correct behavior. Must preserve it when migrating to SDK.

### 2.11 Miscellaneous

- `chat-store.ts:sendMessage` (lines 358-392): after calling `adapter.sessions.send`, the code immediately treats `response.content` as a final text and overwrites the pending stub. But in ClaudeCode adapter, `sendMessage` returns *immediately* with `{ id: runId, content: "" }` (adapter line 249-261). So `response.content.trim()` is empty, falls into the `else` branch, sets the stub's `runId` to the run ID. Fine — but the `runId` the store sets (`response.id`, which is the server's run UUID) won't match anything the runner publishes (`session.delta` carries `messageId`, not runId). This means the pending-stub match is purely positional (last pending assistant in conversation), not ID-based. Works today but fragile against concurrent retries.
- `chat-store.ts:131` — `set({ conversations: sessions, ... })` **overwrites** local conversations with the server list. If the user has a `web-xxxxxx` or `pending-xxxxxx` local conversation with messages, `refreshSessions` nukes it. Any message loss that happens mid-stream corresponds to the stream's remap event failing to arrive before a refresh does.

---

## Section 3 — Target Architecture

### 3.1 Backend runner: SDK-based

Replace `server/claude/standalone-runner.mjs` internals. The file's exported surface (`startRun`, `cancelRun`, `getRunStatus`) stays stable so `serve.mjs` doesn't change routes. Signature:

```js
// server/claude/sdk-runner.mjs
import { query } from "@anthropic-ai/claude-agent-sdk";

export async function startRun(sessionKey, userMessage, options) {
  // returns { runId, sessionKey, acceptedAt } synchronously (fire-and-forget stream)
}
export function cancelRun(runId) { /* aborts AbortController */ }
export function getRunStatus(runId) { /* same shape as today */ }
```

**Input:** sessionKey is either `pending-<uuid>`, a UI-local `web-<id>`, or a real `<encodedCwd>::<sessionId>`. Parse with `parseSessionKey()` as today. If real, call SDK with `options.resume: sessionId` and `options.cwd: decodedCwd`. If pending/local, omit `resume`.

**Auth:** SDK v0.2.113+ spawns a native Claude Code binary. Pass `options.env` as the inherited environment *minus* `ANTHROPIC_API_KEY` when we only have an `sk-ant-oat-` token (so the binary falls through to `~/.claude/.credentials.json`). Keep the existing `resolveAnthropicApiKey()` helper; simplify the call site:

```js
const rawKey = await resolveAnthropicApiKey();
const apiKey = rawKey.startsWith("sk-ant-api") ? rawKey : "";
const env = { ...process.env };
if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
// else: inherit process.env unchanged; CLI binary uses ~/.claude/.credentials.json for OAuth
```

**Stream loop:**

```js
const controller = new AbortController();
const q = query({
  prompt: userMessage,
  options: {
    resume: resumeSessionId || undefined,
    cwd: resolvedCwd,
    includePartialMessages: true,      // enables content_block_delta events
    permissionMode: "bypassPermissions", // for trusted local use; preserves current CLI behavior
    env,
    abortController: controller,
    // No allowedTools restriction → inherits full claude_code preset
  }
});

for await (const msg of q) {
  handleSdkMessage(msg, state);
}
```

`handleSdkMessage` dispatches on `msg.type`:

- `"system"` with `subtype: "init"` → capture `msg.session_id`, emit `session.remap` once.
- `"stream_event"` (which is `SDKPartialAssistantMessage`) → translate the `BetaRawMessageStreamEvent` into our own `session.block.*` events (see 3.2).
- `"assistant"` (`SDKAssistantMessage`) → whole-turn checkpoint; used to finalize block-level accumulators for a completed assistant turn. Carries `parent_tool_use_id` for sub-agent attribution.
- `"user"` (`SDKUserMessage`) with `tool_result` content → emit `session.block.tool_result` event.
- `"result"` → emit `session.completed` with usage/cost metadata. Finalize run.
- `"system"` with `subtype: "task_started" | "task_progress" | "task_notification"` → emit matching `session.subagent.{started,progress,notification}` events for the sub-agent card status header. **Validated by R4 spike — these are the actual subtype names.**
- `"rate_limit_event"` → ignore (validated as present in stream).
- Other types → log at debug level; ignore.

### 3.2 Event protocol over WS

All events use the existing envelope `{ type: "event", event, sessionKey, runId, ts, payload }`. New `event` names:

| `event` | payload | purpose |
|---|---|---|
| `session.streaming` | `{ isStreaming: bool }` | unchanged; bubble pulse |
| `session.remap` | `{ fromSessionKey, toSessionKey }` | unchanged; **frontend must rename conversation canonically** (see 3.3) |
| `session.block.start` | `{ messageId, parentToolUseId?: string \| null, index: number, block: { type: "text"\|"thinking"\|"tool_use", id?: string, name?: string, input?: object } }` | a new content block is beginning |
| `session.block.delta` | `{ messageId, index, delta: { type: "text_delta", text } \| { type: "thinking_delta", thinking } \| { type: "input_json_delta", partial_json } }` | streaming delta for block |
| `session.block.stop` | `{ messageId, index }` | block finalized |
| `session.message.start` | `{ messageId, parentToolUseId?: string \| null, role: "assistant", ts }` | new assistant turn begins (for parent/child attribution) |
| `session.message.stop` | `{ messageId }` | assistant turn done |
| `session.tool_result` | `{ messageId, toolUseId, isError: bool, content: Array<{type: "text", text}> }` | tool ran, here's the result block |
| `session.subagent.started` | `{ parentToolUseId?, payload }` | from SDK `system.task_started` (optional render — header status) |
| `session.subagent.progress` | `{ parentToolUseId?, payload }` | from SDK `system.task_progress` |
| `session.subagent.notification` | `{ parentToolUseId?, payload }` | from SDK `system.task_notification` |
| `session.completed` | `{ usage, cost, durationMs }` | run finished successfully |
| `session.error` | `{ code, message, detail? }` | run failed |

`session.delta` (legacy flat text accumulator) is **removed**. `session.message` (final whole message) is **removed** — the block events now supply everything.

**Mapping from SDK events**, the concrete translation that `handleSdkMessage` implements:

```
SDK: { type: "stream_event", event: { type: "message_start", message } }
  → session.message.start { messageId: message.id, parentToolUseId: msg.parent_tool_use_id }

SDK: { type: "stream_event", event: { type: "content_block_start", index, content_block: {type, ...} } }
  → session.block.start { messageId, parentToolUseId, index, block }

SDK: { type: "stream_event", event: { type: "content_block_delta", index, delta } }
  → session.block.delta { messageId, index, delta }

SDK: { type: "stream_event", event: { type: "content_block_stop", index } }
  → session.block.stop { messageId, index }

SDK: { type: "stream_event", event: { type: "message_stop" } }
  → session.message.stop { messageId }

SDK: { type: "user", message: { role: "user", content: [{type:"tool_result", tool_use_id, content, is_error}]} }
  → session.tool_result { messageId: msg.uuid, toolUseId: block.tool_use_id, content, isError }

SDK: { type: "result" }
  → session.completed { ... }

SDK: { type: "system", subtype: "init", session_id }
  → if currentKey already encodes this session_id (resume case): no-op (skip remap emit)
  → else (new session): session.remap { fromSessionKey: currentKey, toSessionKey: canonical(session_id, cwd) }
```

`messageId` in our events is the SDK's `message.id` from `message_start` (Anthropic message UUID). `parentToolUseId` gives the subagent attribution we need.

### 3.3 Frontend: MessagePart types and message card

**Extend `MessageContentPart` union (`src/lib/types.ts`)**:

```ts
export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string; alt: string }
  | { type: "attachment"; name: string; mimeType: string }
  | {
      type: "tool_use";
      id: string;                   // Anthropic tool_use id; used to match tool_result
      name: string;                 // e.g. "Read", "Bash", "Agent"
      input: unknown;               // accumulated JSON (may be partial while streaming)
      inputComplete: boolean;       // true after content_block_stop
      result?: {
        isError: boolean;
        content: Array<{ type: "text"; text: string }>;
      };
      // For Agent (sub-agent) invocations: blocks produced by the sub-agent,
      // accumulated from messages whose parent_tool_use_id === this.id.
      // Rendered as a flat sibling trace, not nested inside this card.
      subAgentParts?: MessageContentPart[];
    }
  | { type: "thinking"; text: string; complete: boolean };
```

**Extend `ChatMessage`** with:
- `blockIndexById: Record<number, string>` — maps SDK stream `index` → synthetic part ID (internal bookkeeping during streaming; not rendered).
- `parentToolUseId?: string | null` — used to route a message into a parent's `subAgentParts` rather than adding it to the top-level message list.

**Extend `message-card.tsx` render switch**:

- `part.type === "text"` → `<Markdown />` (unchanged).
- `part.type === "image"` → `<img>` (unchanged).
- `part.type === "thinking"` → `<ThinkingCard>` — collapsed by default, italic gray, "Thinking…" header with chevron; click expands to show full text. Pulse dot while `complete === false`.
- `part.type === "tool_use"` → `<ToolUseCard>`:
  - Header: `<ToolIcon name>` + tool name + status badge (running / done / error).
  - Body (collapsible): pretty-printed JSON input; below that, if `result` present, a second pane with `result.content` text (monospace, scrollable, `max-h-96`).
  - If `name === "Agent"` (validated by R4 spike — Claude Code's sub-agent tool is named "Agent", not "Task") and `subAgentParts` non-empty: per **decided scope, render flat** — append sub-agent parts as a sibling list right after the Agent card with a left-border indent. (Nested-inside-the-card was rejected for simplicity; revisit later if needed.)
- `part.type === "attachment"` → existing fallback.

All new components live in `src/components/chat/parts/`:
- `parts/thinking-card.tsx`
- `parts/tool-use-card.tsx`
- `parts/tool-icon.tsx`

Each is ~40–80 lines. None require third-party deps — pure Tailwind + React.

### 3.4 Frontend: store mutations

Refactor `src/lib/stores/chat-store.ts` — the `applySessionEventToChatStore` function becomes a switch over the new event types. Key invariants:

- The pending assistant stub created at send time has a synthetic `id: crypto.randomUUID()`. When the first `session.message.start` arrives with a real Anthropic `messageId`, the stub is **promoted**: its `id` is overwritten with `messageId` and its `blockIndexById` is initialized. Subsequent `session.block.*` events use `(messageId, index)` to find the stub.
- `session.block.delta { delta: { type: "text_delta", text } }` **appends** `text` to the relevant text part. No full-replace anywhere.
- `session.block.delta { delta: { type: "input_json_delta", partial_json } }` appends to a string buffer on the tool_use part; on `session.block.stop` for that index, parse once with `JSON.parse` into `input` and set `inputComplete: true`. If parse fails, store the raw string under `input` and mark `inputComplete: false` with an error hint.
- `session.tool_result` finds the matching `tool_use` part by `id === toolUseId`, walks through all messages in the conversation (newest first), stops at first match. Sets `result`.
- If an incoming `session.message.start` has `parentToolUseId` non-null, the new assistant message is NOT pushed as a top-level message. Instead, the store finds the parent tool_use part (across all messages, matching `parentToolUseId`), and all the sub-agent's blocks accumulate inside `parent.subAgentParts`. A helper `appendToParts(parent.subAgentParts, ...)` performs the same block-level operations.
- `session.remap`: canonical remap — rename the conversation key in `conversations` and `messagesByConversation`, update `selectedConversationKey` if it matched, update URL hash to `#/chat/<real-key>` via `navigate()`, also update `localStorage.openclaw-ui-selected-conversation`.
- `session.error`: mark the pending stub with `error`, `pending: false`, put `"Error: {message}"` into its first text part.
- `session.streaming { isStreaming: false }` followed by nothing else within 3 s of a pending stub → also mark error ("stream ended unexpectedly"). This is a safety net; not strictly required.

### 3.5 Sub-agent rendering approach

**Flat with indent (decided).** Sub-agent events have `parentToolUseId`. The parent is always a `tool_use` part with `name === "Agent"` (validated by spike). The sub-agent's blocks render as **siblings to the parent message**, immediately after the Agent tool_use card, wrapped in a container with `border-l-2 border-white/[0.08] pl-3` and a small "↳ Agent" label header.

Rationale: simpler implementation than nesting recursive part lists inside the parent card. Easier to scan transcript top-to-bottom. Sub-agents are rare enough that the visual indent suffices — we can revisit nesting later if multi-agent traces become common.

Concretely: sub-agent assistant messages are *not* added to the main `messages[]` array. Instead they accumulate in `parent.subAgentParts: MessageContentPart[]`. The renderer, when emitting an Agent `tool_use` card, follows it immediately with a sibling render of `subAgentParts` in the indented container.

### 3.6 Keep adapter wire-thin

`claude-code-adapter.ts` is the ONLY file that speaks to the backend. It:
1. Receives each `ClaudeEventEnvelope`.
2. For `session.remap`, updates its `remappedSessionKeys` map so subsequent events can be emitted under the *real* sessionKey. **Change**: emit a new `SessionEvent` type `{ type: "remap", fromSessionKey, toSessionKey }` so the store can canonicalize.
3. For all other events, **pass them through** to the store as `{ type: "block", event, payload }` with minimal transformation. The store owns the state machine.

Extend `SessionEvent` in `src/lib/adapters/types.ts`:

```ts
export type SessionEvent =
  | { type: "message"; sessionKey: string; message: Message }      // kept for other adapters (OpenClaw)
  | { type: "streaming"; sessionKey: string; isStreaming: boolean }
  | { type: "updated"; sessionKey: string }
  | { type: "remap"; fromSessionKey: string; toSessionKey: string }
  | { type: "raw"; sessionKey: string; event: string; payload: Record<string, unknown> };
```

The ClaudeCode adapter forwards everything as `type: "raw"`. The store's `applySessionEventToChatStore` handles `raw` by dispatching to a dedicated `handleClaudeEvent` that knows all the `session.*` sub-events. OpenClaw/Codex adapters continue to emit the coarse `message`/`streaming`/`updated` events they already do.

---

## Section 4 — Step-by-step Implementation Order

Each step leaves the build passing. Commit after each.

### Step 1 — Install SDK + smoke test
**Files touched:** `package.json`, `pnpm-lock.yaml`.
**Change:**
- `pnpm add @anthropic-ai/claude-agent-sdk@^0.2.114`
- No code yet.
**Verify:** `pnpm typecheck` passes. `node -e "import('@anthropic-ai/claude-agent-sdk').then(m => console.log(Object.keys(m)))"` prints `query`, `listSessions`, `getSessionMessages`, etc.
**LoC:** 2 (package.json + lock).

### Step 2 — Extend `MessageContentPart` and `ChatMessage` types
**Files:** `src/lib/types.ts`.
**Change:** Add `tool_use` and `thinking` variants to `MessageContentPart` exactly as in 3.3. Extend `ChatMessage` with `parentToolUseId?: string | null` and `blockIndexById?: Record<number, string>`. Keep all existing fields.
**Verify:** `pnpm typecheck` succeeds. Existing tests still pass (the union widening is non-breaking for consumers that narrow to `text` / `image`).
**LoC:** ~25.

### Step 3 — Add empty renderer branches so new types don't crash
**Files:** `src/components/chat/message-card.tsx`.
**Change:** Add `if (part.type === "thinking") { return null; }` and `if (part.type === "tool_use") { return null; }` as placeholder branches. They do nothing yet; this is so that when the store starts emitting them in Step 10, nothing in the renderer blows up. Update the existing "fallback" `return` to narrow type so TypeScript is happy.
**Verify:** Build passes, tests green, no runtime change.
**LoC:** ~8.

### Step 4 — Add new `SessionEvent` variants
**Files:** `src/lib/adapters/types.ts`.
**Change:** Add `remap` and `raw` variants to the `SessionEvent` union. Bump adapter `handleServerEvent` contracts to emit these (but don't change logic yet).
**Verify:** `pnpm typecheck`. All adapters compile because new variants are additive and the store currently ignores unknown variants.
**LoC:** ~6.

### Step 5 — Canonical remap in ClaudeCode adapter + store
**Files:**
- `src/lib/adapters/claude-code-adapter.ts`: in the `session.remap` branch, also emit `{ type: "remap", fromSessionKey, toSessionKey }` to subscribers (in addition to the existing `updated` emit). Continue to populate `remappedSessionKeys` so future events are routed.
- `src/lib/stores/chat-store.ts`: in `applySessionEventToChatStore`, add a `case "remap":` branch that:
  - renames the conversation entry: replaces `fromSessionKey` with `toSessionKey` in `conversations[]` and in `messagesByConversation`;
  - updates `selectedConversationKey` if it matched;
  - calls `navigate(\`#/chat/${encodeURIComponent(toSessionKey)}\`)` if the user is currently viewing the remapped chat;
  - writes `localStorage.setItem("openclaw-ui-selected-conversation", toSessionKey)`.

**Verify:** Manual — open a brand new chat, send "hello", watch sidebar: the title shifts, no duplicate rows; URL hash changes from `#/chat/web-abc` to `#/chat/<cwd>%3A%3A<uuid>`. Refresh page; session is still selected under the real key.

Also unit test: add `chat-store.test.ts` case that dispatches a `remap` event and asserts keys swap.

**LoC:** ~40.

### Step 6 — Add `/cancel` button wiring (needed before we break streaming)
**Files:**
- `src/lib/adapters/types.ts`: add `cancelRun(runId)` to `SessionAdapter`.
- `src/lib/adapters/claude-code-adapter.ts`: implement as `POST /api/claude-code/runs/:runId/cancel`.
- `src/lib/adapters/openclaw-adapter.ts`, `codex-adapter.ts`, `local-adapter.ts`: no-op implementations.
- `src/lib/stores/chat-store.ts`: add `cancelStream(runId)` action; calls adapter's cancel; marks the pending stub as aborted on success.
- `src/components/chat/chat-composer.tsx`: when `isStreaming`, replace Send button with a red Stop button that calls `cancelStream`.

**Verify:** Send a long message ("write me a 2000 word essay…"), stop mid-stream; bubble shows "Run aborted", streaming chip clears.
**LoC:** ~70.

### Step 7 — Create SDK-based runner (scaffolding, not wired yet)
**Files:** new `server/claude/sdk-runner.mjs`.
**Change:** full implementation of the runner in 3.1, emitting the new `session.block.*`/`session.message.start`/`session.tool_result`/`session.completed`/`session.error` events but **NOT** the legacy `session.delta`/`session.message`. Export `startRun`, `cancelRun`, `getRunStatus` with identical signatures. Keep `resolveAnthropicApiKey` helper — copy-paste or move to a shared module `server/claude/auth.mjs`.

```js
// sketch
export async function startRun(sessionKey, userMessage, { cwd, onEvent, timeoutMs = 5 * 60_000 } = {}) {
  const runId = randomUUID();
  const info = parseSessionKey(sessionKey || "");
  const resumeId = sessionKey && sessionKey.includes("::") ? info.sessionId : undefined;
  const resolvedCwd = cwd || info.cwd || process.cwd();

  const rawKey = await resolveAnthropicApiKey();
  const apiKey = rawKey.startsWith("sk-ant-api") ? rawKey : "";
  const env = { ...process.env };
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  else delete env.ANTHROPIC_API_KEY; // ensure OAuth fallback

  const controller = new AbortController();
  const state = {
    runId, sessionKey, status: "running", startedAt: nowIso(),
    cwd: resolvedCwd, onEvent, controller, finished: false, error: null,
    sessionIdSeen: false,
  };
  activeRuns.set(runId, state);
  emit(state, "session.streaming", { isStreaming: true });

  const timer = setTimeout(() => {
    state.error = "timeout";
    controller.abort();
  }, timeoutMs);

  (async () => {
    try {
      const q = query({
        prompt: userMessage,
        options: {
          resume: resumeId,
          cwd: resolvedCwd,
          includePartialMessages: true,
          permissionMode: "bypassPermissions",
          env,
          abortController: controller,
          extraArgs: { "dangerously-skip-permissions": null }, // matches today's trust model
        },
      });
      for await (const msg of q) {
        handleSdkMessage(msg, state);
      }
      finalizeRun(state, "completed");
      emit(state, "session.completed", {});
    } catch (err) {
      if (controller.signal.aborted && state.status !== "error") {
        finalizeRun(state, "aborted");
        emit(state, "session.error", { code: "aborted", message: "Run cancelled" });
      } else {
        finalizeRun(state, "error");
        emit(state, "session.error", { code: "sdk_error", message: err.message, detail: err.stack });
      }
    } finally {
      clearTimeout(timer);
      emit(state, "session.streaming", { isStreaming: false });
    }
  })();

  return { runId, sessionKey, acceptedAt: state.startedAt };
}
```

`handleSdkMessage` implements the mapping table in 3.2.

**Verify:** `pnpm typecheck`. Not wired to `serve.mjs` yet — no runtime change. Unit-test the mapping with a recorded SDK event log if time permits (optional).
**LoC:** ~250 (new file).

### Step 8 — Flip `serve.mjs` to import the new runner
**Files:** `serve.mjs` line 24, `server/claude/standalone-runner.mjs` (delete).
**Change:** `import { startRun, cancelRun, getRunStatus } from "./server/claude/sdk-runner.mjs";` Delete `standalone-runner.mjs` in the same commit. **No env toggle, no fallback** — per locked decision #3, if SDK breaks we don't ship.
**Verify:**
- Start a new chat, send "say hi". Expect WS frames: `session.streaming` → `session.message.start` → `session.block.start (text)` → multiple `session.block.delta` → `session.block.stop` → `session.message.stop` → `session.completed` → `session.streaming (false)`.
- Network tab in DevTools on the WebSocket shows these frames.
- Chat bubble is **still empty** because the store doesn't understand the new events yet. This is acceptable during this step — we're just confirming the backend.

**LoC:** ~5 added, ~390 deleted.

### Step 9 — Thin adapter: emit raw events to store
**Files:** `src/lib/adapters/claude-code-adapter.ts`.
**Change:** In `handleServerEvent`, after handling `session.remap` and `session.streaming`, all other `event.event` strings get forwarded as `{ type: "raw", sessionKey: mappedSessionKey, event: event.event, payload: event.payload ?? {} }`. Remove the old `session.delta` and `session.message` special cases.

**Verify:** Networking still clean; the store should now receive `{ type: "raw", event: "session.block.delta", payload: {...} }` callbacks. The bubble is still empty because the store hasn't been taught to handle them yet.

**LoC:** ~30 (subtraction mostly).

### Step 10 — Store: handle `raw` events
**Files:** `src/lib/stores/chat-store.ts`.
**Change:** Add `handleClaudeRawEvent(event, payload, sessionKey, runId, set, get)`. Dispatches on `event`:
- `session.message.start` → locate pending assistant stub by (sessionKey, not-yet-assigned-real-id); if found, assign `id = payload.messageId`; else, if `parentToolUseId`, find parent tool_use across messages and attach a new message-like substructure to `parent.subAgentParts`; else, create a new assistant message shell. Store `blockIndexById = {}`.
- `session.block.start` → find the message (by messageId or by parentToolUseId pointer); allocate a new part of the right kind in its `parts` array (text: `{type:"text", text:""}`; thinking: `{type:"thinking", text:"", complete:false}`; tool_use: `{type:"tool_use", id: block.id, name: block.name, input: "", inputComplete: false}`); record `blockIndexById[index] = <partKey>`.
- `session.block.delta` → look up the part by `blockIndexById[index]`; for `text_delta`, append; for `thinking_delta`, append to `.text`; for `input_json_delta`, append to `.input` (kept as a string during streaming).
- `session.block.stop` → for tool_use parts, try `JSON.parse(part.input)`; set `inputComplete: true` on success. For thinking parts, set `complete: true`.
- `session.message.stop` → mark message `pending: false` and clear its streaming state.
- `session.tool_result` → walk messages looking for a `tool_use` part with `id === toolUseId` (including `subAgentParts` recursively); set `.result = { isError, content }`.
- `session.completed` → conversation `isStreaming = false`, `runId = null`.
- `session.error` → mark pending stub with `error`, append error text to its first text part (or create one).

Every mutation uses functional set-state updates for immutability.

**Verify:** Manual — send "write a function to reverse a string" and watch chars appear incrementally in the bubble. Send "list files in this dir" and watch a Bash `tool_use` card appear, then its `tool_result` populate below. Send "use a sub-agent to find all TODOs" and watch the Agent card followed by an indented sub-agent trace.

Unit tests: add a test that feeds a canned event sequence and asserts final `messagesByConversation` shape. 2-3 tests covering text-only, text+tool_use+tool_result, and sub-agent flat-sibling routing.

**LoC:** ~200 (most of the real work).

### Step 11 — Implement `ToolUseCard`, `ThinkingCard`, `ToolIcon`
**Files:** new `src/components/chat/parts/tool-use-card.tsx`, `parts/thinking-card.tsx`, `parts/tool-icon.tsx`. Wire into `message-card.tsx` replacing the placeholder `return null` from Step 3.

`ToolUseCard` skeleton:
```tsx
export function ToolUseCard({ part }: { part: ToolUsePart }) {
  const [expanded, setExpanded] = useState(false);
  const status = part.result
    ? (part.result.isError ? "error" : "done")
    : part.inputComplete ? "running" : "streaming";
  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/20 text-sm">
      <button onClick={() => setExpanded(x => !x)}
              className="flex w-full items-center gap-2 px-3 py-2">
        <ToolIcon name={part.name} />
        <span className="font-mono text-[12px] text-zinc-200">{part.name}</span>
        <StatusBadge status={status} />
        <span className="ml-auto text-zinc-500">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div className="border-t border-white/[0.06] px-3 py-2 space-y-2">
          <pre className="text-[11px] text-zinc-400 overflow-x-auto">
            {typeof part.input === "string" ? part.input : JSON.stringify(part.input, null, 2)}
          </pre>
          {part.result && (
            <div className={`rounded bg-black/30 px-2 py-1.5 text-[11px] whitespace-pre-wrap ${part.result.isError ? "text-rose-300" : "text-zinc-300"} max-h-96 overflow-y-auto`}>
              {part.result.content.map((c, i) => c.type === "text" ? <div key={i}>{c.text}</div> : null)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Sub-agent parts render OUTSIDE the card (flat sibling, indented):
export function SubAgentTrace({ parts }: { parts: MessageContentPart[] }) {
  if (!parts.length) return null;
  return (
    <div className="border-l-2 border-white/[0.08] pl-3 space-y-2 my-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">↳ Agent</div>
      {parts.map((p, i) => <PartRenderer key={i} part={p} />)}
    </div>
  );
}
```

In `message-card.tsx`, when iterating message parts: if a part is `tool_use` with `name === "Agent"` AND has `subAgentParts`, render `<ToolUseCard>` followed immediately by `<SubAgentTrace parts={part.subAgentParts}>`.

`ThinkingCard`: italic, collapsed-by-default, ~30 lines.

`ToolIcon`: switch on `name` → inline SVG for Read / Write / Edit / Bash / Glob / Grep / WebSearch / WebFetch / Agent; fallback generic wrench.

**Verify:** Visual check. Tool cards look distinct from text. Expanding/collapsing works. `pnpm test` — MessageCard test still passes (it renders a text-only message).

**LoC:** ~200.

### Step 12 — Clean-up and polish
**Files:** `src/lib/stores/chat-store.ts` (remove legacy `session.message`/`session.delta` code paths if still present), `README.md` (brief note).

(Old runner already deleted in Step 8 — no toggle to remove.)

Error polish:
- When `session.error` arrives, the error chip on the message should show the backend's `code`: "auth_error", "cli_missing", "aborted", "timeout", "sdk_error".
- Map SDK error text "Claude Code binary not found" → user-friendly "Claude Code not installed. Run: npm i -g @anthropic-ai/claude-code".
- Map "authentication_failed" → "Not logged in. Run `claude login` in a terminal."

**Verify:** Full test plan from Section 6.

**LoC:** ~40 added, ~10 removed (most legacy code already gone in Step 8).

### Step 13 — Backend history parser upgrade for tool blocks (optional but cheap)
Only if time allows.
**Files:** `server/claude/transcript-parser.mjs`.
**Change:** Instead of flattening tool blocks to `[tool_use:Name]`, return them as structured objects. Update the HTTP handler for `/history` to pass them through as `parts[]` instead of `content: string`. Update `normalizeHistoryMessage` in `shared.ts` to map them into the new `MessageContentPart` union. This gives persistent tool-block rendering on session reload.
**Verify:** Reopen a session from yesterday; tool cards are present.
**LoC:** ~80.

---

## Section 5 — Migration / Compatibility

Single-user personal tool, local-only. Specific concerns:

- **In-flight streams across the cutover.** If a user has an open stream when they restart the server, the new runner has no state. The pending assistant stub in the browser will stay pending until they refresh (which abandons the stub anyway). Fine.
- **Old transcripts.** Claude stream-json transcripts on disk have the same shape as before (SDK spawns the same CLI binary). `session-index.mjs` and `transcript-parser.mjs` continue to work untouched. `parseSessionKey` unchanged.
- **API keys.** No change. Subscription OAuth via `~/.claude/.credentials.json` continues to work because the SDK spawns the native Claude Code binary exactly like the CLI does.
- **Localstorage.** `openclaw-ui-selected-conversation` and `openclaw-ui-hidden-messages-v1` schemas unchanged.
- **Conversation keys.** Old `web-*`/`pending-*` entries the user may have lingering in localStorage are harmless; `refreshSessions` overwrites the list on connect.
- **Rollout.** One `git checkout main && pnpm install && pnpm build && pnpm serve`. No DB, no migration script. No env toggle — recovery on regression is `git revert` of Step 8.

---

## Section 6 — Test Plan (Manual)

Run these after Step 12, before calling it done.

### A. Streaming behavior
1. New chat → "count from 1 to 30 slowly" → numbers appear incrementally, not all at once. Streaming chip pulses. When chip clears, all numbers present.
2. "write a haiku about cats in plain text" → 3 lines stream in over ~2 seconds.
3. Long response: "write a 500-word essay on the history of the printing press" → tokens flow for ~30 s; no freezes; scroll stays pinned to bottom until user scrolls up.

### B. Tool use rendering
4. "list the files in the current directory" → a `Bash` or `Glob` tool_use card appears with input shown on expand; result populates below with the file list.
5. "read package.json and tell me the dependencies" → `Read` tool_use card; result shows file content.
6. "search for all files containing 'TODO'" → `Grep` tool_use card; result lists matches.

### C. Thinking blocks (only triggers on complex prompts)
7. "Plan a refactor to split serve.mjs into modules." → `Thinking` card appears (Opus 4.7 default). Expand it and verify content is readable.

### D. Sub-agents
8. "Use a sub-agent to find all `any`-typed variables in src/". Verify: parent `Agent` tool_use card appears in the transcript; immediately below it (as a sibling, not nested), a left-bordered indented block labeled "↳ Agent" shows the sub-agent's tool_use cards (Grep, Read) and final text.

### E. Session lifecycle
9. New chat → send message → verify URL hash changes from `#/chat/web-xxxx` to `#/chat/<cwd>%3A%3A<uuid>` when the first `session.remap` arrives. Sidebar entry renames in place (no duplicate row).
10. Reload page. Open the session from step 9 from the sidebar. Verify full transcript loads.
11. Send another message in the same session. Verify the runner uses `resume: <uuid>`, and the conversation continues (not restarted).
12. Delete a session from the sidebar ellipsis menu. Verify it disappears, the JSONL file moved to `~/.openclaw/.trash/claude-sessions/`.
13. Rename a session. Reload. Title persists.

### F. Navigation during stream
14. In session A, send "write me a 500-word essay". While it's streaming, click a different session in the sidebar. Verify: the stream in A continues in the background (check sidebar pulse dot), viewing B is clean (no A messages bleeding in). Return to A — full streamed output is there, complete.
15. Click "New Chat" while session A is streaming. Same expectations.
16. While A is streaming, click the Stop button. Bubble transitions to "Run aborted" within 250 ms; streaming chip clears.

### G. Multiple concurrent streams
17. Open two browser tabs on the same app. In tab 1, send a long prompt in session A. In tab 2, switch to session B and send a prompt. Both stream independently. Both conversations update in both tabs via the WS broadcast.

### H. Errors
18. Rename the `claude` binary temporarily (e.g. `which claude` then `sudo mv` it aside). Send a message. Expect: `session.error` with code `cli_missing` or `sdk_error`, error chip on the bubble, banner text "Claude Code not installed". Restore the binary.
19. Temporarily edit `~/.claude/.credentials.json` to invalidate the token. Send a message. Expect: `session.error` with code `authentication_failed`, helpful hint. Restore creds.
20. Send an infinite-loop prompt ("write numbers forever"). Verify 5-minute timeout fires: bubble transitions to error.

### I. Page reload while streaming
21. Send a long prompt, reload mid-stream. Expect: on reload, the transcript shows the user message; no pending assistant stub; the stream continues server-side to completion (check server logs). Refresh the sidebar — the session shows the completed assistant message from the persisted transcript.

### J. Regressions
22. Send a message with no assistant tools used — "what is 2+2?" — plain text reply, no cards. Exactly one bubble.
23. Copy an assistant message. Clipboard contains plain text of text parts only (not tool input JSON).
24. Hide a message. It disappears, persists across reload.
25. "Create Task" from an assistant message: task modal opens prefilled with the message text.

---

## Section 7 — Risk Register & Open Questions

| # | Risk / Question | Mitigation / Decision needed |
|---|---|---|
| R1 | ~~OAuth auth via SDK may not fall through.~~ | ✅ **RESOLVED** by spike. SDK 0.2.114 reads `~/.claude/.credentials.json` correctly when `ANTHROPIC_API_KEY` is unset/deleted. |
| R2 | SDK version 0.2.114 is freshly released. Could have bugs. | Pin exactly to `0.2.114`. If regressions surface, downgrade to `0.2.111` (which supports Opus 4.7). No toggle — `git revert` Step 8 on regression. Personal tool, low blast radius. |
| R3 | `includePartialMessages: true` may emit deltas for **input_json** in chunks that are not valid JSON until stop. Already handled by storing as string during streaming. Risk: a very long tool input (like a Bash command with a big `$(…)`) makes the tool_use card show `input_json_delta` string content that looks weird mid-stream. | Only render `part.input` in the card when expanded; show "streaming args…" placeholder while `!inputComplete`. |
| R4 | ~~Sub-agent attribution unverified.~~ | ✅ **RESOLVED** by spike. Every assistant + user message inside a sub-agent carries `parent_tool_use_id` matching the parent Agent's `tool_use.id`. Boundary clean: sub-agent's final result returns to parent as a top-level `tool_result`. Tool name is `"Agent"`, not `"Task"`. |
| R5 | ~~`cancelRun` via `AbortController` — slow?~~ | ✅ **RESOLVED** by spike. 2ms cancel→exit latency, throws `"Claude Code process aborted by user"`, subprocess cleaned within 500ms. No SIGINT fallback needed. |
| R6 | Two-tab scenario: both tabs get both streams. If one tab's user sends in session A and the other tab's user sends in session A at the same time, we'd have two overlapping pending stubs. | Accept as a known limitation; it's a personal tool with one user. No fix. |
| R7 | `session.remap` mid-stream side effects. If a `session.block.delta` arrives BEFORE `session.remap` with the real session ID, the frontend's `remappedSessionKeys` map isn't populated yet — event is routed under `session_id::<uuid>` which doesn't exist in store. | SDK emits `system.init` (which we translate to `remap`) as the *first* message. Verify. If out-of-order is possible, queue events server-side until remap fires. Low risk. |
| R8 | `/history` endpoint still returns `content: string` (whole flattened). When the user reopens a past session, tool cards won't appear. | Acknowledged in Step 13 (optional). Punt to follow-up. |
| R9 | Store's `handleClaudeRawEvent` is ~200 LoC of state-machine logic with many cases. Edge cases (missing message, message already finalized, duplicate events) could produce undefined parts. | Write ≥3 unit tests in `chat-store.test.ts`. Add defensive `?` chains and log-once warnings on unexpected shapes. |
| R10 | Opus 4.7 requires SDK v0.2.111+. If the user's claude binary is older, a mismatch. | `query()` will error clearly. Surface the error text verbatim. |
| R11 | ~~SDK `options.resume` may fork session_id, requiring per-turn remap.~~ | ✅ **RESOLVED** by spike. SDK preserves the original session_id on resume. Remap logic only fires on first message of a new session, never on resume. |

**Decisions locked (2026-04-20):**
1. ✅ **Permission mode: `bypassPermissions`.** Full bypass. No interactive modal in this pass.
2. ✅ **Sub-agent rendering: flat with indent.** Sibling render after the Agent card, `↳ Agent` label, left border. Can revisit later.
3. ✅ **No fallback runner.** Delete `standalone-runner.mjs` directly when SDK runner is wired. No `MC_USE_SDK` toggle needed. If SDK breaks, we don't ship.

---

## Section 8 — Effort & Sequencing

### Total effort estimate
Experienced engineer familiar with the codebase: **~14 hours of focused work**, comfortably fits in 2 days or an aggressive 1-day sprint. Breakdown:

| Step | Time | Depends on |
|---|---|---|
| 1. Install SDK | 10 min | — |
| 2. Extend types | 20 min | 1 |
| 3. Placeholder renderer branches | 15 min | 2 |
| 4. SessionEvent variants | 15 min | 2 |
| 5. Canonical remap | 60 min | 4 |
| 6. Cancel button | 60 min | 5 |
| 7. SDK runner | 3 h | 1, 4 |
| 8. Flip serve.mjs | 30 min (+ debugging) | 7 |
| 9. Thin adapter | 30 min | 8 |
| 10. Store event handler | 3 h | 9, 2 |
| 11. Tool/thinking cards UI | 2 h | 10, 3 |
| 12. Cleanup + error polish | 1 h | 11 |
| Manual testing + fixes | 2 h | 12 |
| **Total** | **~14 h** | |

### Suggested commit breakdown (1:1 with steps)
1. `deps: add @anthropic-ai/claude-agent-sdk`
2. `types: extend MessageContentPart with tool_use and thinking variants`
3. `ui: add placeholder branches for tool_use/thinking parts in MessageCard`
4. `adapters: add remap and raw SessionEvent variants`
5. `fix: canonicalize session key on pending→real remap`
6. `feat: add cancel button for in-flight streams`
7. `feat: add SDK-based runner emitting structured block events`
8. `refactor: replace standalone-runner with SDK runner in serve.mjs`
9. `refactor: thin ClaudeCode adapter, forward events as raw to store`
10. `feat: handle block-level streaming events in chat store`
11. `ui: render tool_use, tool_result, thinking, and sub-agent cards`
12. `cleanup: remove legacy session.delta/message handlers; polish error messages`
13. *(optional)* `feat: surface tool blocks in transcript history`

Each commit is independently shippable — the app continues to function between steps, though with degraded streaming fidelity until Steps 10+11 land.

### Critical sequencing rules
- Steps 2–6 are UI and adapter preparation — all backwards-compatible with the old runner. Can ship each individually.
- Steps 7–10 form a risky cluster: Step 8 breaks rendering (empty bubbles) until Step 10 lands. **Do 7→8→9→10 in one uninterrupted session.** No toggle exists — recovery is `git revert` if something explodes.
- Step 11 is purely visual and can be iterated on without touching backend.

---

## Critical Files for Implementation

- `server/claude/standalone-runner.mjs` — replaced wholesale by new `server/claude/sdk-runner.mjs`; old file deleted at Step 8.
- `src/lib/adapters/claude-code-adapter.ts` — thinned to forward `raw` events; remap handling revised.
- `src/lib/stores/chat-store.ts` — central event handler `handleClaudeRawEvent` added; remap logic centralized.
- `src/components/chat/message-card.tsx` — renders the new part variants through `ToolUseCard` / `ThinkingCard`.
- `src/lib/types.ts` — widened `MessageContentPart` union.

---

## Followups — Chat polish (captured 2026-04-20)

User feedback after shipping context-bar:

1. **Thinking blocks render empty.** Every expandable "thinking" section is blank.
   - Likely cause: `extended_thinking` blocks arrive as `content_block_delta` with `delta.type === "thinking_delta"` but we may not be appending to a `thinking` MessageContentPart. Verify transcript-parser + sdk-runner + store append path.
   - Transcript resume path has its own extraction (`extractTextParts` → `thinkingParts`). Check it's fed into `MessageContentPart[]` not discarded.
   - Files: `src/lib/stores/chat-store.ts` (block delta handler), `server/claude/transcript-parser.mjs`, `src/components/chat/message-card.tsx` or `src/components/chat/parts/*`.

2. **[DONE]** **Message action buttons are over-prominent.** Too many buttons per message, each too large.
   - Keep: Copy, Create-task (low priority — could stay in a menu)
   - User messages only: add **Rewind to here** — truncates conversation to that point and re-prompts from there. Needs transcript rewrite + session replay (non-trivial). (Still open; not part of this pass.)
   - Remove: Retry, Hide, other per-message clutter from assistant messages.
   - Consolidation: collapse into a `⋯` overflow button in the top-right of the bubble. Or: always-small (14px) icons hidden behind hover on desktop, tap-to-reveal on mobile.
   - Files: `src/components/chat/message-card.tsx`.
   - **Resolution:** collapsed all four actions (Copy / Create task / Retry / Hide) behind a single kebab `⋯` button in the top-right of every bubble. Dropdown opens via portal to escape transcript overflow, closes on outside click or Escape. Kebab is dim-until-hover on desktop, always visible on mobile. Net: bubble footprint dropped by ~44px of chrome per message.

3. **[DONE — verify live test]** **Stop button disappears after page refresh during a run.** If the page reloads mid-stream, the UI has no Stop affordance even though the run is still active on the backend.
   - Resolution: `onCancel` is wired in `chat-composer.tsx` and the Stop button renders whenever `isStreaming` is true. Hydration path in `claude-code-adapter.ts` emits a synthetic `session.init` from `/history`, and `isStreaming` rides along. Code paths confirmed; worth a manual test (reload mid-stream, Stop button should reappear).
   - **Original diagnosis (kept for context):**
   - Root cause: the initial SSE/WebSocket connection doesn't reattach to in-flight streams. Streaming state is local-only and gets reset on reload.
   - Options:
     - **Server-side run registry**: on reconnect, query `/api/claude-code/runs/active?sessionKey=...`; if a run is in-flight, hydrate `isStreaming=true` and allow cancel via runId. Requires a small endpoint and that `sdk-runner.mjs` keeps `activeRuns` addressable.
     - **Stream replay**: far more complex — SDK would need to buffer and replay or we'd need to tee every event through a persistent ring buffer keyed by runId. Probably not worth it.
   - The cheap win is option 1: just reattach "is running" and let Cancel work. The partial bubble won't animate, but it'll finalize correctly when the run completes (the backend still emits `session.message.stop` / `session.completed` over the WS).
   - Files: `serve.mjs` (new endpoint), `server/claude/sdk-runner.mjs` (expose active-run lookup), `src/lib/adapters/claude-code-adapter.ts` (hydrate on connect), `src/lib/stores/chat-store.ts` (set streaming from reconnect hydration).

4. **Voice "play" button on assistant replies (TTS).** Add a small speaker icon per assistant message that reads the text aloud.
   - MVP: browser `SpeechSynthesis` API — zero backend, zero cost, works offline. Button toggles play/stop; strips markdown and tool_use JSON before speaking (text parts only).
   - Better quality: pipe to a server-side TTS (ElevenLabs, OpenAI TTS, or a local model) with streaming playback. Requires API key and cost tracking.
   - UX: per-message play button; global "auto-read new replies" toggle (off by default); respect the `session.message.stop` event so mid-stream clicks don't speak half a reply.
   - Files: `src/components/chat/message-card.tsx` (button), new `src/lib/tts.ts` (wrap SpeechSynthesis with abort + markdown stripping), optional server endpoint if going with cloud TTS.

5. **Auto-collapse completed tool calls; keep only the running one expanded.** Each tool_use card is currently collapsed by default. User wants: *all* cards collapsed *except* the one currently executing, which should be expanded until it finishes, then auto-collapse.
   - Implementation: in `ToolUseCard`, derive `defaultExpanded` from status: `"running" | "streaming"` → expanded; `"done" | "error"` → collapsed. User can still manually toggle and their choice sticks (don't auto-collapse if the user manually expanded).
   - Edge case: multiple parallel tool calls in one turn — each runs briefly; auto-expand each while running is fine, they'll collapse as they finish.
   - Edge case: on history reload everything is `done`, so all collapsed — matches current behavior.
   - Files: `src/components/chat/parts/tool-use-card.tsx` (status-driven expand, track manual override).

*Top 3 highest-leverage for phone use (per 2026-04-20 discussion): image paste (#8), slash-command menu (#9), edit-last-user-message (#12).*

6. **[DONE]** **Scroll-to-bottom button + don't hijack scroll when reading above.** Two related scroll behaviors.
   - Resolution: `app.tsx` tracks `isAtBottom` with 40px tolerance; auto-scroll is gated on it. FAB renders when `!isAtBottom && messages.length > 0`, clicking re-arms auto-scroll.
   - **Original plan (kept for context):**
   - **Don't auto-scroll mid-read.** Currently the transcript pins to the bottom on every incoming event. If the user has scrolled up to read earlier context, new deltas yank them back down.
     - Track `isAtBottom` state by listening to the scroll container's `scroll` event with a small tolerance (~40px from bottom = "at bottom"). Only auto-scroll when `isAtBottom === true`.
     - Reset to true on: user send, explicit scroll-to-bottom click, switching sessions.
   - **Scroll-to-bottom FAB.** When `isAtBottom === false`, render a floating button (bottom-right above composer, circular, chevron-down icon). Click scrolls the transcript to the bottom smoothly and re-arms auto-scroll.
     - Optional: badge the button with count of new messages/blocks arrived while scrolled up.
   - Files: `src/components/chat/chat-view.tsx` (or wherever the scroll container lives), new `src/components/chat/scroll-to-bottom-fab.tsx`.

### Composer / input

7. **Voice dictation input.** Natural pair with TTS output (#4). Browser `SpeechRecognition` (webkit prefix on Safari). Mic button in composer toggles recording; interim transcript renders in the textarea; submit on explicit send. Big phone win.
   - Files: `src/components/chat/chat-composer.tsx`, new `src/lib/stt.ts`.

8. **[DONE — `c583436`]** **Image paste & upload in composer** *(top priority)*. Currently text-only. Support pasting screenshots from clipboard, dragging files onto the window, and a paperclip button for file picker. Attach as base64 image blocks to the Anthropic message content array. Critical for phone (screenshots) and debugging.
   - Resolution: `chat-composer.tsx` handles clipboard paste (image MIME filter, renames unnamed pastes with timestamp), drag-drop, and file picker with multi-select. Images attach as base64 image blocks.
   - **Original plan (kept for context):**
   - SDK path: user messages can include `{ type: "image", source: { type: "base64", media_type, data } }` blocks alongside text. Needs `sdk-runner.mjs` to accept a `content: Array<Part>` shape instead of just a string prompt.
   - Files: `src/components/chat/chat-composer.tsx` (paste/drop handlers, preview chips), `server/claude/sdk-runner.mjs` (accept multimodal prompt), `serve.mjs` (API change), `src/lib/types.ts` (already has `image` part).

9. **Slash command menu with autocomplete** *(top priority)*. Typing `/` at the start of the composer opens a popover: `/compact`, `/model <alias>`, `/clear`, `/cost`, `/help`, etc. Fuzzy-match as user types. Matches CLI muscle memory.
   - Commands route to the same handler `quickSend` already uses; new commands might need backend routing (e.g., `/cost` should render locally, not send to Claude).
   - Files: new `src/components/chat/slash-menu.tsx`, `chat-composer.tsx`.

10. **[DONE]** **Draft persistence per conversation.** Typing a message, switching sessions, coming back — the draft is still there. Also survives page reload. `localStorage` keyed by sessionKey, cleared on send.
    - Files: `src/components/chat/chat-composer.tsx`, `src/lib/stores/chat-store.ts` (drafts map).

11. **Keyboard shortcuts + cheat sheet.** Cmd+K new chat, Cmd+/ opens shortcuts modal, Esc cancels active stream, Cmd+Shift+F search, Cmd+↑ edit last user message (→ #12), Cmd+Enter send. Display a "?" button in the corner that opens the cheat sheet.
    - Files: new `src/lib/hotkeys.ts`, new `src/components/chat/shortcut-help.tsx`, wire into `app.tsx`.

12. **Edit last user message** *(top priority)*. Cheap version of rewind. Cmd+↑ or an Edit action on the user bubble pulls the text back into the composer; on send, truncate the conversation at that message and re-prompt. Needs transcript splice + resume from prior turn.
    - Less invasive than full rewind-to-arbitrary-point (followup #2) because it's always the last turn — no mid-history session replay.
    - Files: `src/lib/stores/chat-store.ts` (editLastMessage action), `src/components/chat/message-card.tsx` (edit button on user messages), backend: truncate SDK session or resume from earlier turn.

### Rendering

13. **Code block syntax highlighting + per-block copy.** Shiki or Prism for highlighting; Copy button in each code block's top-right (distinct from message-level copy). Also show detected language.
    - Files: `src/components/chat/markdown.tsx` (or wherever Markdown is rendered); add `rehype-shiki` or similar.

14. **KaTeX math rendering.** `remark-math` + `rehype-katex`. Low-cost, only matters if user prompts math/technical content.
    - Files: `src/components/chat/markdown.tsx`.

### Navigation & state

15. **WS reconnect indicator.** Small dot in the header: green=connected, amber=reconnecting, red=disconnected. Auto-reconnect with exponential backoff. Toast when reconnect fails repeatedly.
    - Files: `src/lib/adapters/claude-code-adapter.ts` (reconnect logic), new `src/components/header/connection-dot.tsx`.

16. **Search within current conversation.** Cmd+F (override browser's or layer on top). Highlight matches, jump next/prev. Searches rendered text parts only (not tool JSON unless opted in).
    - Files: new `src/components/chat/in-conversation-search.tsx`.

17. **Global search across all conversations.** Separate from #16. Searches transcript `.jsonl` files server-side (ripgrep or naive scan). Results list → click opens session + jumps to message.
    - Files: new `/api/claude-code/search` endpoint in `serve.mjs`, new `src/components/sidebar/global-search.tsx`.

18. **Auto-generated session titles.** First user message → 3-6 word title via a cheap Haiku completion (or simple heuristic: first 40 chars). Sidebar shows titles instead of raw keys. Persisted in `~/.openclaw/ui-titles.json` or equivalent. User can rename manually (already supported).
    - Files: `server/claude/session-index.mjs` (title field), `serve.mjs` (title generation on first message), sidebar rendering.

### Session management

19. **[DONE]** **Export conversation** as markdown. One-click from the session's kebab menu. Includes tool calls collapsed as code fences. Plain markdown, no frontmatter.
    - Files: new `src/lib/export-conversation.ts`, sidebar kebab menu.

20. **Pin/favorite sessions + folder grouping.** Sidebar section for pinned at top. Optional folder grouping by `cwd` prefix (already have `~/projects/*` structure). Drag to pin, right-click to assign folder.
    - Files: `serve.mjs` (pin metadata), `src/components/sidebar/*`.

### Mobile polish

21. **[DONE — `37aa70e`]** **Sidebar as bottom sheet / swipe drawer on narrow screens.** Desktop-style sidebar is awkward on phone. Tailwind breakpoint: at `md` and below, collapse sidebar behind a swipe-in drawer with a scrim.
    - Resolution: `app.tsx` renders the sidebar behind an `xl:hidden` fixed overlay + backdrop scrim + slide-in transform, safe-area aware, closes on backdrop click / Escape.
    - Files: `src/app.tsx`, `src/components/sidebar/*`.

22. **iOS viewport / keyboard handling.** Use `visualViewport` API + `env(safe-area-inset-bottom)` so the composer stays above the software keyboard and doesn't get cut off by the home indicator. Known Safari pain point.
    - Files: `src/components/chat/chat-composer.tsx`, `index.css`.

23. **[PARTIAL]** **Bigger touch targets on message actions.** Ties into followup #2 (button cleanup). Any button <44x44pt is a miss on mobile. Either enlarge icons or gate them behind an overflow menu with 44pt targets.
    - Current state: dropdown menu items hit target (`px-3 py-2.5`), but the kebab trigger button itself is ~24×24 (p-1 + 16px icon) — still under the 44pt guideline. Low-effort fix: bump the trigger padding on mobile.

### Perf (not urgent)

24. **Virtual scrolling for 500+ message conversations.** `@tanstack/react-virtual` on the message list. Only bother when a long transcript actually feels sluggish.
    - Files: `src/components/chat/chat-view.tsx`.

### Composer sizing & reading mode

25. **[DONE]** **Composer auto-sizes: small when empty, grows with content.** Current composer is too tall at rest. Goal: single-line height when empty (~40–44px), auto-grow per line up to a cap (say 50% of viewport height), then internal scroll. Plain `textarea` with JS-driven height: reset to `auto`, read `scrollHeight`, clamp to max. Debounce on `input`. The current size-when-full is good — just shrink the empty state.
    - Files: `src/components/chat/chat-composer.tsx`.
    - **Resolution:** the auto-size logic already existed; it was the surrounding chrome that made the composer feel tall. Trimmed outer wrapper `p-2.5` → `p-1.5`, inner dropzone `p-2.5` → `px-2 py-1`, and wrapper around ContextBar + ChatComposer from `pb-2 pt-2` → `pb-1 pt-1` (mobile only; desktop unchanged). Dropped the mobile-visible "Enter to send" hint row. Net: the empty-state composer chrome shrunk by ~18–22px.

26. **[DONE]** **Footer/menu bar overlaps composer as it grows.** As the textarea expands with content, the fixed bottom action/menu bar starts covering the bottom of the composer, hiding text and buttons.
    - Root cause likely: composer is positioned absolutely or fixed and the footer sits at a fixed z-order/position that assumes a static composer height.
    - Fix options:
      - Stack composer *above* the footer in normal flow so the footer naturally pushes down the page (cleanest).
      - Or: make the footer sticky-at-bottom-of-viewport with composer reserving space via `padding-bottom`, and have the composer's max-height respect `100dvh - footer - context-bar - header` so it never overlaps.
    - Also: context bar above composer should stack cleanly with the growing textarea.
    - Files: `src/app.tsx` (layout), `src/components/chat/chat-composer.tsx`, any bottom nav/footer component.
    - **Resolution:** the layout was already structurally correct (chat view is a flex column inside a wrapper that reserves `pb-[calc(3rem+env(safe-area-inset-bottom))]` for the mobile tab bar). What leaked was the composer's growth cap — 40% of innerHeight was too generous once you added context bar + tab bar reservation, so a long message could still push visually into the reserved area. Dropped the cap to 32% of `window.innerHeight` (with a hard ceiling of 280px). Combined with the #25 chrome trim, the composer now comfortably coexists with the tab bar on every viewport tested.

27. **Full-screen reading mode.** A toggle that hides sidebar, header, composer, footer — everything except the message list — for distraction-free reading of long replies.
    - Keybind: maybe `Cmd+.` or a dedicated button (expand icon) near the model badge / context bar.
    - Behavior: takes full viewport; a small floating "exit" pill top-right; Esc exits. Scroll behavior (#6) still applies.
    - Preserve conversation scroll position on enter/exit.
    - Files: `src/app.tsx` (layout flag), new `src/components/chat/reading-mode-overlay.tsx`, hotkey wiring.

### Gestures / navigation ergonomics

28. **Swipe-back gesture on mobile (Telegram/iOS-style).** Edge-swipe from the left to go back to the previous view — especially useful for popping from an open conversation back to the sidebar/conversation list, or for undoing a session switch.
    - Hash-route navigation needs a real history stack: `navigate` should use `history.pushState` (not replace) so `history.back()` and the native swipe-back on iOS Safari work out of the box. Check whether current routing replaces or pushes.
    - For in-app swipe (non-iOS or when we want custom behavior): edge-swipe detector on the left ~20px of the screen; starts a translateX on the conversation view with finger tracking; release past ~30% width or >500px/s velocity commits the back nav, else springs back.
    - Disable on text selection / scrollable horizontal content (code blocks).
    - On desktop: ignore (browser back button suffices).
    - Files: `src/app.tsx` (router), new `src/lib/swipe-back.ts` (touch handler hook), `src/components/chat/chat-view.tsx` (wrap in gesture container on mobile).

### Transcript resume fidelity

30. **[DONE]** **Empty bubbles on resumed sessions.** Reopening any non-trivial session shows blank user AND assistant message bubbles. Verified on `-home-clawd-projects::e1845fe8-bf3f-4979-97f2-55341616453e`: of 500 messages in `/history`, many have `content: ""` (length 0) — both user turns that consist entirely of `tool_result` blocks and assistant turns that are pure `tool_use` / `thinking` get flattened to empty string.
    - Resolution: `transcript-parser.mjs` folds `tool_result` blocks into their matching `tool_use` parts; user messages containing only `tool_result` get returned with parts folded away. `chat-store.ts` filters out messages with `parts.length === 0` on hydration. No more ghost bubbles.
    - Root cause: `server/claude/transcript-parser.mjs` `extractText` keeps only `.text` blocks and drops everything else. A user `tool_result` turn has no `.text` at all → empty. An assistant turn whose blocks are `[tool_use, thinking]` → empty.
    - Fix direction: return structured `parts: MessageContentPart[]` from `/history` instead of a flat `content: string`. This is the same work as plan Step 13 ("optional history parser upgrade") and is no longer optional — the absence is user-visible as ghost bubbles.
    - Frontend must also stop rendering an empty bubble when a message has zero parts; either hide it or render a compact "(tool call)" placeholder pending the structured parse.
    - Files: `server/claude/transcript-parser.mjs`, `serve.mjs` `/history` response shape, `src/lib/adapters/claude-code-adapter.ts` `history()`, `src/lib/shared.ts` (normalizeHistoryMessage), `src/components/chat/message-card.tsx`.

31. **[DONE]** **Assistant tool-use blocks render as plain text on resume.** Even when a message has content, the tool call is serialized as the string `[tool_use:Name] {...json...}` rather than a structured tool_use card. Verified in history payload for the same conversation — `contentPreview: "[tool_use:mcp__playwright__browser_evaluate] {\"function\":\"...\"}"`.
    - Resolution: `transcript-parser.mjs` `extractParts()` emits structured `{ type: "tool_use", id, name, input, ... }` parts instead of bracketized strings. `ToolUseCard` renders them as interactive collapsible cards on resume, matching live streaming.
    - Root cause: same `transcript-parser.mjs` flattening — tool blocks get bracketized strings. Live streaming now has `tool_use` cards (per recent work) but resumed history does not.
    - Fix bundled with #30 — structured parts from the parser naturally resolve this; renderer picks `tool_use` variant.
    - Files: same as #30.

32. **[DONE]** **Subagent transcript files surface as top-level sessions in the sidebar.** Verified: 64 of the 100 sessions returned by `GET /api/claude-code/sessions` are `agent-*` entries with keys like `-home-clawd/<parent-uuid>/subagents::agent-abc475575063bc180` and `cwd: "-home-clawd/<parent-uuid>/subagents"`. These are Claude Code's sub-agent transcripts written under `<parent>/subagents/agent-*.jsonl`, not independent user sessions.
    - Resolution: `session-index.mjs` `walk()` skips any directory named `subagents`. Simplest-fix path from the plan.
    - Root cause: `server/claude/session-index.mjs` (or wherever `/sessions` lists files) is scanning all `.jsonl` under `~/.claude/projects/**/` without excluding `**/subagents/**`.
    - Fix options:
      - **Simplest:** filter out any transcript whose path contains `/subagents/` from the top-level session list.
      - **Better:** associate sub-agent transcripts with their parent session (lookup by parent UUID dir), surface them as nested/linked entries visible only when drilling into the parent (matches the Agent tool_use card → subagent trace relationship).
    - Related: the `cwd` field of sub-agent sessions is a fake path (not a real directory). If we ever try to *run* against such a key, resolving cwd will fail — add a guard.
    - Files: `server/claude/session-index.mjs`, possibly `serve.mjs` `/history` path resolution.

### Readability / eye comfort

33. **Eye-friendliness audit — research + apply best practices.** The current design *looks* good but fatigues the eyes when actually reading chat content for any length of time. Needs a comprehensive pass grounded in established readability research, not vibes.
    - **Research phase** — survey well-established sources and summarize what applies to a chat UI. Target sources: Butterick's *Practical Typography*, Material/Apple HIG readability sections, WebAIM contrast guidance, WCAG 2.2 AA/AAA, GitHub/Linear/Notion's published design notes, iA Writer's typography rationale, research on dark-mode legibility (reduced contrast vs pure-white-on-black, avoiding "halation"/"bloom").
    - **Topics to cover:**
      - **Fonts** — body face choice (system-ui vs Inter vs Söhne-style humanist sans); preferring humanist sans for UI, transitional serif for long-form; monospace for code (JetBrains Mono / IBM Plex Mono / Berkeley Mono). Font-weight range actually readable on dark BG (usually 400–500, not 300). Optical size / x-height considerations.
      - **Contrast** — dark mode should NOT be pure white (#fff) on pure black (#000). Typical best practice: foreground `~#e6e6e6`/`#ddd` on `~#121212`/`#1a1a1a` background. Check current token values. Target WCAG AA (4.5:1) for body, AAA (7:1) where feasible. Avoid high-contrast "bloom" that causes after-images.
      - **Line length (measure)** — 45–75 characters per line for body; chat bubbles often run wider than this. Consider `max-width: 65ch`.
      - **Line height (leading)** — 1.5–1.65 for body copy; 1.3–1.4 for headings; 1.4–1.5 for UI.
      - **Paragraph spacing & rhythm** — space between paragraphs >= line-height; consistent vertical rhythm (8px baseline grid or similar).
      - **Font size** — body 15–17px on desktop, 16–18px on mobile; code blocks ~14px with higher contrast. Avoid <13px anywhere that holds real reading content.
      - **Letter-spacing / tracking** — slight negative tracking on large headings; default on body.
      - **Spacing/padding** — breathing room inside bubbles, between messages. Current bubbles may be too dense.
      - **Color usage** — limit accent colors for body text; reserve saturated colors for interactive elements. Muted grays for metadata/timestamps.
      - **Markdown elements** — headings, lists, blockquotes, inline code, links all need clear hierarchy without overpowering.
      - **Code blocks** — background slightly lighter than page (not darker), syntax colors with enough separation but not neon; padding sized for readability.
      - **Motion** — avoid rapid flashes during streaming; the pulse dot should be subtle.
      - **Optional**: user-adjustable density ("comfortable" / "compact"), font-size slider, toggle for serif vs sans body.
    - **Deliverable:**
      - A short write-up (`docs/READABILITY.md`) of findings + decisions.
      - A concrete token diff to `src/styles/*` or Tailwind config: font stacks, color tokens, spacing scale, typography scale.
      - Before/after screenshots on desktop + phone.
    - **Files:** new `docs/READABILITY.md`, `tailwind.config.*`, `src/index.css` (or design tokens file), `src/components/chat/markdown.tsx`, `src/components/chat/message-card.tsx`, `src/components/chat/parts/*`.

### Compaction artifacts leak into rendered transcript

34. **[DONE — `27a0fe4`]** **Claude Code's compaction plumbing renders as real messages.** Verified against `-home-clawd-projects::e1845fe8-bf3f-4979-97f2-55341616453e`, which has been compacted **54 times** (19MB, 6451-line `.jsonl`). After every `/compact`, Claude Code writes two records to the transcript:
    1. `{"type":"system","subtype":"compact_boundary","content":"Conversation compacted","compactMetadata":{preTokens, postTokens, durationMs, ...}}`
    2. `{"type":"user","message":{"role":"user","content":"This session is being continued from a previous conversation that ran out of context.\n\nSummary:\n..."}}` — the synthetic re-seed prompt containing the model's multi-thousand-word summary of the prior window.
    Our parser has zero handling for either. Result: every compaction shows up in the UI as (a) a silently-swallowed system line and (b) a giant user bubble that looks like the human sent a wall of text they never wrote. Compounds: 54 compactions → 54 ghost-essays in this one session.
    - User messages in the transcript also contain Claude Code harness tags that render as literal text because the markdown pipeline doesn't strip them:
      - `<system-reminder>…</system-reminder>` (TodoWrite reminders, deferred-tool notifications, available-skills listings)
      - `<local-command-caveat>…</local-command-caveat>` (wrapper around slash-command stdout)
      - `<command-name>…</command-name>`, `<command-message>…</command-message>`, `<command-args>…</command-args>` (slash-command invocation metadata)
      - `<bash-input>…</bash-input>`, `<bash-stdout>…</bash-stdout>`, `<bash-stderr>…</bash-stderr>` (from `!` bash mode)
    - Fix direction:
      - **Parser (`server/claude/transcript-parser.mjs`)** — recognize `type:"system"` + `subtype:"compact_boundary"` and emit a dedicated `compact_boundary` message variant carrying `preTokens/postTokens/durationMs/trigger`. Detect the synthetic summary user message (heuristic: first user message after a boundary, or content starts with the literal `"This session is being continued from a previous conversation"` sentinel) and either drop it entirely — its value is for the model, not the human — or attach it as metadata on the boundary marker so it can be shown on demand ("Show summary").
      - **Renderer** — render the boundary as a slim horizontal divider: `— Conversation compacted · 176k → 5.7k tokens · 1m46s —`. Never as a bubble.
      - **Tag stripping** — before markdown parse, strip or fold the harness tags above. Either regex-strip (cleanest for model-facing noise the human never intended to send) or render as dimmed collapsed `<details>` chips labeled "system reminder" / "slash-command output" so power users can audit what reached the model. Default: strip.
    - Also expose compaction count + ratio in the session header (e.g. sidebar tooltip: "compacted 54×"), since a heavily-compacted session is a different beast (smaller retained context, more summary-of-summary drift). Ties into feedback about 1M context quality degradation.
    - Files: `server/claude/transcript-parser.mjs` (detect boundary + synthetic summary), `src/lib/types.ts` (new message variant or `MessageContentPart` kind), `src/components/chat/message-card.tsx` (render divider), `src/components/chat/markdown.tsx` (tag-stripping pre-pass), possibly `src/components/chat/parts/text-part.tsx`.

### Context window starts at 200k on refresh, snaps to 1M after next turn

35. **[DONE]** **Context-window indicator lies until the first assistant response.** Reload the page on any 1M-mode conversation → the context bar reads `77.1k / 200k` (39%). Send a message, wait for the reply → the bar jumps to `77.1k / 1M` (8%). The tokens didn't change; only the denominator did, because the 1M tag only reaches the UI via the live `session.init` event. Fingerprint and fix:
    - The API strips the `[1m]` tag on its way out: `assistant.message.model` is always `"claude-opus-4-7"`, even when `--betas context-1m-2025-08-07` is active.
    - The runtime `system.init` event (emitted once per `query()` by the SDK) carries the tagged string `"claude-opus-4-7[1m]"`. Commit `c4723b4` wired init → `conversation.contextModel/contextWindow` — this is why a turn fixes it.
    - The transcript `.jsonl` never persists the init record. `server/claude/transcript-parser.mjs` only exposes `lastUsage` (model, input/output/cache tokens), all API-shape, so the tag is already gone. On refresh, the adapter emits a synthetic `session.usage` with that stripped model → the store's regex fails to match 1M → `contextWindow = 200_000` (see `src/lib/stores/chat-store.ts:466-485`).
    - Fix direction:
      - **Preferred:** have the server report the *runner's* default model alongside `lastUsage`. `server/claude/sdk-runner.mjs` knows its own `model` option (e.g. `opus[1m]`) since it passed it to `query()`. Expose it from `/api/claude-code/sessions/:key/history` as `runnerModel` (or similar) and let the adapter prefer it over the stripped usage model when setting `contextWindow`.
      - **Fallback heuristic:** if any turn's `cacheRead + cacheCreation + input > 200_000`, the session is demonstrably 1M — surface that from the parser as `contextWindow` hint. Cheap and always correct when it fires, but silent on sessions that never exceeded 200k.
      - **Nuclear:** persist init's model into the transcript on our own sidecar file (e.g. `<sessionId>.meta.json`) since Claude Code won't. More moving parts than it's worth.
    - Files: `server/claude/sdk-runner.mjs` (export runner model), `server/claude/transcript-parser.mjs` (pipe through `runnerModel` or compute the token-exceeds-200k heuristic), `server/claude/session-index.mjs` (may need to update the history handler shape), `src/lib/adapters/claude-code-adapter.ts` (prefer runnerModel), `src/lib/stores/chat-store.ts` (use the preferred model in `session.usage` fallback branch).
    - Verify by: reload `http://127.0.0.1:18795/#/chat/…` on any Opus-1M session; the bar must read `/1M` before any user turn is sent. Current behavior on `e1845fe8-bf3f-4979-97f2-55341616453e`: reads `/200k`.
    - **Resolution:** went with "Preferred" option. `sdk-runner.mjs` exports `getConfiguredModel()`; `serve.mjs` `/history` includes it as `runnerModel`; `claude-code-adapter.ts` `history()` synthesizes a `session.init` with that model *before* emitting the synthetic `session.usage`, so the store's existing init handler sets the right window on resume. Simplified `session.usage` handler (dropped `stripTag`/`sameFamily`/`shouldUpdateModel` workaround block) — net negative LOC.

### Status pill stale after /compact

36. **[DONE]** Status pill doesn't update when `/compact` runs — stays frozen at the pre-compact token count until the next assistant turn fires a `session.usage`. The `compact_boundary` divider in the transcript shows the correct `pre → post` numbers, so the data is clearly in flight; `sdk-runner` emits `session.compact_boundary` carrying `postTokens`; `chat-store` was explicitly dropping that event ("forwarded for future UI rendering; silently dropped for now"). Fixed by wiring the handler to patch `contextTokens` from `postTokens` immediately. Component sub-totals (input/cache/output) get refreshed on the next assistant turn.

### Concurrent-session cross-contamination (2026-04-22, unresolved)

37. **Two active sessions' histories appear to swap when clicking between them.** Reproduced live: user had two recently-active sessions in the sidebar, both with runs in flight. Clicking back and forth, each conversation showed the *other* session's scrollback — not partial pollution, a full takeover in both directions.
    - Static analysis came up empty. Audited every write site to `messagesByConversation` in `chat-store.ts` (lines 117–122, 710, 838, 867, 901–906, 944, 1022, 1044, 1065, 1076, 1144) — every assignment is scoped to its own `key`/`sessionKey` function parameter. No cross-key writes. Event routing uses `event.sessionKey` from per-run server state; per-run state is never shared. `/history` reads `session.transcriptPath` which is derived from the file path at index time — no way for one session's key to resolve to another's jsonl.
    - The render pipeline is direct: `chatSessionKey` from URL via `useSyncExternalStore` → `selectedMessages = messagesByConversation[chatSessionKey]`. No memoization to stale-dep.
    - Still could be: timing race during concurrent streams (two runs emitting events simultaneously), server-side `rebuildIndex()` cache corruption under concurrent access, transient React render interleaving, or something unexplored.
    - Needs instrumentation to reproduce with logs at: adapter event emit, store raw-event routing, hydration set, remap merge, sendMessage set. Without logs, more guessing is lies.
    - Also need from user on next repro: were both runs in-flight, did the swap persist across refresh, same tab or multi-tab, which two session keys.
    - Files to touch when diagnosing: `src/lib/adapters/claude-code-adapter.ts`, `src/lib/stores/chat-store.ts`, `server/claude/sdk-runner.mjs`, `server/claude/session-index.mjs`, `server/claude/ws-broker.mjs`.

38. **[DONE]** Mid-stream refresh loses session history entirely (2026-04-22, possibly related to #37). Repro: two sessions active, query running in both, refresh the page while viewing one of them. Result: main chat area shows "Start something new / Send a message to get started" empty state — no messages rendered. Server has full history (curl `/api/claude-code/sessions/<key>/history` returns 22 messages), but the browser never fires the `/history` GET after refresh. Zero `claude-code/sessions/<key>/history` requests in the network panel.
    - Root cause: race in `app.tsx:301-305`. The `useEffect` calls `selectConversation(chatSessionKey)` on mount with deps `[chatSessionKey, selectConversation]`. `selectConversation` (`chat-store.ts:883`) early-returns if `!adapter.isConnected()`. On first paint the adapter is still connecting (sibling effect at `app.tsx:314`). When the WS connects later, nothing re-triggers `selectConversation` for the URL's session, so `/history` is never fetched. `messagesByConversation[sessionKey]` stays undefined/empty forever.
    - Fix: added `adapterConnected` to the effect's deps and gated the call: `if (chatSessionKey && adapterConnected) void selectConversation(chatSessionKey);`. The effect now re-fires once the WS connects, and `/history` gets fetched exactly once per (session, connection) tuple.

### Tasks polling traffic (2026-04-22, done)

39. **[DONE]** Client hammered `/api/files/read?path=tasks.json` hundreds of times per page load. Two causes in `task-store-v2.ts`:
    - `loadRemote()` did `files.exists()` *and* `files.read()` on every poll — doubled the request count for no gain, since `/api/files/read` already returns 404 when the file is missing and `loadRemote` already catches that into `null`. Dropped the `exists()` round-trip.
    - Polling ran unconditionally, including when the tab was hidden. Added a `document.hidden` short-circuit and bumped the default interval from 3s → 5s. Background-tab traffic is now zero; foreground traffic is one request every 5s instead of two every 3s (~6× reduction overall).
