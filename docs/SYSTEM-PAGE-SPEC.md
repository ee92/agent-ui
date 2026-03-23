# System Page — Spec

> **Vision:** A shared portal into the machine. The UI is for Egor. The CLI is for Claudesworth. The backend serves both. Skills define the contract.

## Why

The projects page shows repos and their services. But there's a whole layer below that — what's actually running on the machine, how much it's eating, what's listening where, what's healthy, what's dying. Today this lives across:

- `dashboard.bots.town` (observability dashboard — separate app)
- The "Untracked" section on the projects page (orphan containers, listening ports)
- CLI tools (`observability/cli.mjs`, `docker stats`, `ss`, `lsof`)
- Manual SSH and `docker logs`

This consolidates all of it into one System page in the main UI, with a matching CLI/skill so the agent can do the same things programmatically.

---

## What the page shows

### 1. Processes & Ports

**Everything listening on the machine, unified.**

Each row is a port/process combo:

| Port | Bind | Process | Project | CPU | Memory | Uptime | Actions |
|------|------|---------|---------|-----|--------|--------|---------|
| :3456 | 127.0.0.1 | lp-api (docker) | swap.win | 0.3% | 49MB | 8d | logs · stop |
| :18789 | 127.0.0.1 | node serve.mjs | openclaw-ui | 1.2% | 84MB | 23h | logs · restart |
| :22 | 0.0.0.0 | sshd | system | — | — | 45d | — |
| :8090 | 0.0.0.0 | nginx (docker) | dev-proxy | 0.1% | 12MB | 23h | logs · stop |

**Key features:**
- Merge Docker containers + bare processes + systemd services into one list
- Link to parent project when possible (via compose labels, cwd, PID tracking)
- Show bind address (0.0.0.0 = public, 127.0.0.1 = local) with visual indicator
- Filter: all / docker / processes / system / public-only
- Sort by: port / memory / CPU / project
- Click row → expand for logs (tail -100, auto-scroll)
- Actions: view logs, stop/restart, open in browser (for HTTP ports)

**Data source:** New `/api/system/processes` endpoint combining:
- `ss -tlnp` (listening ports)
- `docker ps` + `docker stats` (containers)
- `systemctl --user list-units` (user services)
- `/proc/<pid>/cwd` + `/proc/<pid>/stat` (process info)

### 2. Containers

**Docker-specific view with resource trends.**

| Container | Image | Status | CPU | Memory | Net I/O | Ports | Project | Actions |
|-----------|-------|--------|-----|--------|---------|-------|---------|---------|
| provex-watch-api-1 | provex-watch-api | Up (healthy) | 0.2% | 49MB | 12KB/s | :3100 | provex-watch | logs · stop · restart |

**Key features:**
- Real-time stats via `docker stats --no-stream` (polled every 10s)
- Health status indicator (healthy/unhealthy/starting/none)
- Orphan badge for containers not linked to any project
- Bulk actions: stop all orphans, prune stopped containers
- Expandable: show full `docker inspect` summary, env vars, mounts, networks

**Data source:** Existing `docker-scanner.mjs` + new `/api/system/containers` with stats.

### 3. Resources

**System-level health at a glance.**

Cards/gauges:
- **CPU**: load average (1m/5m/15m), per-core usage
- **Memory**: used / total / swap, top consumers
- **Disk**: per-mount usage, Docker volumes breakdown, largest dirs
- **Network**: active connections count, bandwidth (if available)

**Data source:** New `/api/system/resources` reading from:
- `/proc/loadavg`, `/proc/meminfo`, `/proc/stat`
- `df -h`
- `docker system df`
- `du` for known project dirs (cached, not real-time)

### 4. Logs Viewer

**Unified log viewer — click any process/container to see logs.**

- Docker containers: `docker logs --tail 200 --follow`
- Systemd services: `journalctl --user -u <name> -n 200 -f`
- Bare processes: tail log files from `~/.agent-ui/logs/<name>.log`

**Key features:**
- Live streaming via Server-Sent Events (SSE)
- Search within logs (client-side filter)
- Log level highlighting (ERROR = red, WARN = amber)
- Pin multiple log streams side-by-side (split view)
- Download full log

**Data source:** New `/api/system/logs/:name` endpoint with SSE streaming.

### 5. Services

**Systemd user services overview.**

| Service | Status | Since | Memory | Actions |
|---------|--------|-------|--------|---------|
| server-dashboard | active | 2h ago | 45MB | logs · restart · stop |
| cross-chain-arb | active | 2h ago | 12MB | logs · restart · stop |
| openclaw-ui | active | 23h ago | 84MB | logs · restart |

**Data source:** `systemctl --user list-units --type=service --all --output=json`

### 6. Network Map

**Visual overview of what's exposed where.**

Three zones:
- **Public** (0.0.0.0) — what's accessible from the internet
- **Localhost** (127.0.0.1) — local only
- **Docker Internal** — container-to-container, no host port

Shows Cloudflare tunnel routes: `*.bots.town` → which port → which container.

This is lower priority but very useful for security awareness.

---

## Navigation

Add "System" tab to the top nav between "Timeline" and "Projects".

Mobile: Add to bottom tab bar (replace one of the existing tabs or make it scrollable).

---

## API Endpoints

All require auth (`Authorization: Bearer <token>`).

```
GET /api/system/overview      — combined summary (ports + containers + resources)
GET /api/system/processes      — all listening ports with process info
GET /api/system/containers     — docker containers with stats
GET /api/system/containers/:id/logs?tail=200  — container logs
GET /api/system/services       — systemd user services
GET /api/system/services/:name/logs?tail=200  — service logs  
GET /api/system/resources      — CPU, memory, disk
GET /api/system/logs/:name     — SSE streaming logs

POST /api/system/containers/:id/stop
POST /api/system/containers/:id/restart
POST /api/system/services/:name/stop
POST /api/system/services/:name/restart
POST /api/system/processes/:pid/kill  — SIGTERM a process
```

---

## CLI / Skill Contract

The agent uses the same backend via CLI commands. The skill defines the contract.

### CLI: `system`

```bash
# Overview
system status                  # one-line-per-process table (ports, CPU, mem)
system ports                   # listening ports only
system containers              # docker containers with stats
system services                # systemd services
system resources               # CPU, memory, disk summary

# Actions
system logs <name> [--tail N]  # tail logs for container/service/process
system stop <name>             # stop container or service
system restart <name>          # restart container or service
system kill <pid>              # kill a process

# Analysis
system top                     # top consumers by CPU/memory
system public                  # show all publicly exposed ports
system orphans                 # containers not linked to a project
system health                  # combined health check (replaces observability/cli.mjs)

# Output
system status --json           # machine-readable for piping
```

### Skill: `system`

```markdown
## system

Monitor and manage all processes, containers, and services on the host.

### Commands
- `system status` — full process/port/container overview
- `system logs <name>` — view logs for any service
- `system stop/restart <name>` — manage services
- `system health` — health check with alerts

### When to use
- User asks about what's running, resource usage, ports
- Need to check if a service is healthy
- Need to stop/restart something
- Investigating performance issues
```

---

## Migration Plan

### Phase 1: Backend (API endpoints)
1. Create `server/system-scanner.mjs` — unified process/port/container scanner
2. Add `/api/system/*` endpoints to `serve.mjs`
3. Build `system` CLI tool in `workspace/bin/system`
4. Create `system` skill in `workspace/skills/system/`

### Phase 2: UI (System page)
1. Add System page component with 3 tabs: Overview, Containers, Logs
2. Wire up to API endpoints
3. Add to nav bar
4. Remove "Untracked" section from projects page

### Phase 3: Polish
1. SSE log streaming
2. Resource trend charts (store 24h of snapshots)
3. Network map visualization
4. Replace `dashboard.bots.town` entirely
5. Mobile optimization

### Phase 4: Deprecate
1. Remove `observability/` dashboard (absorbed into main UI)
2. Update TOOLS.md references
3. Remove `server-dashboard.service` systemd unit

---

## Design Notes

- Same visual language as the rest of the UI (surface-0/1/2, rounded-xl, 13px text)
- Tables with expandable rows (like projects page)
- Status dots: green=healthy, amber=warning, red=error, gray=stopped
- Log viewer: monospace, dark bg (surface-0), auto-scroll with "pause" on scroll-up
- Resource gauges: simple bars, not fancy charts (keep it fast)
- Everything should load in <500ms — cache aggressively, poll for updates

---

## What This Replaces

| Current | Replaced By |
|---------|-------------|
| `dashboard.bots.town` | System → Overview |
| `observability/cli.mjs status` | `system status` |
| `observability/cli.mjs containers` | `system containers` |
| `docker ps`, `docker logs` | System → Containers, `system logs` |
| `ss -tlnp` | System → Overview, `system ports` |
| Projects page "Untracked" section | System → Overview |
| `/audit` docker security scan | `system public` + `system health` |

---

## Open Questions

1. **Real-time updates** — WebSocket vs SSE vs polling? SSE is simplest for logs. Polling (10s) for stats.
2. **Historical data** — Store snapshots for trend charts? The observability collector already does this. Reuse or rebuild?
3. **Kill confirmation** — Require confirmation for destructive actions in UI? Agent CLI can have `--force`.
4. **Multi-host** — Eventually show Hetzner (production) alongside local? Not in v1 but design the API to support it.
