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

function extractToolUse(block) {
  if (!block || typeof block !== "object") {
    return null;
  }
  if (block.type !== "tool_use") {
    return null;
  }
  const name = typeof block.name === "string" ? block.name : "tool";
  const input = block.input && typeof block.input === "object" ? JSON.stringify(block.input) : "";
  return `[tool_use:${name}]${input ? ` ${input}` : ""}`;
}

function extractTextParts(content) {
  const textParts = [];
  const thinkingParts = [];

  const consumeBlock = (block) => {
    if (typeof block === "string") {
      textParts.push(block);
      return;
    }
    if (!block || typeof block !== "object") {
      return;
    }

    if (typeof block.text === "string" && (block.type === "text" || !block.type)) {
      textParts.push(block.text);
    }

    if (typeof block.thinking === "string") {
      thinkingParts.push(block.thinking);
    }

    if (typeof block.content === "string" && !block.type) {
      textParts.push(block.content);
    }

    const toolUse = extractToolUse(block);
    if (toolUse) {
      textParts.push(toolUse);
    }
  };

  if (typeof content === "string") {
    textParts.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      consumeBlock(block);
    }
  } else {
    consumeBlock(content);
  }

  return {
    content: textParts.join("\n").trim(),
    thinking: thinkingParts.join("\n\n").trim() || undefined,
  };
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
  const extracted = extractTextParts(payload.content ?? payload.text ?? record.content ?? record.text ?? "");

  return {
    id:
      (typeof payload.id === "string" && payload.id) ||
      (typeof record.id === "string" && record.id) ||
      `line-${lineNo}`,
    role,
    content: extracted.content,
    timestamp: pickTimestamp(record),
    thinking: extracted.thinking,
  };
}

export async function parseTranscript(transcriptPath, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : null;
  const messages = [];
  let malformedLines = 0;

  let createdAt = null;
  let updatedAt = null;
  let firstUserText = "";
  let lastAssistantText = "";

  const input = createReadStream(transcriptPath, { encoding: "utf8" });
  const readline = createInterface({ input, crlfDelay: Infinity });

  let lineNo = 0;
  for await (const line of readline) {
    lineNo += 1;
    if (!line.trim()) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }

    const message = normalizeMessage(parsed, lineNo);
    if (!message) {
      continue;
    }

    if (!createdAt) {
      createdAt = message.timestamp;
    }
    updatedAt = message.timestamp;

    if (!firstUserText && message.role === "user" && message.content) {
      firstUserText = message.content;
    }
    if (message.role === "assistant" && message.content) {
      lastAssistantText = message.content;
    }

    messages.push(message);
    if (limit && messages.length > limit) {
      messages.shift();
    }
  }

  const previewSource = lastAssistantText || messages[messages.length - 1]?.content || "";

  return {
    messages,
    metadata: {
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || createdAt || new Date().toISOString(),
      title: firstUserText ? firstUserText.slice(0, 120) : "New Chat",
      preview: previewSource.slice(0, 280),
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
