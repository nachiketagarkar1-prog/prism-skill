import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { BuildState, ChatMessage, ComposerMode, EditPlan, Job, Thread } from "../types";
import { VersionConflictError } from "../types";
import { api, initialStages, stageDefs } from "../api/mockApi";
import { pickSample, TYPE_LABEL } from "../api/catalog";
import { detectIntent, type Intent } from "../lib/intent";
import { genericAnswer } from "../lib/answers";
import { load, save, uid } from "../lib/util";
import { seedThreads } from "../data/seed";

/* ---------- state ---------- */

export interface PanelState {
  jobId: string;
  version: string;
  tab: "studio" | "file" | "versions";
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
    dark: load(DARK_KEY, false),
  };
}

/* ---------- helpers ---------- */

const CLIENT = "Northwind Diagnostics (sample client)";

function makeBrief(intent: Intent, text: string): BuildState["brief"] {
  const skill = intent.skill ?? "report";
  const region = intent.region ?? "Global";
  const { entry, fallbackNote } = pickSample(skill, intent.type, region);
  const assumptions: string[] = [];
  if (!intent.type) assumptions.push(`No ${skill} type stated, so I built a ${TYPE_LABEL[entry.type]}.`);
  if (!intent.region) assumptions.push("No geography stated, so the scope is Global.");
  if (intent.market && !/blood bank/i.test(intent.market))
    assumptions.push(`Working model: the bundled sample covers Blood Bank Serology, not ${intent.market}.`);
  if (fallbackNote) assumptions.push(fallbackNote);
  return {
    skill,
    type: entry.type,
    typeLabel: TYPE_LABEL[entry.type],
    market: entry.market,
    region,
    client: CLIENT,
    question: text.trim(),
    forecast: "2026–2033",
    assumptions,
  };
}

function deliveryNote(job: Job): string {
  const v = job.versions[job.versions.length - 1];
  const f = v.files[0];
  const unit = job.skill === "deck" ? "slides" : "pages";
  const lines = [`**${job.brief.typeLabel}** ${job.skill}, ${job.brief.region}: ${f.pages} ${unit}.`];
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
    document.documentElement.classList.toggle("dark", state.dark);
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

    // New skill job.
    const sameSkill = jobs.filter((j) => j.skill === intent.skill);
    const latestJob = jobs[jobs.length - 1];
    // "make it a deck" in a thread that only has a report → new deck job with the same scope.
    const crossSkill = intent.action === "change" && intent.explicitSkill && !sameSkill.length;
    const noMatch = intent.action === "build" && !sameSkill.some((j) => !intent.type || j.brief.type === intent.type);
    if (crossSkill || noMatch) {
      const brief = makeBrief(
        // Follow-up builds inherit the thread's scope unless the message restates it.
        latestJob ? { ...intent, type: intent.type ?? latestJob.brief.type, region: intent.region ?? latestJob.brief.region } : intent,
        text,
      );
      const build: BuildState = { kind: "create", brief, stages: initialStages(stageDefs.create[brief.skill]), status: "running" };
      dispatch({ t: "addMessage", threadId, msg: { id: asstId, role: "assistant", ts: Date.now(), build } });
      api
        .startJob(brief.skill, { thread_id: threadId, messages: history, uploads, type: brief.type, region: brief.region }, brief, (stages) =>
          dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { stages } }),
        )
        .then(({ job, version }) => {
          dispatch({ t: "setJob", job });
          dispatch({ t: "linkJob", threadId, jobId: job.id });
          dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { status: "done", jobId: job.id, version: version.version, note: deliveryNote(job) } });
          dispatch({ t: "panel", panel: { jobId: job.id, version: version.version, tab: "studio" } });
        })
        .catch((e: Error) => dispatch({ t: "patchBuild", threadId, msgId: asstId, patch: { status: "error", error: e.message } }));
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
            patch: { text: res.markdown, footnote: `Answered from ${target.skill} ${res.version} · no new version` },
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

  const toggleDark = useCallback(() => dispatch({ t: "dark", dark: !stateRef.current.dark }), []);
  const resetDemo = useCallback(() => {
    (api as unknown as { reset?: () => void }).reset?.();
    dispatch({ t: "reset", threads: seedThreads() });
  }, []);

  const value = useMemo<Store>(
    () => ({ state, activeThread, newChat, openThread, send, openPanel, setPanel, sendEditPlan, toggleDark, resetDemo, busy }),
    [state, activeThread, newChat, openThread, send, openPanel, setPanel, sendEditPlan, toggleDark, resetDemo, busy],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
