import { useState } from "react";
import type { MessageContentPart } from "../../../lib/types";
import { ToolIcon } from "./tool-icon";

type ToolUsePart = Extract<MessageContentPart, { type: "tool_use" }>;

type Status = "streaming" | "running" | "done" | "error";

function statusFor(part: ToolUsePart): Status {
  if (part.result) return part.result.isError ? "error" : "done";
  if (part.inputComplete) return "running";
  return "streaming";
}

function statusColor(status: Status): string {
  switch (status) {
    case "done":
      return "bg-emerald-500/20 text-emerald-300";
    case "error":
      return "bg-rose-500/20 text-rose-300";
    case "running":
      return "bg-blue-500/20 text-blue-200";
    case "streaming":
      return "bg-white/[0.06] text-zinc-300";
  }
}

function formatInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function ToolUseCard({ part }: { part: ToolUsePart }) {
  const [expanded, setExpanded] = useState(false);
  const status = statusFor(part);

  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/20 text-[12px]">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ToolIcon name={part.name} />
        <span className="font-mono text-zinc-200">{part.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statusColor(status)}`}>
          {status}
        </span>
        <span className="ml-auto text-zinc-600">{expanded ? "−" : "+"}</span>
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-white/[0.06] px-3 py-2">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-zinc-400">
            {part.inputComplete ? formatInput(part.input) : (typeof part.input === "string" && part.input) || "(streaming args…)"}
          </pre>
          {part.result ? (
            <div
              className={`max-h-96 overflow-y-auto whitespace-pre-wrap rounded bg-black/30 px-2 py-1.5 text-[11px] ${part.result.isError ? "text-rose-300" : "text-zinc-300"}`}
            >
              {part.result.content.length > 0
                ? part.result.content.map((c, i) => <div key={i}>{c.text}</div>)
                : <span className="italic text-zinc-500">(empty result)</span>}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
