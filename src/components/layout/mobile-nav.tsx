import type { MobileTab } from "../../lib/stores/shared";
import { useReviewCount, useBlockedCount } from "../../lib/stores/task-store-v2";
import { AgentsIcon, ChatIcon, FolderIcon, TaskIcon } from "../ui/icons";
import { useAgentsStore } from "../../lib/store";

export function MobileNav({
  mobileTab,
  onSelect
}: {
  mobileTab: MobileTab;
  onSelect: (tab: MobileTab) => void;
}) {
  const reviewCount = useReviewCount();
  const blockedCount = useBlockedCount();
  const taskBadge = reviewCount + blockedCount;
  const agents = useAgentsStore((s) => s.agents);
  const activeAgents = agents.filter((a) => a.status === "running" || a.status === "waiting").length;

  const items: Array<{ tab: MobileTab; label: string; icon: typeof ChatIcon; badge?: number }> = [
    { tab: "chat", label: "Chat", icon: ChatIcon },
    { tab: "tasks", label: "Tasks", icon: TaskIcon, badge: taskBadge },
    { tab: "agents", label: "Agents", icon: AgentsIcon, badge: activeAgents },
    { tab: "files", label: "Files", icon: FolderIcon }
  ];

  return (
    <nav className="fixed inset-x-3 bottom-0 z-20 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 xl:hidden">
      <div className="rounded-lg bg-black/70 p-2 shadow-[0_-12px_40px_rgba(0,0,0,0.35)]">
        <div className="grid grid-cols-4 gap-1">
          {items.map(({ tab, label, icon: Icon, badge }) => (
            <button
              key={tab}
              type="button"
              onClick={() => onSelect(tab)}
              aria-label={label}
              className={`relative flex min-h-9 flex-col items-center justify-center gap-0.5 rounded-lg transition ${
                mobileTab === tab ? "bg-blue-500/18 text-blue-300" : "text-zinc-500"
              }`}
            >
              <Icon />
              <span className="text-[10px]">{label}</span>
              {badge && badge > 0 ? (
                <span className="absolute -top-0.5 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-black">
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
