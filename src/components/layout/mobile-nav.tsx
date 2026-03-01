import type { MobileTab } from "../../lib/stores/shared";
import { ChatIcon, FolderIcon, TaskIcon } from "../ui/icons";

export function MobileNav({
  mobileTab,
  onSelect
}: {
  mobileTab: MobileTab;
  onSelect: (tab: MobileTab) => void;
}) {
  const items: Array<{ tab: MobileTab; label: string; icon: typeof ChatIcon }> = [
    { tab: "chat", label: "Chat", icon: ChatIcon },
    { tab: "tasks", label: "Tasks", icon: TaskIcon },
    { tab: "files", label: "Files", icon: FolderIcon }
  ];

  return (
    <nav className="fixed inset-x-3 bottom-0 z-20 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 xl:hidden">
      <div className="rounded-[1.75rem] bg-black/70 p-2 shadow-[0_-12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="grid grid-cols-3 gap-1.5">
          {items.map(({ tab, label, icon: Icon }) => (
            <button
              key={tab}
              type="button"
              onClick={() => onSelect(tab)}
              aria-label={label}
              className={`flex min-h-11 items-center justify-center rounded-2xl transition ${
                mobileTab === tab ? "bg-blue-500/18 text-blue-300" : "text-zinc-500"
              }`}
            >
              <Icon />
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
