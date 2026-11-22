// Mock Prism backend. Method names follow the suggested endpoints in the developer guides:
//
//   POST /reports | /decks                     -> startJob()
//   POST /{reports|decks}/{id}/turns           -> postTurn()
//   POST /{reports|decks}/{id}/edit-plans      -> submitEditPlan()
//   GET  /{reports|decks}/{id}/versions        -> listVersions()
//
// Swap `mockApi` for an HTTP implementation of `PrismApi` to wire the real backend.
import type { Brief, EditPlan, Job, OutputFile, Region, Skill, Stage, StageListener, StartJobRequest, TurnRequest, TurnResponse, Version } from "../types";
import { VersionConflictError } from "../types";
import { pickSample, sampleByKey, TYPE_LABEL, type SampleEntry } from "./catalog";
import { detectIntent, detectRegion, detectType } from "../lib/intent";
import { answerFromOutput, nextVersion } from "../lib/answers";
import { load, save, uid } from "../lib/util";

export interface PrismApi {
  startJob(skill: Skill, req: StartJobRequest, brief: Brief, onStage: StageListener): Promise<{ job: Job; version: Version }>;
  postTurn(jobId: string, req: TurnRequest, onStage: StageListener): Promise<TurnResponse>;
  submitEditPlan(jobId: string, plan: EditPlan, onStage: StageListener): Promise<{ job: Job; version: Version }>;
  listVersions(jobId: string): Promise<Version[]>;
  getJob(jobId: string): Job | undefined;
}

/* ---------- stage scripts ---------- */

type StageDef = [key: string, label: string, detail: string, ms: number];

const CREATE_STAGES: Record<Skill, StageDef[]> = {
  report: [
    ["brief", "Reading the conversation", "Client, question, focus, region and audience", 900],
    ["evidence", "Gathering evidence", "GVR report text, uploads and cited research", 1500],
    ["plan", "Planning chapters", "Lens, object, decision and depth → chapter outline", 1200],
    ["render", "Rendering the report", "Spec → paginated PDF, two-pass contents", 1500],
    ["qa", "Quality checks", "Every figure traced to a source", 1100],
    ["excel", "Exporting data to Excel", "Tables, charts and KPIs, one sheet each", 700],
    ["studio", "Building the report studio", "Interactive studio from the same spec", 800],
    ["deliver", "Delivering", "Versioned PDF and studio", 500],
  ],
  deck: [
    ["brief", "Settling the brief", "Presentation type, market, geography, years, audience", 900],
    ["evidence", "Gathering evidence", "GVR inputs first, then whitelisted research", 1500],
    ["plan", "Planning the storyline", "Answer first, one message per slide", 1200],
    ["render", "Rendering on the GVR master", "Native shapes and charts, fit warnings cleared", 1500],
    ["qa", "Quality checks", "Visual QA and silent fact-check", 1100],
    ["excel", "Exporting data to Excel", "Charts, tables and KPIs, one sheet each", 700],
    ["studio", "Building the presentation studio", "Slides, element map and insights", 800],
    ["deliver", "Delivering", "Versioned PPTX and studio", 500],
  ],
};

const UPDATE_STAGES: StageDef[] = [
  ["brief", "Updating the brief", "Adding your request to the conversation record", 700],
  ["plan", "Re-planning", "Applying the change to the spec", 1100],
  ["render", "Rendering", "Rebuilding from the updated spec", 1300],
  ["qa", "Quality checks", "Every figure traced to a source", 900],
  ["excel", "Exporting data to Excel", "Rebuilt from the new version", 500],
  ["studio", "Rebuilding the studio", "New studio for the new version", 600],
  ["deliver", "Delivering", "Previous versions are kept", 400],
];

const EDIT_PLAN_STAGES: StageDef[] = [
  ["validate", "Validating edit plan", "Checking base version against the latest", 600],
  ["apply", "Applying edits", "apply_edits.py on the base version", 1100],
  ["render", "Rendering", "Rebuilding the output", 1200],
  ["qa", "Quality checks", "Every figure traced to a source", 900],
  ["excel", "Exporting data to Excel", "Rebuilt from the new version", 500],
  ["studio", "Rebuilding the studio", "New studio for the new version", 600],
  ["deliver", "Delivering", "Previous versions are kept", 400],
];

export function initialStages(defs: StageDef[]): Stage[] {
  return defs.map(([key, label, detail]) => ({ key, label, detail, status: "pending" }));
}
export const stageDefs = { create: CREATE_STAGES, update: UPDATE_STAGES, editPlan: EDIT_PLAN_STAGES };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runStages(defs: StageDef[], onStage: StageListener, speed: number, from = 0, stages = initialStages(defs)) {
  for (let i = from; i < defs.length; i++) {
    stages[i] = { ...stages[i], status: "running" };
    onStage([...stages]);
    await sleep(defs[i][3] * speed);
    stages[i] = { ...stages[i], status: "done" };
    onStage([...stages]);
  }
}

/* ---------- helpers ---------- */

const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function filesFor(entry: SampleEntry, version: string): OutputFile[] {
  const ext = entry.skill === "report" ? "pdf" : "pptx";
  return [
    {
      kind: ext,
      name: `${entry.baseName}_${version}.${ext}`,
      url: entry.primary.url,
      bytes: entry.primary.bytes,
      pages: entry.primary.pages,
      thumb: entry.thumb,
    },
    { kind: "studio", name: `${entry.baseName}_${version}_studio.html`, url: entry.studio.url },
    {
      kind: "xlsx",
      name: `${entry.baseName}_${version}_data.xlsx`,
      url: entry.data.url,
      bytes: entry.data.bytes,
      sheets: entry.data.sheets,
      preview: entry.data.preview,
    },
  ];
}

function makeVersion(entry: SampleEntry, version: string, change: string, source: Version["source"]): Version {
  return { version, date: today(), change, source, files: filesFor(entry, version), sampleKey: entry.key, factcheck: entry.factcheck };
}

/* ---------- mock implementation ---------- */

const JOBS_KEY = "prism.mock.jobs.v1";

class MockPrismApi implements PrismApi {
  private jobs: Record<string, Job> = load(JOBS_KEY, {});
  /** Multiplier on stage timings; lower for faster demos. */
  speed = 1;

  private persist() {
    save(JOBS_KEY, this.jobs);
  }

  getJob(id: string) {
    return this.jobs[id];
  }

  async startJob(skill: Skill, req: StartJobRequest, brief: Brief, onStage: StageListener) {
    await runStages(CREATE_STAGES[skill], onStage, this.speed);
    const { entry } = pickSample(skill, req.type, req.region ?? "Global");
    const version = makeVersion(entry, "v1", `First issue: ${TYPE_LABEL[brief.type] ?? brief.typeLabel}, ${brief.region}`, "chat");
    const job: Job = {
      id: `${skill === "report" ? "rpt" : "dck"}_${uid()}`,
      skill,
      threadId: req.thread_id,
      title: `${brief.market} · ${brief.typeLabel}`,
      brief,
      versions: [version],
      createdAt: Date.now(),
    };
    this.jobs[job.id] = job;
    this.persist();
    return { job, version };
  }

  async postTurn(jobId: string, req: TurnRequest, onStage: StageListener): Promise<TurnResponse> {
    const job = this.jobs[jobId];
    if (!job) throw new Error(`Unknown job ${jobId}`);
    const last = req.messages[req.messages.length - 1]?.text ?? "";
    const intent = detectIntent(last, "auto", true);
    const latest = job.versions[job.versions.length - 1];

    if (intent.action === "question") {
      await sleep(700 * this.speed);
      return { kind: "answer", markdown: answerFromOutput(job, last), version: latest.version };
    }

    await runStages(UPDATE_STAGES, onStage, this.speed);
    // A scope or type change re-plans onto a different sample where one exists.
    const prev = sampleByKey(latest.sampleKey);
    const region: Region = detectRegion(last) ?? prev.region;
    const t = detectType(last) ?? prev.type;
    const { entry } = pickSample(job.skill, t, region);
    if (entry.type !== job.brief.type || region !== job.brief.region) {
      job.brief = { ...job.brief, type: entry.type, typeLabel: TYPE_LABEL[entry.type], region };
      job.title = `${job.brief.market} · ${job.brief.typeLabel}`;
    }
    const v = makeVersion(entry, nextVersion(latest.version), `Chat: “${last.trim().slice(0, 90)}”`, "chat");
    job.versions.push(v);
    this.persist();
    return { kind: "version", job: { ...job }, version: v };
  }

  async submitEditPlan(jobId: string, plan: EditPlan, onStage: StageListener) {
    const job = this.jobs[jobId];
    if (!job) throw new Error(`Unknown job ${jobId}`);
    const latest = job.versions[job.versions.length - 1];
    const stages = initialStages(EDIT_PLAN_STAGES);
    stages[0].status = "running";
    onStage([...stages]);
    await sleep(EDIT_PLAN_STAGES[0][3] * this.speed);
    if (plan.base_version && plan.base_version !== latest.version) {
      throw new VersionConflictError(plan.base_version, latest.version);
    }
    stages[0].status = "done";
    await runStages(EDIT_PLAN_STAGES, onStage, this.speed, 1, stages);
    const ops = Array.isArray(plan.operations) ? plan.operations.length : 0;
    const comments = Array.isArray(plan.comments) ? plan.comments.length : 0;
    const entry = sampleByKey(latest.sampleKey);
    const change = `Studio edit plan: ${ops} operation${ops === 1 ? "" : "s"}${comments ? `, ${comments} comment${comments === 1 ? "" : "s"}` : ""}`;
    const v = makeVersion(entry, nextVersion(latest.version), change, "studio");
    job.versions.push(v);
    this.persist();
    return { job: { ...job }, version: v };
  }

  async listVersions(jobId: string) {
    return [...(this.jobs[jobId]?.versions ?? [])];
  }

  reset() {
    this.jobs = {};
    this.persist();
  }
}

export const mockApi = new MockPrismApi();
export const api: PrismApi = mockApi;
