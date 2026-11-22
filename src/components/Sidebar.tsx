import { useState } from "react";
import { AppWindow, ChevronDown, MessageSquare, Moon, Plus, RotateCcw, SlidersHorizontal, Sun, X } from "lucide-react";
import { useStore } from "../state/store";
import { cx, groupByAge } from "../lib/util";
import type { Thread } from "../types";
import { PrismLogo } from "./PrismLogo";

const ORDER = ["Today", "Previous 7 days", "Previous 30 days", "Older"];

/** `docked`: shown in the layout on md+ screens; otherwise it is an overlay opened from the header. */
export function Sidebar({ open, onClose, docked }: { open: boolean; onClose: () => void; docked: boolean }) {
  const { state, newChat, openThread, toggleDark, resetDemo } = useStore();
  const [armReset, setArmReset] = useState(false);
  const groups = new Map<string, Thread[]>();
  [...state.threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((t) => {
      const g = groupByAge(t.updatedAt);
      groups.set(g, [...(groups.get(g) ?? []), t]);
    });

  return (
    <>
      {open && <div className={cx("fixed inset-0 z-30 bg-black/30", docked && "md:hidden")} onClick={onClose} />}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col border-r border-slate-200 bg-[#fbfbfd] transition-transform",
          docked && "md:static md:z-auto md:translate-x-0",
          "dark:border-white/10 dark:bg-[#130f1d]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <PrismLogo className="h-5 w-5" />
          <div className="leading-tight">
            <div className="text-[15px] text-slate-900 dark:text-white">
              <span className="font-semibold">Prism</span> Layer
            </div>
            <div className="text-xs text-slate-500">Grounded answers · citations</div>
          </div>
          <button
            className={cx("ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5", docked && "md:hidden")}
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-fuchsia-300/70 to-transparent" />

        <div className="px-3 pt-4">
          <button
            onClick={() => {
              newChat();
              onClose();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-prism-gradient py-2.5 text-[15px] font-medium text-white shadow-sm transition hover:brightness-105 active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" /> New chat
          </button>
        </div>

        <nav className="scroll-thin mt-4 flex-1 overflow-y-auto px-2 pb-4">
          {ORDER.filter((g) => groups.has(g)).map((g) => (
            <div key={g} className="mb-4">
              <div className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">{g}</div>
              {groups.get(g)!.map((t) => {
                const active = t.id === state.activeId;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      openThread(t.id);
                      onClose();
                    }}
                    className={cx(
                      "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] transition",
                      active
                        ? "bg-prism-100/70 text-slate-900 dark:bg-prism-500/15 dark:text-white"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5",
                    )}
                    title={t.title}
                  >
                    <MessageSquare className={cx("h-4 w-4 shrink-0", active ? "text-prism-600 dark:text-prism-300" : "text-slate-400")} />
                    <span className="truncate">{t.title}</span>
                    {t.jobIds.length > 0 && (
                      <span className="ml-auto shrink-0 rounded bg-cyan-50 px-1.5 text-[10px] font-medium text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300">
                        {t.jobIds.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 px-3 py-3 dark:border-white/10">
          <SideLink icon={<AppWindow className="h-4 w-4" />} label="Switch workspace" />
          <SideLink icon={<SlidersHorizontal className="h-4 w-4" />} label="Admin settings" />
          <SideLink
            icon={<RotateCcw className="h-4 w-4" />}
            label={armReset ? "Click again to reset everything" : "Reset demo data"}
            onClick={() => {
              // Two-step confirm in the page itself (confirm() is blocked in some hosts).
              if (armReset) {
                resetDemo();
                setArmReset(false);
              } else {
                setArmReset(true);
                setTimeout(() => setArmReset(false), 4000);
              }
            }}
          />
          <div className="mt-2 flex items-center gap-2.5 px-2 py-1.5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#8a6a5c] text-sm font-medium text-white">N</div>
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Nachiket Agarkar</span>
            <ChevronDown className="h-4 w-4 text-slate-400" />
            <button onClick={toggleDark} className="ml-auto rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5" aria-label="Toggle theme">
              {state.dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function SideLink({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
    >
      <span className="text-slate-500">{icon}</span>
      {label}
    </button>
  );
}
