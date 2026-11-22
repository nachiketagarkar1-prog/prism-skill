// Shared types. The API types mirror the "Platform integration contract"
// sections of the GVR Report Builder and GVR Deck Builder developer guides.

export type Skill = "report" | "deck";
/** User-facing noun for each skill. Internally the deck skill stays "deck"; users see "presentation". */
export const SKILL_NOUN: Record<Skill, string> = { report: "report", deck: "presentation" };
export type ComposerMode = "auto" | "answer" | "report" | "deck";
/** Geography as the user chose it ("Global", "North America", "Germany", ...). */
export type Region = string;

/** Output types offered for both reports and presentations. */
export type OutputType =
  | "executive_view"
  | "market_snapshot"
  | "competitive_landscape"
  | "gtm_strategy"
  | "opportunity_assessment"
  | "market_summary"
  /** Any other research output on GVR methodology, described by the client (Brief.typeLabel). */
  | "custom";
export type ReportType = OutputType;
export type DeckType = OutputType;

/**
 * Evidence the skill may use, in the skills' order of precedence (references/sources.md):
 * GVR report / ME workbook > client documents > grandviewresearch.com and whitelisted sites > other cited web research.
 */
export interface SourceChoice {
  gvr: boolean; // GVR report PDF / ME workbook
  client: boolean; // client documents (PDF, DOCX, PPTX, XLSX, CSV)
  urls: boolean; // specific web pages the client points to
  whitelist: boolean; // grandviewresearch.com + whitelisted domains
  web: boolean; // other reputable sources, cited, to fill gaps only
}

/* ---------- Chat ---------- */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  ts: number;
  /** Plain text for user turns; markdown for assistant answers. */
  text?: string;
  /** Files the user attached to this turn (names only in the working model). */
  uploads?: string[];
  /** Present when this assistant turn is (or was) a skill build. */
  build?: BuildState;
  /** Small label under an assistant answer, e.g. "Answered from Deck v2 · no new version". */
  footnote?: string;
  /** A delivered file shown under the message (e.g. the Excel export asked for in chat). */
  attachment?: { jobId: string; version: string; kind: "xlsx" };
  /** Brief questions asked before a skill runs; the build starts only once the user confirms. */
  intake?: Intake;
  /** A request sent to a GVR analyst for validation (instead of an automatic build). */
  review?: AnalystReview;
}

export interface AnalystReview {
  id: string;
  brief: Brief;
  /** Why the request needs validation (client documents, external web data, data beyond the GVR report...). */
  reasons: string[];
  /** offered: suggested after a chat request the loaded GVR report can't cover; the user decides. */
  status: "offered" | "submitted" | "withdrawn" | "declined";
  /** The chat request being reviewed, for follow-ups on an existing output. */
  request?: string;
  submittedAt: number;
}

export interface Intake {
  status: "open" | "confirmed" | "cancelled";
  draft: BriefDraft;
  /**
   * quick: only the essentials missing from the request (type, market, geography), asked before building.
   * refine: the full brief, shown after delivery (or after sending to an analyst) to tailor the next version.
   * Missing on cards saved by older builds, which used the full brief before building.
   */
  mode?: "quick" | "refine";
  /** refine: the job the brief belongs to (its next version), or the analyst review it updates. */
  jobId?: string;
  reviewMsgId?: string;
}

/** What the brief card collects. Empty strings mean "not answered yet". */
export interface BriefDraft {
  skill: Skill;
  type: OutputType | "";
  market: string;
  region: string;
  /** Forecast period, e.g. "2026–2033". */
  forecast: string;
  includeClient: boolean;
  client: string;
  /** For type "custom": the report the client describes, e.g. "Pricing analysis". */
  customType: string;
  question: string;
  sources: SourceChoice;
  /** Send to a GVR analyst for validation instead of building automatically. */
  analystReview: boolean;
  files: string[];
  urls: string[];
}

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  certified: boolean;
  messages: ChatMessage[];
  /** Skill jobs started from this thread (one per skill + output type). */
  jobIds: string[];
}

/* ---------- Build progress ---------- */

export type StageStatus = "pending" | "running" | "done";

export interface Stage {
  key: string;
  label: string;
  detail: string;
  status: StageStatus;
}

export interface Brief {
  skill: Skill;
  type: OutputType;
  typeLabel: string;
  market: string;
  region: Region;
  /** "Prepared for" name; omitted unless the user chose to add one. */
  client?: string;
  question: string;
  /** The decision the client wants supported, if they gave one. */
  decision?: string;
  forecast: string;
  /** Length as delivered: the type's standard length until the client asks to change it in chat. */
  length?: string;
  /** Page or slide count the client asked for in chat, if any. */
  pagesOverride?: number;
  audience?: string;
  /** Evidence the user allowed, plus the client files and URLs given. Optional for builds made before the brief card. */
  sources?: SourceChoice;
  files?: string[];
  urls?: string[];
}

export interface BuildState {
  jobId?: string;
  kind: "create" | "update" | "edit-plan";
  brief: Brief;
  stages: Stage[];
  status: "running" | "done" | "conflict" | "error" | "not_built";
  /** Delivered version label, once done. */
  version?: string;
  note?: string;
  error?: string;
}

/* ---------- Jobs, versions, files ---------- */

export interface OutputFile {
  kind: "pdf" | "pptx" | "studio" | "xlsx";
  /** Display filename, versioned (e.g. BloodBankSerology_ExecutiveView_Global_v2.pdf). */
  name: string;
  url: string;
  bytes?: number;
  pages?: number;
  thumb?: string;
  /** xlsx: number of sheets and the JSON preview used by the Excel tab. */
  sheets?: number;
  preview?: string;
}

export interface Version {
  version: string; // "v1", "v2", ...
  date: string;
  change: string; // revision line
  source: "chat" | "studio";
  files: OutputFile[];
  /** Report spec after a studio edit plan; the studio renders this version from it. */
  spec?: unknown;
  /** Sample catalog entry backing this version (working model only). */
  sampleKey: string;
  /** Internal only; the client UI shows at most a one-line summary (deck notes). */
  factcheck: { traced: number; total: number } | null;
}

export interface Job {
  id: string;
  skill: Skill;
  threadId: string;
  title: string;
  brief: Brief;
  versions: Version[];
  createdAt: number;
}

/** Edit plan as produced by GVRStudio.plan() (report) or plan() (deck). Loosely typed. */
export interface EditPlan {
  skill?: string;
  action?: string;
  base_version?: string;
  target_version?: string;
  operations?: unknown[];
  comments?: unknown[];
  [k: string]: unknown;
}

/* ---------- API request / response shapes ---------- */

export interface StartJobRequest {
  thread_id: string;
  messages: { role: "user" | "assistant"; text: string; ts: number }[];
  uploads: string[];
  /** report_type / deck_type hint from the chat layer, if known. */
  type?: OutputType;
  region?: Region;
}

export interface TurnRequest {
  messages: { role: "user" | "assistant"; text: string; ts: number }[];
  uploads: string[];
}

export type TurnResponse =
  | { kind: "answer"; markdown: string; version: string }
  | { kind: "version"; job: Job; version: Version }
  /** The request can't be carried out by this prototype; nothing was built and no version was made. */
  | { kind: "not_built"; reasons: string[] };

export type StageListener = (stages: Stage[]) => void;

/** Thrown when the prototype can't carry out a request (no substitute output is produced). */
export class PrototypeLimitError extends Error {
  constructor(public reasons: string[]) {
    super(reasons.join(" "));
  }
}

export class VersionConflictError extends Error {
  constructor(
    public base: string,
    public latest: string,
  ) {
    super(`Edit plan is based on ${base}, but ${latest} is the latest version.`);
  }
}
