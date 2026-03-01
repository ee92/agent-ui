import { useMemo, useState } from "react";
import { CopyIcon } from "../ui/icons";

type Block =
  | { type: "code"; code: string }
  | { type: "list"; items: string[] }
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string };

export function Markdown({ text }: { text: string }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const blocks = useMemo(() => {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const result: Block[] = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      if (line.startsWith("```")) {
        const code: string[] = [];
        index += 1;
        while (index < lines.length && !lines[index].startsWith("```")) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        result.push({ type: "code", code: code.join("\n") });
        continue;
      }
      if (line.startsWith("- ") || line.startsWith("* ")) {
        const items: string[] = [];
        while (index < lines.length && (lines[index].startsWith("- ") || lines[index].startsWith("* "))) {
          items.push(lines[index].slice(2));
          index += 1;
        }
        result.push({ type: "list", items });
        continue;
      }
      if (line.startsWith("#")) {
        result.push({ type: "heading", text: line.replace(/^#+\s*/, "") });
        index += 1;
        continue;
      }
      const paragraph: string[] = [];
      while (index < lines.length && lines[index].trim() && !lines[index].startsWith("```")) {
        paragraph.push(lines[index]);
        index += 1;
      }
      result.push({ type: "paragraph", text: paragraph.join(" ") });
    }
    return result;
  }, [text]);

  return (
    <div className="space-y-3 text-[14px] leading-6 text-zinc-100">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <div key={`${block.type}-${index}`} className="relative">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(block.code);
                  setCopiedIndex(index);
                  window.setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1200);
                }}
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/50 px-2 py-1 text-[11px] text-zinc-200"
              >
                <CopyIcon />
                {copiedIndex === index ? "Copied" : "Copy"}
              </button>
              <pre className="overflow-x-auto rounded-2xl border border-white/8 bg-black/40 px-4 py-3 text-[13px] text-sky-200">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={`${block.type}-${index}`} className="space-y-2 pl-5 text-zinc-100">
              {block.items.map((item) => (
                <li key={item} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "heading") {
          return (
            <h4 key={`${block.type}-${index}`} className="text-sm font-semibold tracking-wide text-white">
              {block.text}
            </h4>
          );
        }
        return (
          <p key={`${block.type}-${index}`} className="text-zinc-100">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
