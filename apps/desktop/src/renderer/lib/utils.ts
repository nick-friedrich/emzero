import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function keysInRange(keys: string[], anchorIndex: number, endIndex: number): ReadonlySet<string> {
  const start = Math.min(anchorIndex, endIndex);
  const end = Math.max(anchorIndex, endIndex);
  return new Set(keys.slice(start, end + 1));
}
