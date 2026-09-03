export const EMZERO_IMPORTANT_KEYWORD = 'Emzero-Important-v1';
export const EMZERO_MESSAGE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type EmzeroMessageColor = (typeof EMZERO_MESSAGE_COLORS)[number];

export function isEmzeroMessageColor(value: unknown): value is EmzeroMessageColor {
  return typeof value === 'string' && (EMZERO_MESSAGE_COLORS as readonly string[]).includes(value);
}

const dueKeywordPattern = /^Emzero-Due-(\d{4})(\d{2})(\d{2})-v1$/i;
const colorKeywordPattern = /^Emzero-Color-(red|orange|yellow|green|blue|purple)-v1$/i;
const dateKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface EmzeroImportance {
  important: boolean;
  dueDate: string | null;
}

export function validDateKey(value: string): boolean {
  const match = dateKeyPattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localDateKeyAfter(days: number, now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function tomorrowDateKey(now = new Date()): string {
  return localDateKeyAfter(1, now);
}

export function emzeroDueKeyword(dueDate: string): string {
  if (!validDateKey(dueDate)) throw new Error('Choose a valid due date.');
  return `Emzero-Due-${dueDate.replaceAll('-', '')}-v1`;
}

export function isEmzeroDueKeyword(flag: string): boolean {
  return dueKeywordPattern.test(flag);
}

export function emzeroColorKeyword(color: EmzeroMessageColor): string {
  return `Emzero-Color-${color}-v1`;
}

export function isEmzeroColorKeyword(flag: string): boolean {
  return colorKeywordPattern.test(flag);
}

export function emzeroColorFromFlags(
  flags: ReadonlySet<string> | undefined,
): EmzeroMessageColor | null {
  for (const flag of flags ?? []) {
    const match = colorKeywordPattern.exec(flag);
    if (match) return match[1].toLowerCase() as EmzeroMessageColor;
  }
  return null;
}

export function emzeroImportanceFromFlags(flags: ReadonlySet<string> | undefined): EmzeroImportance {
  let important = false;
  let dueDate: string | null = null;
  for (const flag of flags ?? []) {
    if (flag.toLowerCase() === EMZERO_IMPORTANT_KEYWORD.toLowerCase()) important = true;
    const match = dueKeywordPattern.exec(flag);
    if (!match) continue;
    const candidate = `${match[1]}-${match[2]}-${match[3]}`;
    if (validDateKey(candidate)) dueDate = candidate;
  }
  return { important, dueDate: important ? dueDate : null };
}

export function supportsEmzeroKeywords(permanentFlags: ReadonlySet<string> | undefined): boolean {
  if (!permanentFlags) return true;
  return [...permanentFlags].some((flag) => flag.toLowerCase() === '\\*');
}
