import { describe, expect, it } from "vitest";
import { messagesToMarkdown, slugForFilename } from "./export-markdown";
import type { ChatMessage } from "./types";

describe("messagesToMarkdown", () => {
  it("renders a simple two-turn conversation with role headers", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Hello Claude." }],
        createdAt: "2026-04-21T10:00:00.000Z",
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Hi! How can I help?" }],
        createdAt: "2026-04-21T10:00:03.000Z",
      },
    ];
    const md = messagesToMarkdown("Test chat", messages);
    expect(md).toContain("# Test chat");
    expect(md).toContain("## You — ");
    expect(md).toContain("Hello Claude.");
    expect(md).toContain("## Assistant — ");
    expect(md).toContain("Hi! How can I help?");
    expect(md).toContain("2 messages");
  });

  it("skips hidden messages", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "visible" }],
        createdAt: "2026-04-21T10:00:00.000Z",
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "secret-hidden" }],
        createdAt: "2026-04-21T10:00:01.000Z",
        hidden: true,
      },
    ];
    const md = messagesToMarkdown("Test", messages);
    expect(md).toContain("visible");
    expect(md).not.toContain("secret-hidden");
    expect(md).toContain("1 message");
  });

  it("flattens tool_use parts into a fenced code block with input + result", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "ls" },
            inputComplete: true,
            result: {
              isError: false,
              content: [{ type: "text", text: "a\nb\nc" }],
            },
          },
        ],
        createdAt: "2026-04-21T10:00:00.000Z",
      },
    ];
    const md = messagesToMarkdown("Tools", messages);
    expect(md).toContain("**🔧 Bash**");
    expect(md).toContain("```json");
    expect(md).toContain('"command": "ls"');
    expect(md).toContain("_Result:_");
    expect(md).toContain("a\nb\nc");
  });

  it("renders compact_boundary as a horizontal rule without a role header", () => {
    const messages: ChatMessage[] = [
      {
        id: "cb1",
        role: "system",
        parts: [
          {
            type: "compact_boundary",
            trigger: "manual",
            preTokens: 189_000,
            postTokens: 9_000,
            durationMs: 100_000,
          },
        ],
        createdAt: "2026-04-21T10:00:00.000Z",
      },
    ];
    const md = messagesToMarkdown("Compacted", messages);
    expect(md).toContain("Context compacted");
    expect(md).toContain("189k → 9k");
    expect(md).not.toContain("## System");
  });
});

describe("slugForFilename", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(slugForFilename("Hello, World! Test")).toBe("hello-world-test");
  });
  it("caps length", () => {
    const long = "a".repeat(200);
    expect(slugForFilename(long)).toHaveLength(60);
  });
  it("falls back for empty input", () => {
    expect(slugForFilename("")).toBe("conversation");
    expect(slugForFilename("!!! 💥 ???")).toBe("conversation");
  });
});
