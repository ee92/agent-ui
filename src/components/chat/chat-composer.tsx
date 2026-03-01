import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { TaskNode } from "../../lib/task-types";
import type { AgentRun, AttachmentDraft } from "../../lib/types";
import { SendIcon } from "../ui/icons";

type Suggestion = {
  label: string;
  insert: string;
  meta: string;
};

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
  const [trigger, setTrigger] = useState<"#" | "@" | null>(null);
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
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="bg-white/[0.03] p-2.5 shadow-[0_-12px_80px_rgba(0,0,0,0.28)] xl:rounded-[2rem] xl:border xl:border-white/8 xl:p-3">
      {attachments.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => onRemoveAttachment(attachment.id)}
              className="min-h-11 rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-zinc-200"
            >
              {attachment.name} ×
            </button>
          ))}
        </div>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="mb-3 rounded-2xl border border-white/8 bg-black/40 p-2">
          <div className="mb-2 px-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            {trigger === "#" ? "Task references" : "Agent mentions"}
          </div>
          <div className="space-y-1">
            {suggestions.map((suggestion) => (
              <button
                key={`${suggestion.insert}-${suggestion.meta}`}
                type="button"
                onClick={() => applySuggestion(suggestion)}
                className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/[0.04]"
              >
                <span>{suggestion.label}</span>
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
        className="rounded-[1.5rem] bg-black/25 p-2.5 xl:border xl:border-white/8 xl:p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Message OpenClaw. Use # for tasks and @ for agents."
            className="max-h-[220px] min-h-11 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-white outline-none placeholder:text-zinc-600 xl:min-h-[56px]"
          />
          <button
            type="button"
            onClick={onSend}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-400 xl:h-auto xl:w-auto xl:gap-2 xl:rounded-2xl xl:px-4 xl:py-2.5 xl:text-sm xl:font-medium"
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
              className="min-h-11 rounded-full border border-white/8 px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.04]"
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
