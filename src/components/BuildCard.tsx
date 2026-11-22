import { AlertTriangle, Check, Download, ExternalLink, FileSpreadsheet, FileText, Loader2, MonitorPlay, Presentation, Sparkles } from "lucide-react";
import { SKILL_NOUN, type Brief, type BuildState, type OutputFile } from "../types";
import { useStore } from "../state/store";
import { cx, formatBytes } from "../lib/util";

const SKILL_NAME = { report: "GVR Report Builder", deck: "GVR Presentation Builder" } as const;

export function BuildCard({ build }: { build: BuildState }) {
  const { state, openPanel } = useStore();
  const job = build.jobId ? state.jobs[build.jobId] : undefined;
  const version = job?.versions.find((v) => v.version === build.version);
  const done = build.stages.filter((s) => s.status === "done").length;
  const pct = Math.round((done / build.stages.length) * 100);
  const { brief } = build;
  const Icon = brief.skill === "deck" ? Presentation : FileText;
  const heading =
    build.status === "done"
      ? `${brief.typeLabel} ${SKILL_NOUN[brief.skill]}${build.kind === "create" ? "" : " updated"}`
      : build.status === "conflict" || (build.status === "not_built" && build.kind === "edit-plan")
        ? "Edit plan not applied"
        : build.status === "not_built"
          ? `${brief.typeLabel} ${SKILL_NOUN[brief.skill]} not built`
          : build.kind === "create"
            ? `Building your ${brief.typeLabel} ${SKILL_NOUN[brief.skill]}`
            : build.kind === "edit-plan"
              ? "Applying your studio edit plan"
              : `Updating the ${brief.typeLabel} ${SKILL_NOUN[brief.skill]}`;

  return (
    <div className="w-full max-w-[760px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-white/5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-gvr-purple to-[#6d2a91] text-white">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-prism-600 dark:text-prism-300">{SKILL_NAME[brief.skill]}</div>
          <div className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{heading}</div>
        </div>
        <div className="ml-auto shrink-0">
          {build.status === "running" && (
            <span className="flex items-center gap-1.5 rounded-full bg-prism-50 px-2.5 py-1 text-xs font-medium text-prism-700 dark:bg-prism-500/10 dark:text-prism-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {pct}%
            </span>
          )}
          {build.status === "done" && build.version && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
              {build.version} delivered
            </span>
          )}
          {build.status === "conflict" && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
              Version conflict
            </span>
          )}
          {build.status === "not_built" && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">Not built</span>
          )}
          {build.status === "error" && (
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-400/10 dark:text-rose-300">Stopped</span>
          )}
        </div>
      </div>

      {/* Brief chips */}
      <div className="flex flex-wrap gap-1.5 px-5 pt-3.5 text-xs">
        <Chip label="Type" value={brief.typeLabel} />
        <Chip label="Market" value={brief.market} />
        <Chip label="Geography" value={brief.region} />
        <Chip label="Forecast" value={brief.forecast} />
        {brief.length && <Chip label="Length" value={brief.length} />}
        {brief.client && <Chip label="Prepared for" value={brief.client} />}
      </div>
      {brief.sources && <div className="px-5 pt-2 text-xs text-slate-500">Sources: {sourceList(brief).join(" · ")}</div>}

      {/* Stages */}
      {build.status === "running" || build.status === "error" ? (
        <div className="px-5 py-4">
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
            <div className="h-full rounded-full bg-prism-gradient transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <ol className="space-y-1">
            {build.stages.map((s) => (
              <li key={s.key} className={cx("flex items-start gap-3 rounded-lg px-2 py-1.5", s.status === "running" && "shimmer")}>
                <span className="mt-0.5">
                  {s.status === "done" ? (
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  ) : s.status === "running" ? (
                    <Loader2 className="h-5 w-5 animate-spin text-prism-500" />
                  ) : (
                    <span className="block h-5 w-5 rounded-full border-2 border-slate-200 dark:border-white/15" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className={cx("text-sm", s.status === "pending" ? "text-slate-400" : "font-medium text-slate-800 dark:text-slate-100")}>{s.label}</div>
                  {s.status !== "pending" && <div className="text-xs text-slate-500">{s.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {build.status === "conflict" && (
        <div className="mx-5 mb-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{build.error}</p>
            {build.jobId && build.version && (
              <button onClick={() => openPanel(build.jobId!, build.version, "studio")} className="mt-2 font-semibold underline underline-offset-4">
                Reload the {build.version} studio
              </button>
            )}
          </div>
        </div>
      )}
      {build.status === "error" && <div className="mx-5 mb-4 text-sm text-rose-600">{build.error}</div>}
      {build.status === "not_built" && (
        <div className="mx-5 my-4 flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p>{build.error}</p>
        </div>
      )}

      {/* Delivery */}
      {build.status === "done" && job && version && (
        <div className="space-y-4 px-5 pb-5 pt-3.5">
          {build.note && (
            <p className="text-[14.5px] leading-relaxed text-slate-700 dark:text-slate-300" dangerouslySetInnerHTML={{ __html: mdInline(build.note) }} />
          )}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3">
            {version.files.map((f) =>
              f.kind === "studio" ? (
                <StudioCard key={f.name} file={f} skill={brief.skill} onOpen={() => openPanel(job.id, version.version, "studio")} />
              ) : f.kind === "xlsx" ? (
                <ExcelCard key={f.name} file={f} onOpen={() => openPanel(job.id, version.version, "excel")} />
              ) : (
                <FileCard key={f.name} file={f} onOpen={() => openPanel(job.id, version.version, "file")} />
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Human list of the evidence a brief allows, in the skills' order of precedence. */
export function sourceList(b: Pick<Brief, "sources" | "files" | "urls">): string[] {
  const s = b.sources;
  if (!s) return [];
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return [
    s.gvr && "GVR report",
    s.client && (b.files?.length ? n(b.files.length, "client document", "client documents") : "Client documents"),
    s.urls && (b.urls?.length ? n(b.urls.length, "web page", "web pages") : "Web pages"),
    s.whitelist && "Whitelisted sources",
    s.web && "Web research (cited)",
  ].filter(Boolean) as string[];
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
      <span className="text-slate-400">{label}</span> {value}
    </span>
  );
}

export function ExcelCard({ file, onOpen }: { file: OutputFile; onOpen: () => void }) {
  return (
    <div className="group flex overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-emerald-400 hover:shadow-md dark:border-white/10 dark:bg-white/[0.02]">
      <button
        onClick={onOpen}
        className="grid w-[78px] shrink-0 place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"
        aria-label={`Preview ${file.name}`}
      >
        <FileSpreadsheet className="h-8 w-8" strokeWidth={1.5} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">XLSX</span>
          <span className="text-[11px] text-slate-400">
            {file.sheets} sheets · {formatBytes(file.bytes)}
          </span>
        </div>
        <button
          onClick={onOpen}
          className="mt-1 truncate text-left text-[13px] font-medium text-slate-800 hover:text-emerald-700 dark:text-slate-100"
          title={file.name}
        >
          {file.name}
        </button>
        <div className="text-[11px] text-slate-500">Tables, charts and KPIs</div>
        <div className="mt-auto flex gap-3 pt-2 text-xs font-medium">
          <button onClick={onOpen} className="flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-300">
            <ExternalLink className="h-3.5 w-3.5" /> Preview
          </button>
          <a href={file.url} download={file.name} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:hover:text-white">
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        </div>
      </div>
    </div>
  );
}

export function FileCard({ file, onOpen }: { file: OutputFile; onOpen: () => void }) {
  const isPdf = file.kind === "pdf";
  return (
    <div className="group flex overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-prism-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.02]">
      <button
        onClick={onOpen}
        className={cx("grid shrink-0 place-items-center overflow-hidden", isPdf ? "w-[78px] bg-slate-100 dark:bg-white/5" : "w-[118px] bg-gvr-purple p-1.5")}
        aria-label={`Open ${file.name}`}
      >
        {file.thumb && (
          <img
            src={file.thumb}
            alt=""
            className={cx(
              "transition group-hover:scale-[1.03]",
              isPdf ? "h-full w-full object-cover object-top" : "aspect-video w-full rounded-sm object-cover",
            )}
          />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <div className="flex items-center gap-1.5">
          <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-bold text-white", isPdf ? "bg-rose-500" : "bg-orange-500")}>
            {isPdf ? "PDF" : "PPTX"}
          </span>
          <span className="text-[11px] text-slate-400">
            {file.pages} {isPdf ? "pages" : "slides"} · {formatBytes(file.bytes)}
          </span>
        </div>
        <button
          onClick={onOpen}
          className="mt-1 truncate text-left text-[13px] font-medium text-slate-800 hover:text-prism-700 dark:text-slate-100"
          title={file.name}
        >
          {file.name}
        </button>
        <div className="mt-auto flex gap-3 pt-2 text-xs font-medium">
          <button onClick={onOpen} className="flex items-center gap-1 text-prism-600 hover:underline dark:text-prism-300">
            <ExternalLink className="h-3.5 w-3.5" /> {isPdf ? "Preview" : "Slides"}
          </button>
          <a href={file.url} download={file.name} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:hover:text-white">
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        </div>
      </div>
    </div>
  );
}

export function StudioCard({ file, skill, onOpen }: { file: OutputFile; skill: "report" | "deck"; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group relative flex overflow-hidden rounded-xl border border-transparent bg-gradient-to-br from-gvr-purple via-[#4b1a6b] to-[#1e6a8f] p-3.5 text-left text-white transition hover:shadow-lg"
    >
      <div className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-cyan-300/20 blur-2xl" />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-cyan-200">
          <MonitorPlay className="h-3.5 w-3.5" /> {skill === "deck" ? "Presentation studio" : "Report studio"}
        </div>
        <div className="mt-1 text-[13px] font-medium leading-snug text-white/95">Ask Prism AI, edit elements and generate chart insights</div>
        <div className="mt-auto flex items-center gap-1.5 pt-2 text-xs font-semibold text-cyan-200 group-hover:text-white">
          <Sparkles className="h-3.5 w-3.5" /> Open studio
        </div>
        <div className="sr-only">{file.name}</div>
      </div>
    </button>
  );
}

/** Minimal inline markdown (bold) for delivery notes. */
function mdInline(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong class='text-slate-900 dark:text-white'>$1</strong>");
}
