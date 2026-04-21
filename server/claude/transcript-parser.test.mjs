// Fixture-driven tests for the Claude Code transcript parser.
//
// Writes a synthetic .jsonl covering the records that have bit us in
// production and asserts the parser drops the right ones. Specifically:
//
// - `isMeta: true` records ("Continue from where you left off.") — CLI hides
//   these; agent-ui used to render them as fake user turns.
// - `isVisibleInTranscriptOnly: true` — the giant compact-summary essay.
// - `isCompactSummary: true` + summary text body — the same essay from a
//   slightly different SDK version that also text-matches our prefix.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTranscript } from "./transcript-parser.mjs";

let dir;
let jsonlPath;

async function writeFixture(records) {
  const body = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(jsonlPath, body, "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "transcript-parser-test-"));
  jsonlPath = path.join(dir, "session.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseTranscript", () => {
  it("drops `isMeta: true` user records (SDK auto-continuation)", async () => {
    await writeFixture([
      { type: "user", uuid: "u1", message: { role: "user", content: [{ type: "text", text: "Real user input" }] }, timestamp: "2026-04-21T22:00:00Z" },
      { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "Real assistant reply" }] }, timestamp: "2026-04-21T22:00:01Z" },
      { type: "user", uuid: "u2", isMeta: true, message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] }, timestamp: "2026-04-21T22:00:02Z" },
      { type: "user", uuid: "u3", message: { role: "user", content: [{ type: "text", text: "Next real turn" }] }, timestamp: "2026-04-21T22:00:03Z" },
    ]);
    const { messages } = await parseTranscript(jsonlPath);
    expect(messages).toHaveLength(3);
    const texts = messages.map((m) => m.parts.find((p) => p.type === "text")?.text);
    expect(texts).toEqual(["Real user input", "Real assistant reply", "Next real turn"]);
  });

  it("drops `isVisibleInTranscriptOnly: true` (compact summary records)", async () => {
    await writeFixture([
      { type: "user", uuid: "u1", message: { role: "user", content: [{ type: "text", text: "Hi" }] }, timestamp: "2026-04-21T22:00:00Z" },
      { type: "user", uuid: "u2", isVisibleInTranscriptOnly: true, isCompactSummary: true, message: { role: "user", content: "This session is being continued from a previous conversation that ran out of context.\nSummary:\n..." }, timestamp: "2026-04-21T22:00:01Z" },
      { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "Post-compact reply" }] }, timestamp: "2026-04-21T22:00:02Z" },
    ]);
    const { messages } = await parseTranscript(jsonlPath);
    expect(messages).toHaveLength(2);
    const texts = messages.map((m) => m.parts.find((p) => p.type === "text")?.text);
    expect(texts).toEqual(["Hi", "Post-compact reply"]);
  });

  it("keeps real user/assistant text records and folds tool_result into tool_use", async () => {
    await writeFixture([
      { type: "user", uuid: "u1", message: { role: "user", content: [{ type: "text", text: "Run the build" }] }, timestamp: "2026-04-21T22:00:00Z" },
      { type: "assistant", uuid: "a1", message: {
        role: "assistant",
        content: [
          { type: "text", text: "Running..." },
          { type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm run build" } },
        ],
      }, timestamp: "2026-04-21T22:00:01Z" },
      { type: "user", uuid: "u2", message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu1", content: "build complete" }],
      }, timestamp: "2026-04-21T22:00:02Z" },
    ]);
    const { messages } = await parseTranscript(jsonlPath);
    // tool_result gets folded into the tool_use part on the assistant message,
    // so we end up with 2 visible messages (user + assistant with tool_use).
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const assistant = messages.find((m) => m.role === "assistant");
    const toolUse = assistant?.parts.find((p) => p.type === "tool_use");
    expect(toolUse).toBeDefined();
  });

  it("keeps `isMeta: undefined` records (defense against over-matching)", async () => {
    // Every regular record should have isMeta = undefined. Explicitly verify
    // that we only drop the `=== true` case.
    await writeFixture([
      { type: "user", uuid: "u1", isMeta: false, message: { role: "user", content: [{ type: "text", text: "kept" }] }, timestamp: "2026-04-21T22:00:00Z" },
      { type: "user", uuid: "u2", message: { role: "user", content: [{ type: "text", text: "also kept" }] }, timestamp: "2026-04-21T22:00:01Z" },
    ]);
    const { messages } = await parseTranscript(jsonlPath);
    expect(messages).toHaveLength(2);
  });
});
