import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text }: { text: string }) {
  return (
    <div
      className="prose prose-slate max-w-none text-[15.5px] leading-[1.85] dark:prose-invert
        prose-headings:font-semibold prose-headings:text-slate-900 prose-h3:mb-2 prose-h3:mt-6 prose-h3:text-xl first:prose-h3:mt-0
        prose-p:my-2 prose-strong:text-slate-900 prose-a:text-prism-600 prose-a:underline-offset-4
        prose-table:my-4 prose-table:overflow-hidden prose-table:border prose-table:border-slate-200
        prose-th:border prose-th:border-slate-200 prose-th:bg-slate-50 prose-th:px-3 prose-th:py-2.5 prose-th:font-semibold
        prose-td:border prose-td:border-slate-200 prose-td:px-3 prose-td:py-2.5 prose-td:text-slate-600
        dark:prose-headings:text-white dark:prose-strong:text-white dark:prose-a:text-prism-300
        dark:prose-table:border-white/10 dark:prose-th:border-white/10 dark:prose-th:bg-white/5 dark:prose-td:border-white/10 dark:prose-td:text-slate-300"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
