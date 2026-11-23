// Client-specific table of contents. The GVR outline is only a starting point: the client can rename, reorder,
// remove and add chapters and sections, or paste their own TOC. Sections that match a GVR report section keep
// its content (figures, tables, text); new ones are researched and marked "Not from the GVR report".
import type { OutlineChapter, OutlineRef, OutlineSection } from "../types";
import { uid } from "./util";

/* ---------- reading an outline from a spec ---------- */

const HOLD_LABEL: Record<string, string> = {
  figure: "Chart",
  table: "Table",
  kpis: "KPIs",
  bullets: "Bullets",
  cards: "Cards",
  swot: "SWOT",
  p: "Text",
  side: "Side note",
  callout: "Callout",
};

interface SpecBlock {
  type: string;
  label?: string;
  text?: string;
  [k: string]: unknown;
}
interface SpecSection {
  title: string;
  blocks: SpecBlock[];
  subsections?: { title: string; blocks: SpecBlock[] }[];
}
export interface SpecChapter {
  title: string;
  sections: SpecSection[];
}

const GAP_PREFIX = "Not from the GVR report";
const isGap = (b: SpecBlock) => b.type === "callout" && typeof b.label === "string" && b.label.startsWith(GAP_PREFIX);

function holds(blocks: SpecBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (isGap(b)) continue;
    const l = HOLD_LABEL[b.type];
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/** True when a section has no GVR content of its own (only text around a "Not from the GVR report" note). */
function isPlaceholder(s: SpecSection): boolean {
  return s.blocks.some(isGap) && !s.blocks.some((b) => !isGap(b) && b.type !== "p" && b.label !== "Research brief");
}

/** Outline of a report spec; each node points back at its content so it can be reused in another order. */
export function outlineFromReportSpec(spec: { chapters: SpecChapter[] }, src: string): OutlineChapter[] {
  return spec.chapters.map((c, ci) => ({
    id: uid(),
    title: c.title,
    ref: { src, path: [ci] },
    sections: c.sections.map((s, si): OutlineSection => {
      if (isPlaceholder(s)) {
        const note = s.blocks.find((b) => b.type === "callout" && b.label === "Research brief")?.text;
        return { id: uid(), title: s.title, notes: typeof note === "string" ? note : undefined };
      }
      return { id: uid(), title: s.title, ref: { src, path: [ci, si] }, holds: holds([...s.blocks, ...(s.subsections ?? []).flatMap((x) => x.blocks)]) };
    }),
  }));
}

interface DeckSlide {
  type: string;
  title?: string;
  rows?: { type: string }[];
  items?: { title: string }[];
}

/** Outline of a presentation spec: one entry per content slide (chapters), named as in its contents slide. */
export function outlineFromDeckSpec(spec: { slides: DeckSlide[] }, src: string): OutlineChapter[] {
  const toc = spec.slides.find((s) => s.type === "toc")?.items?.map((i) => i.title) ?? [];
  const content = spec.slides.map((s, i) => ({ s, i })).filter(({ s }) => s.type !== "cover" && s.type !== "toc" && s.type !== "closing");
  return content.map(({ s, i }, n) => ({
    id: uid(),
    title: toc.length === content.length ? toc[n] : (s.title ?? `Slide ${i + 1}`),
    ref: { src, path: [i] },
    sections: [],
  }));
}

/* ---------- comparing ---------- */

const STOP = new Set(["the", "and", "of", "a", "an", "in", "on", "for", "to", "by", "with", "vs", "versus", "&", "market", "analysis", "overview"]);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(?<!s)s$/, ""));

/** Word-overlap similarity of two titles, 0..1. */
export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  A.forEach((w) => B.has(w) && both++);
  return both / Math.min(A.size, B.size) / (1 + Math.abs(A.size - B.size) * 0.15);
}

/** Short list of what changed between two outlines, for the version's revision line. */
export function describeOutlineChanges(a: OutlineChapter[] | undefined, b: OutlineChapter[] | undefined): string[] {
  if (!b) return [];
  const flat = (o: OutlineChapter[] = []) => o.flatMap((c) => [{ id: c.id, title: c.title, kind: "chapter" }, ...c.sections.map((s) => ({ id: s.id, title: s.title, kind: "section" }))]);
  const A = flat(a);
  const B = flat(b);
  const byId = new Map(A.map((x) => [x.id, x]));
  const out: string[] = [];
  const added = B.filter((x) => !byId.has(x.id));
  const removed = A.filter((x) => !B.some((y) => y.id === x.id));
  const renamed = B.filter((x) => byId.has(x.id) && byId.get(x.id)!.title !== x.title);
  const list = (xs: { title: string; kind: string }[]) =>
    xs.length > 4
      ? `${xs.filter((x) => x.kind === "chapter").length} chapters and ${xs.filter((x) => x.kind === "section").length} sections`
      : xs.map((x) => `“${x.title}”`).join(", ");
  if (added.length && removed.length > 4 && added.length > 4) {
    out.push(`new table of contents (${B.filter((x) => x.kind === "chapter").length} chapters)`);
  } else {
    if (added.length) out.push(`added ${list(added)}`);
    if (removed.length) out.push(`removed ${list(removed)}`);
  }
  if (renamed.length) out.push(`renamed ${renamed.map((x) => `“${byId.get(x.id)!.title}” to “${x.title}”`).join(", ")}`);
  const order = (o: { id: string }[]) => o.map((x) => x.id).filter((id) => byId.has(id) && B.some((y) => y.id === id)).join();
  if (!added.length && !removed.length && order(A) !== order(B)) out.push("reordered the contents");
  else if (order(A) !== order(B)) out.push("reordered");
  const notesChanged = (b ?? []).some((c) =>
    c.sections.some((s) => {
      const old = (a ?? []).flatMap((x) => x.sections).find((y) => y.id === s.id);
      return old && (old.notes ?? "") !== (s.notes ?? "");
    }),
  );
  if (notesChanged) out.push("updated research notes");
  return out;
}

/** Sections in the outline that are new (not from the GVR report). */
export const newSections = (o: OutlineChapter[] | undefined) =>
  (o ?? []).flatMap((c) => (c.sections.length ? c.sections.filter((s) => !s.ref).map((s) => s.title) : c.ref ? [] : [c.title]));

/* ---------- pasted TOC ---------- */

/**
 * Parse a pasted table of contents. Chapters: "1. Title", "Chapter 2: Title", "I. Title", or unindented lines.
 * Sections: "1.1 Title", indented lines, or bullets ("-", "•", "a)").
 */
export function parseToc(text: string): OutlineChapter[] {
  const out: OutlineChapter[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  // A single line with separators: "Chapters: A; B; C" or "A, B and C".
  if (lines.length === 1) {
    const body = lines[0].replace(/^.*?(?:chapters?|sections?|contents|toc|outline|structure)\s*(?:on|about|covering|should be|:|-)\s*/i, "");
    for (const t of body.split(/\s*(?:;|\||,|\band\b)\s*/i).filter(Boolean)) out.push({ id: uid(), title: tidy(t), sections: [] });
    return out.filter((c) => c.title);
  }
  for (const raw of lines) {
    if (/^\s*(table of contents|contents|toc|outline)\s*:?\s*$/i.test(raw)) continue;
    const indent = raw.match(/^\s*/)![0].replace(/\t/g, "    ").length;
    const line = raw.trim();
    const secNum = line.match(/^(\d+)\.(\d+)(?:\.\d+)*\.?\s+(.+)$/);
    const bullet = line.match(/^(?:[-•*–·▪]|[a-z]\)|\([a-z]\)|[a-z]\.)\s+(.+)$/i);
    const chapNum = line.match(/^(?:chapter\s+|ch\.?\s*)?(?:\d+|[ivxlc]+)\s*[.):\-–]?\s+(.+)$/i);
    const isSection = !!secNum || (indent >= 2 && out.length > 0) || (!!bullet && out.length > 0 && !/^\d/.test(line));
    const title = tidy(secNum ? secNum[3] : bullet ? bullet[1] : chapNum ? chapNum[1] : line);
    if (!title) continue;
    if (isSection && out.length) out[out.length - 1].sections.push({ id: uid(), title });
    else out.push({ id: uid(), title, sections: [] });
  }
  return out;
}

const tidy = (s: string) =>
  s
    .replace(/^["“'`]+|["”'`.:;]+$/g, "")
    .replace(/\s+\.{3,}\s*\d+$/, "") // dotted leaders and page numbers
    .replace(/\s+\d+$/, "")
    .trim();

/** Make "pricing benchmarks" read as a title: "Pricing Benchmarks". */
export function titleCase(s: string): string {
  const small = new Set(["and", "or", "of", "the", "a", "an", "in", "on", "for", "to", "by", "vs", "with"]);
  return s
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : /[A-Z]{2,}/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Match a client outline to the GVR one: a chapter or section whose title matches a GVR one takes its content;
 * a matched chapter with no sections listed takes the GVR chapter's sections. Everything else stays new.
 */
export function matchToGvr(client: OutlineChapter[], gvr: OutlineChapter[]): OutlineChapter[] {
  const gvrSections = gvr.flatMap((c) => c.sections.filter((s) => s.ref));
  const used = new Set<string>();
  const best = <T extends { title: string; id: string }>(title: string, pool: T[]) => {
    let top: T | undefined;
    let score = 0;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const sc = similarity(title, p.title);
      if (sc > score) [top, score] = [p, sc];
    }
    return score >= 0.5 ? top : undefined;
  };
  return client.map((c) => {
    const ch = { ...c, sections: c.sections.map((s) => ({ ...s })) };
    if (!ch.sections.length) {
      const g = best(ch.title, gvr);
      if (g) {
        used.add(g.id);
        return { ...ch, ref: g.ref, sections: g.sections.map((s) => ({ ...s, id: uid() })) };
      }
      const s = best(ch.title, gvrSections);
      if (s) {
        used.add(s.id);
        return { ...ch, sections: [{ ...s, id: uid() }] };
      }
      return ch;
    }
    ch.sections = ch.sections.map((s) => {
      const g = best(s.title, gvrSections);
      if (!g) return s;
      used.add(g.id);
      return { ...s, ref: g.ref, holds: g.holds };
    });
    return ch;
  });
}

/* ---------- chat commands ---------- */

export type OutlineCommand =
  | { op: "add"; kind: "chapter" | "section"; title: string; where?: "after" | "before" | "under"; anchor?: string }
  | { op: "remove"; target: string }
  | { op: "rename"; target: string; title: string }
  | { op: "move"; target: string; where: "before" | "after" | "start" | "end"; anchor?: string }
  | { op: "replace"; toc: string };

const Q = `["“”']?`;
const KIND = `(?:\\s+(?:chapter|section|part))?`;

/** Recognise a table-of-contents change in a chat turn ("Add a chapter on pricing after market size", "Drop the SWOT"). */
export function parseOutlineCommand(text: string): OutlineCommand | null {
  const t = text.trim().replace(/[.!?]+$/, "");
  const toc = extractToc(text);
  if (toc && /\b(toc|table of contents|contents|outline|structure|chapters)\b/i.test(text)) return { op: "replace", toc };
  let m = t.match(
    new RegExp(
      `\\b(?:add|include|insert|create)\\s+(?:a\\s+|an\\s+|one\\s+more\\s+|another\\s+)?(?:new\\s+)?(chapter|section)\\s+(?:on|about|for|covering|called|titled|named|:)?\\s*${Q}(.+?)${Q}(?:\\s+(after|before|under|in|into|to|within)\\s+(?:the\\s+)?${Q}(.+?)${Q}${KIND})?$`,
      "i",
    ),
  );
  if (m) {
    const where = m[3] ? (/after/i.test(m[3]) ? "after" : /before/i.test(m[3]) ? "before" : "under") : undefined;
    return { op: "add", kind: m[1].toLowerCase() as "chapter" | "section", title: titleCase(m[2]), where, anchor: m[4] };
  }
  m = t.match(new RegExp(`\\b(?:rename|retitle|call)\\s+(?:the\\s+)?${Q}(.+?)${Q}${KIND}\\s+(?:to|as)\\s+${Q}(.+?)${Q}$`, "i"));
  if (m) return { op: "rename", target: m[1], title: titleCase(m[2]) };
  m = t.match(
    new RegExp(
      `\\b(?:move|put)\\s+(?:the\\s+)?${Q}(.+?)${Q}${KIND}\\s+(before|after|first|last|to the (?:top|start|beginning|front|end|bottom))\\s*(?:the\\s+)?${Q}(.*?)${Q}${KIND}$`,
      "i",
    ),
  );
  if (m) {
    const w = m[2].toLowerCase();
    const where = w === "before" || w === "after" ? w : /top|start|beginning|front|first/.test(w) ? "start" : "end";
    return { op: "move", target: m[1], where, anchor: m[3] || undefined };
  }
  m = t.match(new RegExp(`\\b(?:remove|drop|delete|cut|take out|skip|exclude)\\s+(?:the\\s+)?${Q}(.+?)${Q}${KIND}$`, "i"));
  if (m && !/\b(client|name|logo|cover)\b/i.test(m[1])) return { op: "remove", target: m[1] };
  return null;
}

/** A TOC pasted into a message (three or more list-like lines, or "chapters: A; B; C"). */
export function extractToc(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const listy = lines.filter((l) => /^\s*(?:\d+(?:\.\d+)*[.)]?|[-•*–·▪]|[a-z]\)|chapter\s+\d+)\s+\S/i.test(l));
  if (listy.length >= 3) {
    const first = lines.findIndex((l) => listy.includes(l));
    return lines.slice(first).join("\n").trim();
  }
  const inline = text.match(/\b(?:chapters?|sections?|table of contents|toc|structure)\s*(?:on|covering|:)\s*([^\n.]+(?:[;,][^\n.]+){2,})/i);
  if (inline) return inline[1].trim();
  return undefined;
}

/** The request without its pasted TOC lines, so they don't skew market or geography detection. */
export function withoutToc(text: string): string {
  const toc = extractToc(text);
  return toc ? text.replace(toc, "").trim() : text;
}

type Found = { ci: number; si?: number; title: string };

/** Find a chapter or section by name ("market size", "chapter 3", "section 4.2", "the SWOT"). */
export function findNode(o: OutlineChapter[], phrase: string): Found | undefined {
  const p = phrase.trim().replace(/^the\s+/i, "");
  const num = p.match(/^(?:chapter|ch\.?|section|slide)?\s*(\d+)(?:\.(\d+))?$/i);
  if (num) {
    const ci = +num[1] - 1;
    if (!o[ci]) return undefined;
    if (num[2]) {
      const si = +num[2] - 1;
      return o[ci].sections[si] ? { ci, si, title: o[ci].sections[si].title } : undefined;
    }
    return { ci, title: o[ci].title };
  }
  let top: Found | undefined;
  let score = 0;
  o.forEach((c, ci) => {
    const sc = similarity(p, c.title) + 0.01; // prefer chapters on ties
    if (sc > score) [top, score] = [{ ci, title: c.title }, sc];
    c.sections.forEach((s, si) => {
      const ss = similarity(p, s.title);
      if (ss > score) [top, score] = [{ ci, si, title: s.title }, ss];
    });
  });
  return score >= 0.5 ? top : undefined;
}

const clone = (o: OutlineChapter[]) => o.map((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s })) }));

/** Apply a chat command to an outline. Returns the new outline and a revision line, or an error to show. */
export function applyOutlineCommand(
  o: OutlineChapter[],
  cmd: OutlineCommand,
  gvr: OutlineChapter[],
): { outline: OutlineChapter[]; change: string } | { error: string } {
  const out = clone(o);
  const names = () => o.map((c, i) => `${i + 1}. ${c.title}`).join("; ");
  const miss = (what: string) => ({ error: `I couldn't find “${what}” in the contents. The chapters are: ${names()}.` });
  switch (cmd.op) {
    case "replace": {
      const parsed = matchToGvr(parseToc(cmd.toc), gvr);
      if (!parsed.length) return { error: "I couldn't read a table of contents in that message. Put one chapter per line (sections indented or numbered 1.1)." };
      return { outline: parsed, change: `Table of contents replaced with the client's (${parsed.length} chapters)` };
    }
    case "add": {
      const g = matchToGvr([{ id: uid(), title: cmd.title, sections: [] }], gvr)[0];
      if (cmd.kind === "chapter") {
        const anchor = cmd.anchor ? findNode(o, cmd.anchor) : undefined;
        if (cmd.anchor && !anchor) return miss(cmd.anchor);
        const at = anchor ? (cmd.where === "before" ? anchor.ci : anchor.ci + 1) : Math.max(out.length - 1, 1);
        out.splice(at, 0, g.sections.length ? g : { ...g, sections: [{ id: uid(), title: cmd.title }] });
        return { outline: out, change: `Added chapter “${cmd.title}”` };
      }
      const anchor = cmd.anchor ? findNode(o, cmd.anchor) : undefined;
      if (cmd.anchor && !anchor) return miss(cmd.anchor);
      const ci = anchor ? anchor.ci : out.length - 1;
      const sec: OutlineSection = g.sections[0] && g.sections.length === 1 ? { ...g.sections[0], title: cmd.title } : { id: uid(), title: cmd.title };
      const si = anchor?.si !== undefined ? (cmd.where === "before" ? anchor.si : anchor.si + 1) : out[ci].sections.length;
      out[ci].sections.splice(si, 0, sec);
      return { outline: out, change: `Added section “${cmd.title}” to “${out[ci].title}”` };
    }
    case "remove": {
      const n = findNode(o, cmd.target);
      if (!n) return miss(cmd.target);
      if (n.si === undefined) {
        if (out.length === 1) return { error: "That's the only chapter left, so I've kept it." };
        out.splice(n.ci, 1);
      } else out[n.ci].sections.splice(n.si, 1);
      if (n.si !== undefined && !out[n.ci].sections.length) out.splice(n.ci, 1);
      return { outline: out, change: `Removed “${n.title}”` };
    }
    case "rename": {
      const n = findNode(o, cmd.target);
      if (!n) return miss(cmd.target);
      if (n.si === undefined) out[n.ci].title = cmd.title;
      else out[n.ci].sections[n.si].title = cmd.title;
      return { outline: out, change: `Renamed “${n.title}” to “${cmd.title}”` };
    }
    case "move": {
      const n = findNode(o, cmd.target);
      if (!n) return miss(cmd.target);
      const a = cmd.anchor ? findNode(o, cmd.anchor) : undefined;
      if (cmd.anchor && !a) return miss(cmd.anchor);
      if (n.si === undefined) {
        const [c] = out.splice(n.ci, 1);
        let at = cmd.where === "start" ? 0 : cmd.where === "end" ? out.length : a!.ci - (a!.ci > n.ci ? 1 : 0) + (cmd.where === "after" ? 1 : 0);
        at = Math.max(0, Math.min(out.length, at));
        out.splice(at, 0, c);
      } else {
        const [s] = out[n.ci].sections.splice(n.si, 1);
        const ci = a ? a.ci : n.ci;
        const list = out[ci].sections;
        let at = cmd.where === "start" ? 0 : cmd.where === "end" || a?.si === undefined ? list.length : a.si - (ci === n.ci && a.si > n.si ? 1 : 0) + (cmd.where === "after" ? 1 : 0);
        if (a && a.si === undefined && cmd.where === "before") at = 0;
        at = Math.max(0, Math.min(list.length, at));
        list.splice(at, 0, s);
        if (!out[n.ci].sections.length) out.splice(n.ci, 1);
      }
      return { outline: out, change: `Moved “${n.title}” ${cmd.where === "start" ? "to the start" : cmd.where === "end" ? "to the end" : `${cmd.where} “${a!.title}”`}` };
    }
  }
}

/* ---------- building chapters from an outline ---------- */

export type SpecResolver = (ref: OutlineRef) => Promise<{ chapters: SpecChapter[] } | undefined>;

const gapCallout = (text: string): SpecBlock => ({ type: "callout", label: GAP_PREFIX, text });

/**
 * Chapters for the report, in the client's order and wording. Referenced sections bring their GVR content
 * (earlier "Not from the GVR report" notes are dropped and restated by the caller); new ones state what will
 * be researched and from which sources, with no figures invented.
 */
export async function chaptersFromOutline(
  outline: OutlineChapter[],
  resolve: SpecResolver,
  ctx: { market: string; region: string; forecast: string; sources: string; noData?: boolean },
): Promise<SpecChapter[]> {
  const newSection = (title: string, notes?: string): SpecSection => ({
    title,
    blocks: [
      ...(notes?.trim() ? [{ type: "callout", label: "Research brief", text: notes.trim() } as SpecBlock] : []),
      gapCallout(
        `“${title}” is a section added for this client; the GVR report doesn't cover it. It will be researched for ${ctx.market} (${ctx.region}, ${ctx.forecast}) from ${ctx.sources || "the sources you add"}, cited in each figure and table, with no estimates.`,
      ),
    ],
  });
  const copy = async (ref: OutlineRef, title: string): Promise<SpecSection | undefined> => {
    if (ctx.noData) return undefined;
    const spec = await resolve(ref);
    const [ci, si] = ref.path;
    const s = si === undefined ? undefined : spec?.chapters[ci]?.sections[si];
    if (!s) return undefined;
    const c = JSON.parse(JSON.stringify(s)) as SpecSection;
    c.title = title;
    c.blocks = c.blocks.filter((b) => !isGap(b));
    return c.blocks.length || c.subsections?.length ? c : undefined;
  };
  const chapters: SpecChapter[] = [];
  for (const ch of outline) {
    const sections: SpecSection[] = [];
    if (!ch.sections.length) {
      // A chapter taken whole from a spec, or a new one with no sections listed yet.
      const spec = ch.ref && !ctx.noData ? await resolve(ch.ref) : undefined;
      const src = spec?.chapters[ch.ref!.path[0]];
      if (src) for (let si = 0; si < src.sections.length; si++) {
        const s = await copy({ src: ch.ref!.src, path: [ch.ref!.path[0], si] }, src.sections[si].title);
        if (s) sections.push(s);
      }
      if (!sections.length) sections.push(newSection(ch.title));
    } else {
      for (const s of ch.sections) sections.push((s.ref && (await copy(s.ref, s.title))) || newSection(s.title, s.notes));
    }
    chapters.push({ title: ch.title, sections });
  }
  return chapters;
}
