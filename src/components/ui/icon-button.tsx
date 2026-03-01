import type { ReactNode } from "react";

export function IconButton({
  label,
  onClick,
  active,
  children
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
        active
          ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
          : "border-white/8 bg-white/[0.03] text-zinc-300 hover:border-white/14 hover:bg-white/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}
