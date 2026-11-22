import { useEffect, useState } from "react";
import { BarChart3, Download, Sheet } from "lucide-react";
import type { OutputFile } from "../types";
import { cx, formatBytes } from "../lib/util";

interface Preview {
  bytes: number;
  sheets: { name: string; charts: number; rows: string[][] }[];
}

/** Read-only preview of the Excel export, from the JSON written next to the workbook. */
export function ExcelPreview({ file }: { file: OutputFile }) {
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setData(null);
    setError(null);
    setActive(0);
    if (!file.preview) {
      setError("No preview is available for this workbook.");
      return;
    }
    fetch(file.preview)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: Error) => setError(`Couldn't load the preview (${e.message}).`));
  }, [file.preview]);

  const sheet = data?.sheets[active];
  // Data sheets: reference, title and note (rows 1–3), header on row 5, data below.
  // Contents: title rows, then "Key | value" metadata, then the item list whose header starts with "Type".
  const isContents = sheet?.name === "Contents";
  const rows = sheet?.rows ?? [];
  const headerAt = isContents ? rows.findIndex((r) => r[0] === "Type") : 4;
  const head = rows.slice(0, 3);
  const meta = isContents ? rows.slice(4, Math.max(4, headerAt)).filter((r) => r[0]) : [];
  const header = headerAt >= 0 ? (rows[headerAt] ?? []) : [];
  const body = headerAt >= 0 ? rows.slice(headerAt + 1) : [];
  const cols = Math.max(0, ...body.map((r) => lastFilled(r)), lastFilled(header));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3 dark:border-white/10 dark:bg-white/[0.02]">
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">XLSX</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{file.name}</div>
          <div className="text-xs text-slate-500">
            {file.sheets} sheets · {formatBytes(file.bytes)} · Tables, charts and KPIs from this version
          </div>
        </div>
        <a
          href={file.url}
          download={file.name}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-500 dark:border-white/15 dark:bg-white/5 dark:text-slate-200"
        >
          <Download className="h-3.5 w-3.5" /> Download Excel
        </a>
      </div>

      {error && <div className="p-5 text-sm text-rose-600">{error}</div>}
      {!data && !error && <div className="p-5 text-sm text-slate-500">Loading preview…</div>}

      {sheet && (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-white p-5 dark:bg-transparent">
          {head[0]?.[0] && <div className="text-xs font-bold uppercase tracking-wide text-cyan-600 dark:text-cyan-300">{head[0][0]}</div>}
          {head[1]?.[0] && <div className="mt-0.5 text-[15px] font-semibold text-gvr-purple dark:text-prism-200">{head[1][0]}</div>}
          {head[2]?.[0] && <div className="mt-0.5 text-xs italic text-slate-500">{head[2][0]}</div>}
          {sheet.charts > 0 && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-prism-50 px-2 py-1 text-xs text-prism-700 dark:bg-prism-500/10 dark:text-prism-200">
              <BarChart3 className="h-3.5 w-3.5" /> Includes a native Excel chart of this data
            </div>
          )}
          {meta.length > 0 && (
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
              {meta.map((r) => (
                <div key={r[0]} className="contents">
                  <dt className="font-semibold text-slate-700 dark:text-slate-200">{r[0]}</dt>
                  <dd className="text-slate-600 dark:text-slate-300">{r[1]}</dd>
                </div>
              ))}
            </dl>
          )}
          {cols > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10">
              <table className="min-w-full border-collapse text-[12.5px] tabular-nums">
                <thead>
                  <tr>
                    {header.slice(0, cols).map((h, i) => (
                      <th key={i} className="whitespace-nowrap bg-gvr-purple px-3 py-2 text-left font-semibold text-white">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((r, i) =>
                    isSource(r) ? null : (
                      <tr key={i} className="odd:bg-white even:bg-slate-50 dark:odd:bg-transparent dark:even:bg-white/[0.03]">
                        {r.slice(0, cols).map((v, j) => (
                          <td
                            key={j}
                            className={cx(
                              "border-t border-slate-100 px-3 py-1.5 dark:border-white/5",
                              j > 0 && isNumeric(v) ? "text-right text-slate-800 dark:text-slate-100" : "text-slate-700 dark:text-slate-300",
                            )}
                          >
                            {v}
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
          {body.filter(isSource).map((r, i) => (
            <p key={i} className="mt-2 text-xs italic text-slate-500">
              {r[0]}
            </p>
          ))}
        </div>
      )}

      {data && (
        <div
          className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-t border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-white/10 dark:bg-black/20"
          role="tablist"
        >
          {data.sheets.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cx(
                "flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
                i === active
                  ? "bg-white text-emerald-700 shadow-sm dark:bg-white/10 dark:text-emerald-300"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
              )}
            >
              {i === 0 && <Sheet className="h-3 w-3" />}
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const lastFilled = (r: string[]) => {
  for (let i = r.length - 1; i >= 0; i--) if (r[i]) return i + 1;
  return 0;
};
const isNumeric = (v: string) => /^[-+]?[\d,]+(\.\d+)?%?$/.test(v.trim());
const isSource = (r: string[]) => /^(Source:|Values are|Figures are)/.test(r[0] ?? "") && r.slice(1).every((x) => !x);
