import { useState } from "react";
import type { MessageContentPart } from "../../../lib/types";

type ThinkingPart = Extract<MessageContentPart, { type: "thinking" }>;

export function ThinkingCard({ part }: { part: ThinkingPart }) {
  const [expanded, setExpanded] = useState(false);
  const preview = part.text.slice(0, 80).replace(/\s+/g, " ").trim();
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/10 text-[12px] text-zinc-400">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="font-mono text-zinc-500">
          {part.complete ? "Thought" : "Thinking…"}
        </span>
        {!expanded && preview ? (
          <span className="truncate italic text-zinc-500">{preview}</span>
        ) : null}
        <span className="ml-auto text-zinc-600">{expanded ? "−" : "+"}</span>
      </button>
      {expanded ? (
        <div className="border-t border-white/[0.04] px-3 py-2 italic text-zinc-400 whitespace-pre-wrap">
          {part.text || " "}
        </div>
      ) : null}
    </div>
  );
}
