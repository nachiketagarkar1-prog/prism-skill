import { Check, Clock, UserCheck } from "lucide-react";
import type { AnalystReview } from "../types";
import { SKILL_NOUN } from "../types";
import { useStore } from "../state/store";
import { cx } from "../lib/util";
import { sourceList } from "./BuildCard";

/** A request routed to a GVR analyst for validation instead of an automatic build. */
export function ReviewCard({ threadId, msgId, review }: { threadId: string; msgId: string; review: AnalystReview }) {
  const { setReviewStatus } = useStore();
  const b = review.brief;
  const withdrawn = review.status === "withdrawn" || review.status === "declined";
  const offered = review.status === "offered";
  const when = new Date(review.submittedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const steps: { label: string; detail: string; state: "done" | "current" | "pending" }[] = [
    { label: "Request submitted", detail: `${review.id} · ${when}`, state: "done" },
    { label: "Analyst validation", detail: "Checks sources and figures against GVR methodology", state: withdrawn ? "pending" : "current" },
    {
      label: `${SKILL_NOUN[b.skill][0].toUpperCase() + SKILL_NOUN[b.skill].slice(1)} delivered here`,
      detail: "With PDF/PPTX, studio and Excel",
      state: "pending",
    },
  ];

  return (
    <div className="mt-3 w-full max-w-[760px] overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm dark:border-amber-400/30 dark:bg-white/[0.03]">
      <div className="flex items-center gap-3 border-b border-amber-100 bg-amber-50/60 px-5 py-3 dark:border-amber-400/20 dark:bg-amber-400/5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500 text-white">
          <UserCheck className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Analyst review</div>
          <div className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">
            {b.typeLabel} {SKILL_NOUN[b.skill]} · {b.market}, {b.region}
          </div>
        </div>
        <span
          className={cx(
            "ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            withdrawn
              ? "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200",
          )}
        >
          {review.status === "declined" ? "Not sent" : withdrawn ? "Withdrawn" : offered ? "Available" : "With an analyst"}
        </span>
      </div>

      <div className="grid gap-5 px-5 py-4 text-[13px] sm:grid-cols-2">
        <div>
          {review.request && (
            <p className="mb-2 text-slate-700 dark:text-slate-200">
              <span className="text-slate-400">Request:</span> “{review.request}”
            </p>
          )}
          <div className="mb-1.5 font-semibold text-slate-800 dark:text-slate-100">What the analyst will validate</div>
          <ul className="list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-300">
            {review.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-slate-600 dark:text-slate-300">
            <dt className="text-slate-400">Forecast</dt>
            <dd>{b.forecast}</dd>
            {b.client && (
              <>
                <dt className="text-slate-400">Prepared for</dt>
                <dd>{b.client}</dd>
              </>
            )}
            {b.decision && (
              <>
                <dt className="text-slate-400">Decision</dt>
                <dd>{b.decision}</dd>
              </>
            )}
            <dt className="text-slate-400">Sources</dt>
            <dd>{sourceList(b).join(" · ")}</dd>
          </dl>
        </div>
        <ol className={cx("space-y-2.5", offered && "opacity-50")}>
          {steps.map((s) => (
            <li key={s.label} className="flex gap-2.5">
              <span className="mt-0.5">
                {s.state === "done" ? (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                ) : s.state === "current" ? (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-400/20 dark:text-amber-200">
                    <Clock className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="block h-5 w-5 rounded-full border-2 border-slate-200 dark:border-white/15" />
                )}
              </span>
              <div>
                <div className={cx(s.state === "pending" ? "text-slate-400" : "font-medium text-slate-800 dark:text-slate-100")}>{s.label}</div>
                <div className="text-xs text-slate-500">{s.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500 dark:border-white/5">
        {review.status === "declined"
          ? "Not sent. The current version stays as it is."
          : withdrawn
            ? "Withdrawn. Nothing will be delivered for this request."
            : offered
              ? "Send it to a GVR analyst to validate and deliver?"
              : "Nothing is delivered until the analyst has validated it."}
        {offered && (
          <span className="ml-auto flex gap-2">
            <button
              onClick={() => setReviewStatus(threadId, msgId, "declined")}
              className="rounded-lg px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            >
              No thanks
            </button>
            <button
              onClick={() => setReviewStatus(threadId, msgId, "submitted")}
              className="rounded-lg bg-amber-500 px-3 py-1 text-sm font-semibold text-white hover:bg-amber-600"
            >
              Send for analyst review
            </button>
          </span>
        )}
        {review.status === "submitted" && (
          <button
            onClick={() => setReviewStatus(threadId, msgId, "withdrawn")}
            className="ml-auto font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            Withdraw request
          </button>
        )}
      </div>
    </div>
  );
}
