import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { SKILL_NOUN } from "../types";
import type { AnalystReview, Brief, BriefDraft, OutputType, BuildState, ChatMessage, ComposerMode, EditPlan, Job, OutlineChapter, Thread } from "../types";
import { PrototypeLimitError, VersionConflictError } from "../types";
import { api, dropSampleClient, initialStages, mockApi, stageDefs } from "../api/mockApi";
import { GVR_FORECAST, OUTPUT_TYPES, standardLength, TYPE_LABEL } from "../api/catalog";
import { missingEssentials, describeChanges } from "../lib/brief";
import { draftGaps } from "../lib/compose";
import { nextVersion } from "../lib/answers";
import { detectCustomType, detectForecast, detectIntent, detectRegion, type Intent } from "../lib/intent";
import { genericAnswer } from "../lib/answers";
import { describeOutlineChanges, extractToc, parseOutlineCommand, withoutToc } from "../lib/outline";
import { load, save, uid } from "../lib/util";
import { seedThreads } from "../data/seed";

/* ---------- state ---------- */

export interface PanelState {
  jobId: string;
  version: string;
  tab: "studio" | "outline" | "brief" | "file" | "excel" | "versions";
}

interface State {
  threads: Thread[];
  activeId: string | null;
  jobs: Record<string, Job>;
  panel: PanelState | null;
  dark: boolean;
}

type Action =
  | { t: "upsertThread"; thread: Thread }
  | { t: "activate"; id: string | null }
  | { t: "addMessage"; threadId: string; msg: ChatMessage }
  | { t: "patchMessage"; threadId: string; msgId: string; patch: Partial<ChatMessage> }
  | { t: "patchBuild"; threadId: string; msgId: string; patch: Partial<BuildState> }
  | { t: "linkJob"; threadId: string; jobId: string }
  | { t: "setJob"; job: Job }
  | { t: "panel"; panel: PanelState | null }
  | { t: "dark"; dark: boolean }
  | { t: "reset"; threads: Thread[] };

function mapThread(s: State, id: string, fn: (t: Thread) => Thread): State {
  return { ...s, threads: s.threads.map((t) => (t.id === id ? fn(t) : t)) };
}

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case "upsertThread": {
      const exists = s.threads.some((t) => t.id === a.thread.id);
      return { ...s, threads: exists ? s.threads.map((t) => (t.id === a.thread.id ? a.thread : t)) : [a.thread, ...s.threads] };
    }
    case "activate":
      return { ...s, activeId: a.id, panel: null };
    case "addMessage":
      return mapThread(s, a.threadId, (t) => ({ ...t, updatedAt: Date.now(), messages: [...t.messages, a.msg] }));
    case "patchMessage":
      return mapThread(s, a.threadId, (t) => ({
        ...t,
        messages: t.messages.map((m) => (m.id === a.msgId ? { ...m, ...a.patch } : m)),
      }));
    case "patchBuild":
      return mapThread(s, a.threadId, (t) => ({
        ...t,
        messages: t.messages.map((m) => (m.id === a.msgId && m.build ? { ...m, build: { ...m.build, ...a.patch } } : m)),
      }));
    case "linkJob":
      return mapThread(s, a.threadId, (t) => (t.jobIds.includes(a.jobId) ? t : { ...t, jobIds: [...t.jobIds, a.jobId] }));
    case "setJob":
      return { ...s, jobs: { ...s.jobs, [a.job.id]: a.job } };
    case "panel":
      return { ...s, panel: a.panel };
    case "dark":
      return { ...s, dark: a.dark };
    case "reset":
      return { ...s, threads: a.threads, jobs: {}, activeId: a.threads[0]?.id ?? null, panel: null };
  }
}

const THREADS_KEY = "prism.threads.v1";
const DARK_KEY = "prism.dark";

/** Theme from the host page: an explicit data-theme on <html> (e.g. the artifact viewer), else the OS setting. */
function hostDark(): boolean | null {
  const t = document.documentElement.dataset.theme;
  if (t === "dark" || t === "light") return t === "dark";
  return null;
}
const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

function init(): State {
  const threads = load<Thread[]>(THREADS_KEY, seedThreads()).map((t) => ({
    ...t,
    // A build interrupted by a reload can't resume in the mock; mark it as such.
    messages: t.messages.map((m) => {
      const msg = m.build ? { ...m, build: { ...m.build, brief: dropSampleClient(m.build.brief) } } : m;
      return msg.build?.status === "running" ? { ...msg, build: { ...msg.build!, status: "error" as const, error: "Interrupted by a page reload." } } : msg;
    }),
  }));
  return {
    threads,
    activeId: threads[0]?.id ?? null,
    jobs: mockApi.allJobs(),
    panel: null,
    dark: hostDark() ?? load(DARK_KEY, systemDark()),
  };
}

/* ---------- helpers ---------- */

const URL_RX = /https?:\/\/[^\s)>\]]+/g;
const VALID_TYPES = new Set(OUTPUT_TYPES.map((t) => t.id as string));

/**
 * Pre-fill the brief card from what the user actually said (and the thread's earlier output, if any).
 * Nothing is assumed: unanswered fields stay empty and the card asks for them.
 */
function draftFromIntent(intent: Intent, text: string, uploads: string[], prev?: Job, sameOutput = false): BriefDraft {
  const urls = text.match(URL_RX) ?? [];
  // The output type carries over only for "make it a presentation"-style requests about the same output.
  // A named type the app doesn't list ("a pricing analysis report") becomes a custom request, not a refusal.
  const custom = detectCustomType(text);
  const type: OutputType | "" =
    intent.type && VALID_TYPES.has(intent.type) ? (intent.type as OutputType) : custom !== undefined ? "custom" : sameOutput && prev ? prev.brief.type : "";
  const customType = type === "custom" ? (custom ?? (prev?.brief.type === "custom" ? prev.brief.typeLabel : "")) : "";
  const sources = prev?.brief.sources ?? { gvr: true, client: uploads.length > 0, urls: urls.length > 0, whitelist: true, web: true };
  return {
    skill: intent.skill ?? "report",
    type,
    market: intent.market ?? prev?.brief.market ?? "",
    region: intent.region ?? prev?.brief.region ?? "",
    // GVR's standard period is pre-selected (it is what GVR data covers); a period in the message wins.
    forecast: detectForecast(text) ?? prev?.brief.forecast ?? GVR_FORECAST,
    includeClient: !!prev?.brief.client,
    client: prev?.brief.client ?? "",
    customType,
    question: "",
    sources,
    analystReview: false,
    files: [...new Set([...(prev?.brief.files ?? []), ...uploads])],
    urls: [...new Set([...(prev?.brief.urls ?? []), ...urls])],
    toc: extractToc(text) ?? "",
  };
}

/** The brief card's fields for an existing brief (refine after delivery). */
export function draftFromBrief(b: Brief): BriefDraft {
  return {
    skill: b.skill,
    type: b.type,
    customType: b.type === "custom" ? b.typeLabel : "",
    market: b.market,
    region: b.region,
    forecast: b.forecast,
    includeClient: !!b.client,
    client: b.client ?? "",
    question: b.decision ?? "",
    sources: b.sources ?? { gvr: true, client: false, urls: false, whitelist: true, web: true },
    files: b.files ?? [],
    urls: b.urls ?? [],
    analystReview: false,
    toc: "",
  };
}

function briefFromDraft(d: BriefDraft, text: string): Brief {
  const type = d.type as OutputType;
  return {
    skill: d.skill,
    type,
    typeLabel: type === "custom" ? d.customType.trim() : TYPE_LABEL[type],
    market: d.market.trim(),
    region: d.region.trim(),
    client: d.includeClient && d.client.trim() ? d.client.trim() : undefined,
    question: d.question.trim() || text.trim(),
    decision: d.question.trim() || undefined,
    forecast: d.forecast.trim().replace(/\s*[-—–]\s*/, "–"),
    length: type === "custom" ? undefined : standardLength(d.skill, type),
    sources: d.sources,
    files: d.sources.client ? d.files : [],
    urls: d.sources.urls ? d.urls : [],
    ...(d.toc?.trim() ? { tocText: d.toc.trim() } : {}),
  };
}

function deliveryNote(job: Job): string {
  const v = job.versions[job.versions.length - 1];
  const f = v.files.find((x) => x.kind === "pdf" || x.kind === "pptx");
  if (!f) {
    const gaps = v.gaps?.length
      ? ` ${v.gaps.length} part${v.gaps.length === 1 ? " isn't" : "s aren't"} from the GVR report and ${v.gaps.length === 1 ? "is" : "are"} highlighted in amber.`
      : "";
    return `**${job.brief.typeLabel}** ${SKILL_NOUN[job.skill]} on ${job.brief.market}, ${job.brief.region}${job.brief.client ? `, prepared for ${job.brief.client}` : ""}: open the studio to read it.${gaps} Its PDF and Excel are produced by the server render.`;
  }
  const unit = job.skill === "deck" ? "slides" : "pages";
  const lines = [
    `**${job.brief.typeLabel}** ${SKILL_NOUN[job.skill]} on ${job.brief.market}, ${job.brief.region}: ${f.pages} ${unit}${job.brief.client ? `, prepared for ${job.brief.client}` : ""}.`,
  ];
  if (job.skill === "deck") {
    // The deck note carries a one-line fact-check summary; the report UI shows none.
    lines.push(
      v.factcheck ? `Fact-check: ${v.factcheck.traced} of ${v.factcheck.total} figures traced to sources.` : "Fact-check: all figures traced to sources.",
    );
  }
  return lines.join(" ");
}

const toApiMessages = (t: Thread) => t.messages.filter((m) => m.text).map((m) => ({ role: m.role, text: m.text!, ts: m.ts }));

/* ---------- context ---------- */

interface Store {
  state: State;
  activeThread: Thread | null;
  newChat(): void;
  openThread(id: string): void;
  send(text: string, mode: ComposerMode, uploads: string[]): void;
  openPanel(jobId: string, version?: string, tab?: PanelState["tab"]): void;
  setPanel(p: PanelState | null): void;
  sendEditPlan(jobId: string, plan: EditPlan): Promise<void>;
  confirmIntake(threadId: string, msgId: string, draft: BriefDraft): void;
  cancelIntake(threadId: string, msgId: string): void;
  setReviewStatus(threadId: string, msgId: string, status: AnalystReview["status"]): void;
  requestReview(threadId: string, jobId: string): void;
  refineFromDraft(jobId: string, draft: BriefDraft): void;
  applyOutline(jobId: string, before: OutlineChapter[], outline: OutlineChapter[]): void;
  toggleDark(): void;
  resetDemo(): void;
  busy: boolean;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const stateRef = useRef(state);
  // send() is defined before the build helpers; it reaches createFromDraft through this ref.
  const createRef = useRef<(threadId: string, draft: BriefDraft, request: string) => void>(() => {});
  stateRef.current = state;

  useEffect(() => save(THREADS_KEY, state.threads), [state.threads]);
  useEffect(() => {
    save(DARK_KEY, state.dark);
    const root = document.documentElement;
    root.classList.toggle("dark", state.dark);
    root.style.colorScheme = state.dark ? "dark" : "light";
    root.style.background = state.dark ? "#0e0b16" : "#ffffff";
  }, [state.dark]);

  const activeThread = state.threads.find((t) => t.id === state.activeId) ?? null;
  const busy = !!activeThread?.messages.some((m) => m.build?.status === "running" || (m.role === "assistant" && m.text === "" && !m.build));

  const newChat = useCallback(() => dispatch({ t: "activate", id: null }), []);
  const openThread = useCallback((id: string) => dispatch({ t: "activate", id }), []);
  const setPanel = useCallback((panel: PanelState | null) => dispatch({ t: "panel", panel }), []);
  const openPanel = useCallback((jobId: string, version?: string, tab: PanelState["tab"] = "studio") => {
    const job = stateRef.current.jobs[jobId];
    if (!job) return;
    dispatch({ t: "panel", panel: { jobId, version: version ?? job.versions[job.versions.length - 1].version, tab } });
  }, []);

  const send = useCallback((text: string, mode: ComposerMode, uploads: string[]) => {
    const s = stateRef.current;
    let thread = s.threads.find((t) => t.id === s.activeId) ?? null;
    if (!thread) {
      thread = { id: `t-${uid()}`, title: text.trim().slice(0, 80), createdAt: Date.now(), updatedAt: Date.now(), certified: true, messages: [], jobIds: [] };
      dispatch({ t: "upsertThread", thread });
      dispatch({ t: "activate", id: thread.id });
    }
    const threadId = thread.id;
    const userMsg: ChatMessage = { id: uid(), role: "user", ts: Date.now(), text, uploads: uploads.length ? uploads : undefined };
    dispatch({ t: "addMessage", threadId, msg: userMsg });
    const history = [...toApiMessages(thread), { role: "user" as const, text, ts: userMsg.ts }];

    const jobs = thread.jobIds.map((id) => s.jobs[id]).filter(Boolean);
    const outlineCmd = jobs.length > 0 && !!parseOutlineCommand(text);
    const intent = outlineCmd ? { ...detectIntent(withoutToc(text), "auto", true), action: "change" as const } : detectIntent(withoutToc(text), mode, jobs.length > 0);
    const asstId = uid();

    // Plain answer.
    if (intent.action === "answer" || (intent.action === "question" && !jobs.length)) {
      dispatch({ t: "addMessage", threadId, msg: { id: asstId, role: "assistant", ts: Date.now(), text: "" } });
      setTimeout(() => dispatch({ t: "patchMessage", threadId, msgId: asstId, patch: { text: genericAnswer(text) } }), 900);
      return;
    }

    // Excel export of an existing output: hand over the version's workbook, no rebuild.
    if (intent.action === "export" && jobs.length) {
      const job = (intent.skill && [...jobs].reverse().find((j) => j.skill === intent.skill)) || jobs[jobs.length - 1];
      const v = job.versions[job.versions.length - 1];
      const x = v.files.find((f) => f.kind === "xlsx");
      const label = `${job.brief.typeLabel} ${SKILL_NOUN[job.skill]} ${v.version}`;
      dispatch({ t: "addMessage", threadId, msg: { id: asstId, role: "assistant", ts: Date.now(), text: "" } });
      setTimeout(
        () =>
          dispatch({
            t: "patchMessage",
            threadId,
            msgId: asstId,
            patch: x
              ? {
                  text: `Here's the Excel export of the **${label}**: ${x.sheets} sheets with every table, chart and KPI, one sheet each, plus a contents sheet with links.`,
                  attachment: { jobId: job.id, version: v.version, kind: "xlsx" },
                  footnote: "Included with every version · no new version",
                }
              : { text: `The **${label}** was built before Excel exports were added. Ask for any change and the next version will include one.` },
          }),
        600,
      );
      return;
    }

    // New skill job.
    const sameSkill = jobs.filter((j) => j.skill === intent.skill);
    const latestJob = jobs[jobs.length - 1];
    // "make it a deck" in a thread that only has a report → new deck job with the same scope.
    const crossSkill = !outlineCmd && intent.action === "change" && intent.explicitSkill && !sameSkill.length;
    const noMatch = !outlineCmd && intent.action === "build" && !sameSkill.some((j) => !intent.type || j.brief.type === intent.type);
    if (crossSkill || noMatch) {
      // Build first from what the request says. Only type, market and geography are essential; if one is
      // missing, ask just that (no assumed defaults). The full brief is offered after delivery to refine.
      const draft = draftFromIntent(intent, withoutToc(text), uploads, latestJob, crossSkill);
      draft.toc = extractToc(text) ?? "";
      const missing = missingEssentials(draft);
      if (missing.length) {
        const noun = SKILL_NOUN[draft.skill];
        const what = draft.type ? `${draft.type === "custom" ? draft.customType || "custom research" : TYPE_LABEL[draft.type]} ${noun}` : noun;
        const ask =
          missing.length === 1 && missing[0] === "region"
            ? `Which geography should the ${what} cover? I'll create it as soon as you pick one.`
            : `One quick check before I create the ${what}: your message didn't say ${missing.map((m) => (m === "type" ? "which kind" : m === "region" ? "which geography" : "which market")).join(" or ")}.`;
        dispatch({
          t: "addMessage",
          threadId,
          msg: { id: asstId, role: "assistant", ts: Date.now(), text: ask, intake: { status: "open", mode: "quick", draft } },
        });
        return;
      }
      createRef.current(threadId, draft, text);
      return;
    }

    // Follow-up on an existing job: answer from it, or build the next version.
    const target = (!outlineCmd && intent.skill && [...sameSkill].pop()) || jobs[jobs.length - 1];
    dispatch({ t: "addMessage", threadId, msg: { id: asstId, role: "assistant", ts: Date.now(), text: "" } });
    let started = false;
    api
      .postTurn(target.id, { messages: history, uploads }, (stages) => {
        if (!started) {
          started = true;
          const build: BuildState = { kind: "update", jobId: target.id, brief: target.brief, stages, status: "running" };
          dispatch({ t: "patchMessage", threadId, msgId: asstId, patch: { build, text: undefined } });
        } else dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { stages } });
      })
      .then((res) => {
        if (res.kind === "answer") {
          dispatch({
            t: "patchMessage",
            threadId,
            msgId: asstId,
            patch: { text: res.markdown, footnote: `Answered from ${SKILL_NOUN[target.skill]} ${res.version} · no new version` },
          });
          return;
        }
        if (res.kind === "not_built") {
          // Offer analyst validation for the request instead of a flat refusal.
          const region = detectRegion(text);
          const fc = detectForecast(text);
          const review: AnalystReview = {
            id: `REV-${uid().slice(0, 6).toUpperCase()}`,
            brief: {
              ...target.brief,
              region: region ?? target.brief.region,
              forecast: fc && /forecast|period|horizon/i.test(text) ? fc : target.brief.forecast,
            },
            reasons: res.reasons,
            status: "offered",
            submittedAt: Date.now(),
            request: text.trim(),
          };
          const latest = target.versions[target.versions.length - 1].version;
          dispatch({
            t: "patchMessage",
            threadId,
            msgId: asstId,
            patch: {
              text: `This goes beyond what I can build from the loaded GVR report, so I haven't changed the ${SKILL_NOUN[target.skill]}. A GVR analyst can validate it and deliver the update.`,
              review,
              footnote: `${SKILL_NOUN[target.skill]} ${latest} is unchanged`,
            },
          });
          return;
        }
        dispatch({ t: "setJob", job: res.job });
        dispatch({
          t: "patchBuild",
          threadId,
          msgId: asstId,
          patch: {
            status: "done",
            brief: res.job.brief,
            version: res.version.version,
            note: `${res.version.version}: ${res.version.change}. ${deliveryNote(res.job)}`,
          },
        });
        dispatch({ t: "panel", panel: { jobId: res.job.id, version: res.version.version, tab: "studio" } });
      })
      .catch((e: Error) => dispatch({ t: "patchMessage", threadId, msgId: asstId, patch: { text: `Something went wrong: ${e.message}` } }));
  }, []);

  const sendEditPlan = useCallback(async (jobId: string, plan: EditPlan) => {
    const s = stateRef.current;
    const job = s.jobs[jobId];
    if (!job) return;
    const threadId = job.threadId;
    const asstId = uid();
    const ops = Array.isArray(plan.operations) ? plan.operations.length : 0;
    dispatch({
      t: "addMessage",
      threadId,
      msg: { id: uid(), role: "user", ts: Date.now(), text: `Sent studio edit plan · base ${plan.base_version} · ${ops} operation${ops === 1 ? "" : "s"}` },
    });
    const build: BuildState = { kind: "edit-plan", jobId, brief: job.brief, stages: initialStages(stageDefs.editPlan), status: "running" };
    dispatch({ t: "addMessage", threadId, msg: { id: asstId, role: "assistant", ts: Date.now(), build } });
    if (s.activeId !== threadId) dispatch({ t: "activate", id: threadId });
    try {
      const res = await api.submitEditPlan(jobId, plan, (stages) => dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { stages } }));
      dispatch({ t: "setJob", job: res.job });
      dispatch({
        t: "patchBuild",
        threadId,
        msgId: asstId,
        patch: { status: "done", version: res.version.version, note: `${res.version.version}: ${res.version.change}. ${deliveryNote(res.job)}` },
      });
      dispatch({ t: "panel", panel: { jobId, version: res.version.version, tab: "studio" } });
    } catch (e) {
      if (e instanceof VersionConflictError) {
        dispatch({
          t: "patchBuild",
          threadId,
          msgId: asstId,
          patch: {
            status: "conflict",
            version: e.latest,
            error: `This edit plan is based on ${e.base}, but ${e.latest} is already the latest version. Reload the ${e.latest} studio and make your edits there; plans are never merged silently.`,
          },
        });
      } else if (e instanceof PrototypeLimitError) {
        dispatch({
          t: "patchBuild",
          threadId,
          msgId: asstId,
          patch: { status: "not_built", error: `${e.message} Nothing was built, and the latest version is unchanged.` },
        });
      } else {
        dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { status: "error", error: (e as Error).message } });
      }
    }
  }, []);

  // Follow the host's theme switch (data-theme on <html>) and OS theme changes.
  useEffect(() => {
    const sync = () => {
      const d = hostDark() ?? systemDark();
      if (d !== stateRef.current.dark) dispatch({ t: "dark", dark: d });
    };
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    const onMq = () => {
      if (!hostDark()) sync();
    };
    mq?.addEventListener("change", onMq);
    return () => {
      mo.disconnect();
      mq?.removeEventListener("change", onMq);
    };
  }, []);

  /** Start a skill job from a confirmed brief. */
  const startBuild = useCallback((threadId: string, brief: Brief, onDone?: (job: Job) => void) => {
    // A brand-new thread may not be in the state snapshot yet (same tick as send()); its history is just the request.
    const thread = stateRef.current.threads.find((t) => t.id === threadId);
    const asstId = uid();
    const build: BuildState = { kind: "create", brief, stages: initialStages(stageDefs.create[brief.skill]), status: "running" };
    dispatch({ t: "addMessage", threadId, msg: { id: asstId, role: "assistant", ts: Date.now(), build } });
    api
      .startJob(
        brief.skill,
        {
          thread_id: threadId,
          messages: thread ? toApiMessages(thread) : [{ role: "user", text: brief.question, ts: Date.now() }],
          uploads: brief.files ?? [],
          type: brief.type,
          region: brief.region,
        },
        brief,
        (stages) => dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { stages } }),
      )
      .then(({ job, version }) => {
        dispatch({ t: "setJob", job });
        dispatch({ t: "linkJob", threadId, jobId: job.id });
        dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { status: "done", jobId: job.id, version: version.version, note: deliveryNote(job) } });
        dispatch({ t: "panel", panel: { jobId: job.id, version: version.version, tab: "studio" } });
        onDone?.(job);
      })
      .catch((e: Error) =>
        dispatch({
          t: "patchBuild",
          threadId,
          msgId: asstId,
          patch: e instanceof PrototypeLimitError ? { status: "not_built", error: e.message } : { status: "error", error: e.message },
        }),
      );
  }, []);

  /** After delivery: offer the full brief so the client can tailor the next version. */
  const offerRefine = useCallback((threadId: string, job: Job) => {
    const v = job.versions[job.versions.length - 1].version;
    dispatch({
      t: "addMessage",
      threadId,
      msg: {
        id: uid(),
        role: "assistant",
        ts: Date.now(),
        text: `Your ${job.brief.typeLabel} ${SKILL_NOUN[job.skill]} (${v}) is ready. Make it the client's: change the ${job.skill === "deck" ? "slide outline" : "table of contents"}, add their name or the decision it supports, or just tell me, e.g. “Add a chapter on pricing after chapter 3”. Each change creates ${nextVersion(v)}.`,
        intake: { status: "open", mode: "refine", jobId: job.id, draft: draftFromBrief(job.brief) },
      },
    });
  }, []);

  /** Send a brief to a GVR analyst (instead of building) and offer the full brief to add details for them. */
  const sendToAnalyst = useCallback((threadId: string, brief: Brief, reasons: string[], request?: string) => {
    const reviewMsgId = uid();
    const review: AnalystReview = {
      id: `REV-${uid().slice(0, 6).toUpperCase()}`,
      brief,
      reasons: reasons.length ? reasons : ["You asked for an analyst to validate this before delivery."],
      status: "submitted",
      submittedAt: Date.now(),
      request,
    };
    dispatch({
      t: "addMessage",
      threadId,
      msg: {
        id: reviewMsgId,
        role: "assistant",
        ts: Date.now(),
        text: `This needs validation beyond the loaded GVR report, so I've sent it to a GVR analyst instead of building it automatically. You'll see the ${SKILL_NOUN[brief.skill]} here once it's validated.`,
        review,
      },
    });
    dispatch({
      t: "addMessage",
      threadId,
      msg: {
        id: uid(),
        role: "assistant",
        ts: Date.now(),
        text: "Want to give the analyst more to work with? Add a client name, the decision it should support or other sources, and I'll update the request.",
        intake: { status: "open", mode: "refine", reviewMsgId, draft: { ...draftFromBrief(brief), analystReview: true } },
      },
    });
  }, []);

  /** Build the next version of a job from a changed brief (refined brief, client TOC, edited outline). */
  const runRefine = useCallback((threadId: string, job: Job, brief: Brief, change: string) => {
    const asstId = uid();
    const build: BuildState = { kind: "update", jobId: job.id, brief, stages: initialStages(stageDefs.update), status: "running" };
    dispatch({ t: "addMessage", threadId, msg: { id: asstId, role: "assistant", ts: Date.now(), build } });
    api
      .refineJob(job.id, brief, change, (stages) => dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { stages } }))
      .then((res) => {
        dispatch({ t: "setJob", job: res.job });
        dispatch({
          t: "patchBuild",
          threadId,
          msgId: asstId,
          patch: { status: "done", brief: res.job.brief, version: res.version.version, note: `${res.version.version}: ${change}. ${deliveryNote(res.job)}` },
        });
        dispatch({ t: "panel", panel: { jobId: res.job.id, version: res.version.version, tab: "studio" } });
      })
      .catch((e: Error) =>
        dispatch({
          t: "patchBuild",
          threadId,
          msgId: asstId,
          patch: e instanceof PrototypeLimitError ? { status: "not_built", error: e.message } : { status: "error", error: e.message },
        }),
      );
  }, []);

  /** Refine from the workspace's Brief tab: same as the brief card in chat. */
  const refineFromDraft = useCallback(
    (jobId: string, draft: BriefDraft) => {
      const job = stateRef.current.jobs[jobId];
      if (!job) return;
      const brief = briefFromDraft(draft, job.brief.question);
      const changes = describeChanges(job.brief, brief);
      const latest = job.versions[job.versions.length - 1].version;
      if (stateRef.current.activeId !== job.threadId) dispatch({ t: "activate", id: job.threadId });
      if (draft.analystReview) return sendToAnalyst(job.threadId, brief, draftGaps(draft), `Refine ${latest}: ${changes.join(", ") || "validate"}`);
      if (!changes.length) {
        dispatch({ t: "addMessage", threadId: job.threadId, msg: { id: uid(), role: "assistant", ts: Date.now(), text: `Nothing changed, so ${latest} stays as it is.` } });
        return;
      }
      dispatch({ t: "addMessage", threadId: job.threadId, msg: { id: uid(), role: "user", ts: Date.now(), text: `Refine the brief: ${changes.join(", ")}` } });
      runRefine(job.threadId, job, { ...brief, outline: brief.tocText ? undefined : job.brief.outline }, `Brief refined: ${changes.join(", ")}`);
    },
    [runRefine, sendToAnalyst],
  );

  /** Apply an outline edited in the workspace (the client's own table of contents) as the next version. */
  const applyOutline = useCallback(
    (jobId: string, before: OutlineChapter[], outline: OutlineChapter[]) => {
      const job = stateRef.current.jobs[jobId];
      if (!job) return;
      const changes = describeOutlineChanges(before, outline);
      const what = changes.length ? changes.join("; ") : "outline confirmed";
      const threadId = job.threadId;
      if (stateRef.current.activeId !== threadId) dispatch({ t: "activate", id: threadId });
      dispatch({ t: "addMessage", threadId, msg: { id: uid(), role: "user", ts: Date.now(), text: `Update the table of contents: ${what}` } });
      runRefine(threadId, job, { ...job.brief, outline, tocText: undefined }, `Table of contents: ${what}`);
    },
    [runRefine],
  );

  /** Create from a brief: build automatically when the loaded GVR report covers it, otherwise go to an analyst. */
  const createFromDraft = useCallback(
    (threadId: string, draft: BriefDraft, request: string) => {
      const brief = briefFromDraft(draft, request);
      const reasons = draftGaps(draft);
      // Always create it; an analyst only when the client asks (gaps are highlighted in the output).
      if (draft.analystReview) return sendToAnalyst(threadId, brief, reasons);
      startBuild(threadId, brief, (job) => offerRefine(threadId, job));
    },
    [startBuild, sendToAnalyst, offerRefine],
  );
  createRef.current = createFromDraft;

  const confirmIntake = useCallback(
    (threadId: string, msgId: string, draft: BriefDraft) => {
      const thread = stateRef.current.threads.find((t) => t.id === threadId);
      const idx = thread?.messages.findIndex((m) => m.id === msgId) ?? -1;
      const intake = idx >= 0 ? thread!.messages[idx].intake : undefined;
      dispatch({ t: "patchMessage", threadId, msgId, patch: { intake: { ...intake, status: "confirmed", draft } } });

      // Refine an analyst request: update it in place.
      if (intake?.mode === "refine" && intake.reviewMsgId) {
        const rm = thread!.messages.find((m) => m.id === intake.reviewMsgId);
        if (rm?.review) {
          const brief = briefFromDraft(draft, rm.review.brief.question);
          const reasons = draftGaps(draft);
          dispatch({
            t: "patchMessage",
            threadId,
            msgId: rm.id,
            patch: { review: { ...rm.review, brief, reasons: reasons.length ? reasons : rm.review.reasons, status: "submitted", submittedAt: Date.now() } },
          });
        }
        return;
      }

      // Refine a delivered output: next version, or an analyst if the changes need validation.
      if (intake?.mode === "refine" && intake.jobId) {
        const job = stateRef.current.jobs[intake.jobId];
        if (!job) return;
        const brief = briefFromDraft(draft, job.brief.question);
        const changes = describeChanges(job.brief, brief);
        const latest = job.versions[job.versions.length - 1].version;
        if (!changes.length && !draft.analystReview) {
          dispatch({ t: "addMessage", threadId, msg: { id: uid(), role: "assistant", ts: Date.now(), text: `Nothing changed, so ${latest} stays as it is.` } });
          return;
        }
        const reasons = draftGaps(draft);
        if (draft.analystReview) return sendToAnalyst(threadId, brief, reasons, `Refine ${latest}: ${changes.join(", ") || "validate"}`);
        runRefine(threadId, job, { ...brief, outline: brief.tocText ? undefined : job.brief.outline }, `Brief refined: ${changes.join(", ")}`);
        return;
      }

      // Quick question answered (or an older full brief card): create now.
      const request = idx > 0 ? (thread!.messages[idx - 1].text ?? "") : "";
      createFromDraft(threadId, draft, request);
    },
    [createFromDraft, sendToAnalyst, runRefine],
  );

  /** Client asks for an analyst on a delivered version (e.g. to validate highlighted gaps). */
  const requestReview = useCallback(
    (threadId: string, jobId: string) => {
      const job = stateRef.current.jobs[jobId];
      if (!job) return;
      const v = job.versions[job.versions.length - 1];
      sendToAnalyst(threadId, job.brief, v.gaps?.length ? v.gaps : [], `Validate ${v.version}`);
    },
    [sendToAnalyst],
  );

  const setReviewStatus = useCallback((threadId: string, msgId: string, status: AnalystReview["status"]) => {
    const m = stateRef.current.threads.find((t) => t.id === threadId)?.messages.find((x) => x.id === msgId);
    if (m?.review)
      dispatch({
        t: "patchMessage",
        threadId,
        msgId,
        patch: { review: { ...m.review, status, submittedAt: status === "submitted" ? Date.now() : m.review.submittedAt } },
      });
  }, []);

  const cancelIntake = useCallback((threadId: string, msgId: string) => {
    const m = stateRef.current.threads.find((t) => t.id === threadId)?.messages.find((x) => x.id === msgId);
    if (m?.intake) dispatch({ t: "patchMessage", threadId, msgId, patch: { intake: { ...m.intake, status: "cancelled" } } });
  }, []);

  const toggleDark = useCallback(() => dispatch({ t: "dark", dark: !stateRef.current.dark }), []);
  const resetDemo = useCallback(() => {
    (api as unknown as { reset?: () => void }).reset?.();
    dispatch({ t: "reset", threads: seedThreads() });
  }, []);

  const value = useMemo<Store>(
    () => ({
      state,
      activeThread,
      newChat,
      openThread,
      send,
      openPanel,
      setPanel,
      sendEditPlan,
      confirmIntake,
      cancelIntake,
      setReviewStatus,
      requestReview,
      refineFromDraft,
      applyOutline,
      toggleDark,
      resetDemo,
      busy,
    }),
    [
      state,
      activeThread,
      newChat,
      openThread,
      send,
      openPanel,
      setPanel,
      sendEditPlan,
      confirmIntake,
      cancelIntake,
      setReviewStatus,
      requestReview,
      refineFromDraft,
      applyOutline,
      toggleDark,
      resetDemo,
      busy,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
