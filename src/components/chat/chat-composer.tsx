import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
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
  onDraftChange,
  onSend,
  onAttach,
  onRemoveAttachment
}: {
  draft: string;
  attachments: AttachmentDraft[];
  tasks: TaskNode[];
  agents: AgentRun[];
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onAttach: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
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
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
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

  return (
    <div className="bg-white/[0.03] p-2.5 xl:rounded-lg xl:border xl:border-white/4 xl:p-3">
      {attachments.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => onRemoveAttachment(attachment.id)}
              className="min-h-9 rounded-lg border border-white/4 bg-surface-1 px-3 py-2 text-sm text-zinc-200"
            >
              {attachment.name} ×
            </button>
          ))}
        </div>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="mb-3 rounded-lg border border-white/4 bg-surface-1 p-2">
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
        className="rounded-lg bg-black/25 p-2.5 xl:border xl:border-white/4 xl:p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Message agent — type / for commands, # for tasks, @ for agents"
            className="max-h-[220px] min-h-9 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-white outline-none placeholder:text-zinc-600 xl:min-h-[56px]"
          />
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
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 xl:mt-3">
          <div className="hidden flex-wrap items-center gap-2 text-sm text-zinc-500 xl:flex">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="min-h-9 rounded-full border border-white/4 px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.04]"
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
