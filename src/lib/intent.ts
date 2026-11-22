// Lightweight chat-intent detection for the working model. In production the model
// settles the brief (SKILL.md "Settle the brief"); this only routes the turn.
import type { ComposerMode, OutputType, Region, Skill } from "../types";
import { TYPE_LABEL } from "../api/catalog";

export interface Intent {
  /** What the turn should do. */
  action: "answer" | "build" | "change" | "question" | "export";
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
const EXCEL_RX = /\b(excel|xlsx|spreadsheet|workbook)\b|\bexport (the )?(data|numbers|figures|tables|charts)\b/i;
const CHANGE_RX =
  /\b(change|update|add|remove|drop|rename|retitle|move|replace|include|exclude|focus|only|switch|swap|shorten|shorter|longer|condense|trim|restructure|reorgani[sz]e|fewer|expand|rebuild|redo|make (it|this|slide|section|the)|convert|hide|instead)\b/i;
const NA_ABBR_RX = /\bNA\b/; // case-sensitive
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

// Regions first, then countries (a named country is the geography, not its region).
const GEO_RULES: [RegExp, string][] = [
  [/\bnorth america(n)?\b|\bn\.\s?america\b/i, "North America"],
  [/\b(europe|european|emea)\b/i, "Europe"],
  [/\b(asia[\s-]?pacific|apac)\b/i, "Asia Pacific"],
  [/\b(latin america|latam|south america)\b/i, "Latin America"],
  [/\b(middle east|mea|gcc|africa)\b/i, "Middle East & Africa"],
  [/\b(united states|usa|u\.s\.a?\.?)(?=\W|$)/i, "United States"],
  [/\bUS\b/, "United States"],
  [/\b(united kingdom|u\.k\.|britain)\b|\bUK\b/, "United Kingdom"],
  ...[
    "Canada",
    "Mexico",
    "Brazil",
    "Germany",
    "France",
    "Italy",
    "Spain",
    "China",
    "India",
    "Japan",
    "South Korea",
    "Australia",
    "Saudi Arabia",
    "UAE",
    "South Africa",
    "Oman",
    "Indonesia",
  ].map((c): [RegExp, string] => [new RegExp(`\\b${c}\\b`, "i"), c]),
];

/** "2025-2030", "2026 to 2032" -> "2025–2030"; "through 2030" / "by 2030" -> "2026–2030". */
export function detectForecast(text: string): string | undefined {
  const range = text.match(/\b(20\d\d)\s*(?:-|–|—|to)\s*(20\d\d)\b/i);
  if (range && +range[2] > +range[1]) return `${range[1]}–${range[2]}`;
  const until = text.match(/\b(?:to|through|till|until|by)\s+(20\d\d)\b/i);
  if (until && +until[1] > 2026) return `2026–${until[1]}`;
  return undefined;
}

const FORECAST_WORD_RX = /\b(forecast|period|horizon|outlook to)\b/i;

/** "make it 20 slides" -> {n: 20, unit: "slides"}. */
export function detectLength(text: string): { n: number; unit: "slides" | "pages" } | undefined {
  const m = text.match(/\b(\d{1,3})\s*(slides?|pages?)\b/i);
  if (!m) return undefined;
  return { n: +m[1], unit: /slide/i.test(m[2]) ? "slides" : "pages" };
}

export function detectRegion(text: string): Region | undefined {
  for (const [rx, name] of GEO_RULES) if (rx.test(text)) return name;
  if (NA_ABBR_RX.test(text)) return "North America";
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
  // Every version already carries its Excel export, so asking for it never rebuilds.
  // ("Build a North America deck with the Excel" is still a build: it names a new type or scope.)
  if (EXCEL_RX.test(text) && !(skill && build && (type || region))) return { action: "export", skill, region, market, explicitSkill };
  // "Make it 20 slides" resizes the existing output; it is not a request for a new one.
  if (detectLength(text) && !type && !region) return { action: "change", skill, type, region, market, explicitSkill };
  if (skill && build) return { action: "build", skill, type, region, market, explicitSkill };
  // A stated forecast period or page/slide count on an existing output is a change, even without a verb.
  if (CHANGE_RX.test(text) || (FORECAST_WORD_RX.test(text) && detectForecast(text)) || detectLength(text) || (build && (type || region)))
    return { action: "change", skill, type, region, market, explicitSkill };
  return { action: "question", skill, type, region, market, explicitSkill };
}

/** Human label for the composer hint ("Will build: GVR Presentation · Executive View · North America"). */
export function describeIntent(i: Intent): string | null {
  if (i.action === "answer" || i.action === "question") return null;
  if (i.action === "export") return "Excel export of the latest version";
  const parts = [i.skill === "deck" ? "GVR Presentation" : "GVR Report"];
  if (i.type) parts.push(TYPE_LABEL[i.type] ?? i.type);
  if (i.region) parts.push(i.region);
  return parts.join(" · ");
}
