import { useEffect, useReducer } from "react";

/**
 * Forces a re-render every `ms` milliseconds.
 * Useful for keeping relative timestamps ("3m ago") fresh.
 */
export function useTick(ms: number): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(bump, ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}
