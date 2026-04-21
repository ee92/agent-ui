import { type ChangeEvent, type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { getBackendAdapter } from "../../lib/adapters";
import type { SlashCommandSuggestion } from "../../lib/adapters/types";
import type { TaskNode } from "../../lib/task-types";
import type { AgentRun, AttachmentDraft } from "../../lib/types";
import { SendIcon } from "../ui/icons";

type Suggestion = SlashCommandSuggestion;

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { label: "/help", insert: "/help", meta: "Show available commands" },
  { label: "/status", insert: "/status", meta: "System status" },
  { label: "/tasks", insert: "/tasks", meta: "Show task board" },
  { label: "/search", insert: "/search ", meta: "Search sessions and files" },
];

export function ChatComposer({
  draft,
  attachments,
  tasks,
  agents,
  isStreaming = false,
  onDraftChange,
  onSend,
  onAttach,
  onRemoveAttachment,
  onCancel,
}: {
  draft: string;
  attachments: AttachmentDraft[];
  tasks: TaskNode[];
  agents: AgentRun[];
  isStreaming?: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onAttach: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  onCancel?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [trigger, setTrigger] = useState<"/" | "#" | "@" | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) {
      return;
    }
    // Composer height policy:
    //   empty  -> exactly one line (LINE_HEIGHT + PADDING_Y = 40px)
    //   typing -> grow with scrollHeight, capped so we never dominate small screens
    //   over cap -> internal scroll
    // We measure by collapsing to MIN first, so scrollHeight reports content-only
    // and never inherits the placeholder's wrapped height.
    const LINE_HEIGHT = 24; // matches `leading-6`
    const PADDING_Y = 16; // `py-2` top+bottom
    const MIN_H = LINE_HEIGHT + PADDING_Y; // 40px — one visible line

    const resize = () => {
      // Cap at ~40% of the dynamic viewport, with a floor and ceiling.
      // On a 700px phone that's 280px (~7 lines). On a 450px landscape that's 180px (~4 lines).
      const cap = Math.max(MIN_H * 2, Math.min(320, Math.round(window.innerHeight * 0.4)));
      if (element.value.length === 0) {
        element.style.height = `${MIN_H}px`;
        element.style.overflowY = "hidden";
        return;
      }
      element.style.height = `${MIN_H}px`;
      const content = element.scrollHeight;
      const next = Math.min(Math.max(content, MIN_H), cap);
      element.style.height = `${next}px`;
      element.style.overflowY = content > cap ? "auto" : "hidden";
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draft]);

  const updateSuggestions = (value: string) => {
    const token = value.split(/\s+/).at(-1) ?? "";
    if (token.startsWith("/") && value.trimStart() === token) {
      // Only show slash commands when it's the first token
      const query = token.toLowerCase();
      const slashCommands = getBackendAdapter().slashCommands?.() ?? DEFAULT_SUGGESTIONS;
      setSuggestions(
        slashCommands
          .filter((cmd) => cmd.label.startsWith(query) || cmd.meta.toLowerCase().includes(query.slice(1)))
          .slice(0, 8)
      );
      setTrigger("/");
      return;
    }
    if (token.startsWith("#")) {
      const query = token.slice(1).toLowerCase();
      setSuggestions(
        tasks
          .filter((task) => task.title.toLowerCase().includes(query))
          .slice(0, 5)
          .map((task) => ({ label: task.title, insert: `#${task.title.replace(/\s+/g, "-")}`, meta: task.status }))
      );
      setTrigger("#");
      return;
    }
    if (token.startsWith("@")) {
      const query = token.slice(1).toLowerCase();
      setSuggestions(
        agents
          .filter((agent) => agent.label.toLowerCase().includes(query))
          .slice(0, 5)
          .map((agent) => ({ label: agent.label, insert: `@${agent.label.replace(/\s+/g, "-")}`, meta: agent.status }))
      );
      setTrigger("@");
      return;
    }
    setSuggestions([]);
    setTrigger(null);
  };

  const applySuggestion = (suggestion: Suggestion) => {
    const tokens = draft.split(/\s+/);
    tokens[tokens.length - 1] = suggestion.insert;
    const next = tokens.join(" ");
    onDraftChange(next.endsWith(" ") ? next : `${next} `);
    setSuggestions([]);
    setTrigger(null);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    onDraftChange(value);
    updateSuggestions(value);
    setSelectedIndex(0);
  };

  const canSend = draft.trim().length > 0 || attachments.length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
        return;
      }
      if (event.key === "Escape") {
        setSuggestions([]);
        setTrigger(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (draft.trim().length > 0) {
        onSend();
      }
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;

    // Walk clipboard items; grab anything that's a file with an image MIME type.
    // Screenshots come in as `image/png` with an empty filename; rename them so
    // the attachment chip is readable and the backend sees something sensible.
    const pasted: File[] = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const hasRealName = file.name && file.name !== "image.png" && !file.name.startsWith("image.");
      if (hasRealName) {
        pasted.push(file);
      } else {
        const ext = item.type.split("/")[1] || "png";
        const stamp = new Date()
          .toISOString()
          .replace(/[-:T]/g, "")
          .slice(0, 15); // YYYYMMDDTHHMMSS-ish
        pasted.push(new File([file], `pasted-${stamp}.${ext}`, { type: item.type }));
      }
    }

    if (pasted.length === 0) return;

    // Only swallow the paste when we actually captured an image — plain-text
    // paste still goes through to the textarea untouched.
    event.preventDefault();

    // onAttach takes a FileList, so build one via DataTransfer.
    const dt = new DataTransfer();
    for (const f of pasted) dt.items.add(f);
    onAttach(dt.files);
  };

  return (
    <div className="bg-white/[0.03] p-2.5 xl:rounded-lg xl:border xl:border-white/[0.06] xl:p-3">
      {attachments.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => {
            const isImage = attachment.mimeType.startsWith("image/") && attachment.dataUrl;
            return (
              <button
                key={attachment.id}
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
                title={`Remove ${attachment.name}`}
                className={
                  isImage
                    ? "group relative h-16 w-16 overflow-hidden rounded-lg border border-white/[0.06] bg-surface-1"
                    : "min-h-9 rounded-lg border border-white/[0.06] bg-surface-1 px-3 py-2 text-sm text-zinc-200"
                }
              >
                {isImage ? (
                  <>
                    <img
                      src={attachment.dataUrl as string}
                      alt={attachment.name}
                      className="h-full w-full object-cover"
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-start justify-end p-1 opacity-0 transition group-hover:opacity-100">
                      <span className="rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white">×</span>
                    </span>
                  </>
                ) : (
                  <>{attachment.name} ×</>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="mb-3 rounded-lg border border-white/[0.06] bg-surface-1 p-2">
          <div className="mb-2 px-2 text-[10px] uppercase tracking-wide text-zinc-500">
            {trigger === "/" ? "Commands" : trigger === "#" ? "Task references" : "Agent mentions"}
          </div>
          <div className="space-y-0.5">
            {suggestions.map((suggestion, si) => (
              <button
                key={`${suggestion.insert}-${suggestion.meta}`}
                type="button"
                onClick={() => applySuggestion(suggestion)}
                onMouseEnter={() => setSelectedIndex(si)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${si === selectedIndex ? "bg-white/[0.08] text-white" : "text-zinc-200 hover:bg-white/[0.04]"}`}
              >
                <span className="font-medium">{suggestion.label}</span>
                <span className="text-xs text-zinc-500">{suggestion.meta}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length > 0) {
            onAttach(event.dataTransfer.files);
          }
        }}
        className="rounded-lg bg-black/25 p-2.5 xl:border xl:border-white/[0.06] xl:p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Message agent"
            className="flex-1 resize-none bg-transparent py-2 text-base leading-6 text-white outline-none placeholder:text-zinc-600"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={() => onCancel?.()}
              title="Stop generating"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white hover:bg-rose-400 xl:h-auto xl:w-auto xl:gap-2 xl:rounded-lg xl:px-4 xl:py-2.5 xl:text-sm xl:font-medium"
            >
              <span className="block h-3 w-3 rounded-sm bg-white" />
              <span className="hidden xl:inline">Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (canSend) {
                  onSend();
                }
              }}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-400 xl:h-auto xl:w-auto xl:gap-2 xl:rounded-lg xl:px-4 xl:py-2.5 xl:text-sm xl:font-medium"
            >
              <SendIcon />
              <span className="hidden xl:inline">Send</span>
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 xl:mt-3">
          <div className="hidden flex-wrap items-center gap-2 text-sm text-zinc-500 xl:flex">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="min-h-9 rounded-full border border-white/[0.06] px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.04]"
            >
              Attach
            </button>
            <span>Enter to send, Shift+Enter for newline</span>
          </div>
          <span className="hidden text-xs text-zinc-600 sm:block xl:hidden">Enter to send</span>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) {
            onAttach(event.target.files);
          }
          event.target.value = "";
        }}
      />
    </div>
  );
}
