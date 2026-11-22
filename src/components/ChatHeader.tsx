import { Layers, Menu, PenLine, ShieldCheck } from "lucide-react";
import { useStore } from "../state/store";
import { cx } from "../lib/util";

export function ChatHeader({ onMenu, menuAlways }: { onMenu: () => void; menuAlways: boolean }) {
  const { activeThread, state, openPanel } = useStore();
  const jobs = activeThread?.jobIds.map((id) => state.jobs[id]).filter(Boolean) ?? [];
  const lastJob = jobs[jobs.length - 1];
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-100 bg-white/80 px-4 backdrop-blur md:px-7 dark:border-white/5 dark:bg-[#0e0b16]/80">
      <button
        className={cx("rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5", !menuAlways && "md:hidden")}
        onClick={onMenu}
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>
      <h1 className="min-w-0 truncate text-[15px] font-medium text-slate-900 dark:text-white">{activeThread?.title ?? "New chat"}</h1>
      <div className="ml-auto flex shrink-0 items-center gap-2 text-xs">
        {lastJob && (
          <button
            onClick={() => openPanel(lastJob.id, undefined, "versions")}
            className="hidden items-center gap-1.5 rounded-full border border-prism-200 bg-prism-50 px-3 py-1 font-medium text-prism-700 hover:bg-prism-100 sm:flex dark:border-prism-400/30 dark:bg-prism-500/10 dark:text-prism-200"
          >
            <Layers className="h-3.5 w-3.5" /> Outputs · {jobs.length}
          </button>
        )}
        <span className="flex items-center gap-1.5 rounded-full border border-cyan-300 bg-cyan-50/60 px-3 py-1 font-medium text-cyan-600 dark:border-cyan-400/40 dark:bg-cyan-400/10 dark:text-cyan-300">
          <ShieldCheck className="h-3.5 w-3.5" /> GVR-certified
        </span>
        <span className="hidden items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1 text-slate-600 xl:flex dark:bg-white/5 dark:text-slate-300">
          <PenLine className="h-3.5 w-3.5" /> Working Draft
        </span>
        <span className={cx("hidden pl-1 text-slate-400", menuAlways ? "2xl:inline" : "lg:inline")}>{activeThread?.messages.length ?? 0} messages</span>
      </div>
    </header>
  );
}
