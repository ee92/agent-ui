import { Fragment, type ReactNode } from "react";

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: string }
  | { type: "code"; language: string; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "hr" }
  | { type: "paragraph"; lines: string[] };

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;

  const pushPlainText = (value: string) => {
    if (value) {
      nodes.push(value);
    }
  };

  while (index < text.length) {
    const boldStart = text.indexOf("**", index);
    const italicStart = text.indexOf("*", index);
    const codeStart = text.indexOf("`", index);
    const linkStart = text.indexOf("[", index);
    const candidates = [boldStart, italicStart, codeStart, linkStart].filter((value) => value >= 0);
    const nextToken = candidates.length ? Math.min(...candidates) : -1;

    if (nextToken === -1) {
      pushPlainText(text.slice(index));
      break;
    }

    pushPlainText(text.slice(index, nextToken));

    if (nextToken === boldStart) {
      const boldEnd = text.indexOf("**", boldStart + 2);
      if (boldEnd > boldStart + 1) {
        nodes.push(
          <strong key={`bold-${boldStart}`} className="font-semibold text-zinc-100">
            {renderInline(text.slice(boldStart + 2, boldEnd))}
          </strong>
        );
        index = boldEnd + 2;
        continue;
      }
    }

    if (nextToken === italicStart) {
      const italicEnd = text.indexOf("*", italicStart + 1);
      if (italicEnd > italicStart) {
        nodes.push(
          <em key={`italic-${italicStart}`} className="italic text-zinc-200">
            {renderInline(text.slice(italicStart + 1, italicEnd))}
          </em>
        );
        index = italicEnd + 1;
        continue;
      }
    }

    if (nextToken === codeStart) {
      const codeEnd = text.indexOf("`", codeStart + 1);
      if (codeEnd > codeStart) {
        nodes.push(
          <code
            key={`code-${codeStart}`}
            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[0.9em] text-emerald-200"
          >
            {text.slice(codeStart + 1, codeEnd)}
          </code>
        );
        index = codeEnd + 1;
        continue;
      }
    }

    if (nextToken === linkStart) {
      const labelEnd = text.indexOf("]", linkStart + 1);
      const urlStart = labelEnd >= 0 ? text.indexOf("(", labelEnd + 1) : -1;
      const urlEnd = urlStart >= 0 ? text.indexOf(")", urlStart + 1) : -1;
      if (labelEnd > linkStart && urlStart === labelEnd + 1 && urlEnd > urlStart) {
        nodes.push(
          <a
            key={`link-${linkStart}`}
            href={text.slice(urlStart + 1, urlEnd)}
            target="_blank"
            rel="noreferrer"
            className="text-sky-300 underline decoration-sky-500/60 underline-offset-2 hover:text-sky-200"
          >
            {renderInline(text.slice(linkStart + 1, labelEnd))}
          </a>
        );
        index = urlEnd + 1;
        continue;
      }
    }

    pushPlainText(text.charAt(nextToken));
    index = nextToken + 1;
  }

  return nodes;
}

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", language, content: codeLines.join("\n") });
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      const [, hashes, text] = trimmed.match(/^(#{1,6})\s+(.*)$/) ?? [];
      if (hashes && text !== undefined) {
        blocks.push({ type: "heading", level: hashes.length as 1 | 2 | 3 | 4 | 5 | 6, content: text });
        index += 1;
        continue;
      }
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (/^- /.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^- /.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^- /, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      const currentTrimmed = current.trim();
      if (!currentTrimmed) {
        break;
      }
      if (
        currentTrimmed.startsWith("```") ||
        /^#{1,6}\s+/.test(currentTrimmed) ||
        /^-{3,}$/.test(currentTrimmed) ||
        /^>\s?/.test(currentTrimmed) ||
        /^- /.test(currentTrimmed) ||
        /^\d+\.\s/.test(currentTrimmed)
      ) {
        break;
      }
      paragraphLines.push(currentTrimmed);
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraphLines });
  }

  return blocks;
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.type === "heading") {
    const sizes = {
      1: "text-3xl",
      2: "text-2xl",
      3: "text-xl",
      4: "text-lg",
      5: "text-base",
      6: "text-sm"
    } as const;
    const HeadingTag = `h${block.level}` as const;
    return (
      <HeadingTag key={`heading-${index}`} className={`font-semibold text-sky-300 ${sizes[block.level]}`}>
        {renderInline(block.content)}
      </HeadingTag>
    );
  }

  if (block.type === "code") {
    return (
      <div key={`code-${index}`} className="overflow-hidden rounded-lg border border-white/4 bg-zinc-800/90">
        {block.language ? (
          <div className="border-b border-white/4 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
            {block.language}
          </div>
        ) : null}
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-6 text-zinc-200 sm:text-sm">
          <code>{block.content}</code>
        </pre>
      </div>
    );
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag
        key={`list-${index}`}
        className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-2 pl-6 text-sm leading-7 text-zinc-200`}
      >
        {block.items.map((item, itemIndex) => (
          <li key={`item-${itemIndex}`}>{renderInline(item)}</li>
        ))}
      </ListTag>
    );
  }

  if (block.type === "blockquote") {
    return (
      <blockquote
        key={`quote-${index}`}
        className="border-l-2 border-sky-400/70 pl-4 text-sm italic leading-7 text-zinc-300"
      >
        {block.lines.map((line, lineIndex) => (
          <Fragment key={`quote-line-${lineIndex}`}>
            {lineIndex > 0 ? <br /> : null}
            {renderInline(line)}
          </Fragment>
        ))}
      </blockquote>
    );
  }

  if (block.type === "hr") {
    return <hr key={`hr-${index}`} className="border-white/4" />;
  }

  return (
    <p key={`paragraph-${index}`} className="text-sm leading-7 text-zinc-200">
      {block.lines.map((line, lineIndex) => (
        <Fragment key={`paragraph-line-${lineIndex}`}>
          {lineIndex > 0 ? " " : null}
          {renderInline(line)}
        </Fragment>
      ))}
    </p>
  );
}

export function MarkdownViewer({ content }: { content: string }) {
  const blocks = parseMarkdown(content);

  return <div className="space-y-5 p-4 sm:p-5">{blocks.map((block, index) => renderBlock(block, index))}</div>;
}
