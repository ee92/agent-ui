export function ToolIcon({ name }: { name: string }) {
  const symbol = iconForName(name);
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[11px] text-zinc-400">
      {symbol}
    </span>
  );
}

function iconForName(name: string): string {
  switch (name) {
    case "Read":
      return "📖";
    case "Write":
      return "✏️";
    case "Edit":
    case "MultiEdit":
      return "✂️";
    case "Bash":
      return "▶";
    case "Glob":
      return "🔎";
    case "Grep":
      return "🔍";
    case "WebSearch":
      return "🌐";
    case "WebFetch":
      return "↓";
    case "Agent":
    case "Task":
      return "⚡";
    case "TodoWrite":
      return "☑";
    default:
      return "🔧";
  }
}
