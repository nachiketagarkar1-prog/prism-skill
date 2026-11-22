// Canned, source-grounded answers for the working model. Figures are taken from the
// Blood Bank Serology sample specs bundled with the skills.
import type { Job } from "../types";
import { TYPE_LABEL } from "../api/catalog";

interface Fact {
  rx: RegExp;
  report: string; // with § references
  deck: string; // with slide references
}

const FACTS: Fact[] = [
  {
    rx: /\b(size|big|value|worth|revenue|forecast|cagr|grow(th|ing)?|fast)\b/i,
    report:
      "The global market is **USD 3,329.3 Mn in 2025** and reaches **USD 5,893.1 Mn by 2033**, a **7.45% CAGR (2026–2033)** (§1.1). Immunohematology holds **61.8%** of 2025 revenue (§1.1).",
    deck: "The market is **USD 3,329.3 Mn in 2025**, growing at **7.45% CAGR** to **USD 5,893.1 Mn by 2033** (slide 3, Executive View: Market Reality).",
  },
  {
    rx: /\b(region|regional|europe|asia|apac|latin|mea|north america|u\.s\.|country|countries)\b/i,
    report:
      "**North America** leads with **41.3%** of 2025 revenue; the U.S. is 83.85% of the region. **Asia Pacific (28.5%)** grows fastest at **8.08%**, reaching USD 1,761.56 Mn by 2033. Europe holds 24.7%; Latin America and MEA 5.4% (§3.1).",
    deck: "**North America (41.3%)** is the largest region; **Asia Pacific (28.5%)** grows fastest at **8.08%** to USD 1,761.56 Mn by 2033 (slide 5, Summarized Regional Insights).",
  },
  {
    rx: /\b(segment|technology|immunoassay|agglutination|gel|product|end use|testing area)\b/i,
    report:
      "Immunoassay is both the largest technology and an above-market grower. Gel / column agglutination grows fastest, while agglutination is large but slower at **6.36%** (§2.2).",
    deck: "Immunoassay is the largest technology and grows above the market; gel / column agglutination grows fastest; agglutination is slower at **6.36%** (slide 4, Segment Summary & Positioning).",
  },
  {
    rx: /\b(compet|player|compan|leader|share|swot|rival)\w*/i,
    report:
      "Competition is shifting **from single reagents to complete, automated, connected workflows**; the Competitive Positioning and SWOT chapter maps where suppliers defend and where to build (§4).",
    deck: "Competition is shifting **from single reagents to complete, automated, connected workflows** (slide 6, Competitive Positioning & SWOT).",
  },
  {
    rx: /\b(go[\s-]?to[\s-]?market|gtm|priorit|enter|entry|recommend|should we|where to play|implication)\w*/i,
    report:
      "The Go-To-Market Priorities chapter phases entry: win the hospital transfusion lab, then scale donor screening, then expand into Asia Pacific (§5).",
    deck: "Go-to-market runs in three stages: win the hospital transfusion lab, scale donor and plasma screening, then expand to Asia Pacific (slide 7, Go-To-Market Priorities).",
  },
];

export function answerFromOutput(job: Job, question: string): string {
  const v = job.versions[job.versions.length - 1];
  const kind = job.skill === "deck" ? "deck" : "report";
  const hits = FACTS.filter((f) => f.rx.test(question)).slice(0, 2);
  const label = `${TYPE_LABEL[job.brief.type]} ${kind} ${v.version}`;
  if (!hits.length) {
    return [
      `I couldn't find that in the ${label}. The ${kind} covers market size and growth, segments, regions, competition and go-to-market priorities.`,
      "",
      `If you need it covered, ask me to **add a section** and I'll research it and build ${nextVersion(v.version)}.`,
    ].join("\n");
  }
  return [
    `From the **${label}**:`,
    "",
    // Section/slide references are mapped to the Executive View samples only.
    ...hits.map((h) => {
      const line = kind === "deck" ? h.deck : h.report;
      return `- ${job.brief.type === "executive_view" ? line : line.replace(/\s*\((§|slide)[^)]*\)/g, "")}`;
    }),
    "",
    "_Source: Grand View Research, Blood Bank Serology Market Report (2026)._",
  ].join("\n");
}

export function nextVersion(v: string): string {
  return `v${parseInt(v.replace(/\D/g, ""), 10) + 1}`;
}

export function genericAnswer(text: string): string {
  return [
    "**Grounded answer (mocked).** In production this reply comes from Prism's GVR-certified answer engine with inline citations.",
    "",
    `You asked: _"${text.trim().slice(0, 160)}"_`,
    "",
    "To turn this into a client-ready output, ask me to **build a report** (paginated PDF plus report studio) or **build a deck** (PowerPoint on the GVR master plus deck studio). For example:",
    "",
    "- *Build an executive view report on the blood bank serology market for North America*",
    "- *Create an opportunity assessment deck for the blood bank serology market*",
  ].join("\n");
}
