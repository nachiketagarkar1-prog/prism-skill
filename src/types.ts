// Shared types. The API types mirror the "Platform integration contract"
// sections of the GVR Report Builder and GVR Deck Builder developer guides.

export type Skill = "report" | "deck";
export type ComposerMode = "auto" | "answer" | "report" | "deck";
export type Region = "Global" | "North America";

export type ReportType = "executive_view" | "market_snapshot" | "opportunity_assessment";
export type DeckType = "executive_view" | "market_snapshot" | "opportunity_assessment" | "market_summary" | "competitive_landscape";
export type OutputType = ReportType | DeckType;

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
  client: string;
  question: string;
  forecast: string;
  audience?: string;
  /** Assumptions the skill states in the delivery note (unattended jobs). */
  assumptions: string[];
}

export interface BuildState {
  jobId?: string;
  kind: "create" | "update" | "edit-plan";
  brief: Brief;
  stages: Stage[];
  status: "running" | "done" | "conflict" | "error";
  /** Delivered version label, once done. */
  version?: string;
  note?: string;
  error?: string;
}

/* ---------- Jobs, versions, files ---------- */

export interface OutputFile {
  kind: "pdf" | "pptx" | "studio";
  /** Display filename, versioned (e.g. BloodBankSerology_ExecutiveView_Global_v2.pdf). */
  name: string;
  url: string;
  bytes?: number;
  pages?: number;
  thumb?: string;
}

export interface Version {
  version: string; // "v1", "v2", ...
  date: string;
  change: string; // revision line
  source: "chat" | "studio";
  files: OutputFile[];
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

export type TurnResponse = { kind: "answer"; markdown: string; version: string } | { kind: "version"; job: Job; version: Version };

export type StageListener = (stages: Stage[]) => void;

export class VersionConflictError extends Error {
  constructor(
    public base: string,
    public latest: string,
  ) {
    super(`Edit plan is based on ${base}, but ${latest} is the latest version.`);
  }
}
