import { useEffect, useRef, useState } from "react";
import type { MessageContentPart } from "../../../lib/types";
import { ToolIcon } from "./tool-icon";

type ToolUsePart = Extract<MessageContentPart, { type: "tool_use" }>;

export type ToolStatus = "streaming" | "running" | "done" | "error";

export function statusFor(part: ToolUsePart): ToolStatus {
  if (part.result) return part.result.isError ? "error" : "done";
  if (part.inputComplete) return "running";
  return "streaming";
}

function statusTextColor(status: ToolStatus): string {
  switch (status) {
    case "done":
      return "text-zinc-500";
    case "error":
      return "text-rose-300";
    case "running":
      return "text-blue-200";
    case "streaming":
      return "text-zinc-400";
  }
}

function formatInputBlock(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

// Ellipsize long strings on a single line — preserve the first line only so
// multi-line commands/snippets become a one-line summary.
function clip(value: string, max = 80): string {
  const firstLine = value.split("\n")[0] ?? "";
  const trimmed = firstLine.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? clip(input) : "";
  }
  const rec = input as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookRead":
    case "NotebookEdit":
      return clip(str(rec.file_path) || str(rec.notebook_path));
    case "Bash":
      return clip(str(rec.command));
    case "Grep": {
      const pat = str(rec.pattern);
      const scope = str(rec.path) || str(rec.glob);
      return clip(scope ? `${pat}  ${scope}` : pat);
    }
    case "Glob":
      return clip(str(rec.pattern));
    case "WebFetch":
      return clip(str(rec.url));
    case "WebSearch":
      return clip(str(rec.query));
    case "TodoWrite":
      return "";
    default:
      try {
        return clip(JSON.stringify(input));
      } catch {
        return "";
      }
  }
}

export function ToolLogRow({
  part,
  defaultExpanded = false,
}: {
  part: ToolUsePart;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const status = statusFor(part);

  // Auto-collapse once a tool that was expanded for being "running" completes.
  // We only want to flip the user-invisible default — a click-expand by the
  // user should stick. The `manualRef` latch fires on any user toggle so we
  // stop messing with their choice.
  const manualRef = useRef(false);
  const wasRunningRef = useRef(defaultExpanded);
  useEffect(() => {
    if (manualRef.current) return;
    const running = status === "streaming" || status === "running";
    if (wasRunningRef.current && !running) {
      setExpanded(false);
    }
    wasRunningRef.current = running;
  }, [status]);

  const summary = summarizeInput(part.name, part.input);
  const isBusy = status === "streaming" || status === "running";

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          manualRef.current = true;
          setExpanded((x) => !x);
        }}
        className="flex w-full items-center gap-2 rounded py-0.5 text-left text-[12px] leading-5 hover:bg-white/[0.03]"
      >
        <ToolIcon name={part.name} />
        <span className="font-mono text-zinc-300">{part.name}</span>
        {summary ? (
          <span className="truncate font-mono text-[11px] text-zinc-500">
            {summary}
          </span>
        ) : null}
        <span className={`ml-auto shrink-0 text-[10px] ${statusTextColor(status)}`}>
          {isBusy ? <PulseDots /> : status === "error" ? "error" : null}
        </span>
      </button>
      {expanded ? (
        <div className="mt-1 mb-1 space-y-2 border-l border-white/[0.06] pl-3 pr-1">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-zinc-400">
            {part.inputComplete
              ? formatInputBlock(part.input)
              : (typeof part.input === "string" && part.input) || "(streaming args…)"}
          </pre>
          {part.result ? (
            <div
              className={`max-h-96 overflow-y-auto whitespace-pre-wrap rounded bg-black/30 px-2 py-1.5 text-[11px] ${
                part.result.isError ? "text-rose-300" : "text-zinc-300"
              }`}
            >
              {part.result.content.length > 0 ? (
                part.result.content.map((c, i) => <div key={i}>{c.text}</div>)
              ) : (
                <span className="italic text-zinc-500">(empty result)</span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PulseDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <Dot delay="0ms" />
      <Dot delay="150ms" />
      <Dot delay="300ms" />
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-1 w-1 animate-pulse rounded-full bg-current"
      style={{ animationDelay: delay }}
    />
  );
}
