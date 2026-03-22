import { useMemo, useState } from "react";
import { CopyIcon } from "../ui/icons";

type Block =
  | { type: "code"; lang: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "image"; url: string; alt: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] };

const IMAGE_EXTENSIONS = /\.(gif|png|jpe?g|webp|svg)(\?[^\s]*)?$/i;
const MARKDOWN_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const STANDALONE_URL_RE = /^https?:\/\/\S+$/;

function isImageUrl(url: string): boolean {
  try {
    return IMAGE_EXTENSIONS.test(new URL(url).pathname);
  } catch {
    return IMAGE_EXTENSIONS.test(url);
  }
}

/** Returns true if a line starts a new block-level element */
function isBlockStart(line: string): boolean {
  if (!line.trim()) return true;
  if (line.startsWith("```")) return true;
  if (line.startsWith("# ") || line.startsWith("## ") || line.startsWith("### ") || line.startsWith("#### ")) return true;
  if (line.startsWith("- ") || line.startsWith("* ") || line.startsWith("+ ")) return true;
  if (/^\d+\.\s/.test(line)) return true;
  if (line.startsWith("> ")) return true;
  if (line.startsWith("---") || line.startsWith("***") || line.startsWith("___")) return true;
  const trimmed = line.trim();
  if (MARKDOWN_IMAGE_RE.test(trimmed)) return true;
  if (STANDALONE_URL_RE.test(trimmed) && isImageUrl(trimmed)) return true;
  if (/^\|.*\|$/.test(trimmed)) return true;
  return false;
}

/** Render inline markdown: bold, italic, code, links, inline images, /commands */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Order matters: longer patterns first
  // Match: ![alt](url), [text](url), **bold**, *italic*, `code`, /command, bare URLs
  const inlineRe = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]*)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|(\/[a-zA-Z][\w-]*(?:\s+<[^>]+>)*)|(https?:\/\/[^\s)<,]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined && match[2]) {
      // ![alt](url) inline image
      parts.push(
        <img key={key++} src={match[2]} alt={match[1]} className="my-1 inline-block max-h-72 rounded-lg border border-white/4" />
      );
    } else if (match[3] !== undefined && match[4]) {
      // [text](url) link
      parts.push(
        <a key={key++} href={match[4]} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline decoration-blue-400/40 hover:text-blue-300 hover:decoration-blue-300/60">{match[3]}</a>
      );
    } else if (match[5]) {
      parts.push(<strong key={key++} className="font-semibold text-white">{match[5]}</strong>);
    } else if (match[6]) {
      parts.push(<em key={key++}>{match[6]}</em>);
    } else if (match[7]) {
      parts.push(<code key={key++} className="rounded-lg bg-white/8 px-1.5 py-0.5 text-sm text-sky-200">{match[7]}</code>);
    } else if (match[9]) {
      // /command — style like code
      parts.push(<code key={key++} className="rounded-lg bg-white/8 px-1.5 py-0.5 text-sm text-emerald-300">{match[9]}</code>);
    } else if (match[10]) {
      // Bare URL — render as image if it looks like one, otherwise link
      const url = match[10];
      if (isImageUrl(url)) {
        parts.push(
          <img key={key++} src={url} alt="" loading="lazy" className="my-2 block max-h-80 rounded-lg border border-white/4" />
        );
      } else {
        parts.push(
          <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline decoration-blue-400/40 hover:text-blue-300 break-all">{url}</a>
        );
      }
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const result: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      result.push({ type: "code", lang, code: code.join("\n") });
      continue;
    }

    // Horizontal rule
    const trimmed = line.trim();
    if (/^[-*_]{3,}$/.test(trimmed)) {
      result.push({ type: "hr" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      result.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Markdown image on its own line
    const mdImgMatch = trimmed.match(MARKDOWN_IMAGE_RE);
    if (mdImgMatch) {
      result.push({ type: "image", url: mdImgMatch[2], alt: mdImgMatch[1] });
      i++;
      continue;
    }

    // Standalone image URL
    if (STANDALONE_URL_RE.test(trimmed) && isImageUrl(trimmed)) {
      result.push({ type: "image", url: trimmed, alt: "" });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      result.push({ type: "blockquote", lines: bqLines });
      continue;
    }

    // Table (pipe-delimited)
    if (/^\|.*\|$/.test(trimmed)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) =>
          row.split("|").slice(1, -1).map((cell) => cell.trim());
        const headers = parseRow(tableLines[0]);
        // Skip separator row (|---|---|)
        const startRow = /^[\s|:-]+$/.test(tableLines[1]) ? 2 : 1;
        const rows = tableLines.slice(startRow).map(parseRow);
        result.push({ type: "table", headers, rows });
      } else {
        result.push({ type: "paragraph", text: tableLines.join(" ") });
      }
      continue;
    }

    // Unordered list
    if (line.startsWith("- ") || line.startsWith("* ") || line.startsWith("+ ")) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s/, ""));
        i++;
      }
      result.push({ type: "list", ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      result.push({ type: "list", ordered: true, items });
      continue;
    }

    // Paragraph — collect lines until we hit a block start or empty line
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      // If this line (not the first) starts a new block, stop
      if (para.length > 0 && isBlockStart(lines[i])) {
        break;
      }
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      result.push({ type: "paragraph", text: para.join("\n") });
    }
  }

  return result;
}

export function Markdown({ text }: { text: string }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="space-y-3 text-sm leading-relaxed text-zinc-100">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <div key={`${block.type}-${index}`} className="relative">
              <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-white/4 bg-black/50 px-4 py-1.5">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">{block.lang || "code"}</span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(block.code);
                    setCopiedIndex(index);
                    window.setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 1200);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                >
                  <CopyIcon />
                  {copiedIndex === index ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-b-lg border border-white/4 bg-surface-1 px-4 py-3 text-sm leading-relaxed text-sky-200">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === "image") {
          return (
            <img
              key={`${block.type}-${index}`}
              src={block.url}
              alt={block.alt}
              loading="lazy"
              className="max-h-80 rounded-lg border border-white/4 object-contain"
            />
          );
        }

        if (block.type === "hr") {
          return <hr key={`${block.type}-${index}`} className="border-white/4" />;
        }

        if (block.type === "blockquote") {
          return (
            <blockquote key={`${block.type}-${index}`} className="border-l-2 border-blue-400/40 pl-4 text-zinc-300 italic">
              {block.lines.map((line, li) => (
                <p key={li}>{renderInline(line)}</p>
              ))}
            </blockquote>
          );
        }

        if (block.type === "table") {
          return (
            <div key={`${block.type}-${index}`} className="overflow-x-auto rounded-lg border border-white/4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/4 bg-surface-1">
                    {block.headers.map((h, hi) => (
                      <th key={hi} className="px-3 py-2 font-semibold text-zinc-200">{renderInline(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-white/4 last:border-0">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-zinc-300">{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={`${block.type}-${index}`} className={`space-y-1.5 pl-5 text-zinc-100 ${block.ordered ? "list-decimal" : "list-disc"}`}>
              {block.items.map((item, ii) => (
                <li key={ii} className="pl-1">
                  {renderInline(item)}
                </li>
              ))}
            </Tag>
          );
        }

        if (block.type === "heading") {
          const sizes = ["text-lg font-bold", "text-base font-bold", "text-sm font-semibold", "text-sm font-semibold"];
          return (
            <div key={`${block.type}-${index}`} className={`tracking-wide text-white ${sizes[block.level - 1] || sizes[3]}`}>
              {renderInline(block.text)}
            </div>
          );
        }

        // Paragraph — preserve line breaks within
        return (
          <p key={`${block.type}-${index}`} className="text-zinc-100">
            {block.text.split("\n").map((line, li, arr) => (
              <span key={li}>
                {renderInline(line)}
                {li < arr.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
