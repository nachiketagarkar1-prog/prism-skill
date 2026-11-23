// Mock Prism backend. Method names follow the suggested endpoints in the developer guides:
//
//   POST /reports | /decks                     -> startJob()
//   POST /{reports|decks}/{id}/turns           -> postTurn()
//   POST /{reports|decks}/{id}/edit-plans      -> submitEditPlan()
//   GET  /{reports|decks}/{id}/versions        -> listVersions()
//
// Swap `mockApi` for an HTTP implementation of `PrismApi` to wire the real backend.
import type { Brief, EditPlan, Job, OutlineChapter, OutputFile, Region, Skill, Stage, StageListener, StartJobRequest, TurnRequest, TurnResponse, Version } from "../types";
import { PrototypeLimitError, SKILL_NOUN, VersionConflictError } from "../types";
import { coverage, SAMPLES, sampleByKey, standardLength, TYPE_LABEL, type SampleEntry } from "./catalog";
import { baseSpecFile, composeReport, gapList } from "../lib/compose";
import { detectForecast, detectIntent, detectLength, detectRegion, detectType } from "../lib/intent";
import { answerFromOutput, nextVersion } from "../lib/answers";
import { load, save, uid } from "../lib/util";
import {
  applyOutlineCommand,
  matchToGvr,
  outlineFromDeckSpec,
  outlineFromReportSpec,
  parseOutlineCommand,
  parseToc,
  type SpecResolver,
} from "../lib/outline";

export interface PrismApi {
  startJob(skill: Skill, req: StartJobRequest, brief: Brief, onStage: StageListener): Promise<{ job: Job; version: Version }>;
  postTurn(jobId: string, req: TurnRequest, onStage: StageListener): Promise<TurnResponse>;
  submitEditPlan(jobId: string, plan: EditPlan, onStage: StageListener): Promise<{ job: Job; version: Version }>;
  refineJob(jobId: string, brief: Brief, change: string, onStage: StageListener): Promise<{ job: Job; version: Version }>;
  listVersions(jobId: string): Promise<Version[]>;
  /** GET /{reports|decks}/{id}/versions/{v}/outline: the version's table of contents, each entry linked to its content. */
  getOutline(jobId: string, version?: string): Promise<OutlineChapter[]>;
  /** The GVR report's own outline for the job's market and scope: sections the client can add back. */
  getGvrOutline(jobId: string): Promise<{ standard: OutlineChapter[]; library: OutlineChapter[] }>;
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

/** Spec behind a bundled sample (what its studio renders). */
export function sampleSpecUrl(entry: SampleEntry): string {
  return entry.skill === "deck"
    ? `samples/specs/decks/${entry.type}.json`
    : `samples/specs/blood_bank_${entry.type}_${entry.region === "North America" ? "north_america" : "global"}.json`;
}

const specCache = new Map<string, Promise<unknown>>();
const fetchJson = (url: string) => {
  if (!specCache.has(url)) specCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : undefined)));
  return specCache.get(url)!;
};

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

  /**
   * Build a version for a brief. Bundled outputs are used when they match exactly; any other report is
   * composed from the GVR report spec with every gap highlighted. New presentations need the server renderer.
   */
  private resolver(job?: Job): SpecResolver {
    return async (ref) => {
      if (ref.src.startsWith("job:")) return job?.versions.find((v) => v.version === ref.src.slice(4))?.spec as never;
      return (await fetchJson(ref.src)) as never;
    };
  }

  /** The GVR outline for this brief's report type (the "GVR standard" table of contents). */
  private async gvrStandard(brief: Brief): Promise<OutlineChapter[]> {
    if (brief.skill === "deck" || !/blood\s*bank\s*serology/i.test(brief.market)) return [];
    const url = baseSpecFile(brief);
    const spec = (await fetchJson(url)) as { chapters: never[] } | undefined;
    return spec ? outlineFromReportSpec(spec, url) : [];
  }

  /**
   * Everything the GVR report covers for this market and geography, across its report types: what a client's
   * TOC is matched against, so "Market Share" or "Global Market" pick up GVR content even if this type lacks them.
   * The standard outline comes first so its sections win ties; repeated section titles are listed once.
   */
  private async gvrOutline(brief: Brief): Promise<OutlineChapter[]> {
    const standard = await this.gvrStandard(brief);
    if (!standard.length) return [];
    const region = brief.region === "North America" ? "north_america" : "global";
    const urls = ["executive_view", "market_snapshot", "opportunity_assessment"]
      .map((t) => `samples/specs/blood_bank_${t}_${region}.json`)
      .filter((u) => u !== baseSpecFile(brief));
    const seen = new Set(standard.flatMap((c) => c.sections.map((s) => s.title.toLowerCase())));
    const more: OutlineChapter[] = [];
    for (const url of urls) {
      const spec = (await fetchJson(url)) as { chapters: never[] } | undefined;
      if (!spec) continue;
      for (const c of outlineFromReportSpec(spec, url)) {
        const sections = c.sections.filter((s) => s.ref && !seen.has(s.title.toLowerCase()) && !/^(at a glance|scope|sources|methodology)/i.test(s.title));
        sections.forEach((s) => seen.add(s.title.toLowerCase()));
        if (sections.length) more.push({ ...c, sections });
      }
    }
    return [...standard, ...more];
  }

  /** Turn a TOC pasted in the request into an outline matched to the GVR report's sections. */
  private async withOutline(brief: Brief): Promise<Brief> {
    if (!brief.tocText || brief.outline) return brief;
    const parsed = parseToc(brief.tocText);
    const { tocText: _t, ...rest } = brief;
    void _t;
    return parsed.length ? { ...rest, outline: matchToGvr(parsed, await this.gvrOutline(brief)) } : rest;
  }

  async getGvrOutline(jobId: string) {
    const job = this.jobs[jobId];
    if (!job) return { standard: [], library: [] };
    return { standard: await this.gvrStandard(job.brief), library: await this.gvrOutline(job.brief) };
  }

  async getOutline(jobId: string, version?: string): Promise<OutlineChapter[]> {
    const job = this.jobs[jobId];
    if (!job) return [];
    const v = job.versions.find((x) => x.version === version) ?? job.versions[job.versions.length - 1];
    if (v.spec) return outlineFromReportSpec(v.spec as never, `job:${v.version}`);
    if (job.skill === "deck" && job.brief.outline) return job.brief.outline;
    const url = sampleSpecUrl(sampleByKey(v.sampleKey));
    const spec = await fetchJson(url);
    if (!spec) return [];
    return job.skill === "deck" ? outlineFromDeckSpec(spec as never, url) : outlineFromReportSpec(spec as never, url);
  }

  private async buildVersion(skill: Skill, brief: Brief, version: string, change: string, source: Version["source"], job?: Job): Promise<Version> {
    const cov = coverage(skill, brief.type, brief.region, brief.market, brief.forecast, brief.typeLabel);
    if (cov.ok && !brief.outline) return makeVersion(cov.entry, brief, version, change, source);
    if (skill === "deck") {
      throw new PrototypeLimitError([
        brief.outline
          ? "Re-planning a presentation to a new outline runs the presentation skill's PowerPoint renderer on the server, which this prototype doesn't include. Reports can be restructured here."
          : "Creating this presentation runs the presentation skill's PowerPoint renderer on the server, which this prototype doesn't include. Reports of any kind can be created here.",
      ]);
    }
    const gaps = gapList(brief);
    const spec = (await composeReport(brief, gaps, this.resolver(job))) as { meta: Record<string, unknown>; revision: unknown[] };
    spec.meta.version = version;
    // The studio file carries the renderer, fonts and cover; the composed spec replaces its content.
    const host = SAMPLES.find((e) => e.skill === "report" && `samples/specs/blood_bank_${e.type}_${e.region === "Global" ? "global" : "north_america"}.json` === baseSpecFile(brief))!;
    const v: Version = { ...makeVersion(host, brief, version, change, source), spec, gaps, factcheck: null };
    v.files = v.files.filter((f) => f.kind === "studio");
    return v;
  }

  async startJob(skill: Skill, req: StartJobRequest, requested: Brief, onStage: StageListener) {
    const brief = skill === "deck" ? requested : await this.withOutline(requested);
    if (skill === "deck" && (requested.tocText || !coverage(skill, brief.type, brief.region, brief.market, brief.forecast, brief.typeLabel).ok)) {
      if (requested.tocText) throw new PrototypeLimitError(["Building a presentation to your own outline runs the presentation skill's PowerPoint renderer on the server, which this prototype doesn't include. Reports can follow your table of contents here."]);
      await this.buildVersion(skill, brief, "v1", "", "chat"); // throws with the reason
    }
    await runStages(CREATE_STAGES[skill], onStage, this.speed);
    const version = await this.buildVersion(
      skill,
      brief,
      "v1",
      `First issue: ${brief.typeLabel}, ${brief.region}${brief.outline ? `, to the client's table of contents (${brief.outline.length} chapters)` : ""}`,
      "chat",
    );
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

    // Table-of-contents changes: add, remove, rename, move chapters or sections, or replace the TOC.
    const cmd = parseOutlineCommand(last);
    if (cmd) {
      const current = await this.getOutline(jobId);
      const res = applyOutlineCommand(current, cmd, await this.gvrOutline(job.brief));
      if ("error" in res) {
        await sleep(400 * this.speed);
        return { kind: "answer", markdown: res.error, version: latest.version };
      }
      if (job.skill === "deck") {
        await sleep(500 * this.speed);
        return {
          kind: "not_built",
          reasons: [`${res.change}: re-planning the presentation to the new outline runs the PowerPoint renderer on the server, which this prototype doesn't include.`],
        };
      }
      await runStages(UPDATE_STAGES, onStage, this.speed);
      const brief = { ...job.brief, outline: res.outline };
      const v = await this.buildVersion(job.skill, brief, nextVersion(latest.version), res.change, "chat", job);
      job.brief = brief;
      job.versions.push(v);
      this.persist();
      return { kind: "version", job: { ...job }, version: v };
    }

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
    // Reports: any scope change is built (gaps highlighted). Presentations: only bundled ones can be rendered here.
    const cov = scopeChanged ? coverage(job.skill, t, region, job.brief.market, newForecast) : null;
    if (cov && !cov.ok && job.skill === "deck")
      reasons.push("Rendering a presentation for that scope runs the PowerPoint renderer on the server, which this prototype doesn't include.");
    if (!scopeChanged && !len) reasons.push(`Rewriting the ${noun} content (“${last.trim().slice(0, 80)}”) needs the live skill.`);
    if (reasons.length) {
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
    const v = await this.buildVersion(job.skill, job.brief, nextVersion(latest.version), `Chat: “${last.trim().slice(0, 90)}”`, "chat", job);
    job.versions.push(v);
    this.persist();
    return { kind: "version", job: { ...job }, version: v };
  }

  /** Next version from a refined brief (client name, decision, scope, sources). Built only if the loaded GVR report covers it. */
  async refineJob(jobId: string, requested: Brief, change: string, onStage: StageListener) {
    const job = this.jobs[jobId];
    if (!job) throw new Error(`Unknown job ${jobId}`);
    let brief = requested;
    // A pasted TOC replaces the outline; matched to the GVR sections.
    if (brief.tocText) brief = await this.withOutline({ ...brief, outline: undefined });
    if (job.skill === "deck" && (brief.outline || !coverage(job.skill, brief.type, brief.region, brief.market, brief.forecast, brief.typeLabel).ok)) {
      await this.buildVersion(job.skill, brief, "", "", "chat"); // throws with the reason
    }
    await runStages(UPDATE_STAGES, onStage, this.speed);
    const latest = job.versions[job.versions.length - 1];
    const v = await this.buildVersion(job.skill, brief, nextVersion(latest.version), change, "chat", job);
    job.brief = brief;
    job.title = `${brief.market} · ${brief.typeLabel}`;
    job.versions.push(v);
    this.persist();
    return { job: { ...job }, version: v };
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
