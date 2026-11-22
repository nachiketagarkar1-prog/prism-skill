// Lightweight chat-intent detection for the working model. In production the model
// settles the brief (SKILL.md "Settle the brief"); this only routes the turn.
import type { ComposerMode, OutputType, Region, Skill } from "../types";
import { TYPE_LABEL } from "../api/catalog";

export interface Intent {
  /** What the turn should do. */
  action: "answer" | "build" | "change" | "question";
  skill?: Skill;
  type?: OutputType | "strategy_mapping" | "market_overview" | "gtm_strategy";
  region?: Region;
  market?: string;
  /** True when the skill came from an explicit word (deck, pdf…) or the composer toggle. */
  explicitSkill: boolean;
}

const DECK_RX = /\b(deck|slides?|pptx?|power ?point|presentation)\b/i;
const REPORT_RX = /\b(report|pdf|document|study|write-?up)\b/i;
const BUILD_RX = /\b(build|create|make|generate|prepare|draft|produce|put together|turn (this|it) into)\b/i;
const CHANGE_RX =
  /\b(change|update|add|remove|drop|rename|retitle|move|replace|include|exclude|focus|only|switch|swap|shorten|expand|rebuild|redo|make (it|this|slide|section|the)|convert|hide|instead)\b/i;
const NA_RX = /\b(north america|n\.\s?america|u\.s\.?|usa|united states|canada|mexico)\b/i;
const NA_ABBR_RX = /\b(NA|US)\b/; // case-sensitive so "us" (pronoun) doesn't match
const GLOBAL_RX = /\b(global|worldwide|all regions)\b/i;

const TYPE_RULES: [RegExp, Intent["type"]][] = [
  [/\bexec(utive)?[\s-]*(view|summary|brief)?\b/i, "executive_view"],
  [/\bsnapshot\b/i, "market_snapshot"],
  [/\bopportunit(y|ies)\b|\bwhere (is|are) the growth\b/i, "opportunity_assessment"],
  [/\bcompetitive|competitor|landscape|benchmark/i, "competitive_landscape"],
  [/\bgtm\b|go[\s-]to[\s-]market/i, "gtm_strategy"],
  [/\bstrategy mapping|strategic map/i, "strategy_mapping"],
  [/\bmarket summary\b/i, "market_summary"],
  [/\boverview\b/i, "market_overview"],
];

export function detectType(text: string): Intent["type"] {
  for (const [rx, t] of TYPE_RULES) if (rx.test(text)) return t;
  return undefined;
}

export function detectRegion(text: string): Region | undefined {
  if (NA_RX.test(text) || NA_ABBR_RX.test(text)) return "North America";
  if (GLOBAL_RX.test(text)) return "Global";
  return undefined;
}

export function detectMarket(text: string): string | undefined {
  const m =
    text.match(/\b(?:for|on|of|about)\s+(?:the\s+)?(?:global\s+|north american?\s+)?([A-Za-z][\w&\-\s]{2,60}?)\s+market\b/i) ??
    text.match(/\b([A-Z][\w&\-]*(?:\s+[A-Z][\w&\-]*){0,4})\s+market\b/);
  if (!m) return undefined;
  return m[1]
    .trim()
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Detect what a turn wants.
 * @param hasJob whether the thread already has a skill job (follow-up turns).
 */
export function detectIntent(text: string, mode: ComposerMode, hasJob: boolean): Intent {
  const deckWord = DECK_RX.test(text);
  const reportWord = REPORT_RX.test(text);
  const build = BUILD_RX.test(text);
  const type = detectType(text);
  const region = detectRegion(text);
  const market = detectMarket(text);

  let skill: Skill | undefined;
  let explicitSkill = false;
  if (mode === "report" || mode === "deck") {
    // Toggle set by the user (or by picking a home-screen option).
    skill = mode;
    explicitSkill = true;
  } else if (deckWord) {
    skill = "deck";
    explicitSkill = true;
  } else if (reportWord) {
    skill = "report";
    explicitSkill = true;
  }

  // The Answer toggle never swallows an explicit "create a report / presentation" request.
  if (mode === "answer" && !(build && (deckWord || reportWord))) return { action: "answer", explicitSkill: false, region, market };

  if (!hasJob) {
    if (skill && (build || type || mode !== "auto")) return { action: "build", skill, type, region, market, explicitSkill };
    if (build && type) return { action: "build", skill: "report", type, region, market, explicitSkill: false };
    return { action: "answer", explicitSkill: false, region, market };
  }

  // Follow-up turn in a thread with a job.
  if (skill && build) return { action: "build", skill, type, region, market, explicitSkill };
  if (CHANGE_RX.test(text) || (build && (type || region))) return { action: "change", skill, type, region, market, explicitSkill };
  return { action: "question", skill, type, region, market, explicitSkill };
}

/** Human label for the composer hint ("Will build: GVR Presentation · Executive View · North America"). */
export function describeIntent(i: Intent): string | null {
  if (i.action === "answer" || i.action === "question") return null;
  const parts = [i.skill === "deck" ? "GVR Presentation" : "GVR Report"];
  if (i.type) parts.push(TYPE_LABEL[i.type] ?? i.type);
  if (i.region) parts.push(i.region);
  return parts.join(" · ");
}
