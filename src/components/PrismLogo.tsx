export function PrismLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <defs>
        <linearGradient id="prism-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path d="M12 3 L21 20 H3 Z" stroke="url(#prism-logo)" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export function AssistantAvatar() {
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7c5cff] to-[#38bdf8] text-white shadow-sm">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
        <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" />
        <path d="M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" opacity=".8" />
      </svg>
    </div>
  );
}
