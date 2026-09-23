import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Compact number formatting for dashboard tiles: 8.2k, 1.4M, 63.5. */
export function formatNumber(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";

  const magnitude = Math.abs(value);
  let text: string;
  if (magnitude >= 1_000_000) text = `${(value / 1_000_000).toFixed(1)}M`;
  else if (magnitude >= 10_000) text = `${(value / 1000).toFixed(1)}k`;
  else if (magnitude >= 100) text = Math.round(value).toLocaleString();
  else if (magnitude >= 10) text = value.toFixed(1);
  else text = value.toFixed(magnitude < 1 ? 2 : 1);

  return unit ? `${text} ${unit}` : text;
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "3.2k steps" style label for a metric's typical value. */
export function describeLag(lag: number): string {
  if (lag === 0) return "same day";
  if (lag === 1) return "next day";
  if (lag === -1) return "previous day";
  return lag > 0 ? `${lag} days later` : `${Math.abs(lag)} days earlier`;
}

/** A p-value the way a reader wants to see it. */
export function formatP(p: number): string {
  if (p < 0.0001) return "p < 0.0001";
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(3)}`;
}
