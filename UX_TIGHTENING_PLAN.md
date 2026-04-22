# UX Tightening Pass — Chat Dynamics (April 2026)

**Goal:** close the feel-gap between agent-ui and Claude Code CLI. This plan is self-contained and meant to be executed in one sitting (~6–8h) without further clarification. Read it end-to-end before touching any file.

---

## 1. Problem statement (what actually fails today)

Real user complaints, verified against the code:

1. **Tool-call spam.** Every `Read` / `Grep` / `Bash` renders as a heavy collapsible card stacked vertically. A 10-tool turn drowns the assistant's actual reply in chrome. The user never expands these cards; they exist purely as noise. Claude Code CLI instead shows each completed tool as a single compact log line (`⎿ Read src/app.tsx`) and reserves visual weight for the prose answer.
2. **Auto-scroll falls behind mid-stream.** The pin-to-bottom pattern tracks `messages.length` but not in-place height growth (streaming text into an existing bubble, tool cards expanding, images loading). So scroll drifts up as content streams in.
3. **"Stuck vs working" is ambiguous.** During long turns, tool cards sit in `running` state and there is nothing at the bottom telling the user *"still alive, currently doing X"*. If the backend stalls without emitting `session.error`, the UI spins forever with no warning. A turn that ends on a tool result silently drops its stub — the user sees no "done" signal and wonders if something hung.
4. **Sidebar preview is useless.** Every non-text last-part renders as the literal string `"[Image]"` (see `buildPreview` in `shared.ts:210`). So when the last activity was a tool call, thinking block, or an actual image, the sidebar row says "[Image]" — no indication of what the conversation is about or whether it's running.

## 2. Design principles

- **Prose is the message; tools are the receipts.** Tool invocations should be lightweight log lines, never competing for attention with the assistant text.
- **One running tool expanded at a time, everything else collapsed.** Match the CLI: the in-flight operation is visible, completed ones are one-liners.
- **Always tell the user what's happening.** If a stream is active, show a concrete activity line (`"Reading src/app.tsx…"`), not a generic spinner. If a stream stalls, say so.
- **Never leave a turn silently empty.** A turn that ends on a tool must still produce a closing signal.
- **Pin behavior should survive in-place growth**, not just new messages.

## 3. Out of scope (do NOT do these in this pass)

- Eye-comfort / typography audit (plan #33)
- Virtual scrolling (plan #24)
- Keyboard shortcuts, slash-command menu (plan #9, #11)
- Syntax highlighting / KaTeX (plan #13, #14)
- Bug #37 (cross-contamination) — still shelved, orthogonal
- Changing the `ChatMessage` / `MessageContentPart` shape in `src/lib/types.ts` — the plan preserves all existing store state; all grouping is render-time only
- Backend/transcript changes — purely frontend

---

## 4. Workstreams

### A. Tool-call rendering overhaul (biggest win)

**Current state:**
- `src/components/chat/message-card.tsx:131–184` maps `message.parts` to a component per part. A `tool_use` part becomes a `<ToolUseCard>` inside a wrapper with 12px vertical space between parts (`space-y-3` on line 130).
- `src/components/chat/parts/tool-use-card.tsx` renders each tool as a bordered card (`rounded-lg border border-white/[0.08] bg-black/20`) with a clickable header and collapsed body by default (`useState(false)` at line 38).
- The `Agent` tool case also renders a `<SubAgentTrace>` beneath the card (message-card.tsx:157–159). This stays as-is — sub-agents are recursive and deserve full cards.

**Target state:**
- New component `src/components/chat/parts/tool-log-row.tsx` — a **single-line** row for completed/queued tool invocations. Visual: `[icon] ToolName  <arg summary>   <duration ms / "running…">`. Height ~24px, no border, muted color. Click anywhere on the row toggles an inline expanded panel (same content the current `ToolUseCard` shows, but without its own border — rendered as an indented block beneath the clicked row).
- Consecutive `tool_use` parts (within one ChatMessage's `parts` array) are visually grouped: a thin 1px left rail in `border-white/[0.06]` with 8px left padding. This is CSS-only, implemented by detecting runs of `tool_use` while iterating.
- Exactly one tool in the group is **expanded by default** at any time: the **currently running** one. "Running" = `statusFor(part) === "running" || "streaming"` (reuse `statusFor` from tool-use-card.tsx:9). On completion it auto-collapses to a log row. The user can still click to re-expand.
- If there is no currently-running tool in the group (i.e. the turn is done), all tools are collapsed by default.
- The `Agent` tool **keeps its current full-card treatment** (plus its `<SubAgentTrace>`). Do not log-row-ify sub-agents.
- On `ChatMessage` completion (`pending: false`), the auto-expanded running row collapses — implemented via a `useEffect` in the group component that reacts to each tool's `statusFor` transition.

**Concrete tasks:**

1. **Create `src/components/chat/parts/tool-log-row.tsx`.** Props: `{ part: ToolUsePart; defaultExpanded?: boolean }`. Internals:
   - Local `useState` for expansion, seeded from `defaultExpanded`.
   - One-line summary: tool name + a 60–80 char slice of the first meaningful input field. Use a helper `summarizeInput(name, input)` that knows the common tools:
     - `Read`, `Write`, `Edit`, `NotebookEdit`, `NotebookRead` → `input.file_path`
     - `Bash` → first line of `input.command` (trim trailing, ellipsize past 80 chars)
     - `Grep` → `input.pattern` + optional `glob`/`path`
     - `Glob` → `input.pattern`
     - `WebFetch` → `input.url`
     - `WebSearch` → `input.query`
     - Unknown → `JSON.stringify(input).slice(0, 80)`
   - Trailing meta on the right (muted): if `result` present → nothing (done state is implicit); if running → small 3-dot pulse; if error → "error" badge in rose.
   - Expanded body: reuse the existing pattern from `tool-use-card.tsx:55–70` (input `<pre>` + result scrollable block) but without its own border — render as a left-padded block beneath the row.
   - Status colors from `tool-use-card.tsx:15–26` — keep that palette to stay on-brand.

2. **Create `src/components/chat/parts/tool-log-group.tsx`.** Props: `{ parts: Array<{ part: ToolUsePart; originalIndex: number }> }`. Internals:
   - Render as a `<div>` with the left rail (`border-l border-white/[0.06] pl-3 space-y-1`).
   - For each part, render a `<ToolLogRow>`; set `defaultExpanded={statusFor(part) === "running" || statusFor(part) === "streaming"}`.
   - Only the first running/streaming tool in the group should get `defaultExpanded=true`; subsequent in-flight ones stay collapsed (in practice Claude Code runs tools sequentially, so there is at most one at a time — but be defensive).

3. **Modify `src/components/chat/message-card.tsx:131–184`.** Replace the naïve `.map` with a pass that:
   - Walks `message.parts`, collecting runs of consecutive `tool_use` parts (excluding `Agent`) into buffers. Flush a buffer by rendering `<ToolLogGroup>` with the collected parts. Non-tool parts and `Agent` parts render with their existing components inline.
   - The wrapping `<div className="space-y-3 overflow-x-hidden">` stays the same; groups are siblings of text/thinking blocks.
   - Keep all other part types (`text`, `image`, `attachment`, `thinking`, `compact_boundary`) rendering exactly as today.

4. **Delete the old `ToolUseCard` import from `message-card.tsx`** once the new group path is in — but keep `tool-use-card.tsx` file **in place** for now, since `SubAgentTrace` and any future use of the card treatment still reference it. Re-audit after this pass; don't delete the file as part of this plan.

**Preserve:**
- `SubAgentTrace` rendering for `Agent` parts.
- `blockIndexById` on `ChatMessage` (currently unused at render time).
- Copy / retry / hide / task menu on `MessageCard`.
- Markdown rendering for text parts.
- Compact_boundary divider short-circuit at `message-card.tsx:67–71`.

**Acceptance:**
- A 10-tool turn renders as 10 one-line log rows under a single left rail, with the final assistant text bubble visually dominant.
- During streaming, exactly one running tool is expanded; as it completes, it collapses and the next starts expanded automatically.
- Clicking a completed tool row still shows its full input + output.
- Agent / sub-agent tool blocks look unchanged.

---

### B. Scroll pin that survives in-place growth

**Current state (`src/app.tsx:132–157`):**
- `isAtBottom` is tracked on a scroll listener with 40px tolerance (lines 135–138).
- Auto-scroll effect fires on `[lastMessage?.id, lastMessage?.pending, loading, messages.length, isAtBottom]` (line 157) — but **not on in-place content growth**, which is what streaming text and expanding tool rows produce.
- There is already a floating "jump to bottom" FAB (lines 199–220). Good — keep it.

**Target state:**
- A `ResizeObserver` on the scroll container's *inner content* (the div that wraps all messages) that, when content height grows AND `isAtBottom` is currently true, re-pins to the bottom. Skip the call when not pinned — this is what lets the user scroll up to read without being yanked.
- Throttle the scroll listener's `computeAtBottom` via `requestAnimationFrame` so rapid scroll events (touch-momentum on iOS) don't starve the main thread.

**Concrete tasks:**

1. In `src/app.tsx` ChatView (around lines 112–165):
   - Add a new ref `const contentRef = useRef<HTMLDivElement | null>(null);` — attached to the inner wrapping `<div>` at line 169–172's contents. Concretely: wrap the flex-col children (lines 173–197) in a new `<div ref={contentRef}>` that does nothing else. The ResizeObserver needs a stable element whose `scrollHeight` changes.
   - New `useEffect` with deps `[isAtBottom]` (read the latest via a ref to avoid re-subscribing each render): create a `ResizeObserver` on `contentRef.current` that, on any entry, calls `endRef.current?.scrollIntoView({ block: "end" })` **only when the isAtBottom ref is true**.
   - The RO disconnects on cleanup.
   - Throttle the existing scroll listener: store an `rafId` in a ref; inside `computeAtBottom` cancel pending raf, request a new one, run the measurement inside.

2. Do **not** change the `block: "end"` jump behavior — we don't want smooth animation during streaming (it visibly stutters). Smooth is only for the explicit FAB click, which is already correct at line 161.

3. Keep the "on session switch: reset to bottom" effect at lines 146–151 as-is.

**Edge cases:**
- Very first paint with no messages: RO fires once with 0 height — harmless, `scrollIntoView` on an end-ref inside an empty list is a no-op visually.
- If the user scrolls up mid-stream, `isAtBottom` flips to false, RO's pin-check short-circuits, FAB appears. This is correct.

**Acceptance:**
- Open a long conversation, send a prompt that produces a 200+ line response. Without touching scroll: the bottom stays pinned through the entire stream, including while tool cards expand/collapse.
- Scroll up mid-stream: reading position holds, FAB appears, no jumps.
- Click FAB: smooth scroll to bottom, pin resumes.

---

### C. "Working vs stuck" clarity

**Current state:**
- Streaming signal is `conversation.isStreaming` (set/unset in chat-store.ts on `session.streaming` events).
- Stop button in `ChatComposer:290–313` reflects it (red square vs blue arrow).
- Sidebar shows a pulsing blue dot when `conversation.isStreaming`.
- But **there is no per-turn activity line** telling the user *what* is running, and **no stall detector** — if the backend falls silent, the UI spins forever.
- Empty stubs are filtered on `session.completed` (chat-store.ts:409–413) — so a turn that ends purely on tool results silently vanishes from the message list. From the user's POV: no assistant reply appeared.

**Target state:**

1. **Always-visible turn status line.** A small strip pinned to the bottom of the message list (above the composer, inside the scroll container so it stays in transcript flow) that, while `conversation.isStreaming`, shows the current activity. Format:
   - `"Thinking…"` — if the latest pending assistant message has an in-progress `thinking` part with no text yet.
   - `"Reading src/app.tsx…"` / `"Running bash: npm test…"` / `"Searching for 'foo'…"` — if there is a running `tool_use`. Use the same `summarizeInput` helper from workstream A.
   - `"Writing…"` — if the latest part is an in-progress `text` part (streaming prose).
   - `"Waiting for Claude…"` — fallback when none of the above matches (e.g. between blocks).
   - Hidden entirely when not streaming.

2. **Stall detector.** In `chat-store.ts`, track `lastEventAtBySession: Record<string, number>` — updated on any event that reaches `handleClaudeRawEvent` for that sessionKey. A separate `useEffect` in the ChatView (or a small hook `useStallDetector(sessionKey)`) polls every 5s; if `isStreaming && Date.now() - lastEventAt > 20000`, render a warning pill above the status line: `"⚠ No activity for 20s — [Retry] [Stop]"`. Buttons reuse the existing cancel and retry paths.

3. **Explicit "done with no text" indicator.** Modify the `session.completed` handler in chat-store.ts (around line 409–413) to **not** filter the assistant stub if the turn produced *any* `tool_use` part. Instead, mark it `pending: false` and append a synthesized `text` part with the literal content `"✓ Done"` (one unicode check, no decoration). The assistant bubble thus always renders a closing signal. Exception: if the filtered stub had literally zero content parts (true empty), keep filtering it — that's the existing behavior for harmless junk.
   - Alternative if the team prefers a non-text signal: append a new `{ type: "turn_complete" }` part and render it as a small inline check in `message-card.tsx`. This requires a new discriminant on `MessageContentPart`, which the "out of scope" list forbids — so use the text-part approach above.

**Concrete tasks:**

1. **New hook `src/components/chat/use-turn-status.ts`.** Takes a `sessionKey`; reads `messagesByConversation[sessionKey]` and `conversations.find(...).isStreaming`; returns `{ text: string | null, stalled: boolean }`. Logic as described above. Keep it pure — no side effects.

2. **New component `src/components/chat/turn-status-line.tsx`.** Renders the pill. Minimal styling: `text-[11px] text-zinc-500 italic` with a small animated dot. Retry/stop buttons only appear when `stalled=true`.

3. **Mount it in ChatView (`src/app.tsx`):** just before the closing `</div>` of the scroll container (after the `endRef` at line 197). It lives inside the scroll flow so it shares pin behavior with messages.

4. **Add `lastEventAtBySession` to chat-store.** In `handleClaudeRawEvent`, at the top, update the timestamp for the event's `sessionKey`. Add a corresponding field to the store state and expose a selector.

5. **Modify session.completed stub handling in chat-store.ts.** Replace the filter-out with the append-"✓ Done" text part logic for turns that have any `tool_use`.

**Preserve:**
- Existing `session.streaming` → `isStreaming` pipeline.
- The pulse dot in the sidebar.
- The Stop button in the composer.
- The existing behavior for turns that do produce text (the check is not needed there — the text itself is the done signal).

**Acceptance:**
- Send a prompt that triggers 5 tool calls then a text reply: status line says `"Reading …"` → `"Searching …"` → `"Writing…"` → disappears; no changes to the final message.
- Send a prompt that ends silently on a tool result (e.g. `/memory` write with no narration): assistant bubble closes with `"✓ Done"`.
- Simulate a stall by killing the server mid-stream: after ~20s, the stall warning appears with Retry / Stop actions.

---

### D. Sidebar preview: last assistant text OR "Working…"

**Current state:**
- `src/lib/stores/shared.ts:210` — `buildPreview(parts)` returns text parts joined + falls back to `"[Image]"` for everything else. So tool-use / thinking / image / compact_boundary endings all render as `"[Image]"`.
- `buildPreview` is called from chat-store.ts:355 (on any message update inside that session) and 1043 (when the user sends a message → preview becomes the user's text). Sidebar reads `conversation.preview` at `conversation-sidebar.tsx:403`.

**Target state per user directive:**
- Sidebar preview is **"Working…" while the conversation is streaming**, otherwise the **last assistant text message's text** (ellipsized to ~140 chars, same as today).
- Never show tool names, thinking previews, `"[Image]"`, or the user's own last message in the preview slot. If no assistant text exists yet in the session, show empty string (the sidebar already falls back to `"No messages yet"`).

**Concrete tasks:**

1. **Rewrite `buildPreview` in `src/lib/stores/shared.ts:210`** to take `(message: ChatMessage | null | undefined)` instead of `parts`, and return only text from assistant messages:
   ```ts
   export function buildPreview(message: ChatMessage | null | undefined): string {
     if (!message || message.role !== "assistant") return "";
     const text = message.parts
       .flatMap((p) => (p.type === "text" ? p.text : ""))
       .join(" ")
       .trim();
     return text.slice(0, 140);
   }
   ```
   Signature change → TypeScript will catch the two call sites.

2. **Update call sites:**
   - `chat-store.ts:355` — currently passes the just-completed assistant message's `parts`. Pass the message itself. Works — same message.
   - `chat-store.ts:1043` — currently called with the **user** message's parts on send. This is wrong by the new rule. **Delete the preview update** in the user-send path; the preview should only change on assistant messages and on `isStreaming` transitions. Keep the `updatedAt` bump; drop the preview line.

3. **Add "Working…" override.** In `conversation-sidebar.tsx:403`, change the rendered preview from `conversation.preview` alone to:
   ```tsx
   {conversation.isStreaming ? "Working…" : (conversation.preview.split("\n").find((line) => line.trim()) || "No messages yet").trim()}
   ```
   No store-level change needed — `isStreaming` is already on every `Conversation`.

4. **On session-list load** (`normalizeSession` at `shared.ts:182`): the existing `preview` logic reads `entry.lastMessage` from the server. This is fine — if the last message on disk is an assistant text it shows, otherwise it's blank and sidebar falls back to "No messages yet" (unless streaming, which wins). No change needed here.

**Preserve:**
- Sidebar row structure / pulse dot / title / timestamp — unchanged.
- Search-in-sidebar (`conversation-sidebar.tsx:208`) — still matches on `conversation.preview`. With the new rule, it matches assistant text only. That's acceptable for this pass; broader search is plan #17 (global search), out of scope.

**Acceptance:**
- Send a prompt in session A. While streaming, its sidebar row says `"Working…"`. When the reply arrives, the preview switches to the assistant's reply text (ellipsized).
- Send a tool-only turn (ends in tool result, no text). Preview stays as the **previous** assistant text — because the new turn produced no text. This is intentional; the user only cares about the last readable answer.
- User-typed message never appears in the preview slot.

---

## 5. File-touch summary

| File | Change |
|---|---|
| `src/components/chat/parts/tool-log-row.tsx` | **new** |
| `src/components/chat/parts/tool-log-group.tsx` | **new** |
| `src/components/chat/use-turn-status.ts` | **new** |
| `src/components/chat/turn-status-line.tsx` | **new** |
| `src/components/chat/message-card.tsx` | part-loop grouping (lines 131–184) |
| `src/components/chat/parts/tool-use-card.tsx` | untouched (kept for sub-agents) |
| `src/app.tsx` | ChatView scroll (ResizeObserver + rAF throttle); mount `TurnStatusLine` |
| `src/lib/stores/shared.ts` | rewrite `buildPreview` (line 210) signature + logic |
| `src/lib/stores/chat-store.ts` | call-site updates for buildPreview (lines 355, 1043); `lastEventAtBySession` tracking; modified `session.completed` stub handling (around 409–413) |
| `src/components/chat/conversation-sidebar.tsx` | "Working…" override at line 403 |

No backend files. No types file. No new store.

## 6. Testing checklist (manual, in this order)

Hit each after implementation; if any fails, fix before committing the workstream.

**A — tool rendering:**
- [ ] Prompt that runs 5 Grep + 3 Read + 1 Bash. Verify log-row-group appears under a left rail, one row per tool, final text bubble dominates.
- [ ] During streaming: exactly one tool expanded (the running one), others collapsed.
- [ ] After completion: all tools collapsed; click any row → expands, shows input + output.
- [ ] Prompt that invokes an `Agent` sub-agent. Verify the Agent tool still renders as a card, not a log row, and `<SubAgentTrace>` appears below it.
- [ ] Prompt that is pure text, no tools. Verify no tool-group artifacts (empty rail etc.).

**B — scroll:**
- [ ] Long streaming response (500+ words). Don't touch scroll. Verify bottom stays pinned.
- [ ] Same response, scroll up at token 100. Verify reading position holds, FAB appears, pin does not snap back.
- [ ] Click FAB. Smooth scroll to bottom; pin resumes; future streams keep bottom.
- [ ] Switch between sessions mid-stream. Each opens pre-scrolled to bottom.

**C — status clarity:**
- [ ] Multi-tool turn: status line shows each tool's activity label, then "Writing…", then disappears on completion.
- [ ] Silent tool turn (e.g. a write-only operation): assistant bubble closes with "✓ Done".
- [ ] Stall sim: run a long prompt, then `kill -STOP` the backend process. After ~20s: stall warning appears with Retry / Stop buttons. `SIGCONT` the backend and verify warning clears on next event.

**D — sidebar:**
- [ ] Streaming session: sidebar row shows "Working…".
- [ ] On reply: preview switches to assistant text.
- [ ] Tool-only turn: preview stays as previous assistant text.
- [ ] User-sent message never shows in preview.

**Regression checks:**
- [ ] Copy / retry / hide / task from message menu — all still work.
- [ ] `/compact` boundary still renders as divider.
- [ ] Thinking blocks: empty signed thinking still hidden, streaming thinking still shows "Thinking…" card.
- [ ] Page refresh mid-stream (bug #38 still fixed): `/history` fires, stop button reappears, stall timer resets from the resume event.
- [ ] Image attachments from the user still render in their own bubble.

## 7. Commit breakdown

Order from lowest to highest blast radius, so early commits don't depend on later ones:

1. `fix(chat): sidebar preview prefers last assistant text; "Working…" while streaming`
   → Workstream D only. `shared.ts` + `chat-store.ts` call-sites + `conversation-sidebar.tsx:403`.

2. `feat(chat): ResizeObserver-pinned scroll survives in-place content growth`
   → Workstream B only. `app.tsx` ChatView changes + rAF-throttled scroll.

3. `feat(chat): compact tool log rows with auto-expanded running tool`
   → Workstream A. New files + `message-card.tsx` part-loop rewrite. Biggest diff.

4. `feat(chat): turn-status line, stall detector, explicit done for tool-only turns`
   → Workstream C. New hook/component + chat-store changes + mount in ChatView.

Each commit must pass `npm run typecheck` and a manual smoke test of the just-shipped workstream before moving on.

## 8. Explicit anti-goals

Do **not**, in the course of this plan:

- Remove or edit `tool-use-card.tsx` (sub-agents still use it — future cleanup task).
- Change any event names, `ChatMessage`/`MessageContentPart` types, or adapter surface.
- Touch the server (`serve.mjs`, `sdk-runner.mjs`, `ws-broker.mjs`, etc.).
- Replace the existing FAB ("Scroll to bottom" button) — it's correct, keep it.
- Introduce a new state-management library, utility, or observer package. Use DOM APIs (`ResizeObserver`, `requestAnimationFrame`) directly.
- Change styling tokens / palette beyond what's described. Reuse existing Tailwind color classes (`text-zinc-500`, `bg-black/20`, etc.).
- Attempt to fix bug #37 as a side quest.

## 9. When this plan is done

Update `CHAT_OVERHAUL_PLAN.md` to mark plan items **#5** (auto-collapse tool calls) and, implicitly, the scroll / ambiguity / sidebar concerns raised in the April 2026 discussion as **[DONE]**. Append a short "UX Tightening Pass 2026-04-22" section there referencing this plan file for traceability. Do not delete `UX_TIGHTENING_PLAN.md` — keep it as a historical record.

---

**End of plan.** Execute workstreams in the commit order above. Any ambiguity encountered mid-execution — stop and ask rather than improvise.
