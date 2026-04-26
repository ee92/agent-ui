// Serialize a chat transcript to a single markdown document so users can save
// conversations offline, share them, or archive them long-term.
//
// Output shape:
//   # <title>
//   _Exported YYYY-MM-DD HH:MM — N messages_
//
//   ## You — 10:14 AM
//   …message text…
//
//   ## Assistant — 10:15 AM
//   …message text…
//
//   Tool calls are flattened to fenced code blocks; thinking blocks become
//   blockquotes. Nothing fancy — plain GFM-compatible markdown.

import type { ChatMessage, MessageContentPart } from "./types";

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Local time, sortable, human-readable.
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function roleLabel(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return role;
  }
}

// Pretty-print tool input as JSON. Protects against circular refs + non-JSON
// values (undefined, functions) so one bad block doesn't explode the export.
function stringifyInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function renderPart(part: MessageContentPart): string {
  switch (part.type) {
    case "text":
      return part.text.trim();

    case "image":
      return `![${part.alt || "image"}](${part.url})`;

    case "attachment":
      return `*[attachment: ${part.name}${part.mimeType ? ` (${part.mimeType})` : ""}]*`;

    case "thinking":
      // Blockquote so the thinking trace reads as "aside" context.
      return part.text
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");

    case "tool_use": {
      const header = `**🔧 ${part.name}**`;
      const inputBlock = `\`\`\`json\n${stringifyInput(part.input)}\n\`\`\``;
      const resultBlock = part.result
        ? (() => {
            const text = part.result.content
              .map((c) => c.text)
              .join("\n")
              .trim();
            if (!text) return "";
            const label = part.result.isError ? "Result (error)" : "Result";
            return `\n\n_${label}:_\n\`\`\`\n${text}\n\`\`\``;
          })()
        : "";
      return `${header}\n${inputBlock}${resultBlock}`;
    }

    case "compact_boundary": {
      const pre = part.preTokens != null ? `${Math.round(part.preTokens / 1000)}k` : "?";
      const post = part.postTokens != null ? `${Math.round(part.postTokens / 1000)}k` : "?";
      return `---\n*Context compacted · ${pre} → ${post} tokens*\n---`;
    }

    default:
      return "";
  }
}

function renderMessage(message: ChatMessage): string {
  if (message.hidden) return "";
  const body = message.parts
    .map(renderPart)
    .filter((s) => s.length > 0)
    .join("\n\n");
  if (!body) return "";

  // Compact boundaries render as their own horizontal rule — no role header.
  if (
    message.role === "system" &&
    message.parts.length === 1 &&
    message.parts[0].type === "compact_boundary"
  ) {
    return body;
  }

  return `## ${roleLabel(message.role)} — ${fmtTimestamp(message.createdAt)}\n\n${body}`;
}

export function messagesToMarkdown(
  title: string,
  messages: ChatMessage[]
): string {
  const visible = messages.filter((m) => !m.hidden);
  const header = [
    `# ${title || "Conversation"}`,
    ``,
    `_Exported ${fmtTimestamp(new Date().toISOString())} — ${visible.length} message${visible.length === 1 ? "" : "s"}_`,
  ].join("\n");
  const body = visible.map(renderMessage).filter((s) => s.length > 0).join("\n\n");
  return `${header}\n\n${body}\n`;
}

// Slugify a title for use in a filename: lowercase, keep alnum/dash, collapse
// whitespace, trim to 60 chars so phone file-pickers don't misbehave.
export function slugForFilename(title: string): string {
  const cleaned = (title || "conversation")
    .toLowerCase()
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/[-\s]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "conversation").slice(0, 60);
}

// Trigger a browser download of the given markdown content. Returns void; the
// caller should treat this as fire-and-forget.
export function downloadMarkdown(filename: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
