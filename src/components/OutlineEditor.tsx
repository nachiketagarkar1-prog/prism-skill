import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardPaste, GripVertical, ListPlus, Plus, RotateCcw, Sparkles, Trash2, Undo2 } from "lucide-react";
import type { Job, OutlineChapter, OutlineSection } from "../types";
import { SKILL_NOUN } from "../types";
import { api } from "../api/mockApi";
import { useStore } from "../state/store";
import { describeOutlineChanges, matchToGvr, parseToc } from "../lib/outline";
import { nextVersion } from "../lib/answers";
import { cx, uid } from "../lib/util";

type Drag = { ci: number; si?: number } | null;

/**
 * The client's table of contents. Starts from the current version's outline (the GVR one for a first build);
 * chapters and sections can be renamed, reordered (drag or arrows), removed, added, or replaced by a pasted TOC.
 * GVR sections keep their figures and text; new ones carry a research brief and are highlighted in the output.
 */
export function OutlineEditor({ job, version }: { job: Job; version: string }) {
  const { applyOutline } = useStore();
  const [base, setBase] = useState<OutlineChapter[] | null>(null);
  const [gvr, setGvr] = useState<OutlineChapter[]>([]); // everything the GVR report covers (for matching and "Add GVR section")
  const [standard, setStandard] = useState<OutlineChapter[]>([]);
  const [o, setO] = useState<OutlineChapter[]>([]);
  const [history, setHistory] = useState<OutlineChapter[][]>([]);
  const [paste, setPaste] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const isDeck = job.skill === "deck";
  const latest = job.versions[job.versions.length - 1].version;

  useEffect(() => {
    let live = true;
    setBase(null);
    Promise.all([api.getOutline(job.id, version), api.getGvrOutline(job.id)]).then(([cur, g]) => {
      if (!live) return;
      setBase(cur);
      setO(cur);
      setGvr(g.library);
      setStandard(g.standard);
      setHistory([]);
    });
    return () => {
      live = false;
    };
  }, [job.id, version]);

  const changes = useMemo(() => (base ? describeOutlineChanges(base, o) : []), [base, o]);
  const unused = useMemo(() => {
    const inUse = new Set(o.flatMap((c) => c.sections.map((s) => s.ref && `${s.ref.src}#${s.ref.path.join(".")}`)));
    return gvr
      .map((c) => ({ ...c, sections: c.sections.filter((s) => s.ref && !inUse.has(`${s.ref.src}#${s.ref.path.join(".")}`)) }))
      .filter((c) => c.sections.length);
  }, [gvr, o]);

  if (!base) return <div className="p-6 text-sm text-slate-500">Loading the table of contents…</div>;

  const edit = (fn: (draft: OutlineChapter[]) => void) => {
    setHistory((h) => [...h.slice(-30), o]);
    const draft = o.map((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s })) }));
    fn(draft);
    setO(draft.filter((c) => c.title.trim() || c.sections.length));
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setO(prev);
    setHistory((h) => h.slice(0, -1));
  };
  const moveCh = (from: number, to: number) =>
    edit((d) => {
      if (to < 0 || to >= d.length) return;
      const [c] = d.splice(from, 1);
      d.splice(to, 0, c);
    });
  const moveSec = (ci: number, si: number, toCi: number, toSi: number) =>
    edit((d) => {
      const [s] = d[ci].sections.splice(si, 1);
      d[toCi].sections.splice(Math.max(0, Math.min(d[toCi].sections.length, toSi)), 0, s);
    });
  const addChapter = () => {
    const id = uid();
    edit((d) => d.push({ id, title: "New chapter", sections: [{ id: uid(), title: "New section" }] }));
    setFocusId(id);
  };
  const addSection = (ci: number) => {
    const id = uid();
    edit((d) => d[ci].sections.push({ id, title: "New section" }));
    setFocusId(id);
  };
  const applyPaste = () => {
    if (!paste?.trim()) return;
    const parsed = matchToGvr(parseToc(paste), gvr);
    if (!parsed.length) return;
    edit((d) => d.splice(0, d.length, ...parsed));
    setPaste(null);
  };
  const onDrop = (target: { ci: number; si?: number }) => {
    if (!drag) return;
    if (drag.si === undefined && target.si === undefined) moveCh(drag.ci, target.ci);
    else if (drag.si !== undefined) moveSec(drag.ci, drag.si, target.ci, target.si ?? o[target.ci].sections.length);
    setDrag(null);
  };

  const newCount = o.reduce((n, c) => n + c.sections.filter((s) => !s.ref).length + (c.sections.length ? 0 : 1), 0);
  const next = nextVersion(latest);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#120e1a]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 dark:border-white/5">
        <div className="mr-auto min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{isDeck ? "Slide outline" : "Table of contents"}</h3>
          <p className="text-xs text-slate-500">
            Make it the client's: rename, reorder, remove or add. <Legend kind="gvr" /> keeps its figures; <Legend kind="new" /> is researched and highlighted.
          </p>
        </div>
        <ToolBtn onClick={() => setPaste(paste === null ? "" : null)} active={paste !== null} icon={<ClipboardPaste className="h-3.5 w-3.5" />}>
          Paste client TOC
        </ToolBtn>
        {!isDeck && unused.length > 0 && (
          <ToolBtn onClick={() => setLibrary(!library)} active={library} icon={<ListPlus className="h-3.5 w-3.5" />}>
            Add GVR section
          </ToolBtn>
        )}
        <ToolBtn onClick={undo} disabled={!history.length} icon={<Undo2 className="h-3.5 w-3.5" />}>
          Undo
        </ToolBtn>
        {!isDeck && standard.length > 0 && (
          <ToolBtn onClick={() => edit((d) => d.splice(0, d.length, ...standard.map((c) => ({ ...c, id: uid(), sections: c.sections.map((s) => ({ ...s, id: uid() })) }))))} icon={<RotateCcw className="h-3.5 w-3.5" />}>
            GVR standard
          </ToolBtn>
        )}
      </div>

      {paste !== null && (
        <div className="border-b border-slate-100 bg-prism-50/40 px-5 py-3 dark:border-white/5 dark:bg-prism-500/5">
          <label htmlFor="toc-paste" className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Paste the client's table of contents: one chapter per line, sections indented or numbered (1.1, 1.2). Titles that match a GVR section keep its content.
          </label>
          <textarea
            id="toc-paste"
            autoFocus
            rows={6}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"1. Executive Summary\n2. Market Size and Forecast\n   2.1 Global Market\n   2.2 By Product\n3. Pricing and Reimbursement\n4. Competitive Landscape\n5. Recommendations"}
            className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs text-slate-800 outline-none focus:border-prism-400 dark:border-white/15 dark:bg-white/5 dark:text-slate-100"
          />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={applyPaste} disabled={!paste.trim()} className="rounded-lg bg-prism-gradient px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              Use this table of contents
            </button>
            <button onClick={() => setPaste(null)} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5">
              Cancel
            </button>
            <span className="text-xs text-slate-500">Nothing is rebuilt until you create the next version.</span>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Outline */}
        <ol className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          {o.map((c, ci) => (
            <li
              key={c.id}
              className={cx(
                "rounded-xl border bg-white dark:bg-white/[0.02]",
                drag && drag.si === undefined && drag.ci !== ci ? "border-dashed border-prism-300" : "border-slate-200 dark:border-white/10",
              )}
              onDragOver={(e) => drag && e.preventDefault()}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop({ ci });
              }}
            >
              <Row
                level={0}
                num={`${ci + 1}`}
                title={c.title}
                autoFocus={focusId === c.id}
                isNew={!c.ref && c.sections.every((s) => !s.ref)}
                onTitle={(t) => edit((d) => void (d[ci].title = t))}
                onUp={ci > 0 ? () => moveCh(ci, ci - 1) : undefined}
                onDown={ci < o.length - 1 ? () => moveCh(ci, ci + 1) : undefined}
                onRemove={o.length > 1 ? () => edit((d) => void d.splice(ci, 1)) : undefined}
                onDragStart={() => setDrag({ ci })}
                onDragEnd={() => setDrag(null)}
                label={isDeck ? "Slide" : "Chapter"}
              />
              {c.sections.length > 0 && (
                <ol className="border-t border-slate-100 py-1 dark:border-white/5">
                  {c.sections.map((s, si) => (
                    <SectionRow
                      key={s.id}
                      s={s}
                      num={`${ci + 1}.${si + 1}`}
                      autoFocus={focusId === s.id}
                      onTitle={(t) => edit((d) => void (d[ci].sections[si].title = t))}
                      onNotes={(t) => edit((d) => void (d[ci].sections[si].notes = t))}
                      onUp={si > 0 ? () => moveSec(ci, si, ci, si - 1) : ci > 0 ? () => moveSec(ci, si, ci - 1, o[ci - 1].sections.length) : undefined}
                      onDown={
                        si < c.sections.length - 1 ? () => moveSec(ci, si, ci, si + 1) : ci < o.length - 1 ? () => moveSec(ci, si, ci + 1, 0) : undefined
                      }
                      onRemove={() =>
                        edit((d) => {
                          d[ci].sections.splice(si, 1);
                          if (!d[ci].sections.length) d.splice(ci, 1);
                        })
                      }
                      onDragStart={() => setDrag({ ci, si })}
                      onDragEnd={() => setDrag(null)}
                      onDrop={() => onDrop({ ci, si })}
                      dragging={!!drag && drag.si !== undefined}
                    />
                  ))}
                </ol>
              )}
              {!isDeck && (
                <button
                  onClick={() => addSection(ci)}
                  className="mb-2 ml-[52px] flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-prism-700 dark:hover:bg-white/5 dark:hover:text-prism-200"
                >
                  <Plus className="h-3.5 w-3.5" /> Add section
                </button>
              )}
            </li>
          ))}
          <li>
            <button
              onClick={addChapter}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:border-prism-400 hover:text-prism-700 dark:border-white/15 dark:text-slate-300"
            >
              <Plus className="h-4 w-4" /> Add {isDeck ? "slide" : "chapter"}
            </button>
          </li>
        </ol>

        {/* GVR sections not in the outline: add back with their content */}
        {library && (
          <aside className="scroll-thin w-64 shrink-0 overflow-y-auto border-l border-slate-100 bg-slate-50/60 p-3 dark:border-white/5 dark:bg-white/[0.02]">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">From the GVR report</div>
            {unused.map((c) => (
              <div key={c.id} className="mb-3">
                <div className="mb-1 text-xs font-medium text-slate-700 dark:text-slate-200">{c.title}</div>
                {c.sections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      edit((d) => {
                        const ci = Math.max(0, d.length - 1);
                        d[ci].sections.push({ ...s, id: uid() });
                      })
                    }
                    title="Add to the last chapter; drag it where you want"
                    className="mb-1 flex w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs text-slate-700 hover:border-prism-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                  >
                    <Plus className="h-3 w-3 shrink-0 text-prism-500" />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">{s.holds?.slice(0, 2).join(" · ")}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-3 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="min-w-0 flex-1 text-xs text-slate-600 dark:text-slate-300">
          {changes.length ? (
            <>
              <span className="font-semibold text-slate-800 dark:text-white">Changes:</span> {changes.join("; ")}.
              {newCount > 0 && (
                <span className="ml-1 text-amber-700 dark:text-amber-300">
                  {newCount} new {newCount === 1 ? "section is" : "sections are"} researched and highlighted as not from the GVR report.
                </span>
              )}
            </>
          ) : (
            <>
              {o.length} {isDeck ? "slides" : `chapters · ${o.reduce((n, c) => n + c.sections.length, 0)} sections`}. Edit anything, then create{" "}
              {next}. {version !== latest && `You're viewing ${version}; this outline becomes ${next}.`}
            </>
          )}
        </div>
        <button
          onClick={() => {
            setO(base);
            setHistory([]);
          }}
          disabled={!changes.length}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/5"
        >
          Discard
        </button>
        <button
          onClick={() => applyOutline(job.id, base, o)}
          disabled={!changes.length}
          className="flex items-center gap-1.5 rounded-lg bg-prism-gradient px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
        >
          <Sparkles className="h-3.5 w-3.5" /> Create {next}
        </button>
      </div>
      {isDeck && (
        <div className="border-t border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
          Re-planning a {SKILL_NOUN.deck} to a new outline runs the PowerPoint renderer on the server; this prototype will tell you it can't render it here.
        </div>
      )}
    </div>
  );
}

function Legend({ kind }: { kind: "gvr" | "new" }) {
  return kind === "gvr" ? (
    <span className="rounded bg-prism-50 px-1 py-px text-[11px] font-medium text-prism-700 dark:bg-prism-500/15 dark:text-prism-200">GVR</span>
  ) : (
    <span className="rounded bg-amber-100 px-1 py-px text-[11px] font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">New</span>
  );
}

function ToolBtn({
  onClick,
  icon,
  children,
  active,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40",
        active
          ? "border-prism-400 bg-prism-50 text-prism-800 dark:bg-prism-500/15 dark:text-prism-100"
          : "border-slate-200 text-slate-600 hover:border-prism-300 dark:border-white/10 dark:text-slate-300",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

interface RowProps {
  level: 0 | 1;
  num: string;
  title: string;
  isNew: boolean;
  holds?: string[];
  autoFocus?: boolean;
  label?: string;
  onTitle: (t: string) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function Row({ level, num, title, isNew, holds, autoFocus, label = "Section", onTitle, onUp, onDown, onRemove, onDragStart, onDragEnd }: RowProps) {
  return (
    <div className={cx("group flex items-center gap-1.5 pr-2", level === 0 ? "py-2 pl-2" : "py-1 pl-7")}>
      <span
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className="cursor-grab text-slate-300 hover:text-slate-500 dark:text-slate-600"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <span className={cx("w-7 shrink-0 text-xs tabular-nums", level === 0 ? "font-semibold text-prism-600 dark:text-prism-300" : "text-slate-400")}>{num}</span>
      <input
        aria-label={`${label} ${num} title`}
        value={title}
        autoFocus={autoFocus}
        onFocus={(e) => autoFocus && e.target.select()}
        onChange={(e) => onTitle(e.target.value)}
        className={cx(
          "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 outline-none hover:border-slate-200 focus:border-prism-400 focus:bg-white dark:hover:border-white/10 dark:focus:bg-white/5",
          level === 0 ? "text-[14px] font-semibold text-slate-900 dark:text-white" : "text-[13px] text-slate-700 dark:text-slate-200",
        )}
      />
      {isNew ? (
        <Legend kind="new" />
      ) : holds?.length ? (
        <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">{holds.slice(0, 3).join(" · ")}</span>
      ) : level === 0 ? (
        <Legend kind="gvr" />
      ) : null}
      <span className="flex shrink-0 opacity-40 transition group-focus-within:opacity-100 group-hover:opacity-100">
        <Icon label={`Move ${title} up`} onClick={onUp}>
          <ArrowUp className="h-3.5 w-3.5" />
        </Icon>
        <Icon label={`Move ${title} down`} onClick={onDown}>
          <ArrowDown className="h-3.5 w-3.5" />
        </Icon>
        <Icon label={`Remove ${title}`} onClick={onRemove} danger>
          <Trash2 className="h-3.5 w-3.5" />
        </Icon>
      </span>
    </div>
  );
}

function SectionRow({
  s,
  num,
  autoFocus,
  onTitle,
  onNotes,
  onUp,
  onDown,
  onRemove,
  onDragStart,
  onDragEnd,
  onDrop,
  dragging,
}: {
  s: OutlineSection;
  num: string;
  autoFocus: boolean;
  onTitle: (t: string) => void;
  onNotes: (t: string) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  dragging: boolean;
}) {
  return (
    <li
      onDragOver={(e) => dragging && e.preventDefault()}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop();
      }}
      className={cx(dragging && "border-t-2 border-transparent hover:border-prism-300")}
    >
      <Row
        level={1}
        num={num}
        title={s.title}
        isNew={!s.ref}
        holds={s.holds}
        autoFocus={autoFocus}
        onTitle={onTitle}
        onUp={onUp}
        onDown={onDown}
        onRemove={onRemove}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      {!s.ref && (
        <div className="pb-1.5 pl-[76px] pr-3">
          <textarea
            aria-label={`What should ${s.title} research?`}
            rows={1}
            value={s.notes ?? ""}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Research brief (optional): what should this section answer?"
            className="w-full resize-y rounded-md border border-amber-200 bg-amber-50/50 px-2 py-1 text-xs text-slate-700 outline-none placeholder:text-amber-700/50 focus:border-amber-400 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-slate-200"
          />
        </div>
      )}
    </li>
  );
}

function Icon({ label, onClick, children, danger }: { label: string; onClick?: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-label={label}
      title={label}
      className={cx(
        "grid h-7 w-7 place-items-center rounded-md text-slate-500 disabled:invisible",
        danger ? "hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-400/10" : "hover:bg-slate-100 dark:hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}
