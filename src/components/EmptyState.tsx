import { FileText, MessageCircle, Presentation } from "lucide-react";
import { PrismLogo } from "./PrismLogo";

// Example market for the prompts: the bundled sample outputs cover Blood Bank Serology.
const MARKET = "the blood bank serology market";

interface Option {
  label: string;
  /** Prompt placed in the composer when the option is picked. */
  prompt: string;
}

const report = (label: string): Option => ({ label, prompt: `Create a ${label} on ${MARKET}` });
const presentation = (label: string): Option => ({ label, prompt: `Create a ${label} presentation on ${MARKET}` });

const CARDS: { icon: React.ReactNode; title: string; desc: string; options: Option[] }[] = [
  {
    icon: <MessageCircle className="h-5 w-5" />,
    title: "Ask a grounded question",
    desc: "Market size, players, regulation and trends, with GVR citations.",
    options: [
      { label: "What is the size of the blood bank serology market?", prompt: "What is the size of the blood bank serology market?" },
      { label: "Regulatory shifts in US medical-device approvals (2024)", prompt: "Regulatory shifts in US medical-device approvals (2024)" },
    ],
  },
  {
    icon: <FileText className="h-5 w-5" />,
    title: "Create a Report",
    desc: "A paginated PDF in GVR report format plus an interactive report studio.",
    options: [
      report("Market Executive View Report"),
      report("Market Snapshot Report"),
      report("Competitive Landscape Report"),
      report("GTM Strategy Report"),
      report("Opportunity Assessment Report"),
    ],
  },
  {
    icon: <Presentation className="h-5 w-5" />,
    title: "Create a presentation",
    desc: "An editable PowerPoint on the GVR master template plus a presentation studio.",
    options: [
      presentation("Market Executive"),
      presentation("Market Snapshot"),
      presentation("Competitive Landscape"),
      presentation("GTM Strategy"),
      presentation("Opportunity Assessment"),
    ],
  },
];

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col items-center px-4 pt-[8vh] md:px-8">
      <PrismLogo className="h-10 w-10" />
      <h2 className="mt-4 text-center text-2xl font-semibold text-slate-900 dark:text-white">What can Prism build for your client?</h2>
      <p className="mt-2 max-w-xl text-center text-[15px] text-slate-500">
        Ask a question, or create a report or presentation. Outputs stay in sync with this conversation, and every change creates a new version.
      </p>
      <div className="mt-8 grid w-full gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-prism-50 text-prism-600 dark:bg-prism-500/10 dark:text-prism-300">{c.icon}</span>
              <span className="font-semibold text-slate-900 dark:text-white">{c.title}</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500">{c.desc}</p>
            <div className="mt-3 space-y-1.5">
              {c.options.map((o) => (
                <button
                  key={o.label}
                  onClick={() => onPick(o.prompt)}
                  title={o.prompt}
                  className="block w-full rounded-lg bg-slate-50 px-3 py-2 text-left text-[13px] text-slate-700 transition hover:bg-prism-50 hover:text-prism-800 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-prism-500/10"
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
