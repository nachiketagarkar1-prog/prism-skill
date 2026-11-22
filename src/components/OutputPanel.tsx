import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  History,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Presentation,
  X,
} from "lucide-react";
import { useStore, type PanelState } from "../state/store";
import type { EditPlan, Job, Version } from "../types";
import { sampleByKey } from "../api/catalog";
import { cx, formatBytes } from "../lib/util";
import { ExcelPreview } from "./ExcelPreview";
import { GAP_LABEL } from "../lib/compose";

interface StudioWindow extends Window {
  GVRStudio?: { plan?: () => EditPlan };
  plan?: () => EditPlan;
}

/** Read the edit plan from the embedded studio: report studio exposes GVRStudio.plan(), deck studio a global plan(). */
function readPlan(frame: HTMLIFrameElement | null): EditPlan | null {
  try {
    const w = frame?.contentWindow as StudioWindow | null;
    if (!w) return null;
    if (w.GVRStudio?.plan) return w.GVRStudio.plan();
    if (typeof w.plan === "function") return w.plan();
  } catch (e) {
    console.warn("Could not read studio plan", e);
  }
  return null;
}

const SEND_LABEL = "Send to Prism";

/**
 * Turn the studio's own "Export edit plan" button into "Send to Prism", so the action lives
 * inside the studio. Cloning the node drops the studio's export handler.
 * Working model only: needs a same-origin studio. In production the studio template should
 * ship this button itself and post the plan to the parent (postMessage) or to the backend.
 */
function installSendButton(frame: HTMLIFrameElement | null, onClick: () => void): HTMLButtonElement | null {
  try {
    const doc = frame?.contentDocument;
    const old = doc?.getElementById("exportBtn");
    if (!doc || !old) return null;
    const btn = old.cloneNode(false) as HTMLButtonElement;
    btn.textContent = SEND_LABEL;
    btn.title = "Post this studio's edit plan to Prism; it builds the next version";
    btn.style.background = "linear-gradient(90deg,#7c5cff,#5b8cff 50%,#22d3ee)";
    btn.style.borderColor = "transparent";
    btn.style.color = "#fff";
    btn.addEventListener("click", onClick);
    old.replaceWith(btn);
    return btn;
  } catch (e) {
    console.warn("Could not install Send to Prism in the studio", e);
    return null;
  }
}

/**
 * Report studios render live from their embedded spec (window.SPEC_IN). Load them with the brief applied:
 * the client name only if the user gave one, their decision question, and for studio-edited versions the
 * edited spec. This goes through the skill's own renderer, so nothing is invented.
 */
interface StudioPatch {
  client?: string;
  decision?: string;
  spec?: unknown;
  version: string;
}

/** Amber highlight for "Not from the GVR report" callouts wherever the renderer draws them. */
const GAP_HIGHLIGHT =
  "<style>.prism-gap{border-left-color:#F59E0B!important;background:#FFF4E0!important}.prism-gap .co-label{color:#B45309!important;font-weight:700}</style>" +
  "<script>new MutationObserver(function(){document.querySelectorAll('.co-label').forEach(function(l){" +
  `if(l.textContent.indexOf(${JSON.stringify(GAP_LABEL)})===0&&l.parentElement)l.parentElement.classList.add('prism-gap')})})` +
  ".observe(document.documentElement,{childList:true,subtree:true});</script>";

function patchStudio(html: string, p: StudioPatch): string | null {
  if (!html.includes("<script>window.SPEC_IN=") || !html.includes(";window.META=")) return null;
  const data = JSON.stringify(p).replace(/</g, "\\u003c");
  const fn =
    "function(s){var p=window.__prism;if(p.spec)s=p.spec;s.meta=s.meta||{};s.brief=s.brief||{};" +
    "if(p.client){s.meta.prepared_for=p.client;s.brief.client=p.client}else{delete s.meta.prepared_for;delete s.brief.client}" +
    "if(p.decision)s.brief.question=p.decision;s.meta.version=p.version;return s}";
  return html
    .replace(
      "<script>window.SPEC_IN=",
      `${GAP_HIGHLIGHT}<script>window.__prism=${data};window.__prismPatch=${fn};</script><script>window.SPEC_IN=window.__prismPatch(`,
    )
    .replace(";window.META=", ");window.META=")
    .replace(";window.ASSETS=", ";window.META.version=window.__prism.version;window.ASSETS=");
}

function useStudioDoc(url: string, patch: StudioPatch | null): { srcDoc?: string; loading: boolean } {
  const [doc, setDoc] = useState<{ key: string; html: string } | null>(null);
  const key = patch ? url + JSON.stringify(patch) : "";
  useEffect(() => {
    if (!patch) return;
    let live = true;
    fetch(url)
      .then((r) => r.text())
      .then((html) => {
        const out = patchStudio(html, patch);
        if (live) setDoc({ key, html: out ?? html });
      })
      .catch(() => live && setDoc(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!patch) return { loading: false };
  return doc?.key === key ? { srcDoc: doc.html, loading: false } : { loading: true };
}

export function OutputPanel({ panel }: { panel: PanelState }) {
  const { state, setPanel, sendEditPlan } = useStore();
  const job = state.jobs[panel.jobId];
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [wide, setWide] = useState(false);
  const [notice, setNotice] = useState<{ plan: EditPlan; ops: number } | null>(null);
  const [sending, setSending] = useState(false);
  const sendRef = useRef<() => void>(() => {});
  const studioBtnRef = useRef<HTMLButtonElement | null>(null);

  // Mirror the sending state onto the in-studio button.
  useEffect(() => {
    const btn = studioBtnRef.current;
    if (!btn) return;
    btn.disabled = sending;
    btn.textContent = sending ? "Sending…" : SEND_LABEL;
    btn.style.opacity = sending ? "0.6" : "";
  }, [sending]);

  const jobForPatch = state.jobs[panel.jobId];
  const vForPatch = jobForPatch?.versions.find((v) => v.version === panel.version) ?? jobForPatch?.versions[jobForPatch.versions.length - 1];
  const studioForPatch = vForPatch?.files.find((f) => f.kind === "studio");
  const studioDoc = useStudioDoc(
    studioForPatch?.url ?? "",
    jobForPatch?.skill === "report" && vForPatch
      ? { client: jobForPatch.brief.client, decision: jobForPatch.brief.decision, spec: vForPatch.spec, version: vForPatch.version }
      : null,
  );

  if (!job) return null;

  const version = job.versions.find((v) => v.version === panel.version) ?? job.versions[job.versions.length - 1];
  const latest = job.versions[job.versions.length - 1];
  const isLatest = version.version === latest.version;
  const primary = version.files.find((f) => f.kind === "pdf" || f.kind === "pptx");
  const studio = version.files.find((f) => f.kind === "studio")!;
  // Versions built before the Excel export existed have no xlsx file.
  const excel = version.files.find((f) => f.kind === "xlsx");
  const isDeck = job.skill === "deck";

  const go = (patch: Partial<PanelState>) => setPanel({ ...panel, ...patch });

  const doSend = async (plan: EditPlan) => {
    setNotice(null);
    setSending(true);
    await sendEditPlan(job.id, plan);
    setSending(false);
  };

  const onSend = () => {
    const raw = readPlan(frameRef.current) ?? { skill: `gvr-${job.skill}-builder`, action: "edit", operations: [], comments: [] };
    // The bundled sample studios carry their own embedded version; the platform version is the one open here.
    // Report plans carry the full edited spec (GVRStudio.plan()); keep it so the edits can be applied.
    const plan: EditPlan = { ...raw, base_version: version.version, sample_base_version: raw.base_version };
    const ops = (Array.isArray(plan.operations) ? plan.operations.length : 0) + (Array.isArray(plan.comments) ? plan.comments.length : 0);
    if (ops === 0) setNotice({ plan, ops });
    else void doSend(plan);
  };
  sendRef.current = onSend;

  return (
    <section
      className={cx(
        "fixed inset-0 z-40 flex flex-col border-l border-slate-200 bg-white lg:static lg:z-auto dark:border-white/10 dark:bg-[#120e1a]",
        wide ? "lg:w-[72%]" : "lg:w-[56%]",
        "lg:shrink-0 transition-[width]",
      )}
      aria-label="Output viewer"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-white/10">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gvr-purple text-white">
          {isDeck ? <Presentation className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{job.title}</div>
          <div className="truncate text-xs text-slate-500">
            {version.spec || version.gaps ? `${job.brief.typeLabel}: ${job.brief.region}, ${job.brief.forecast}` : sampleByKey(version.sampleKey).subtitle}
          </div>
        </div>
        <VersionSelect job={job} value={version.version} onChange={(v) => go({ version: v })} />
        <div className="ml-auto flex items-center gap-1">
          <IconBtn label={wide ? "Narrow" : "Widen"} onClick={() => setWide(!wide)} className="hidden lg:grid">
            {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </IconBtn>
          <IconBtn label="Close" onClick={() => setPanel(null)}>
            <X className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-100 px-3 text-[13px] dark:border-white/5">
        <Tab active={panel.tab === "studio"} onClick={() => go({ tab: "studio" })} icon={<MonitorPlay className="h-3.5 w-3.5" />}>
          Studio
        </Tab>
        {primary && (
          <Tab
            active={panel.tab === "file"}
            onClick={() => go({ tab: "file" })}
            icon={isDeck ? <Presentation className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
          >
            {isDeck ? "Slides" : "PDF"}
          </Tab>
        )}
        {excel && (
          <Tab active={panel.tab === "excel"} onClick={() => go({ tab: "excel" })} icon={<FileSpreadsheet className="h-3.5 w-3.5" />}>
            Excel
          </Tab>
        )}
        <Tab active={panel.tab === "versions"} onClick={() => go({ tab: "versions" })} icon={<History className="h-3.5 w-3.5" />}>
          Versions <span className="ml-1 rounded bg-slate-100 px-1.5 text-[11px] dark:bg-white/10">{job.versions.length}</span>
        </Tab>
        <div className="ml-auto flex items-center gap-3 py-2 text-xs">
          {/* A report studio opened on its own would miss the brief applied above, so only offer it for presentations. */}
          {(isDeck || panel.tab !== "studio") && primary && (
            <a
              href={panel.tab === "studio" ? studio.url : primary.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" /> New tab
            </a>
          )}
          {primary && (
            <a href={primary.url} download={primary.name} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:hover:text-white">
              <Download className="h-3.5 w-3.5" /> {isDeck ? "PPTX" : "PDF"}
            </a>
          )}
          {excel && (
            <a href={excel.url} download={excel.name} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:hover:text-white">
              <Download className="h-3.5 w-3.5" /> Excel
            </a>
          )}
        </div>
      </div>

      {!isLatest && (
        <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          You're viewing {version.version}; the latest is {latest.version}. Edits sent from here will be rejected as a version conflict.
          <button className="ml-auto shrink-0 font-semibold underline underline-offset-2" onClick={() => go({ version: latest.version })}>
            Open {latest.version}
          </button>
        </div>
      )}

      {notice && (
        <div className="flex flex-wrap items-center gap-2 bg-prism-50 px-4 py-2 text-xs text-prism-900 dark:bg-prism-500/10 dark:text-prism-100">
          No edits found in the studio yet. Select an element to edit, hide, move or comment on it, then send.
          <span className="ml-auto flex gap-3">
            <button className="font-semibold underline underline-offset-2" onClick={() => void doSend(notice.plan)}>
              Send anyway
            </button>
            <button onClick={() => setNotice(null)}>Dismiss</button>
          </span>
        </div>
      )}

      {/* Body */}
      <div className="relative min-h-0 flex-1 bg-slate-100 dark:bg-black/30">
        {panel.tab === "studio" && studioDoc.loading && <div className="p-5 text-sm text-slate-500">Loading studio…</div>}
        {panel.tab === "studio" && !studioDoc.loading && (
          <iframe
            key={`${studio.url}#${version.version}#${studioDoc.srcDoc ? "doc" : "src"}`}
            ref={frameRef}
            {...(studioDoc.srcDoc ? { srcDoc: studioDoc.srcDoc } : { src: studio.url })}
            title={`${job.title} studio ${version.version}`}
            className="h-full w-full border-0 bg-white"
            onLoad={() => {
              studioBtnRef.current = installSendButton(frameRef.current, () => sendRef.current());
            }}
            // Working model: same origin so "Send to Prism" can read the studio's edit plan.
            // In production, serve studios from an isolated origin and use postMessage instead.
            sandbox="allow-scripts allow-same-origin allow-downloads allow-modals allow-popups allow-forms"
          />
        )}
        {panel.tab === "file" && !isDeck && primary && job.brief.client && (
          <div className="bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
            This prototype's PDF was rendered before your brief, so it has no client name. The studio shows the cover with “Prepared for {job.brief.client}”,
            and the live build prints it in the PDF.
          </div>
        )}
        {panel.tab === "file" && !isDeck && primary && (
          <object key={primary.url} data={primary.url} type="application/pdf" title={primary.name} className="h-full w-full">
            <div className="grid h-full place-items-center p-8 text-center text-sm text-slate-500">
              <div>
                {primary.thumb && <img src={primary.thumb} alt="" className="mx-auto mb-4 w-40 rounded shadow" />}
                This browser can't show PDFs inline.
                <a href={primary.url} target="_blank" rel="noreferrer" className="ml-1 font-semibold text-prism-600 underline">
                  Open {primary.name}
                </a>
              </div>
            </div>
          </object>
        )}
        {panel.tab === "file" && isDeck && primary && <SlidesPreview version={version} />}
        {panel.tab === "excel" && excel && <ExcelPreview file={excel} />}
        {panel.tab === "versions" && <Versions job={job} current={version.version} onOpen={(v) => go({ version: v, tab: "studio" })} />}
      </div>
    </section>
  );
}

function SlidesPreview({ version }: { version: Version }) {
  const entry = sampleByKey(version.sampleKey);
  const f = version.files[0];
  return (
    <div className="scroll-thin h-full overflow-auto p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{f.name}</div>
          <div className="text-xs text-slate-500">
            {f.pages} slides · {formatBytes(f.bytes)} · Native PowerPoint shapes and charts on the GVR master
          </div>
        </div>
        <a
          href={f.url}
          download={f.name}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-prism-400 dark:border-white/15 dark:bg-white/5 dark:text-slate-200"
        >
          <Download className="h-3.5 w-3.5" /> Download PPTX
        </a>
      </div>
      {entry.sheet && (
        <img src={entry.sheet} alt={`${f.name} contact sheet`} className="w-full rounded-lg border border-slate-200 bg-white shadow-sm dark:border-white/10" />
      )}
      <p className="mt-2 text-xs text-slate-500">
        Preview from the QA contact sheet. Open the Studio tab to review slide by slide, edit elements and generate insights.
      </p>
    </div>
  );
}

function Versions({ job, current, onOpen }: { job: Job; current: string; onOpen: (v: string) => void }) {
  return (
    <div className="scroll-thin h-full overflow-auto p-5">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Revision history</h3>
      <p className="mb-4 text-xs text-slate-500">Delivered versions are never overwritten. Each change in chat or the studio adds a version.</p>
      <ol className="relative space-y-3 border-l border-slate-200 pl-5 dark:border-white/10">
        {[...job.versions].reverse().map((v, i) => (
          <li key={v.version} className="relative">
            <span
              className={cx(
                "absolute -left-[27px] top-3 h-3 w-3 rounded-full border-2 border-white dark:border-[#120e1a]",
                i === 0 ? "bg-prism-500" : "bg-slate-300 dark:bg-slate-600",
              )}
            />
            <div
              className={cx(
                "rounded-xl border bg-white p-3.5 dark:bg-white/[0.03]",
                v.version === current ? "border-prism-300 dark:border-prism-400/40" : "border-slate-200 dark:border-white/10",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900 dark:text-white">{v.version}</span>
                {i === 0 && (
                  <span className="rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                    latest
                  </span>
                )}
                <span
                  className={cx(
                    "rounded px-1.5 text-[11px] font-medium",
                    v.source === "studio"
                      ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300"
                      : "bg-prism-50 text-prism-700 dark:bg-prism-500/10 dark:text-prism-200",
                  )}
                >
                  {v.source === "studio" ? "Studio edit plan" : "Chat"}
                </span>
                <span className="text-xs text-slate-400">{v.date}</span>
                <button onClick={() => onOpen(v.version)} className="ml-auto text-xs font-semibold text-prism-600 hover:underline dark:text-prism-300">
                  Open studio
                </button>
              </div>
              <p className="mt-1.5 text-[13px] text-slate-600 dark:text-slate-300">{v.change}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {v.files.map((f) => (
                  <a
                    key={f.name}
                    href={f.url}
                    download={f.name}
                    className="flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-slate-600 hover:text-slate-900 dark:bg-white/5 dark:text-slate-300"
                  >
                    <Download className="h-3 w-3" /> {f.name}
                  </a>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function VersionSelect({ job, value, onChange }: { job: Job; value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative ml-1 shrink-0">
      <span className="sr-only">Version</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-slate-200 bg-white py-1 pl-2 pr-6 text-xs font-semibold text-slate-700 outline-none hover:border-prism-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
      >
        {[...job.versions].reverse().map((v, i) => (
          <option key={v.version} value={v.version}>
            {v.version}
            {i === 0 ? " (latest)" : ""}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </label>
  );
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-medium transition",
        active ? "border-prism-500 text-slate-900 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function IconBtn({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx("grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5", className)}
    >
      {children}
    </button>
  );
}
