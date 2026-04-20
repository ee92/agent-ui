import type { Conversation } from "../../lib/types";

/**
 * Mirrors the CLI statusline context progress bar.
 *
 * Color thresholds intentionally diverge between 1M and 200k models:
 * quality degrades around the same absolute token count regardless of window,
 * so the 1M scale goes red ~5x earlier in percentage terms.
 */
function classify(pct: number, is1M: boolean) {
  const [g, y, o] = is1M ? [10, 20, 40] : [50, 75, 90];
  if (pct < g) return { label: "ok", fill: "bg-emerald-500", text: "text-emerald-400" };
  if (pct < y) return { label: "warm", fill: "bg-yellow-400", text: "text-yellow-300" };
  if (pct < o) return { label: "hot", fill: "bg-orange-500", text: "text-orange-300" };
  return { label: "red", fill: "bg-red-500", text: "text-red-400" };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function shortModelName(model: string | null | undefined): string {
  if (!model) return "";
  // claude-opus-4-7[1m] → Opus 4.7 · 1M
  // claude-sonnet-4-5 → Sonnet 4.5
  const m = model.match(/claude-(opus|sonnet|haiku)-(\d+)-?(\d+)?(?:\[(\w+)\])?/i);
  if (!m) return model;
  const [, family, major, minor, tag] = m;
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  const ver = minor ? `${major}.${minor}` : major;
  return tag ? `${name} ${ver} · ${tag.toUpperCase()}` : `${name} ${ver}`;
}

export function ContextBar({ conversation }: { conversation: Conversation | undefined }) {
  const tokens = conversation?.contextTokens ?? 0;
  const window = conversation?.contextWindow ?? 200_000;
  const model = conversation?.contextModel ?? conversation?.model ?? null;
  const pct = window > 0 ? (tokens / window) * 100 : 0;
  const pctClamped = Math.max(0, Math.min(100, pct));
  const is1M = window >= 1_000_000;
  const hasData = tokens > 0;
  const c = classify(pctClamped, is1M);
  const pctDisplay = hasData ? `${pctClamped < 1 ? pctClamped.toFixed(1) : Math.round(pctClamped)}%` : "—";

  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-zinc-500">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${hasData ? c.fill : "bg-white/10"}`}
          style={{ width: `${pctClamped}%` }}
        />
      </div>
      <span className={`tabular-nums font-medium ${hasData ? c.text : "text-zinc-600"}`}>
        {pctDisplay}
      </span>
      {hasData && (
        <span className="tabular-nums text-zinc-600">
          {formatTokens(tokens)}/{formatTokens(window)}
        </span>
      )}
      {model && (
        <span className="hidden truncate text-zinc-600 sm:inline">
          {shortModelName(model)}
        </span>
      )}
    </div>
  );
}
