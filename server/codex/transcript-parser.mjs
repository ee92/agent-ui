import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

function toIsoTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractText(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block?.type === "input_text" || block?.type === "output_text") return block.text || "";
      if (block?.type === "text") return block.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeRole(role) {
  if (role === "assistant") return "assistant";
  if (role === "developer" || role === "user" || role === "system") return "user";
  return null;
}

function normalizeMessage(record, lineNo) {
  if (!record || record.type !== "response_item") return null;
  const payload = record.payload;
  if (!payload || typeof payload !== "object") return null;

  const role = normalizeRole(payload.role);
  if (!role) return null;

  // Skip developer preambles (permissions instructions)
  if (payload.role === "developer" || payload.role === "system") return null;

  // Skip user preambles (AGENTS.md, environment_context injected by harness)
  if (role === "user") {
    const text = extractText(payload.content);
    if (text.startsWith("# AGENTS.md") || text.startsWith("<environment_context>") || text.startsWith("<INSTRUCTIONS>")) return null;
  }

  const content = extractText(payload.content);
  if (!content) return null;

  return {
    id: payload.id || `line-${lineNo}`,
    role,
    content,
    timestamp: toIsoTimestamp(record.timestamp) || new Date().toISOString(),
  };
}

export async function parseCodexTranscript(transcriptPath, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : null;
  const messages = [];

  let sessionMeta = null;
  let createdAt = null;
  let updatedAt = null;
  let firstUserText = "";
  let lastAssistantText = "";

  const input = createReadStream(transcriptPath, { encoding: "utf8" });
  const readline = createInterface({ input, crlfDelay: Infinity });

  let lineNo = 0;
  for await (const line of readline) {
    lineNo++;
    if (!line.trim()) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    // Capture session_meta for metadata
    if (parsed.type === "session_meta" && parsed.payload) {
      sessionMeta = parsed.payload;
      if (!createdAt) createdAt = toIsoTimestamp(parsed.timestamp);
      continue;
    }

    // Handle function_call entries as tool use display
    if (parsed.type === "response_item" && parsed.payload?.type === "function_call") {
      const fc = parsed.payload;
      const toolContent = `[tool_use:${fc.name || "tool"}] ${fc.arguments || ""}`.trim();
      const msg = {
        id: fc.id || fc.call_id || `line-${lineNo}`,
        role: "assistant",
        content: toolContent,
        timestamp: toIsoTimestamp(parsed.timestamp) || new Date().toISOString(),
      };
      if (!createdAt) createdAt = msg.timestamp;
      updatedAt = msg.timestamp;
      messages.push(msg);
      if (limit && messages.length > limit) messages.shift();
      continue;
    }

    // Handle function_call_output
    if (parsed.type === "response_item" && parsed.payload?.type === "function_call_output") {
      const output = parsed.payload.output || "";
      if (output) {
        const msg = {
          id: parsed.payload.id || `line-${lineNo}`,
          role: "user",
          content: `[tool_result] ${typeof output === "string" ? output.slice(0, 2000) : JSON.stringify(output).slice(0, 2000)}`,
          timestamp: toIsoTimestamp(parsed.timestamp) || new Date().toISOString(),
        };
        updatedAt = msg.timestamp;
        messages.push(msg);
        if (limit && messages.length > limit) messages.shift();
      }
      continue;
    }

    const message = normalizeMessage(parsed, lineNo);
    if (!message) continue;

    if (!createdAt) createdAt = message.timestamp;
    updatedAt = message.timestamp;

    if (!firstUserText && message.role === "user" && message.content) {
      firstUserText = message.content;
    }
    if (message.role === "assistant" && message.content) {
      lastAssistantText = message.content;
    }

    messages.push(message);
    if (limit && messages.length > limit) messages.shift();
  }

  const previewSource = lastAssistantText || messages[messages.length - 1]?.content || "";

  return {
    messages,
    metadata: {
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || createdAt || new Date().toISOString(),
      title: firstUserText ? firstUserText.slice(0, 120) : "New Chat",
      preview: previewSource.slice(0, 280),
      cwd: sessionMeta?.cwd || null,
      git: sessionMeta?.git || null,
      model: sessionMeta?.model_provider || null,
    },
  };
}

export async function parseCodexTranscriptMetadata(transcriptPath) {
  const parsed = await parseCodexTranscript(transcriptPath, { limit: 1 });
  return { metadata: parsed.metadata };
}
