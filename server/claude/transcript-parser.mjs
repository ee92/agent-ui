import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

function toIsoTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function normalizeRole(raw) {
  if (raw === "user" || raw === "assistant" || raw === "system") {
    return raw;
  }
  return null;
}

// Normalize a tool_result block's content into the shape the frontend expects:
// Array<{ type: "text"; text: string }>. Transcripts store this as either
// a plain string or an array of typed blocks; we coerce everything to text.
function normalizeToolResultContent(raw) {
  if (raw == null) return [];
  if (typeof raw === "string") {
    return raw ? [{ type: "text", text: raw }] : [];
  }
  if (Array.isArray(raw)) {
    const out = [];
    for (const block of raw) {
      if (typeof block === "string") {
        if (block) out.push({ type: "text", text: block });
        continue;
      }
      if (!block || typeof block !== "object") continue;
      if (typeof block.text === "string" && block.text) {
        out.push({ type: "text", text: block.text });
      } else if (typeof block.content === "string" && block.content) {
        out.push({ type: "text", text: block.content });
      } else {
        // Fallback: JSON-stringify the block so nothing is silently dropped.
        try {
          out.push({ type: "text", text: JSON.stringify(block) });
        } catch {
          /* ignore */
        }
      }
    }
    return out;
  }
  if (typeof raw === "object") {
    try {
      return [{ type: "text", text: JSON.stringify(raw) }];
    } catch {
      return [];
    }
  }
  return [];
}

// Convert one assistant/user message's raw `content` into structured parts that
// match the frontend MessageContentPart union. Tool_result blocks are returned
// as a synthetic { type: "tool_result", ... } part so the caller can route them
// onto the matching tool_use from a prior assistant turn.
function extractParts(content) {
  const parts = [];

  if (typeof content === "string") {
    if (content.trim()) parts.push({ type: "text", text: content });
    return parts;
  }
  if (!Array.isArray(content)) {
    if (content && typeof content === "object") {
      return extractParts([content]);
    }
    return parts;
  }

  for (const block of content) {
    if (typeof block === "string") {
      if (block.trim()) parts.push({ type: "text", text: block });
      continue;
    }
    if (!block || typeof block !== "object") continue;

    const t = block.type;

    if (t === "text" || (!t && typeof block.text === "string")) {
      const text = typeof block.text === "string" ? block.text : "";
      if (text.trim()) parts.push({ type: "text", text });
      continue;
    }

    if (t === "thinking") {
      const text = typeof block.thinking === "string" ? block.thinking : "";
      if (text.trim()) parts.push({ type: "thinking", text, complete: true });
      continue;
    }

    if (t === "tool_use") {
      parts.push({
        type: "tool_use",
        id: typeof block.id === "string" ? block.id : `tu-${parts.length}`,
        name: typeof block.name === "string" ? block.name : "tool",
        input: block.input ?? {},
        inputComplete: true,
      });
      continue;
    }

    if (t === "tool_result") {
      // Synthetic part — the main loop folds this into the matching tool_use.
      parts.push({
        type: "tool_result",
        toolUseId: typeof block.tool_use_id === "string" ? block.tool_use_id : null,
        isError: Boolean(block.is_error),
        content: normalizeToolResultContent(block.content),
      });
      continue;
    }

    // Unknown block type — skip silently.
  }

  return parts;
}

function pickTimestamp(record) {
  return (
    toIsoTimestamp(record.timestamp) ||
    toIsoTimestamp(record.created_at) ||
    toIsoTimestamp(record.createdAt) ||
    toIsoTimestamp(record.updated_at) ||
    toIsoTimestamp(record.updatedAt) ||
    new Date().toISOString()
  );
}

// Build the structured message + the raw parts array (which may still include
// a `tool_result` sentinel that the main loop will fold away).
function normalizeMessage(record, lineNo) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const role =
    normalizeRole(record.role) ||
    normalizeRole(record.message?.role) ||
    normalizeRole(record.author?.role) ||
    normalizeRole(record.type);

  if (!role) {
    return null;
  }

  const payload = record.message && typeof record.message === "object" ? record.message : record;
  const parts = extractParts(payload.content ?? payload.text ?? record.content ?? record.text ?? "");

  return {
    id:
      (typeof payload.id === "string" && payload.id) ||
      (typeof record.id === "string" && record.id) ||
      `line-${lineNo}`,
    role,
    parts,
    timestamp: pickTimestamp(record),
  };
}

function extractUsage(record) {
  const payload = record?.message && typeof record.message === "object" ? record.message : record;
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return null;
  return {
    model: typeof payload?.model === "string" ? payload.model : null,
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    cacheCreationTokens: typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0,
    cacheReadTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0,
  };
}

// Collapse an array of parts into a short plain-text preview for the sidebar.
function previewFromParts(parts) {
  if (!Array.isArray(parts)) return "";
  for (const part of parts) {
    if (part && part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      return part.text.trim();
    }
  }
  // Fall back to first tool_use name so the preview isn't blank when the final
  // assistant turn is pure-tool.
  for (const part of parts) {
    if (part && part.type === "tool_use" && typeof part.name === "string") {
      return `[${part.name}]`;
    }
  }
  return "";
}

function titleFromParts(parts) {
  if (!Array.isArray(parts)) return "";
  for (const part of parts) {
    if (part && part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      return part.text.trim();
    }
  }
  return "";
}

export async function parseTranscript(transcriptPath, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : null;
  const rawMessages = [];
  let malformedLines = 0;

  let createdAt = null;
  let updatedAt = null;
  let firstUserText = "";
  let lastAssistantParts = null;
  let lastUsage = null;

  const input = createReadStream(transcriptPath, { encoding: "utf8" });
  const readline = createInterface({ input, crlfDelay: Infinity });

  let lineNo = 0;
  for await (const line of readline) {
    lineNo += 1;
    if (!line.trim()) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }

    const message = normalizeMessage(parsed, lineNo);
    if (!message) continue;

    if (!createdAt) createdAt = message.timestamp;
    updatedAt = message.timestamp;

    if (!firstUserText && message.role === "user") {
      const t = titleFromParts(message.parts);
      if (t) firstUserText = t;
    }
    if (message.role === "assistant") {
      if (message.parts.length > 0) lastAssistantParts = message.parts;
      const u = extractUsage(parsed);
      if (u) lastUsage = u;
    }

    rawMessages.push(message);
  }

  // Second pass: fold user `tool_result` parts into the matching `tool_use`
  // on a prior assistant turn, and drop messages that end up with zero parts.
  const toolUseMap = new Map();
  const finalMessages = [];
  for (const msg of rawMessages) {
    if (msg.role === "assistant") {
      for (const part of msg.parts) {
        if (part && part.type === "tool_use" && typeof part.id === "string") {
          toolUseMap.set(part.id, part);
        }
      }
      if (msg.parts.length > 0) finalMessages.push(msg);
      continue;
    }

    if (msg.role === "user") {
      const kept = [];
      for (const part of msg.parts) {
        if (part && part.type === "tool_result") {
          const target = part.toolUseId ? toolUseMap.get(part.toolUseId) : null;
          if (target) {
            target.result = {
              isError: Boolean(part.isError),
              content: Array.isArray(part.content) ? part.content : [],
            };
          }
          // Drop the tool_result part from the user bubble either way —
          // if the parent tool_use wasn't captured, the result would still
          // render as an orphan that the renderer doesn't know how to show.
          continue;
        }
        kept.push(part);
      }
      if (kept.length > 0) {
        finalMessages.push({ ...msg, parts: kept });
      }
      continue;
    }

    // system / other roles — keep only if they have real parts.
    if (msg.parts.length > 0) finalMessages.push(msg);
  }

  // Apply `limit` AFTER folding so truncation doesn't orphan a tool_use from
  // its tool_result.
  const trimmed = limit && finalMessages.length > limit
    ? finalMessages.slice(finalMessages.length - limit)
    : finalMessages;

  const previewSource = lastAssistantParts
    ? previewFromParts(lastAssistantParts)
    : previewFromParts(trimmed[trimmed.length - 1]?.parts || []);

  return {
    messages: trimmed,
    metadata: {
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || createdAt || new Date().toISOString(),
      title: firstUserText ? firstUserText.slice(0, 120) : "New Chat",
      preview: previewSource.slice(0, 280),
      // Latest assistant-turn usage — mirrors the session.usage event emitted
      // at runtime, so the context bar can render immediately on resume.
      lastUsage,
    },
    malformedLines,
  };
}

export async function parseTranscriptMetadata(transcriptPath) {
  const parsed = await parseTranscript(transcriptPath, { limit: 1 });
  return {
    metadata: parsed.metadata,
    malformedLines: parsed.malformedLines,
  };
}
