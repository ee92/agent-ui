import { useTurnStatus } from "./use-turn-status";

// Pinned to the tail of the scroll container while the session is streaming.
// Shows what Claude is currently doing (Reading/Running/Writing/Thinking/…)
// plus a live elapsed-seconds counter. No stall threshold — a climbing
// counter is more honest than an arbitrary "stalled?" verdict.
export function TurnStatusLine({ sessionKey }: { sessionKey: string | null }) {
  const { text, elapsedMs } = useTurnStatus(sessionKey);
  if (!text) return null;
  return (
    <div className="mb-3 flex items-center gap-2 px-1 text-[11px] italic text-zinc-500">
      <span className="inline-flex items-center gap-0.5">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
      <span className="truncate">{text}</span>
      {elapsedMs >= 2000 ? (
        <span className="shrink-0 not-italic tabular-nums text-zinc-600">
          · {formatElapsed(elapsedMs)}
        </span>
      ) : null}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-1 w-1 animate-pulse rounded-full bg-zinc-500"
      style={{ animationDelay: delay }}
    />
  );
}
