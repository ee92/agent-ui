---
name: task-board
description: Operate the OpenClaw task board safely and autonomously. Use when an agent needs to pick work, claim tasks, log progress, handle blockers, submit review evidence, and follow the board state machine with dependency and concurrency guardrails.
---

# Task Board Skill

Use this skill to run task-board work end-to-end through the `task` CLI without corrupting board state.

The workflow is simple: pick eligible work, claim one task, do the work, send to review, wait for human approval to mark done.

## Quick Reference

| Command | Purpose | Typical use |
|---|---|---|
| `task list [--status ...] [--json]` | View board | Find queue and priority |
| `task eligible [--json]` | Show claimable tasks | Dispatcher loop and manual pickup |
| `task claim ID [--session KEY] [--branch NAME]` | Atomically claim and start | Safe pickup (preferred over `start`) |
| `task start ID [--session KEY] [--branch NAME]` | Start directly | Manual fallback |
| `task plan ID "summary"` | Move to `plan` with approach | Ask for plan approval before coding |
| `task note ID "text"` | Append progress note | Mid-task updates |
| `task block ID "reason"` | Move to `blocked` | Missing requirement, dependency, or access |
| `task review ID "what was done" [--branch NAME]` | Submit for review | Required before done |
| `task done ID "what was done + evidence"` | Mark complete | Human/owner finalization step |
| `task edit ID ...` | Metadata/status edits | Admin corrections |
| `task stats` | Throughput and queue metrics | Operational checks |
| `task rm ID` | Remove task tree | Cleanup only with intent |

## Picking Up Work

1. Run `task eligible --json` to get claimable tasks in priority order.
2. Pick the highest-priority eligible task.
3. Run `task claim ID` to atomically claim and move to `active`.
4. Work only one claimed task at a time unless `maxConcurrent` explicitly allows more.

Rules enforced by CLI:
- Invalid state transitions are rejected.
- Blocked dependencies (`blockedBy`) are rejected.
- Concurrency limits (`maxConcurrent`) are rejected.

The `--json` output includes a `meta` object with `totalTodo`, `activeCount`, `maxConcurrent`, and `atCapacity` so you know WHY nothing is eligible.

If no tasks are eligible, do not invent work. Wait for next cron tick or ask for clarification.

## Working on a Task

1. Keep the task branch-linked (`--branch` on `claim`/`start`, or set via `task edit`).
2. Add progress with `task note ID "..."` at meaningful checkpoints.
3. If scope/requirements are unclear, move to `blocked` and ask concrete questions.
4. If planning approval is needed first, use `task plan ID "approach"`.

Never guess requirements. Block and ask.

## Completing Work

1. Ensure code/tests are complete and reproducible.
2. Run `task review ID "summary of changes + validation"`.
3. Include evidence: tests run, behavior verified, and commit hash.
4. Do not skip directly to `done` from your own flow.

Always go through `review`. Final `done` is a human approval action.

For detailed reviews, create a review packet at `reviews/<task-id>.md` with sections `## Approach`, `## Verification`, `## Proof`. The CLI picks these up and includes them in the notification.

## Git Conventions

- Branch name: `task/<task-id>-<short-slug>` (example: `task/t_ab12cd34-fix-login-race`).
- Commit message prefix: `<task-id>: <summary>`.
- Never merge directly to `main` from autonomous flow.
- Include at least one commit hash in the review summary and done evidence.

## Dependencies

Use `blockedBy` to model prerequisite tasks.

Behavior:
- A task is not eligible until every `blockedBy` task is `done`.
- CLI eligibility/claim checks enforce this; blocked tasks cannot be started through safe flow.

This lets you trust the board order while still expressing dependency graphs.

## Task Decomposition

Break a task into subtasks when:
- Work spans multiple independent files/systems.
- There are separate validation paths.
- The parent goal is vague or too large for one focused session.

Pattern:
1. Keep parent as outcome statement.
2. Add child tasks for concrete deliverables.
3. Work children to `review`/`done` first.
4. Move parent when child outcomes are satisfied.

## Dispatcher Pattern

This system uses the agent itself as dispatcher. No separate dispatcher code is required.

Cron loop:
1. OpenClaw cron or system cron triggers agent execution periodically.
2. Agent runs `task eligible --json`.
3. Agent runs `task claim ID` for highest-priority eligible task.
4. Agent does the work.
5. Agent runs `task review ID "summary + evidence"`.
6. Human reviews and later sets `done`.

That loop is the dispatcher.

## What Not To Do

- Do not edit `tasks.json` directly.
- Do not bypass workflow and jump straight to `done`.
- Do not start multiple tasks unless policy/config explicitly permits it.
- Do not guess missing requirements.
- Do not fight CLI guardrails; they are the safety system.

## Agent-Specific Setup

### OpenClaw

- Use `task` from workspace tooling.
- Session key can come from `OPENCLAW_SESSION_KEY`.
- Run under periodic cron trigger for dispatcher loop.

### Claude Code

- Session key can come from `CLAUDE_SESSION_ID`.
- Use same `task eligible` -> `task claim` -> `task review` loop.
- Keep branch and commit evidence in review note.

### Standalone

- Ensure `task` CLI is on `PATH` or call by absolute path.
- Run cron via system scheduler (for example, `crontab`) if autonomous pickup is needed.
- If no session env var exists, provide `--session` explicitly on claim/start.

## Core Principle

Your job is to do good engineering work. The CLI prevents bad board state.
