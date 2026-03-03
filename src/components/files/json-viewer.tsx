import { useState } from "react";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function JsonPrimitive({ value }: { value: JsonValue }) {
  if (value === null) {
    return <span className="text-zinc-500">null</span>;
  }
  if (typeof value === "string") {
    return <span className="text-green-300">"{value}"</span>;
  }
  if (typeof value === "number") {
    return <span className="text-amber-300">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-purple-300">{String(value)}</span>;
  }
  return null;
}

function JsonNode({
  label,
  value,
  depth,
  defaultExpanded
}: {
  label?: string;
  value: JsonValue;
  depth: number;
  defaultExpanded: boolean;
}) {
  const isArray = Array.isArray(value);
  const isObject = Boolean(value) && typeof value === "object" && !isArray;
  const expandable = isArray || isObject;
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!expandable) {
    return (
      <div className="py-1" style={{ paddingLeft: `${depth * 16}px` }}>
        {label ? <span className="text-blue-300">"{label}"</span> : null}
        {label ? <span className="text-zinc-500">: </span> : null}
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const summary = isArray ? `[${(value as JsonValue[]).length} items]` : `{${Object.keys(value as object).length} keys}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 py-1 text-left"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <span className="text-xs text-zinc-500">{expanded ? "▾" : "▸"}</span>
        {label ? <span className="text-blue-300">"{label}"</span> : <span className="text-zinc-300">root</span>}
        {label ? <span className="text-zinc-500">: </span> : null}
        <span className="text-zinc-400">{summary}</span>
      </button>
      {expanded ? (
        <div>
          {isArray
            ? (value as JsonValue[]).map((item, index) => (
                <JsonNode
                  key={`${depth}-array-${index}`}
                  label={String(index)}
                  value={item}
                  depth={depth + 1}
                  defaultExpanded={false}
                />
              ))
            : Object.entries(value as { [key: string]: JsonValue }).map(([key, child]) => (
                <JsonNode
                  key={`${depth}-object-${key}`}
                  label={key}
                  value={child}
                  depth={depth + 1}
                  defaultExpanded={false}
                />
              ))}
        </div>
      ) : null}
    </div>
  );
}

export function JsonViewer({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content) as JsonValue;
    return (
      <div className="p-4 font-mono text-xs leading-6 text-zinc-200 sm:p-5 sm:text-sm">
        <JsonNode value={parsed} depth={0} defaultExpanded />
      </div>
    );
  } catch (error) {
    return (
      <div className="p-4 text-sm text-rose-300 sm:p-5">
        Invalid JSON: {error instanceof Error ? error.message : "Unable to parse content."}
      </div>
    );
  }
}
