// Compose a report spec for requests the bundled outputs don't cover (custom types, other geographies,
// other markets, client documents...). Figures come only from the loaded GVR report specs; everything
// else is stated as a highlighted gap ("Not from the GVR report"), never estimated. The spec is rendered
// by the report skill's own renderer inside the studio.
import type { Brief, BriefDraft } from "../types";
import { PROTOTYPE_FORECAST, TYPE_LABEL } from "../api/catalog";

/** Label the studio highlights (amber) wherever it appears on a callout. */
export const GAP_LABEL = "Not from the GVR report";

type Block = Record<string, unknown> & { type: string };
interface Section {
  title: string;
  blocks: Block[];
  subsections?: { title: string; blocks: Block[] }[];
}
interface Chapter {
  title: string;
  sections: Section[];
}
interface Spec {
  meta: Record<string, unknown>;
  brief: Record<string, unknown>;
  revision: { version: string; date: string; change: string }[];
  chapters: Chapter[];
  [k: string]: unknown;
}

const isGvrMarket = (m: string) => /blood\s*bank\s*serology/i.test(m);
const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** What in this brief is not from the loaded GVR report, in plain words. Empty when the report covers it all. */
export function gapList(b: Brief): string[] {
  const gaps: string[] = [];
  const research = b.sources?.web ? "cited web research" : "";
  const docs = b.sources?.client && b.files?.length ? "the client documents" : "";
  const from = [docs, research].filter(Boolean).join(" and ") || "sources you add";
  if (!isGvrMarket(b.market)) gaps.push(`${b.market}: no GVR report is loaded for this market, so every figure must come from ${from}.`);
  const known = ["Global", "North America"];
  if (isGvrMarket(b.market) && !known.includes(b.region))
    gaps.push(`${b.region}: the GVR report has no ${b.region} split. Global figures are shown for reference and labelled as such.`);
  if (b.type === "custom" || !["executive_view", "market_snapshot", "opportunity_assessment"].includes(b.type))
    gaps.push(`${b.typeLabel}: the analysis specific to this report type isn't in the GVR report; it needs ${from}.`);
  if (b.forecast !== PROTOTYPE_FORECAST)
    gaps.push(`${b.forecast} forecast: the GVR report publishes ${PROTOTYPE_FORECAST}; only published years are used, nothing is interpolated.`);
  if (b.sources?.client && b.files?.length) gaps.push(`Client documents (${b.files.join(", ")}): cited as client-provided data, not GVR figures.`);
  if (b.sources?.urls && b.urls?.length) gaps.push(`Web pages (${b.urls.length}): cited with URL and date, not GVR figures.`);
  return gaps;
}

/** The same list for a brief card draft (before it becomes a Brief). */
export function draftGaps(d: BriefDraft): string[] {
  if (!d.type) return [];
  return gapList({
    skill: d.skill,
    type: d.type,
    typeLabel: d.type === "custom" ? d.customType.trim() || "Custom research" : TYPE_LABEL[d.type],
    market: d.market.trim(),
    region: d.region.trim(),
    forecast: d.forecast.trim().replace(/\s*[-—–]\s*/, "–"),
    question: "",
    sources: d.sources,
    files: d.sources.client ? d.files : [],
    urls: d.sources.urls ? d.urls : [],
  });
}

const gap = (text: string): Block => ({ type: "callout", label: GAP_LABEL, text });

/** Pick the GVR spec to build on: same type if it exists, else the broadest one; same region if available, else Global. */
export function baseSpecFile(b: Brief): string {
  const type = ["executive_view", "market_snapshot", "opportunity_assessment"].includes(b.type) ? b.type : "opportunity_assessment";
  const region = b.region === "North America" ? "north_america" : "global";
  return `samples/specs/blood_bank_${type}_${region}.json`;
}

export async function composeReport(b: Brief, gaps: string[]): Promise<Spec> {
  const forecastTo = Number(b.forecast.slice(-4)) || 2033;
  const subtitle = `${b.typeLabel}: ${b.region}, ${b.forecast}`;
  const meta = {
    market: b.market,
    title: `${b.market} Market`,
    subtitle,
    scope_title: `${b.typeLabel} | ${b.region}`,
    footer_title: `${b.market} Market: ${b.typeLabel} (${b.region})`,
    forecast: b.forecast,
    forecast_to: forecastTo,
    edition: new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    version: "v1",
    year: new Date().getFullYear(),
    ...(b.client ? { prepared_for: b.client } : {}),
  };
  const brief = { question: b.decision || b.question, region: b.region, ...(b.client ? { client: b.client } : {}) };
  const revision = [{ version: "v1", date: today(), change: `First issue: ${b.typeLabel}, ${b.region}, requested in the Prism conversation` }];
  const summary = gap(`Parts of this ${b.typeLabel} are not from the GVR report and are marked like this. ${gaps.join(" ")}`);
  const sourcesLine = [
    b.sources?.gvr && "GVR report (primary)",
    b.sources?.client && (b.files?.length ? `client documents (${b.files.join(", ")})` : "client documents"),
    b.sources?.urls && "web pages the client provided",
    b.sources?.whitelist && "whitelisted sources",
    b.sources?.web && "cited web research for gaps",
  ]
    .filter(Boolean)
    .join("; ");

  // Another market: there is no GVR data to build on, so lay out the report with every gap stated.
  if (!isGvrMarket(b.market)) {
    const pending = (what: string) =>
      gap(
        `${what} for ${b.market} (${b.region}, ${b.forecast}) isn't in the loaded GVR report. It will come from ${sourcesLine || "the sources you add"}, cited, with no estimates.`,
      );
    return {
      meta: {
        ...meta,
        vertical: "Healthcare",
        base_year: 2025,
        unit: "USD Million",
        scope_lines: [`**Lens:** ${b.typeLabel}`, `**Geography:** ${b.region}`, `**Period:** forecast ${b.forecast}`],
      },
      brief,
      revision,
      chapters: [
        { title: "Executive Summary", sections: [{ title: "At a Glance", blocks: [summary] }] },
        {
          title: "Scope and Methodology",
          sections: [
            {
              title: "Scope",
              blocks: [{ type: "p", text: `${b.typeLabel} of the ${b.market} market, ${b.region}, forecast ${b.forecast}, on GVR methodology.` }],
            },
            { title: "Sources", blocks: [{ type: "p", text: `Sources in order of precedence: ${sourcesLine || "none selected"}.` }] },
          ],
        },
        {
          title: b.typeLabel,
          sections: [
            { title: "Market Size and Forecast", blocks: [pending("Market size and forecast")] },
            { title: "Segments and Regions", blocks: [pending("Segment and regional splits")] },
            { title: "Competitive Landscape", blocks: [pending("Company shares and strategies")] },
            { title: `${b.typeLabel} Findings`, blocks: [pending(`The ${b.typeLabel} analysis`)] },
          ],
        },
      ],
      review_comments: [],
      conversation_log: [],
    };
  }

  // Blood bank serology: build on the GVR report spec; add the requested analysis and mark every gap.
  const base = (await fetch(baseSpecFile(b)).then((r) => r.json())) as Spec;
  const spec: Spec = JSON.parse(JSON.stringify(base));
  spec.meta = { ...spec.meta, ...meta };
  if (!b.client) delete spec.meta.prepared_for;
  spec.brief = { ...spec.brief, ...brief };
  if (!b.client) delete spec.brief.client;
  spec.revision = revision;

  // 1. Executive summary opens with what isn't from the report.
  spec.chapters[0].sections[0].blocks.unshift(summary);

  // 2. A geography the report doesn't split: global figures for reference, stated where the numbers start.
  if (!["Global", "North America"].includes(b.region)) {
    const sizeCh = spec.chapters.find((c) => /market size|market reality|snapshot/i.test(c.title)) ?? spec.chapters[Math.min(2, spec.chapters.length - 1)];
    sizeCh.sections[0].blocks.unshift(
      gap(
        `The GVR report has no ${b.region} split. The figures in this chapter are global and shown for reference only; ${b.region} figures need ${sourcesLine.includes("web") ? "cited research" : "added sources"}.`,
      ),
    );
  }

  // 3. The requested report type, if it isn't one GVR publishes from this report: its own chapter, with the gap stated.
  if (b.type === "custom" || !["executive_view", "market_snapshot", "opportunity_assessment"].includes(b.type)) {
    const label = b.type === "custom" ? b.typeLabel : TYPE_LABEL[b.type];
    const chapter: Chapter = {
      title: label,
      sections: [
        {
          title: `${label}: Scope`,
          blocks: [
            {
              type: "p",
              text: `This ${label} for ${b.market} (${b.region}, ${b.forecast}) builds on the GVR market data in the other chapters: market size and forecast, segments, regions and competition.`,
            },
            gap(
              `The ${label}-specific evidence isn't in the GVR report. It will come from ${sourcesLine || "the sources you add"}, cited in each figure and table, with no estimates.`,
            ),
          ],
        },
      ],
    };
    const at = Math.max(1, spec.chapters.length - 1); // before the closing implications chapter
    spec.chapters.splice(at, 0, chapter);
  }

  // 4. Forecast period other than the published one.
  if (b.forecast !== PROTOTYPE_FORECAST) {
    spec.chapters[0].sections[0].blocks.splice(
      1,
      0,
      gap(
        `The GVR report publishes ${PROTOTYPE_FORECAST}. For ${b.forecast}, only published years are used; years outside the published series are not estimated.`,
      ),
    );
  }

  // 5. Client documents and web pages the client gave.
  if ((b.sources?.client && b.files?.length) || (b.sources?.urls && b.urls?.length)) {
    const scope = spec.chapters.find((c) => /scope/i.test(c.title));
    const items = [
      ...(b.sources?.client ? (b.files ?? []).map((f) => `${f} (client-provided data)`) : []),
      ...(b.sources?.urls ? (b.urls ?? []).map((u) => `${u} (web page, cited with date)`) : []),
    ];
    (scope ?? spec.chapters[0]).sections[0].blocks.push(gap(`Also used, not GVR figures: ${items.join("; ")}.`));
  }
  return spec;
}
