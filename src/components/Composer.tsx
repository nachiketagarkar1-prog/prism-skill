import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, FileText, MessageCircle, Paperclip, Presentation, Wand2, X } from "lucide-react";
import type { ComposerMode } from "../types";
import { useStore } from "../state/store";
import { describeIntent, detectIntent } from "../lib/intent";
import { cx } from "../lib/util";

const MODES: { id: ComposerMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "auto", label: "Auto", icon: <Wand2 className="h-3.5 w-3.5" />, hint: "Detect from the message" },
  { id: "answer", label: "Answer", icon: <MessageCircle className="h-3.5 w-3.5" />, hint: "Grounded answer with citations" },
  { id: "report", label: "Report", icon: <FileText className="h-3.5 w-3.5" />, hint: "GVR Report Builder: PDF + report studio" },
  { id: "deck", label: "Presentation", icon: <Presentation className="h-3.5 w-3.5" />, hint: "GVR Presentation Builder: PPTX + presentation studio" },
];

export function Composer({
  draft,
  setDraft,
  mode,
  setMode,
}: {
  draft: string;
  setDraft: (s: string) => void;
  mode: ComposerMode;
  setMode: (m: ComposerMode) => void;
}) {
  const { send, busy, activeThread, state } = useStore();
  const [uploads, setUploads] = useState<string[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasJob = !!activeThread?.jobIds.some((id) => state.jobs[id]);
  const intent = useMemo(() => (draft.trim() ? detectIntent(draft, mode, hasJob) : null), [draft, mode, hasJob]);
  const hint = intent ? describeIntent(intent) : null;

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [draft]);

  useEffect(() => {
    taRef.current?.focus();
  }, [activeThread?.id]);

  const submit = () => {
    if (!draft.trim() || busy) return;
    send(draft, mode, uploads);
    setDraft("");
    setUploads([]);
    setMode("auto");
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 pb-3 md:px-8">
      {/* Mode + intent hint */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div
          className="flex rounded-full border border-slate-200 bg-white p-0.5 text-xs shadow-sm dark:border-white/10 dark:bg-white/5"
          role="radiogroup"
          aria-label="Output"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              title={m.hint}
              onClick={() => setMode(m.id)}
              className={cx(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition",
                mode === m.id ? "bg-prism-gradient text-white shadow-sm" : "text-slate-500 hover:text-slate-800 dark:hover:text-white",
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
        {hint && (
          <span className="flex items-center gap-1.5 rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300">
            <Wand2 className="h-3.5 w-3.5" /> {intent?.action === "change" ? "Will update" : intent?.action === "export" ? "Will attach" : "Will build"}: {hint}
            {intent?.action === "export" && " · no new version"}
          </span>
        )}
        {!hint && intent?.action === "question" && (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-white/5">
            Will answer from the latest output · no new version
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-composer dark:border-white/10 dark:bg-[#17121f]">
        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {uploads.map((u) => (
              <span key={u} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                <Paperclip className="h-3 w-3" /> {u}
                <button onClick={() => setUploads(uploads.filter((x) => x !== u))} aria-label={`Remove ${u}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 py-2 pl-2 pr-2.5">
          <button
            onClick={() => fileRef.current?.click()}
            className="mb-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5"
            title="Attach files (PDF, Excel, PPT, Word)"
            aria-label="Attach files"
          >
            <Paperclip className="h-[18px] w-[18px]" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.xlsx,.xls,.csv,.pptx,.docx,.txt,.md"
            onChange={(e) => {
              const names = Array.from(e.target.files ?? []).map((f) => f.name);
              setUploads((u) => [...new Set([...u, ...names])]);
              e.target.value = "";
            }}
          />
          <textarea
            ref={taRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask Prism Layer — market size, players, regulation, trends..."
            className="max-h-[200px] flex-1 resize-none bg-transparent py-2.5 text-[16px] text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          <button
            onClick={submit}
            disabled={!draft.trim() || busy}
            className="mb-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#a78bfa] to-[#7dd3fc] text-white shadow transition enabled:hover:brightness-105 disabled:opacity-50"
            aria-label="Send"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">Enter to send · Shift+Enter for newline · Esc to stop · ⌘N new chat</p>
    </div>
  );
}
