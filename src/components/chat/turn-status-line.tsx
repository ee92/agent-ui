import { useTurnStatus } from "./use-turn-status";

// Pinned to the tail of the scroll container while the session is streaming.
// The text mirrors the most-recent activity (Reading/Running/Writing/…); the
// stall pill appears after ~20s of silence from the backend and exposes
// Retry/Stop shortcuts so the user isn't stuck guessing whether the agent
// died.
export function TurnStatusLine({
  sessionKey,
  onRetry,
  onStop,
}: {
  sessionKey: string | null;
  onRetry: () => void;
  onStop: () => void;
}) {
  const { text, stalled } = useTurnStatus(sessionKey);
  if (!text) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5 px-1">
      <div className="flex items-center gap-2 text-[11px] italic text-zinc-500">
        <span className="inline-flex items-center gap-0.5">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
        <span className="truncate">{text}</span>
      </div>
      {stalled ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-400/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200/80">
          <span aria-hidden="true">⚠</span>
          <span className="flex-1">No activity for 20s</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-amber-400/30 px-2 py-0.5 text-[11px] text-amber-100 hover:bg-amber-500/10"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onStop}
            className="rounded border border-rose-400/30 px-2 py-0.5 text-[11px] text-rose-100 hover:bg-rose-500/10"
          >
            Stop
          </button>
        </div>
      ) : null}
    </div>
  );
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
