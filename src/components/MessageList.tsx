import { useEffect, useRef } from "react";
import { Paperclip } from "lucide-react";
import type { Thread } from "../types";
import { AssistantAvatar } from "./PrismLogo";
import { Markdown } from "./Markdown";
import { BuildCard, ExcelCard } from "./BuildCard";
import { BriefForm } from "./BriefForm";
import { ReviewCard } from "./ReviewCard";
import { useStore } from "../state/store";
import { cx } from "../lib/util";

/** `outdent`: hang the assistant avatar in the left gutter (wide layouts only). */
export function MessageList({ thread, outdent }: { thread: Thread; outdent: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = thread.messages[thread.messages.length - 1];
  const lastSig = `${thread.messages.length}:${last?.build?.status}:${last?.text?.length ?? 0}`;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.id, lastSig]);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 pb-10 pt-7 md:px-8">
      {thread.messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="mb-8 flex flex-col items-end">
            <div className="max-w-[80%] rounded-2xl border border-prism-200/70 bg-gradient-to-r from-prism-100 to-[#e9e3ff] px-5 py-3 text-[16px] text-slate-800 dark:border-prism-400/20 dark:from-prism-500/20 dark:to-prism-500/10 dark:text-slate-100">
              {m.text}
            </div>
            {m.uploads && (
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                {m.uploads.map((u) => (
                  <span
                    key={u}
                    className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300"
                  >
                    <Paperclip className="h-3 w-3" /> {u}
                  </span>
                ))}
              </div>
            )}
            {thread.certified && <div className="mt-1.5 text-xs text-slate-400">GVR-certified</div>}
          </div>
        ) : (
          <div key={m.id} className={cx("mb-10 flex gap-4", outdent && "xl:-ml-14")}>
            <AssistantAvatar />
            <div className="min-w-0 flex-1 pt-1">
              {m.build ? (
                <BuildCard build={m.build} threadId={thread.id} />
              ) : m.text ? (
                <>
                  <Markdown text={m.text} />
                  {m.intake && <BriefForm threadId={thread.id} msgId={m.id} intake={m.intake} />}
                  {m.review && <ReviewCard threadId={thread.id} msgId={m.id} review={m.review} />}
                  {m.attachment && <Attachment {...m.attachment} />}
                  {m.footnote && <div className="mt-2 text-xs text-slate-400">{m.footnote}</div>}
                </>
              ) : (
                <Typing />
              )}
            </div>
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function Attachment({ jobId, version }: { jobId: string; version: string }) {
  const { state, openPanel } = useStore();
  const file = state.jobs[jobId]?.versions.find((v) => v.version === version)?.files.find((f) => f.kind === "xlsx");
  if (!file) return null;
  return (
    <div className="mt-3 max-w-[380px]">
      <ExcelCard file={file} onOpen={() => openPanel(jobId, version, "excel")} />
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-1.5 pt-3" aria-label="Prism is thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-prism-400" style={{ animationDelay: `${i * 140}ms` }} />
      ))}
    </div>
  );
}
