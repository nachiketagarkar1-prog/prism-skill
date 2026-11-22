// Mock Prism backend. Method names follow the suggested endpoints in the developer guides:
//
//   POST /reports | /decks                     -> startJob()
//   POST /{reports|decks}/{id}/turns           -> postTurn()
//   POST /{reports|decks}/{id}/edit-plans      -> submitEditPlan()
//   GET  /{reports|decks}/{id}/versions        -> listVersions()
//
// Swap `mockApi` for an HTTP implementation of `PrismApi` to wire the real backend.
import type { Brief, EditPlan, Job, OutputFile, Region, Skill, Stage, StageListener, StartJobRequest, TurnRequest, TurnResponse, Version } from "../types";
import { PrototypeLimitError, SKILL_NOUN, VersionConflictError } from "../types";
import { coverage, sampleByKey, standardLength, TYPE_LABEL, type SampleEntry } from "./catalog";
import { detectForecast, detectIntent, detectLength, detectRegion, detectType } from "../lib/intent";
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
    ["brief", "Reading the conversation", "Client, question, focus and region", 900],
    ["evidence", "Gathering evidence", "GVR report text, uploads and cited research", 1500],
    ["plan", "Planning chapters", "Lens, object, decision and depth → chapter outline", 1200],
    ["render", "Rendering the report", "Spec → paginated PDF, two-pass contents", 1500],
    ["qa", "Quality checks", "Every figure traced to a source", 1100],
    ["excel", "Exporting data to Excel", "Tables, charts and KPIs, one sheet each", 700],
    ["studio", "Building the report studio", "Interactive studio from the same spec", 800],
    ["deliver", "Delivering", "Versioned PDF and studio", 500],
  ],
  deck: [
    ["brief", "Settling the brief", "Presentation type, market, geography and years", 900],
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

/** "Blood Bank Serology" -> "BloodBankSerology"; keeps capitals such as "GTM". */
const pascal = (s: string) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

/** File stem from what the user asked for, in the skills' naming styles. */
function baseName(brief: Brief): string {
  return brief.skill === "report"
    ? `${pascal(brief.market)}_${pascal(brief.typeLabel)}_${pascal(brief.region)}`
    : `GVR_${pascal(brief.market)}_${brief.typeLabel.split(/\s+/).map(pascal).join("_")}${brief.region === "Global" ? "" : "_" + pascal(brief.region)}`;
}

function filesFor(entry: SampleEntry, version: string, brief: Brief): OutputFile[] {
  const ext = entry.skill === "report" ? "pdf" : "pptx";
  const stem = baseName(brief);
  return [
    {
      kind: ext,
      name: `${stem}_${version}.${ext}`,
      url: entry.primary.url,
      bytes: entry.primary.bytes,
      pages: brief.pagesOverride ?? entry.primary.pages,
      thumb: entry.thumb,
    },
    { kind: "studio", name: `${stem}_${version}_studio.html`, url: entry.studio.url },
    {
      kind: "xlsx",
      name: `${stem}_${version}_data.xlsx`,
      url: entry.data.url,
      bytes: entry.data.bytes,
      sheets: entry.data.sheets,
      preview: entry.data.preview,
    },
  ];
}

function makeVersion(entry: SampleEntry, brief: Brief, version: string, change: string, source: Version["source"]): Version {
  // Published fact-check counts belong to the sample; show them only when the request matches it.
  const matches =
    entry.type === brief.type &&
    entry.region === brief.region &&
    /blood bank serology/i.test(brief.market) &&
    brief.forecast === "2026–2033" &&
    !brief.pagesOverride;
  return { version, date: today(), change, source, files: filesFor(entry, version, brief), sampleKey: entry.key, factcheck: matches ? entry.factcheck : null };
}

/* ---------- mock implementation ---------- */

const JOBS_KEY = "prism.mock.jobs.v1";

/** Earlier builds stored a made-up sample client; drop it so nothing shows a client the user never gave. */
const SAMPLE_CLIENT_RX = /northwind/i;
export function dropSampleClient<T extends { client?: string }>(b: T): T {
  if (b && b.client && SAMPLE_CLIENT_RX.test(b.client)) {
    const { client: _drop, ...rest } = b;
    void _drop;
    return rest as T;
  }
  return b;
}
function loadJobs(): Record<string, Job> {
  const jobs = load<Record<string, Job>>(JOBS_KEY, {});
  for (const j of Object.values(jobs)) j.brief = dropSampleClient(j.brief);
  return jobs;
}

class MockPrismApi implements PrismApi {
  private jobs: Record<string, Job> = loadJobs();
  /** Multiplier on stage timings; lower for faster demos. */
  speed = 1;

  private persist() {
    save(JOBS_KEY, this.jobs);
  }

  allJobs() {
    return this.jobs;
  }

  getJob(id: string) {
    return this.jobs[id];
  }

  async startJob(skill: Skill, req: StartJobRequest, brief: Brief, onStage: StageListener) {
    // Only build what this prototype really has; never substitute another output.
    const cov = coverage(skill, brief.type, brief.region, brief.market, brief.forecast);
    if (!cov.ok) throw new PrototypeLimitError(cov.reasons);
    await runStages(CREATE_STAGES[skill], onStage, this.speed);
    const entry = cov.entry;
    const version = makeVersion(entry, brief, "v1", `First issue: ${brief.typeLabel}, ${brief.region}`, "chat");
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

    // Work out what the turn asks for, then build only if the prototype can really produce it.
    const noun = SKILL_NOUN[job.skill];
    const region: Region = detectRegion(last) ?? job.brief.region;
    const detected = detectType(last);
    const t =
      detected && detected in TYPE_LABEL && detected !== "strategy_mapping" && detected !== "market_overview" ? (detected as Brief["type"]) : job.brief.type;
    const len = detectLength(last);
    const fc = detectForecast(last);
    const newForecast = fc && /\b(forecast|period|horizon|outlook)\b/i.test(last) ? fc : job.brief.forecast;
    const scopeChanged = t !== job.brief.type || region !== job.brief.region || newForecast !== job.brief.forecast;
    const reasons: string[] = [];
    if (len)
      reasons.push(
        `Resizing to ${len.n} ${job.skill === "deck" ? "slides" : "pages"} means re-planning and re-rendering the ${noun}, which needs the live skill.`,
      );
    let cov = scopeChanged ? coverage(job.skill, t, region, job.brief.market, newForecast) : null;
    if (cov && !cov.ok) reasons.push(...cov.reasons);
    if (!scopeChanged && !len) reasons.push(`Rewriting the ${noun} content (“${last.trim().slice(0, 80)}”) needs the live skill.`);
    if (reasons.length || !cov?.ok) {
      await sleep(600 * this.speed);
      return { kind: "not_built", reasons };
    }

    await runStages(UPDATE_STAGES, onStage, this.speed);
    job.brief = {
      ...job.brief,
      type: t,
      typeLabel: TYPE_LABEL[t],
      region,
      forecast: newForecast,
      length: standardLength(job.skill, t),
      pagesOverride: undefined,
    };
    job.title = `${job.brief.market} · ${job.brief.typeLabel}`;
    const v = makeVersion(cov.entry, job.brief, nextVersion(latest.version), `Chat: “${last.trim().slice(0, 90)}”`, "chat");
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
    const ops = Array.isArray(plan.operations) ? plan.operations.length : 0;
    const comments = Array.isArray(plan.comments) ? plan.comments.length : 0;
    const change = `Studio edit plan: ${ops} operation${ops === 1 ? "" : "s"}${comments ? `, ${comments} comment${comments === 1 ? "" : "s"}` : ""}`;
    // Presentation plans are applied to the PPTX by apply_edits.py, which needs the live skill.
    if (job.skill === "deck" || !plan.spec || typeof plan.spec !== "object") {
      throw new PrototypeLimitError([
        job.skill === "deck"
          ? `Your edit plan (${ops} operation${ops === 1 ? "" : "s"}) was received. Applying it to the PowerPoint runs apply_edits.py, which needs the live skill.`
          : `Your edit plan (${ops} operation${ops === 1 ? "" : "s"}) arrived without the edited report spec, so it can't be applied here.`,
      ]);
    }
    stages[0].status = "done";
    await runStages(EDIT_PLAN_STAGES, onStage, this.speed, 1, stages);
    // Report plans carry the full edited spec: the next version renders from it, as apply_edits.py does
    // (version bumped, revision line added). The PDF and Excel are re-rendered by the live build.
    const next = nextVersion(latest.version);
    const spec = JSON.parse(JSON.stringify(plan.spec)) as { meta?: Record<string, unknown>; revision?: unknown[] };
    spec.meta = { ...(spec.meta ?? {}), version: next };
    spec.revision = [...(spec.revision ?? []), { version: next, date: today(), change }];
    const entry = sampleByKey(latest.sampleKey);
    const v: Version = { ...makeVersion(entry, job.brief, next, change, "studio"), spec };
    v.files = v.files.filter((f) => f.kind === "studio");
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
