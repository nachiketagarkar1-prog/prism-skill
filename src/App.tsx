import { useEffect, useState } from "react";
import type { ComposerMode } from "./types";
import { useStore } from "./state/store";
import { Sidebar } from "./components/Sidebar";
import { ChatHeader } from "./components/ChatHeader";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { OutputPanel } from "./components/OutputPanel";

export default function App() {
  const { activeThread, state, newChat } = useStore();
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ComposerMode>("auto");
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      <main className="chat-bg flex min-w-0 flex-1 flex-col">
        <ChatHeader onMenu={() => setSidebarOpen(true)} menuAlways={!!state.panel} />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {activeThread && activeThread.messages.length ? (
            <MessageList thread={activeThread} outdent={!state.panel} />
          ) : (
            <EmptyState
              onPick={(t, m) => {
                setDraft(t);
                setMode(m);
                requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("main textarea")?.focus());
              }}
            />
          )}
        </div>
        <Composer draft={draft} setDraft={setDraft} mode={mode} setMode={setMode} />
      </main>
      {state.panel && <OutputPanel panel={state.panel} />}
    </div>
  );
}
