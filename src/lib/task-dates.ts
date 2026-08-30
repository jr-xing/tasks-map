const ISO_DATE_VALUE =
  /^(\d{4})-(\d{2})-(\d{2})(?:(?:T|\s)(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/;

const INLINE_DUE_PATTERNS = [
  /📅\s*(\d{4}-\d{2}-\d{2})/u,
  /\[\[due::\s*(\d{4}-\d{2}-\d{2})\s*\]\]/i,
  /\bdue:(\d{4}-\d{2}-\d{2})\b/i,
];

const INLINE_DUE_REMOVAL_PATTERNS = [
  /📅\s*\d{4}-\d{2}-\d{2}/gu,
  /\[\[due::\s*\d{4}-\d{2}-\d{2}\s*\]\]/gi,
  /\bdue:\d{4}-\d{2}-\d{2}\b/gi,
];

/** Normalize a supported ISO date or ISO timestamp without timezone shifts. */
export function normalizeDueDate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = value.trim().match(ISO_DATE_VALUE);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${yearText}-${monthText}-${dayText}`;
}

/** Read the first supported inline due-date representation. */
export function parseInlineDueDate(text: string): string | null {
  for (const pattern of INLINE_DUE_PATTERNS) {
    const match = text.match(pattern);
    const dueDate = normalizeDueDate(match?.[1]);
    if (dueDate) return dueDate;
  }
  return null;
}

/** Remove inline due metadata from presentation summaries. */
export function stripInlineDueDates(text: string): string {
  return INLINE_DUE_REMOVAL_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, ""),
    text
  );
}
