// Catalog of the sample outputs bundled from the two skill zips (public/samples).
// The mock API serves these in place of real worker output.
import type { DeckType, Region, ReportType, Skill } from "../types";

export interface SampleEntry {
  key: string;
  skill: Skill;
  type: ReportType | DeckType;
  region: Region;
  market: string;
  title: string;
  subtitle: string;
  /** Base filename without version suffix or extension. */
  baseName: string;
  primary: { url: string; bytes: number; pages: number };
  studio: { url: string };
  thumb: string;
  /** Contact sheet image (decks) for the slides tab. */
  sheet?: string;
  factcheck: { traced: number; total: number } | null;
  headline: string;
}

const R = "/samples/reports/";
const D = "/samples/decks/";
const T = "/samples/thumbs/";

export const TYPE_LABEL: Record<string, string> = {
  executive_view: "Executive View",
  market_snapshot: "Market Snapshot",
  opportunity_assessment: "Opportunity Assessment",
  market_summary: "Market Summary",
  competitive_landscape: "Competitive Landscape",
  strategy_mapping: "Strategy Mapping",
  market_overview: "Market Overview",
};

const MARKET = "Blood Bank Serology";

function report(
  type: ReportType,
  region: Region,
  file: string,
  bytes: number,
  pages: number,
  subtitle: string,
  headline: string,
  fc: [number, number] | null,
): SampleEntry {
  return {
    key: `report:${type}:${region}`,
    skill: "report",
    type,
    region,
    market: MARKET,
    title: `${MARKET} Market`,
    subtitle,
    baseName: file,
    primary: { url: `${R}${file}_v1.pdf`, bytes, pages },
    studio: { url: `${R}${file}_v1_studio.html` },
    thumb: `${T}${file}_v1.jpg`,
    factcheck: fc ? { traced: fc[0], total: fc[1] } : null,
    headline,
  };
}

function deck(type: DeckType, file: string, bytes: number, pages: number, subtitle: string, headline: string, fc: [number, number] | null): SampleEntry {
  const sheetKey = type;
  return {
    key: `deck:${type}:Global`,
    skill: "deck",
    type,
    region: "Global",
    market: MARKET,
    title: `${MARKET} Market`,
    subtitle,
    baseName: `GVR_BloodBank_${file.replace(/_v\d+$/, "")}`,
    primary: { url: `${D}GVR_BloodBank_${file}.pptx`, bytes, pages },
    studio: { url: `${D}GVR_BloodBank_${file}_studio.html` },
    thumb: `${T}deck_${sheetKey}_cover.jpg`,
    sheet: `${T}${sheetKey}.jpg`,
    factcheck: fc ? { traced: fc[0], total: fc[1] } : null,
    headline,
  };
}

// Fact-check counts come from the developer guides where published (deck Market Summary and
// Opportunity Assessment, report Global Opportunity Assessment); null where no count was published.
export const SAMPLES: SampleEntry[] = [
  report(
    "executive_view",
    "Global",
    "BloodBankSerology_ExecutiveView_Global",
    247796,
    11,
    "Executive View: Market Reality, Positioning and Priorities",
    "A USD 3.3 Bn market (2025) growing at 7.45% to USD 5,893.1 Mn by 2033.",
    null,
  ),
  report(
    "executive_view",
    "North America",
    "BloodBankSerology_ExecutiveView_NorthAmerica",
    232855,
    11,
    "Executive View: North America Market Reality, Positioning and Priorities",
    "North America holds 41.3% of global revenue; the U.S. is 83.85% of the region.",
    null,
  ),
  report(
    "market_snapshot",
    "Global",
    "BloodBankSerology_MarketSnapshot_Global",
    220634,
    10,
    "Market Snapshot: Blood Bank Serology Market Analysis, 2025 – 2033",
    "USD 3,329.3 Mn in 2025; 7.45% CAGR 2026–2033.",
    null,
  ),
  report(
    "market_snapshot",
    "North America",
    "BloodBankSerology_MarketSnapshot_NorthAmerica",
    204721,
    9,
    "Market Snapshot: North America Blood Bank Serology Market Analysis, 2025 – 2033",
    "North America is the largest region at 41.3% share (2025).",
    null,
  ),
  report(
    "opportunity_assessment",
    "Global",
    "BloodBankSerology_OpportunityAssessment_Global",
    545216,
    18,
    "Opportunity Assessment: Where the USD 2.6 Billion of Growth Sits, 2025 – 2033",
    "USD 2.6 Bn of incremental revenue to 2033; hospital transfusion labs add the most.",
    [256, 256],
  ),
  report(
    "opportunity_assessment",
    "North America",
    "BloodBankSerology_OpportunityAssessment_NorthAmerica",
    380795,
    15,
    "Opportunity Assessment: North America (U.S., Canada, Mexico), 2025 – 2033",
    "Sequencing the U.S., Canada and Mexico by incremental revenue and entry ease.",
    null,
  ),

  deck(
    "executive_view",
    "Executive_View_v3",
    380416,
    8,
    "Strategic synthesis for transfusion diagnostics suppliers: where value sits and how to position for 2033",
    "USD 3,329.3 Mn (2025) → USD 5,893.1 Mn (2033) at 7.45% CAGR.",
    null,
  ),
  deck(
    "market_snapshot",
    "Market_Snapshot_v3",
    366755,
    6,
    "Market Snapshot | Size, segments and dynamics",
    "Snapshot of size, growth, segments and market dynamics.",
    null,
  ),
  deck(
    "opportunity_assessment",
    "Opportunity_Assessment_v3",
    407408,
    16,
    "Where the USD 2.6 billion of new revenue will come from, and how suppliers can capture it",
    "USD 2.6 Bn of new revenue; hospital transfusion labs add USD 1.1 Bn.",
    [155, 155],
  ),
  deck(
    "market_summary",
    "Market_Summary_v5",
    1102944,
    30,
    "Market Summary | Size, Growth, Segments, Regions & Competition | 2021–2033",
    "Full market summary: size, drivers, segments, regions and competition.",
    [268, 268],
  ),
  deck(
    "competitive_landscape",
    "Competitive_Landscape_v3",
    365391,
    8,
    "Competitive Landscape & Benchmarking",
    "Shares, leaders, strategic moves and benchmarks across key suppliers.",
    null,
  ),
];

export const REPORT_TYPES: ReportType[] = ["executive_view", "market_snapshot", "opportunity_assessment"];
export const DECK_TYPES: DeckType[] = ["executive_view", "market_snapshot", "opportunity_assessment", "market_summary", "competitive_landscape"];

/** Find the closest sample for a request. Returns the entry plus a note when it is a fallback. */
export function pickSample(skill: Skill, type: string | undefined, region: Region): { entry: SampleEntry; fallbackNote?: string } {
  const pool = SAMPLES.filter((s) => s.skill === skill);
  const byType = pool.filter((s) => s.type === type);
  const exact = byType.find((s) => s.region === region) ?? byType[0];
  if (exact) {
    const note = exact.region !== region ? `Sample deck is ${exact.region}; a ${region} deck would filter evidence by geography.` : undefined;
    return { entry: exact, fallbackNote: note };
  }
  const fallbackType = skill === "report" ? "opportunity_assessment" : "market_summary";
  const entry = pool.find((s) => s.type === fallbackType && s.region === region) ?? pool.find((s) => s.type === fallbackType)!;
  return {
    entry,
    fallbackNote: type ? `No ${TYPE_LABEL[type] ?? type} sample is bundled, so the closest sample (${TYPE_LABEL[entry.type]}) is shown.` : undefined,
  };
}

export function sampleByKey(key: string): SampleEntry {
  return SAMPLES.find((s) => s.key === key)!;
}
