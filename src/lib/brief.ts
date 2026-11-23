import type { Brief, BriefDraft } from "../types";

/** The only things a request must state before building: what to make, on which market, for which geography. */
export function missingEssentials(d: BriefDraft): ("type" | "market" | "region")[] {
  const out: ("type" | "market" | "region")[] = [];
  if (!d.type || (d.type === "custom" && !d.customType.trim())) out.push("type");
  if (!d.market.trim()) out.push("market");
  if (!d.region.trim()) out.push("region");
  return out;
}

/** Human list of what a refined brief changes, for the revision line. Empty when nothing changed. */
export function describeChanges(a: Brief, b: Brief): string[] {
  const out: string[] = [];
  if (a.typeLabel !== b.typeLabel) out.push(`type ${b.typeLabel}`);
  if (a.market !== b.market) out.push(`market ${b.market}`);
  if (a.region !== b.region) out.push(`geography ${b.region}`);
  if (a.forecast !== b.forecast) out.push(`forecast ${b.forecast}`);
  if ((a.client ?? "") !== (b.client ?? "")) out.push(b.client ? `prepared for ${b.client}` : "client name removed");
  if ((a.decision ?? "") !== (b.decision ?? "")) out.push(b.decision ? "decision question added" : "decision question removed");
  const src = (x: Brief) => JSON.stringify([x.sources ?? {}, x.files ?? [], x.urls ?? []]);
  if (src(a) !== src(b)) out.push("sources updated");
  if (b.tocText) out.push("client's table of contents applied");
  return out;
}
