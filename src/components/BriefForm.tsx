import { useRef, useState } from "react";
import { CheckCircle2, ClipboardList, FileText, Paperclip, Presentation, UserCheck, X } from "lucide-react";
import type { BriefDraft, Intake, SourceChoice } from "../types";
import { SKILL_NOUN } from "../types";
import { FORECASTS, GEOGRAPHIES, GVR_FORECAST, OUTPUT_TYPES, standardLength, TYPE_LABEL } from "../api/catalog";
import { useStore } from "../state/store";
import { missingEssentials } from "../lib/brief";
import { draftGaps } from "../lib/compose";
import { nextVersion } from "../lib/answers";
import { cx } from "../lib/util";
import { sourceList } from "./BuildCard";

const SOURCES: { key: keyof SourceChoice; label: string; hint: string }[] = [
  { key: "gvr", label: "GVR report", hint: "GVR report PDF or ME workbook: primary source for sizes, CAGRs, shares and segments" },
  { key: "client", label: "Client documents", hint: "PDF, Word, PowerPoint, Excel or CSV from the client, cited as client-provided data" },
  { key: "urls", label: "Specific web pages", hint: "Pages the client points to, cited with URL and date" },
  { key: "whitelist", label: "Whitelisted sources", hint: "grandviewresearch.com and the approved research domains" },
  { key: "web", label: "Web research to fill gaps", hint: "Other reputable sources (regulators, statistics offices, filings), cited, published figures only" },
];

/** The questions asked before a skill runs. Nothing is built until the user confirms. */
export function BriefForm({ threadId, msgId, intake }: { threadId: string; msgId: string; intake: Intake }) {
  const { confirmIntake, cancelIntake } = useStore();
  const [d, setD] = useState<BriefDraft>(intake.draft);
  const [otherGeo, setOtherGeo] = useState(GEOGRAPHIES.includes(intake.draft.region) || !intake.draft.region ? "" : intake.draft.region);
  const [otherFc, setOtherFc] = useState(FORECASTS.includes(intake.draft.forecast) ? "" : intake.draft.forecast);
  const [urlText, setUrlText] = useState(intake.draft.urls.join("\n"));
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<BriefDraft>) => setD((x) => ({ ...x, ...patch }));
  const setSource = (k: keyof SourceChoice, v: boolean) => setD((x) => ({ ...x, sources: { ...x.sources, [k]: v } }));
  const noun = SKILL_NOUN[d.skill];
  const { state } = useStore();
  // quick: ask only what the request left out; refine: the full brief after delivery (or for an analyst request).
  const quick = intake.mode === "quick";
  const refine = intake.mode === "refine";
  const forReview = refine && !!intake.reviewMsgId;
  const [askFor] = useState(() => missingEssentials(intake.draft));
  const show = (k: "type" | "market" | "region") => !quick || askFor.includes(k);
  const job = intake.jobId ? state.jobs[intake.jobId] : undefined;
  const next = job ? nextVersion(job.versions[job.versions.length - 1].version) : "";

  if (intake.status !== "open") return <BriefSummary intake={intake} />;

  const urls = urlText
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const missing = [
    !d.type && "output type",
    d.type === "custom" && !d.customType.trim() && "a description of the report",
    !d.market.trim() && "market",
    !d.region.trim() && "geography",
    !validPeriod(d.forecast) && "forecast period (e.g. 2026–2033)",
    d.includeClient && !d.client.trim() && "client name",
    !Object.values(d.sources).some(Boolean) && "at least one source",
    d.sources.client && !d.files.length && "client documents to attach",
    d.sources.urls && !urls.length && "web page links",
  ].filter(Boolean) as string[];

  // Anything beyond the loaded GVR report (client documents, external web data, other scope) goes to an analyst.
  const reasons = missing.length ? [] : draftGaps({ ...d, urls });
  // These are created anyway, with the gaps highlighted; an analyst is optional (recommended when there are gaps).
  const hasGaps = reasons.length > 0;
  const review = d.analystReview;

  const submit = () => {
    setTried(true);
    if (missing.length) return;
    confirmIntake(threadId, msgId, { ...d, urls, analystReview: review });
  };

  return (
    <div className="mt-3 w-full max-w-[760px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3 dark:border-white/5">
        <ClipboardList className="h-4 w-4 text-prism-600 dark:text-prism-300" />
        <span className="text-sm font-semibold text-slate-900 dark:text-white">
          {quick ? "Quick question" : forReview ? "Details for the analyst" : refine ? `Refine this ${noun}` : "Brief"}
        </span>
        <div
          className={cx("ml-auto rounded-full border border-slate-200 p-0.5 text-xs dark:border-white/10", quick || refine ? "hidden" : "flex")}
          role="radiogroup"
          aria-label="Output"
        >
          {(["report", "deck"] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={d.skill === k}
              onClick={() => set({ skill: k })}
              className={cx("flex items-center gap-1 rounded-full px-2.5 py-1 font-medium", d.skill === k ? "bg-prism-gradient text-white" : "text-slate-500")}
            >
              {k === "report" ? <FileText className="h-3.5 w-3.5" /> : <Presentation className="h-3.5 w-3.5" />}
              {k === "report" ? "Report" : "Presentation"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5 px-5 py-4 text-sm">
        {show("type") && (
          <>
            <Field label={`What kind of ${noun}?`} required bad={tried && !d.type}>
              <div className="flex flex-wrap gap-1.5">
                {OUTPUT_TYPES.map((t) => (
                  <Pill key={t.id} on={d.type === t.id} onClick={() => set({ type: t.id })}>
                    {d.skill === "report" ? t.report : t.presentation}
                  </Pill>
                ))}
                <Pill on={d.type === "custom"} onClick={() => set({ type: "custom" })}>
                  Other research {noun}
                </Pill>
              </div>
              {d.type === "custom" && (
                <input
                  autoFocus={!d.customType}
                  aria-label={`Describe the ${noun}`}
                  value={d.customType}
                  onChange={(e) => set({ customType: e.target.value })}
                  placeholder="Describe it, e.g. Pricing analysis, Regulatory landscape, Market entry assessment"
                  className={cx(inputCls, "mt-2", tried && !d.customType.trim() && "border-rose-400")}
                />
              )}
            </Field>
          </>
        )}

        {show("market") && (
          <>
            <Field label="Which market?" required bad={tried && !d.market.trim()} htmlFor={`${msgId}-market`}>
              <input
                id={`${msgId}-market`}
                value={d.market}
                onChange={(e) => set({ market: e.target.value })}
                placeholder="e.g. Blood bank serology"
                className={inputCls}
              />
            </Field>
          </>
        )}

        {show("region") && (
          <>
            <Field label="Which geography?" required bad={tried && !d.region.trim()}>
              <div className="flex flex-wrap items-center gap-1.5">
                {GEOGRAPHIES.map((g) => (
                  <Pill
                    key={g}
                    on={d.region === g}
                    onClick={() => {
                      setOtherGeo("");
                      set({ region: g });
                      // Quick question with only the geography missing: picking one starts the build.
                      if (quick && askFor.length === 1 && askFor[0] === "region") {
                        const next = { ...d, region: g, urls };
                        confirmIntake(threadId, msgId, { ...next, analystReview: d.analystReview });
                      }
                    }}
                  >
                    {g}
                  </Pill>
                ))}
                <input
                  aria-label="Other country or region"
                  value={otherGeo}
                  onChange={(e) => {
                    setOtherGeo(e.target.value);
                    set({ region: e.target.value });
                  }}
                  placeholder="Other country or region"
                  className={cx(inputCls, "w-52 py-1.5")}
                />
              </div>
            </Field>
          </>
        )}

        {!quick && (
          <>
            <Field label="Which forecast period?" required bad={tried && !validPeriod(d.forecast)} hint="GVR reports forecast 2026–2033 from a 2025 base year.">
              <div className="flex flex-wrap items-center gap-1.5">
                {FORECASTS.map((p) => (
                  <Pill
                    key={p}
                    on={d.forecast === p}
                    onClick={() => {
                      setOtherFc("");
                      set({ forecast: p });
                    }}
                  >
                    {p}
                    {p === GVR_FORECAST && <span className="ml-1 text-[11px] text-slate-400">GVR standard</span>}
                  </Pill>
                ))}
                <input
                  aria-label="Other forecast period"
                  value={otherFc}
                  onChange={(e) => {
                    setOtherFc(e.target.value);
                    set({ forecast: e.target.value });
                  }}
                  placeholder="Other, e.g. 2025–2032"
                  className={cx(inputCls, "w-44 py-1.5")}
                />
              </div>
            </Field>

            {d.type && d.type !== "custom" && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                <span className="font-medium text-slate-800 dark:text-slate-100">Length:</span> standard for this type, about {standardLength(d.skill, d.type)}.
                It stays fixed; to restructure it or change the number of {d.skill === "deck" ? "slides" : "pages"} later, just ask in chat.
              </div>
            )}

            <Field label="Add a client name to the cover?" hint="Shown as “Prepared for …” on the inside cover. No client logos or co-branding.">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill on={!d.includeClient} onClick={() => set({ includeClient: false })}>
                  No client name
                </Pill>
                <Pill on={d.includeClient} onClick={() => set({ includeClient: true })}>
                  Yes, add a name
                </Pill>
                {d.includeClient && (
                  <input
                    autoFocus
                    aria-label="Client name"
                    value={d.client}
                    onChange={(e) => set({ client: e.target.value })}
                    placeholder="Client name"
                    className={cx(inputCls, "w-60 py-1.5", tried && !d.client.trim() && "border-rose-400")}
                  />
                )}
              </div>
            </Field>

            <Field label="What decision should it support?" hint="Optional. The executive summary answers this first." htmlFor={`${msgId}-q`}>
              <textarea
                id={`${msgId}-q`}
                rows={2}
                value={d.question}
                onChange={(e) => set({ question: e.target.value })}
                placeholder="e.g. Where should we prioritise entry over the next three years?"
                className={cx(inputCls, "resize-y")}
              />
            </Field>

            <Field
              label="Which sources can I use?"
              required
              bad={tried && !Object.values(d.sources).some(Boolean)}
              hint="Listed in order of precedence when sources disagree."
            >
              <div className="space-y-2">
                {SOURCES.map((s) => (
                  <div key={s.key}>
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={d.sources[s.key]}
                        onChange={(e) => setSource(s.key, e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[#7c5cff]"
                      />
                      <span>
                        <span className="font-medium text-slate-800 dark:text-slate-100">{s.label}</span>
                        <span className="block text-xs text-slate-500">{s.hint}</span>
                      </span>
                    </label>
                    {s.key === "client" && d.sources.client && (
                      <div className="ml-6 mt-1.5 flex flex-wrap items-center gap-1.5">
                        {d.files.map((f) => (
                          <span
                            key={f}
                            className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300"
                          >
                            <Paperclip className="h-3 w-3" /> {f}
                            <button onClick={() => set({ files: d.files.filter((x) => x !== f) })} aria-label={`Remove ${f}`}>
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        <button
                          onClick={() => fileRef.current?.click()}
                          className={cx(
                            "rounded-md border border-dashed px-2 py-1 text-xs font-medium text-prism-700 hover:bg-prism-50 dark:text-prism-200",
                            tried && !d.files.length ? "border-rose-400" : "border-prism-300",
                          )}
                        >
                          Attach files
                        </button>
                        <input
                          ref={fileRef}
                          type="file"
                          multiple
                          hidden
                          accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md"
                          onChange={(e) => {
                            const names = Array.from(e.target.files ?? []).map((f) => f.name);
                            set({ files: [...new Set([...d.files, ...names])] });
                            e.target.value = "";
                          }}
                        />
                      </div>
                    )}
                    {s.key === "urls" && d.sources.urls && (
                      <textarea
                        aria-label="Web page links, one per line"
                        rows={2}
                        value={urlText}
                        onChange={(e) => setUrlText(e.target.value)}
                        placeholder="https://… (one per line)"
                        className={cx(inputCls, "ml-6 mt-1.5 w-[calc(100%-1.5rem)] font-mono text-xs", tried && !urls.length && "border-rose-400")}
                      />
                    )}
                  </div>
                ))}
              </div>
            </Field>
          </>
        )}
      </div>

      {(!quick || hasGaps) && !forReview && (
        <>
          <div className="mx-5 mb-4 rounded-xl border border-slate-200 p-3.5 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={review}
                onClick={() => set({ analystReview: !d.analystReview })}
                className={cx(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition",
                  review
                    ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-400/60 dark:bg-amber-400/15 dark:text-amber-100"
                    : "border-slate-200 text-slate-600 hover:border-amber-300 dark:border-white/10 dark:text-slate-300",
                )}
              >
                <UserCheck className="h-3.5 w-3.5" /> Review with analyst
              </button>
              <span className="text-xs text-slate-500">
                {hasGaps && !review
                  ? "Recommended: parts of this aren't from the GVR report."
                  : review
                    ? "A GVR analyst validates it before delivery."
                    : "Optional. Turn on to have a GVR analyst validate it before delivery."}
              </span>
            </div>
            {hasGaps && (
              <>
                <p className="mt-2 text-[13px] font-medium text-slate-700 dark:text-slate-200">
                  I'll create it now and highlight what isn't from the GVR report:
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-slate-600 dark:text-slate-300">
                  {reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
        <span className={cx("text-xs", tried && missing.length ? "text-rose-600" : "text-slate-500")}>
          {quick && !tried && askFor.length === 1 && askFor[0] === "region"
            ? "Pick one to start, or type another country or region and press Create."
            : missing.length
              ? `Still needed: ${missing.join(", ")}`
              : review
                ? forReview
                  ? "Updates the request the analyst is working on."
                  : "Ready to send to an analyst. Nothing is delivered until it's validated."
                : refine
                  ? `Changes create ${next}; the current version stays in Versions.`
                  : "Ready."}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => cancelIntake(threadId, msgId)}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
          >
            {refine ? "Keep as is" : "Cancel"}
          </button>
          <button
            onClick={submit}
            className={cx(
              "rounded-lg bg-prism-gradient px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105",
              missing.length > 0 && "opacity-60",
            )}
          >
            {forReview ? "Update analyst request" : review ? "Send for analyst review" : refine ? `Create ${next}` : `Create ${noun}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BriefSummary({ intake }: { intake: Intake }) {
  const d = intake.draft;
  if (intake.status === "cancelled") {
    return (
      <p className="mt-2 text-sm text-slate-500">
        {intake.mode === "refine" ? "Kept as is." : "Cancelled. Nothing was built. Ask again whenever you're ready."}
      </p>
    );
  }
  const rows: [string, string][] = [
    ["Output", `${d.type === "custom" ? d.customType : (TYPE_LABEL[d.type] ?? "")} ${SKILL_NOUN[d.skill]}`],
    ["Market", d.market],
    ["Geography", d.region],
    ["Forecast", d.forecast],
    ...(d.type && d.type !== "custom" ? [["Length", `${standardLength(d.skill, d.type)} (standard)`] as [string, string]] : []),
    ["Client name", d.includeClient && d.client ? d.client : "Not added"],
    ...(d.question ? [["Decision", d.question] as [string, string]] : []),
    ["Sources", sourceList({ sources: d.sources, files: d.files, urls: d.urls }).join(" · ")],
    ...(d.analystReview ? [["Analyst review", "Yes"] as [string, string]] : []),
  ];
  return (
    <div className="mt-3 max-w-[760px] rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-[13px] dark:border-emerald-400/20 dark:bg-emerald-400/5">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="h-4 w-4" /> {intake.mode === "refine" ? "Brief updated" : intake.mode === "quick" ? "Details confirmed" : "Brief confirmed"}
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-800 dark:text-slate-200">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** "2026–2033" or "2025-2032", with the end after the start. */
function validPeriod(p: string) {
  const m = p.trim().match(/^(20\d\d)\s*[-–—]\s*(20\d\d)$/);
  return !!m && +m[2] > +m[1];
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-prism-400 focus:ring-2 focus:ring-prism-200 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:focus:ring-prism-500/30";

function Field({
  label,
  hint,
  required,
  bad,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  bad?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className={cx("mb-1.5 block font-medium", bad ? "text-rose-600" : "text-slate-800 dark:text-slate-100")}>
        {label}
        {required && <span className="ml-0.5 text-prism-500">*</span>}
      </label>
      {hint && <p className="-mt-1 mb-1.5 text-xs text-slate-500">{hint}</p>}
      {children}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "rounded-full border px-3 py-1 text-[13px] transition",
        on
          ? "border-prism-500 bg-prism-50 font-medium text-prism-800 dark:border-prism-400 dark:bg-prism-500/15 dark:text-prism-100"
          : "border-slate-200 text-slate-600 hover:border-prism-300 dark:border-white/10 dark:text-slate-300",
      )}
    >
      {children}
    </button>
  );
}
