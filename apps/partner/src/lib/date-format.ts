function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatShortDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${formatDate(date)}, ${formatTime(date)}`;
}

export function formatDateRange(starts: string | Date, ends: string | Date): string {
  const start = toDate(starts);
  const end = toDate(ends);
  if (!start || !end) return "—";

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  return sameDay ? formatDate(start) : `${formatDate(start)} → ${formatDate(end)}`;
}

export function formatDateTimeRange(starts: string | Date, ends: string | Date): string {
  const start = toDate(starts);
  const end = toDate(ends);
  if (!start || !end) return "—";

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  return sameDay
    ? `${formatDate(start)}, ${formatTime(start)}-${formatTime(end)}`
    : `${formatDateTime(start)} → ${formatDateTime(end)}`;
}
