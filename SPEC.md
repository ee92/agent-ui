# OpenClaw UI — Product Spec

## Philosophy

**Less, but better.** Every pixel earns its place. No feature bloat, no settings labyrinths. Three things done perfectly: chat, tasks, awareness.

The UI should feel like a calm, focused workspace — not a dashboard. Think Linear meets iMessage. Fast, quiet, confident.

---

## Core Surfaces

### 1. Chat (Primary)

The main interaction surface. ChatGPT-style but aware of your broader context.

**Sidebar (left)**
- Conversation list, grouped by recency (Today / Yesterday / This Week / Older)
- Each entry: title (auto-generated or manual), timestamp, last message preview
- Active conversations show a subtle pulse/indicator
- "New Chat" button at top — prominent but not loud
- Search conversations (filters as you type)
- Compact mode: just titles, no previews (for mobile or preference)

**Chat Area (center)**
- Message stream with clear user/assistant distinction
- Streaming responses with cursor
- Markdown rendering (code blocks with syntax highlighting, tables, lists)
- Message actions on hover: copy, retry, delete
- Input area: auto-growing textarea, send on Enter (Shift+Enter for newline)
- Attachment support: drag-drop or click to attach files
- Task reference: type `#` to reference a task (autocomplete dropdown)
- Agent reference: type `@` to reference/mention an agent

**Key behaviors:**
- Creating a chat here does NOT interfere with Telegram sessions
- Each chat is a new gateway session with channel=web
- Messages stream in real-time via WebSocket
- Conversations persist and are retrievable across browser sessions
- Mobile: sidebar collapses to hamburger, chat goes full-width

### 2. Tasks (Secondary)

A minimal task board for tracking work. Not Jira — more like a focused todo list with context.

**Layout: Three columns**
- **Queue** — things to do
- **Active** — in progress (linked to running agents)
- **Done** — completed (auto-archive after 7 days)

**Task card:**
- Title (required)
- Description (optional, markdown)
- Priority indicator (subtle: dot color — red/yellow/gray)
- Linked agent session (if any) — shows live status
- Created date
- Tags (optional, freeform)

**Interactions:**
- Drag to reorder or move between columns
- Click to expand (inline, not modal — slides open below the card)
- Quick-add at top of Queue column (just type title, Enter to create)
- From chat: "Add to tasks" action on any assistant message
- From task: "Start chat" opens new conversation with task context pre-loaded

**Storage:** Tasks stored as `workspace/tasks.json` — simple, portable, grep-able. The gateway already supports file read/write.

### 3. Agents (Tertiary)

Awareness of what's running. Not a management console — just visibility.

**Representation: Activity feed in the sidebar (below conversations)**
- Section header: "Agents" with count of active
- Each active agent: name/label, status (running/idle/waiting), duration
- Click to view their conversation transcript (read-only)
- Subtle animation for actively-running agents (thinking indicator)
- Completed agents: brief summary, collapse after 1 hour

**This is NOT a separate page.** It lives in the sidebar, below your conversations. Agents are peers to your conversations — you should see them in the same space, not tucked away in a different tab.

### 4. Files (Tertiary)

Lightweight file browser for the workspace.

**Access:** Icon button in the sidebar header (folder icon) — opens as a panel replacing the sidebar content, or as a slide-over on mobile.

**Features:**
- Directory tree with expand/collapse
- File preview: text files rendered with syntax highlighting, images displayed inline
- Edit: click to open in a simple editor (Monaco or CodeMirror, not both)
- Create new file/directory
- Breadcrumb navigation
- Quick access: recent files, workspace root, memory/ directory

**NOT a full IDE.** No terminal, no git UI, no multi-tab editing. For heavy editing, there's code.bots.town. This is for quick reads and light edits.

---

## Design Language

### Visual Style
- **Color scheme:** Dark mode default (near-black background, not pure black). Light mode available.
- **Typography:** System font stack (SF Pro / Inter / system-ui). Monospace for code: JetBrains Mono or Fira Code.
- **Spacing:** Generous but not wasteful. 16px base grid.
- **Borders:** Minimal. Use subtle background shifts to delineate areas, not hard lines.
- **Animations:** Fast (150-200ms), purposeful. No bouncing, no sliding panels that take 500ms. Everything should feel instant.
- **Icons:** Lucide (consistent, clean, React-native). Minimal icon usage — text labels where space allows.

### Color Palette
```
Background:     #0a0a0a (dark) / #fafafa (light)
Surface:        #141414 (dark) / #ffffff (light)  
Surface raised: #1a1a1a (dark) / #f5f5f5 (light)
Border:         #262626 (dark) / #e5e5e5 (light)
Text primary:   #e5e5e5 (dark) / #171717 (light)
Text secondary: #737373
Accent:         #3b82f6 (blue — links, active states)
Success:        #22c55e
Warning:        #eab308
Danger:         #ef4444
```

### Responsive Behavior
- **Desktop (>1024px):** Sidebar (280px) + Chat (flex) + optional right panel (tasks/files, 320px)
- **Tablet (768-1024px):** Sidebar collapsible + Chat full width
- **Mobile (<768px):** Single column. Bottom nav: Chat / Tasks / Files. Sidebar is a sheet that slides over.

### PWA
- Installable as PWA (manifest.json + service worker for offline shell)
- App icon, splash screen, standalone display mode
- Push notifications for agent completions (future, via gateway)

---

## Technical Architecture

### Stack
- **Vite + React 19** — fast builds, fast HMR, modern React
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS v4** — utility-first, design tokens via CSS variables
- **Zustand** — state management (lightweight, no boilerplate)
- **Gateway WebSocket** — real-time communication
- **No backend** — pure SPA, all state through gateway or localStorage

### Project Structure
```
src/
  app.tsx                 # Root component, routing
  main.tsx                # Entry point
  
  components/
    chat/
      chat-view.tsx       # Main chat area
      message.tsx         # Single message component
      message-input.tsx   # Input area with @ and # autocomplete
      conversation-list.tsx # Sidebar conversation list
    tasks/
      task-board.tsx      # Three-column board
      task-card.tsx       # Individual task
      task-detail.tsx     # Expanded task view
    agents/
      agent-list.tsx      # Sidebar agent section
      agent-transcript.tsx # Read-only agent chat view
    files/
      file-browser.tsx    # Directory tree + preview
      file-editor.tsx     # Simple text editor
    layout/
      sidebar.tsx         # Left sidebar container
      header.tsx          # Top bar (mobile: bottom nav)
      panel.tsx           # Right slide-out panel
    ui/                   # Shared primitives
      button.tsx
      input.tsx
      dropdown.tsx
      markdown.tsx        # Markdown renderer
      
  lib/
    gateway.ts            # WebSocket client + message protocol
    sessions.ts           # Session/conversation management
    tasks.ts              # Task CRUD (via gateway file ops)
    files.ts              # File browser operations
    store.ts              # Zustand stores
    
  hooks/
    use-gateway.ts        # Gateway connection hook
    use-sessions.ts       # Sessions data hook
    use-tasks.ts          # Tasks data hook
    
  styles/
    globals.css           # Tailwind imports + CSS variables
```

### Gateway Protocol

The UI communicates entirely through the OpenClaw gateway WebSocket:

1. **Connect:** `ws://host/api/gateway/ws` (or through Studio proxy path)
2. **Auth:** Send connect frame with token from settings
3. **Sessions:** List, create, send messages, receive streaming responses
4. **Files:** Read/write workspace files (for tasks.json, file browser)

Need to study the gateway WS protocol to map exact message formats. The gateway source is at `/home/clawd/openclaw-src/`.

### Build & Deploy
- `vite build` → static files in `dist/`
- Served by a minimal Node HTTP server on port 18789 (with WS proxy to gateway on 18790)
- Or: served directly by the gateway if it supports static file serving
- Cloudflare tunnel routes ui.bots.town → localhost:18789

### Reliability
- Reconnect logic: exponential backoff with jitter (1s → 2s → 4s → max 30s)
- Optimistic UI: messages appear instantly, mark as failed if send fails
- Offline indicator: subtle banner when disconnected
- No data loss: messages queued during disconnect, sent on reconnect
- Service worker: cache app shell for instant load even when gateway is down

---

## Task File Format

`workspace/tasks.json`:
```json
{
  "version": 1,
  "tasks": [
    {
      "id": "t_abc123",
      "title": "Fix DAG routing for V3 pools",
      "description": "The current DAG doesn't handle...",
      "status": "queue",
      "priority": "high",
      "tags": ["swap.win", "routing"],
      "agentSession": null,
      "createdAt": "2026-03-01T18:00:00Z",
      "updatedAt": "2026-03-01T18:00:00Z",
      "completedAt": null
    }
  ]
}
```

---

## What This Is NOT

- Not an IDE (use code.bots.town for that)
- Not a monitoring dashboard (use /health, /containers for that)
- Not a settings panel (use openclaw.json for that)
- Not a replacement for Telegram (both coexist, different affordances)

---

## v1 Scope

Ship the minimum that feels complete:

1. ✅ Chat with streaming (conversations, sidebar, new/delete)
2. ✅ Task board (queue/active/done, drag, quick-add, # references in chat)
3. ✅ Agent visibility (sidebar section, click to view transcript)
4. ✅ File browser (read-only in v1, edit in v1.1)
5. ✅ Dark mode, responsive, PWA installable
6. ✅ Reliable WebSocket with reconnect

### v1.1 (fast follow)
- File editing
- Push notifications
- Keyboard shortcuts (Cmd+K command palette)
- Chat search within conversation
- Export conversation as markdown
