import type { MobileTab } from "../../lib/stores/shared";

export function MobileNav({
  mobileTab,
  onSelect
}: {
  mobileTab: MobileTab;
  onSelect: (tab: MobileTab) => void;
}) {
  return (
    <nav className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 rounded-[2rem] border border-white/8 bg-black/60 p-2 backdrop-blur-xl md:inset-x-4 xl:hidden">
      <div className="grid grid-cols-3 gap-2">
        {(["chat", "tasks", "files"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            className={`min-h-11 rounded-2xl px-4 py-3 text-base font-medium capitalize ${
              mobileTab === tab ? "bg-blue-500/14 text-blue-200" : "text-zinc-400"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </nav>
  );
}
