import { useEffect, useState } from "react";
import type { ComposerMode } from "./types";
import { useStore } from "./state/store";
import { Sidebar } from "./components/Sidebar";
import { ChatHeader } from "./components/ChatHeader";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { OutputPanel } from "./components/OutputPanel";
import { cx } from "./lib/util";

export default function App() {
  const { activeThread, state, newChat } = useStore();
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ComposerMode>("auto");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // With an output open, chat narrows to a side column so the document gets the room; it can be hidden entirely.
  const [chatHidden, setChatHidden] = useState(false);
  const work = !!state.panel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} docked={!state.panel} />
      <main
        className={cx(
          "chat-bg flex min-w-0 flex-col",
          work ? cx("flex-1 lg:w-[380px] lg:flex-none lg:border-r lg:border-slate-200 xl:w-[420px] dark:lg:border-white/10", chatHidden && "lg:hidden", "compact-chat") : "flex-1",
        )}
      >
        <ChatHeader onMenu={() => setSidebarOpen(true)} menuAlways={work} compact={work} />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {activeThread && activeThread.messages.length ? (
            <MessageList thread={activeThread} outdent={!work} compact={work} />
          ) : (
            <EmptyState
              mode={mode}
              setMode={setMode}
              onPick={(t, m) => {
                setDraft(t);
                setMode(m);
                requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("main textarea")?.focus());
              }}
            />
          )}
        </div>
        <Composer draft={draft} setDraft={setDraft} mode={mode} setMode={setMode} showModes={!!activeThread?.messages.length} compact={work} />
      </main>
      {state.panel && <OutputPanel panel={state.panel} chatHidden={chatHidden} onToggleChat={() => setChatHidden(!chatHidden)} />}
    </div>
  );
}
