import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { SKILL_NOUN } from "../types";
import type { Brief, BriefDraft, OutputType, BuildState, ChatMessage, ComposerMode, EditPlan, Job, Thread } from "../types";
import { VersionConflictError } from "../types";
import { api, initialStages, stageDefs } from "../api/mockApi";
import { OUTPUT_TYPES, TYPE_LABEL } from "../api/catalog";
import { detectIntent, type Intent } from "../lib/intent";
import { genericAnswer } from "../lib/answers";
import { load, save, uid } from "../lib/util";
import { seedThreads } from "../data/seed";

/* ---------- state ---------- */

export interface PanelState {
  jobId: string;
  version: string;
  tab: "studio" | "file" | "excel" | "versions";
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
const JOBS_KEY = "prism.mock.jobs.v1";
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
    messages: t.messages.map((m) =>
      m.build?.status === "running" ? { ...m, build: { ...m.build, status: "error" as const, error: "Interrupted by a page reload." } } : m,
    ),
  }));
  return {
    threads,
    activeId: threads[0]?.id ?? null,
    jobs: load(JOBS_KEY, {}),
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
  const type = intent.type && VALID_TYPES.has(intent.type) ? (intent.type as OutputType) : sameOutput && prev ? prev.brief.type : "";
  return {
    skill: intent.skill ?? "report",
    type,
    market: intent.market ?? prev?.brief.market ?? "",
    region: intent.region ?? prev?.brief.region ?? "",
    includeClient: !!prev?.brief.client,
    client: prev?.brief.client ?? "",
    audience: prev?.brief.audience ?? "",
    question: "",
    sources: prev?.brief.sources ?? { gvr: true, client: uploads.length > 0, urls: urls.length > 0, whitelist: true, web: true },
    files: [...new Set([...(prev?.brief.files ?? []), ...uploads])],
    urls: [...new Set([...(prev?.brief.urls ?? []), ...urls])],
  };
}

function briefFromDraft(d: BriefDraft, text: string): Brief {
  const type = d.type as OutputType;
  return {
    skill: d.skill,
    type,
    typeLabel: TYPE_LABEL[type],
    market: d.market.trim(),
    region: d.region.trim(),
    client: d.includeClient && d.client.trim() ? d.client.trim() : undefined,
    audience: d.audience.trim() || undefined,
    question: d.question.trim() || text.trim(),
    forecast: "2026–2033",
    sources: d.sources,
    files: d.sources.client ? d.files : [],
    urls: d.sources.urls ? d.urls : [],
  };
}

function deliveryNote(job: Job): string {
  const v = job.versions[job.versions.length - 1];
  const f = v.files[0];
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
  toggleDark(): void;
  resetDemo(): void;
  busy: boolean;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const stateRef = useRef(state);
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
    const intent = detectIntent(text, mode, jobs.length > 0);
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
    const crossSkill = intent.action === "change" && intent.explicitSkill && !sameSkill.length;
    const noMatch = intent.action === "build" && !sameSkill.some((j) => !intent.type || j.brief.type === intent.type);
    if (crossSkill || noMatch) {
      // Ask before building: the brief card collects type, market, geography, client name and sources.
      // Later builds in the same thread start from its market, geography, client and sources.
      const draft = draftFromIntent(intent, text, uploads, latestJob, crossSkill);
      const noun = SKILL_NOUN[draft.skill];
      const what = draft.type ? `${TYPE_LABEL[draft.type]} ${noun}` : noun;
      dispatch({
        t: "addMessage",
        threadId,
        msg: {
          id: asstId,
          role: "assistant",
          ts: Date.now(),
          text: `Before I create the ${what}, a few quick questions so it fits your client. I've filled in what your message told me; check it and add anything missing.`,
          intake: { status: "open", draft },
        },
      });
      return;
    }

    // Follow-up on an existing job: answer from it, or build the next version.
    const target = (intent.skill && [...sameSkill].pop()) || jobs[jobs.length - 1];
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
  const startBuild = useCallback((threadId: string, brief: Brief) => {
    const thread = stateRef.current.threads.find((t) => t.id === threadId);
    if (!thread) return;
    const asstId = uid();
    const build: BuildState = { kind: "create", brief, stages: initialStages(stageDefs.create[brief.skill]), status: "running" };
    dispatch({ t: "addMessage", threadId, msg: { id: asstId, role: "assistant", ts: Date.now(), build } });
    api
      .startJob(
        brief.skill,
        { thread_id: threadId, messages: toApiMessages(thread), uploads: brief.files ?? [], type: brief.type, region: brief.region },
        brief,
        (stages) => dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { stages } }),
      )
      .then(({ job, version }) => {
        dispatch({ t: "setJob", job });
        dispatch({ t: "linkJob", threadId, jobId: job.id });
        dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { status: "done", jobId: job.id, version: version.version, note: deliveryNote(job) } });
        dispatch({ t: "panel", panel: { jobId: job.id, version: version.version, tab: "studio" } });
      })
      .catch((e: Error) => dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { status: "error", error: e.message } }));
  }, []);

  const confirmIntake = useCallback(
    (threadId: string, msgId: string, draft: BriefDraft) => {
      const thread = stateRef.current.threads.find((t) => t.id === threadId);
      const idx = thread?.messages.findIndex((m) => m.id === msgId) ?? -1;
      // The request that opened the card is the user turn just before it.
      const request = idx > 0 ? (thread!.messages[idx - 1].text ?? "") : "";
      dispatch({ t: "patchMessage", threadId, msgId, patch: { intake: { status: "confirmed", draft } } });
      startBuild(threadId, briefFromDraft(draft, request));
    },
    [startBuild],
  );

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
    () => ({ state, activeThread, newChat, openThread, send, openPanel, setPanel, sendEditPlan, confirmIntake, cancelIntake, toggleDark, resetDemo, busy }),
    [state, activeThread, newChat, openThread, send, openPanel, setPanel, sendEditPlan, confirmIntake, cancelIntake, toggleDark, resetDemo, busy],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
