export const uid = () => Math.random().toString(36).slice(2, 10);

/** localStorage helpers; storage can be unavailable (private mode, blocked site data). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function formatBytes(n?: number) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function groupByAge(ts: number, now = Date.now()) {
  const days = (now - ts) / 86400000;
  if (days < 1) return "Today";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}
