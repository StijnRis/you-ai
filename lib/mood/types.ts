import type { TypeMeta } from "@/lib/mapping/spec";

/**
 * Mood is one series regardless of where a reading came from — the synthetic
 * connector, a manual check-in, or the sample data. Sharing the type key is
 * what lets them sit on the same chart and correlate against everything else.
 */
export const MOOD_TYPE_KEY = "mood";

export const MOOD_TYPE_META: TypeMeta = {
  label: "Mood",
  unit: "/10",
  valueKind: "numeric",
  aggregation: "avg",
  polarity: 1,
  category: "mood",
  correlatable: true,
};

export const MOOD_MIN = 1;
export const MOOD_MAX = 10;

/** The 1-10 scale, labelled. Used by the logger and the daily email. */
export const MOOD_SCALE = [
  { value: 1, emoji: "😞", label: "Awful" },
  { value: 2, emoji: "😔", label: "Bad" },
  { value: 3, emoji: "😕", label: "Low" },
  { value: 4, emoji: "😐", label: "Meh" },
  { value: 5, emoji: "🙂", label: "OK" },
  { value: 6, emoji: "😊", label: "Fine" },
  { value: 7, emoji: "😄", label: "Good" },
  { value: 8, emoji: "😁", label: "Great" },
  { value: 9, emoji: "🤩", label: "Excellent" },
  { value: 10, emoji: "🥳", label: "Amazing" },
] as const;

/** Nearest scale entry for an averaged value like 7.4. */
export function moodFace(value: number) {
  const rounded = Math.round(Math.min(Math.max(value, MOOD_MIN), MOOD_MAX));
  return MOOD_SCALE.find((entry) => entry.value === rounded) ?? MOOD_SCALE[4];
}
