import { useRef, useState } from "react";
import { CheckCircle2, ClipboardList, FileText, Paperclip, Presentation, X } from "lucide-react";
import type { BriefDraft, Intake, SourceChoice } from "../types";
import { SKILL_NOUN } from "../types";
import { coverage, coverageSummary, FORECASTS, GEOGRAPHIES, GVR_FORECAST, OUTPUT_TYPES, standardLength, TYPE_LABEL } from "../api/catalog";
import { useStore } from "../state/store";
import { cx } from "../lib/util";
import { sourceList } from "./BuildCard";

const AUDIENCES = ["Leadership", "Strategy team", "Sales & marketing", "Investors"];

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

  if (intake.status !== "open") return <BriefSummary intake={intake} />;

  const urls = urlText
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const missing = [
    !d.type && "output type",
    !d.market.trim() && "market",
    !d.region.trim() && "geography",
    !validPeriod(d.forecast) && "forecast period (e.g. 2026–2033)",
    d.includeClient && !d.client.trim() && "client name",
    !Object.values(d.sources).some(Boolean) && "at least one source",
    d.sources.client && !d.files.length && "client documents to attach",
    d.sources.urls && !urls.length && "web page links",
  ].filter(Boolean) as string[];

  // Check the answers against what this prototype really has; never swap in a different output.
  const cov = !missing.length && d.type ? coverage(d.skill, d.type, d.region.trim(), d.market.trim(), d.forecast.trim()) : null;
  const blocked = cov && !cov.ok ? cov.reasons : [];

  const submit = () => {
    setTried(true);
    if (missing.length || blocked.length) return;
    confirmIntake(threadId, msgId, { ...d, urls });
  };

  return (
    <div className="mt-3 w-full max-w-[760px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3 dark:border-white/5">
        <ClipboardList className="h-4 w-4 text-prism-600 dark:text-prism-300" />
        <span className="text-sm font-semibold text-slate-900 dark:text-white">Brief</span>
        <div className="ml-auto flex rounded-full border border-slate-200 p-0.5 text-xs dark:border-white/10" role="radiogroup" aria-label="Output">
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
        <Field label={`What kind of ${noun}?`} required bad={tried && !d.type}>
          <div className="flex flex-wrap gap-1.5">
            {OUTPUT_TYPES.map((t) => (
              <Pill key={t.id} on={d.type === t.id} onClick={() => set({ type: t.id })}>
                {d.skill === "report" ? t.report : t.presentation}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="Which market?" required bad={tried && !d.market.trim()} htmlFor={`${msgId}-market`}>
          <input
            id={`${msgId}-market`}
            value={d.market}
            onChange={(e) => set({ market: e.target.value })}
            placeholder="e.g. Blood bank serology"
            className={inputCls}
          />
        </Field>

        <Field label="Which geography?" required bad={tried && !d.region.trim()}>
          <div className="flex flex-wrap items-center gap-1.5">
            {GEOGRAPHIES.map((g) => (
              <Pill
                key={g}
                on={d.region === g}
                onClick={() => {
                  setOtherGeo("");
                  set({ region: g });
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

        {d.type && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
            <span className="font-medium text-slate-800 dark:text-slate-100">Length:</span> standard for this type, about {standardLength(d.skill, d.type)}. It
            stays fixed; to restructure it or change the number of {d.skill === "deck" ? "slides" : "pages"} later, just ask in chat.
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

        <Field label="Who will read it?" hint="Optional. Sets depth and tone.">
          <div className="flex flex-wrap gap-1.5">
            {AUDIENCES.map((a) => (
              <Pill key={a} on={d.audience === a} onClick={() => set({ audience: d.audience === a ? "" : a })}>
                {a}
              </Pill>
            ))}
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
      </div>

      {blocked.length > 0 && (
        <div className="mx-5 mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[13px] text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
          <p className="font-semibold">This prototype can't build that, and won't substitute another output:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {blocked.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-2 text-amber-800 dark:text-amber-200">Available here: {coverageSummary(d.skill)}. Change an answer above to continue.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
        <span className={cx("text-xs", tried && missing.length ? "text-rose-600" : "text-slate-500")}>
          {missing.length
            ? `Still needed: ${missing.join(", ")}`
            : blocked.length
              ? "Not available in this prototype"
              : "Ready. Nothing is built until you confirm."}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => cancelIntake(threadId, msgId)}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className={cx(
              "rounded-lg bg-prism-gradient px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105",
              (missing.length > 0 || blocked.length > 0) && "opacity-60",
            )}
          >
            Create {noun}
          </button>
        </div>
      </div>
    </div>
  );
}

function BriefSummary({ intake }: { intake: Intake }) {
  const d = intake.draft;
  if (intake.status === "cancelled") {
    return <p className="mt-2 text-sm text-slate-500">Cancelled. Nothing was built. Ask again whenever you're ready.</p>;
  }
  const rows: [string, string][] = [
    ["Output", `${TYPE_LABEL[d.type] ?? ""} ${SKILL_NOUN[d.skill]}`],
    ["Market", d.market],
    ["Geography", d.region],
    ["Forecast", d.forecast],
    ...(d.type ? [["Length", `${standardLength(d.skill, d.type)} (standard)`] as [string, string]] : []),
    ["Client name", d.includeClient && d.client ? d.client : "Not added"],
    ...(d.audience ? [["Audience", d.audience] as [string, string]] : []),
    ...(d.question ? [["Decision", d.question] as [string, string]] : []),
    ["Sources", sourceList({ sources: d.sources, files: d.files, urls: d.urls }).join(" · ")],
  ];
  return (
    <div className="mt-3 max-w-[760px] rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-[13px] dark:border-emerald-400/20 dark:bg-emerald-400/5">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="h-4 w-4" /> Brief confirmed
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
