import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../../lib/stores/chat-store";
import type { Conversation } from "../../lib/types";

// Options fired at the Claude Code `/model` command. Claude Code accepts
// aliases like `opus`, `opus[1m]`, `sonnet` — picker parity isn't required;
// the selection lands in the conversation as a local-command response.
const MODEL_OPTIONS: Array<{ label: string; alias: string; hint?: string }> = [
  { label: "Opus", alias: "opus", hint: "200k" },
  { label: "Opus 1M", alias: "opus[1m]", hint: "1M context" },
  { label: "Sonnet", alias: "sonnet", hint: "200k" },
  { label: "Sonnet 1M", alias: "sonnet[1m]", hint: "1M context" },
  { label: "Haiku", alias: "haiku", hint: "fast" },
  { label: "Default", alias: "default" },
];

/**
 * CLI-statusline parity context progress bar.
 *
 * Thresholds diverge between 1M and 200k windows because quality degrades
 * around the same absolute token count regardless of window size: the 1M
 * scale hits red ~5× earlier in percentage terms.
 */
const COLORS = {
  green: "#10b981", // emerald-500
  yellow: "#facc15", // yellow-400
  orange: "#f97316", // orange-500
  red: "#ef4444", // red-500
} as const;

function thresholds(is1M: boolean) {
  return is1M ? { g: 10, y: 20, o: 40 } : { g: 50, y: 75, o: 90 };
}

function textClass(pct: number, is1M: boolean) {
  const { g, y, o } = thresholds(is1M);
  if (pct < g) return "text-emerald-400";
  if (pct < y) return "text-yellow-300";
  if (pct < o) return "text-orange-300";
  return "text-red-400";
}

/** Pre-calibrated gradient spanning the full window 0–100%. */
function gradientFor(is1M: boolean): string {
  const { g, y, o } = thresholds(is1M);
  return `linear-gradient(to right,
    ${COLORS.green} 0%,
    ${COLORS.green} ${g}%,
    ${COLORS.yellow} ${y}%,
    ${COLORS.orange} ${o}%,
    ${COLORS.red} 100%)`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function shortModelName(model: string | null | undefined): string {
  if (!model) return "";
  const m = model.match(/claude-(opus|sonnet|haiku)-(\d+)-?(\d+)?(?:\[(\w+)\])?/i);
  if (!m) return model;
  const [, family, major, minor, tag] = m;
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  const ver = minor ? `${major}.${minor}` : major;
  return tag ? `${name} ${ver} · ${tag.toUpperCase()}` : `${name} ${ver}`;
}

function BreakdownRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-zinc-500">
        {label}
        {hint ? <span className="ml-1 text-zinc-700">· {hint}</span> : null}
      </span>
      <span className="tabular-nums text-zinc-300">{value}</span>
    </div>
  );
}

export function ContextBar({ conversation }: { conversation: Conversation | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const quickSend = useChatStore((s) => s.quickSend);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setModelMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelMenuOpen]);

  const handleModelPick = async (alias: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setModelMenuOpen(false);
    if (!conversation?.key) return;
    await quickSend(conversation.key, `/model ${alias}`);
  };
  const tokens = conversation?.contextTokens ?? 0;
  const window = conversation?.contextWindow ?? 200_000;
  const model = conversation?.contextModel ?? conversation?.model ?? null;
  const pct = window > 0 ? (tokens / window) * 100 : 0;
  const pctClamped = Math.max(0, Math.min(100, pct));
  const is1M = window >= 1_000_000;
  const hasData = tokens > 0;
  const pctDisplay = hasData ? `${pctClamped < 1 ? pctClamped.toFixed(1) : Math.round(pctClamped)}%` : "—";
  // Show compact hint starting at the "yellow" threshold — context quality
  // noticeably degrades here, and /compact is the cheap fix.
  const { y } = thresholds(is1M);
  const showCompact = hasData && pctClamped >= y;

  const handleCompact = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!conversation?.key || compacting) return;
    setCompacting(true);
    try {
      await quickSend(conversation.key, "/compact");
    } finally {
      setCompacting(false);
    }
  };

  // Mask reveals the left portion of a fixed gradient that spans the whole track.
  const maskImage = `linear-gradient(to right, black ${pctClamped}%, transparent ${pctClamped}%)`;

  const input = conversation?.contextInputTokens ?? 0;
  const cacheRead = conversation?.contextCacheReadTokens ?? 0;
  const cacheCreate = conversation?.contextCacheCreationTokens ?? 0;
  const output = conversation?.contextOutputTokens ?? 0;
  const cost = conversation?.totalCostUsd ?? 0;

  const toggleExpanded = () => {
    if (hasData) setExpanded((v) => !v);
  };

  return (
    <div className="px-1">
      <div
        role="button"
        tabIndex={hasData ? 0 : -1}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && hasData) {
            e.preventDefault();
            toggleExpanded();
          }
        }}
        aria-expanded={expanded}
        aria-label="Toggle context breakdown"
        className={`flex w-full items-center gap-2 py-1 text-[11px] text-zinc-500 ${hasData ? "cursor-pointer" : ""}`}
      >
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
          {hasData ? (
            <div
              className="absolute inset-0 rounded-full transition-[mask-image,-webkit-mask-image] duration-300"
              style={{
                backgroundImage: gradientFor(is1M),
                maskImage,
                WebkitMaskImage: maskImage,
              }}
            />
          ) : null}
        </div>
        <span className={`tabular-nums font-medium ${hasData ? textClass(pctClamped, is1M) : "text-zinc-600"}`}>
          {pctDisplay}
        </span>
        {hasData && (
          <span className="tabular-nums text-zinc-600">
            {formatTokens(tokens)}/{formatTokens(window)}
          </span>
        )}
        {model && (
          <div ref={menuRef} className="relative hidden sm:inline-block">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setModelMenuOpen((v) => !v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setModelMenuOpen((v) => !v);
                }
              }}
              aria-haspopup="menu"
              aria-expanded={modelMenuOpen}
              className="cursor-pointer truncate rounded px-1 py-0.5 text-zinc-600 transition-colors hover:bg-white/[0.05] hover:text-zinc-300"
            >
              {shortModelName(model)}
            </span>
            {modelMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full right-0 z-20 mb-1 w-44 rounded-md border border-white/[0.08] bg-zinc-950 py-1 shadow-lg"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.alias}
                    type="button"
                    role="menuitem"
                    onClick={(e) => void handleModelPick(opt.alias, e)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]"
                  >
                    <span>{opt.label}</span>
                    {opt.hint && <span className="text-zinc-600">{opt.hint}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {showCompact && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleCompact}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleCompact(e as unknown as React.MouseEvent);
            }}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset transition-colors ${
              compacting
                ? "bg-white/5 text-zinc-500 ring-white/10"
                : "bg-amber-500/10 text-amber-300 ring-amber-500/30 hover:bg-amber-500/20"
            }`}
            aria-label="Compact this conversation to reclaim context"
          >
            {compacting ? "compacting…" : "compact"}
          </span>
        )}
        {hasData && (
          <span className={`text-[10px] text-zinc-600 transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
        )}
      </div>

      {expanded && hasData && (
        <div className="mb-1 rounded-md border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px]">
          <BreakdownRow label="Fresh input" value={formatTokens(input)} hint="uncached" />
          <BreakdownRow label="Cache read" value={formatTokens(cacheRead)} hint="history" />
          <BreakdownRow label="Cache write" value={formatTokens(cacheCreate)} hint="new prompts" />
          <BreakdownRow label="Last output" value={formatTokens(output)} />
          <div className="my-1 border-t border-white/[0.04]" />
          <BreakdownRow label="Total context" value={`${formatTokens(tokens)} / ${formatTokens(window)}`} />
          {cost > 0 && <BreakdownRow label="Session cost" value={formatCost(cost)} />}
        </div>
      )}
    </div>
  );
}
