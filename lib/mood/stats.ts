import { getDailySeries, listEventTypes } from "@/lib/db/queries";
import { WEEKDAY_NAMES, shiftLocalDate, weekdayOf } from "@/lib/events/time";
import { MOOD_TYPE_KEY } from "@/lib/mood/types";

export type TopDay = { localDate: string; value: number };

export type DidYouKnow = {
  /** Short headline for the card. */
  headline: string;
  /** The supporting sentence. */
  detail: string;
};

export type MoodStats = {
  days: number;
  average: number | null;
  latest: { localDate: string; value: number } | null;
  /** Average over the last 7 days with data, and the 7 before that. */
  trend: { recent: number; previous: number; delta: number } | null;
  best: TopDay[];
  worst: TopDay[];
  /** Consecutive days ending today (or yesterday) that have a mood reading. */
  streak: number;
  facts: DidYouKnow[];
};

const EMPTY: MoodStats = {
  days: 0,
  average: null,
  latest: null,
  trend: null,
  best: [],
  worst: [],
  streak: 0,
  facts: [],
};

/**
 * Everything the Mood page and the daily email show, from the daily rollup.
 *
 * Reads `daily_metrics` rather than raw events, so a day with three check-ins
 * counts once at its averaged value — the same number every other part of the
 * app correlates against.
 */
export async function getMoodStats(userId: string, today: string): Promise<MoodStats> {
  const [moodSeries] = await getDailySeries(userId, { typeKeys: [MOOD_TYPE_KEY] });
  const points = [...(moodSeries?.points ?? new Map())].sort(([a], [b]) => a.localeCompare(b));
  if (points.length === 0) return EMPTY;

  const values = points.map(([, value]) => value);
  const average = mean(values);
  const [latestDate, latestValue] = points[points.length - 1];

  const ranked = [...points].sort(([, a], [, b]) => b - a);
  const best = ranked.slice(0, 3).map(toTopDay);
  const worst = ranked.slice(-3).reverse().map(toTopDay);

  return {
    days: points.length,
    average,
    latest: { localDate: latestDate, value: latestValue },
    trend: trendOf(points),
    best,
    worst,
    streak: streakEndingAt(new Set(points.map(([date]) => date)), today),
    facts: await facts(userId, points, average),
  };
}

function toTopDay([localDate, value]: [string, number]): TopDay {
  return { localDate, value };
}

/** Last 7 days with data against the 7 before them. */
function trendOf(points: [string, number][]): MoodStats["trend"] {
  if (points.length < 4) return null;
  const recent = points.slice(-7).map(([, value]) => value);
  const previous = points.slice(-14, -7).map(([, value]) => value);
  if (previous.length === 0) return null;

  const a = mean(recent);
  const b = mean(previous);
  return { recent: a, previous: b, delta: a - b };
}

/** Unbroken run of logged days ending today, or yesterday if today is blank. */
function streakEndingAt(logged: Set<string>, today: string): number {
  let cursor = logged.has(today) ? today : shiftLocalDate(today, -1);
  let streak = 0;
  while (logged.has(cursor)) {
    streak += 1;
    cursor = shiftLocalDate(cursor, -1);
  }
  return streak;
}

/**
 * The "did you know" cards.
 *
 * Every candidate is computed, then the ones that clear a materiality bar are
 * kept and the strongest shown first — so a flat week produces fewer cards
 * rather than a page of noise dressed up as insight.
 */
async function facts(
  userId: string,
  points: [string, number][],
  average: number,
): Promise<DidYouKnow[]> {
  const out: { fact: DidYouKnow; strength: number }[] = [];
  const byDate = new Map(points);

  // Best and worst weekday, when there is enough of each to mean anything.
  const byWeekday = new Map<number, number[]>();
  for (const [date, value] of points) {
    const day = weekdayOf(date);
    byWeekday.set(day, [...(byWeekday.get(day) ?? []), value]);
  }
  const weekdayAverages = [...byWeekday]
    .filter(([, values]) => values.length >= 3)
    .map(([day, values]) => ({ day, average: mean(values), count: values.length }))
    .sort((a, b) => b.average - a.average);

  if (weekdayAverages.length >= 3) {
    const top = weekdayAverages[0];
    const bottom = weekdayAverages[weekdayAverages.length - 1];
    const gap = top.average - bottom.average;
    if (gap >= 0.4) {
      out.push({
        strength: gap,
        fact: {
          headline: `${WEEKDAY_NAMES[top.day]}s are your best day`,
          detail: `${WEEKDAY_NAMES[top.day]}s average ${top.average.toFixed(1)}, ${gap.toFixed(1)} points above your ${WEEKDAY_NAMES[bottom.day]}s.`,
        },
      });
    }
  }

  // Weekend versus weekday.
  const weekend = points.filter(([date]) => [0, 6].includes(weekdayOf(date))).map(([, v]) => v);
  const weekday = points.filter(([date]) => ![0, 6].includes(weekdayOf(date))).map(([, v]) => v);
  if (weekend.length >= 4 && weekday.length >= 4) {
    const gap = mean(weekend) - mean(weekday);
    if (Math.abs(gap) >= 0.3) {
      out.push({
        strength: Math.abs(gap),
        fact: {
          headline: gap > 0 ? "Weekends lift you" : "Weekends drag on you",
          detail: `Your weekend mood runs ${Math.abs(gap).toFixed(1)} points ${gap > 0 ? "above" : "below"} your weekdays.`,
        },
      });
    }
  }

  // How often a good day follows a good day — mood's own momentum.
  const pairs = points
    .map(([date, value]) => [byDate.get(shiftLocalDate(date, -1)), value] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined);
  if (pairs.length >= 10) {
    const afterGood = pairs.filter(([yesterday]) => yesterday >= average).map(([, today]) => today);
    const afterBad = pairs.filter(([yesterday]) => yesterday < average).map(([, today]) => today);
    if (afterGood.length >= 3 && afterBad.length >= 3) {
      const gap = mean(afterGood) - mean(afterBad);
      if (Math.abs(gap) >= 0.3) {
        out.push({
          strength: Math.abs(gap),
          fact: {
            headline: "Good days come in runs",
            detail: `The day after an above-average day, you average ${mean(afterGood).toFixed(1)} — against ${mean(afterBad).toFixed(1)} after a below-average one.`,
          },
        });
      }
    }
  }

  out.push(...(await crossMetricFacts(userId, byDate, average)));

  return out
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4)
    .map((entry) => entry.fact);
}

/**
 * Mood against everything else being tracked: for each other correlatable
 * series, how its own good days compare with its bad ones.
 */
async function crossMetricFacts(
  userId: string,
  mood: Map<string, number>,
  moodAverage: number,
): Promise<{ fact: DidYouKnow; strength: number }[]> {
  const types = (await listEventTypes()).filter(
    (type) => type.key !== MOOD_TYPE_KEY && type.correlatable,
  );
  if (types.length === 0) return [];

  const series = await getDailySeries(userId, { typeKeys: types.map((type) => type.key) });
  const labels = new Map(types.map((type) => [type.key, type]));
  const out: { fact: DidYouKnow; strength: number }[] = [];

  for (const entry of series) {
    const paired = [...entry.points]
      .filter(([date]) => mood.has(date))
      .map(([date, value]) => [value, mood.get(date)!] as const);
    if (paired.length < 10) continue;

    const median = medianOf(paired.map(([value]) => value));
    const high = paired.filter(([value]) => value >= median).map(([, m]) => m);
    const low = paired.filter(([value]) => value < median).map(([, m]) => m);
    if (high.length < 4 || low.length < 4) continue;

    const gap = mean(high) - mean(low);
    if (Math.abs(gap) < 0.4) continue;

    const type = labels.get(entry.typeKey)!;
    const direction = gap > 0 ? "higher" : "lower";
    out.push({
      strength: Math.abs(gap),
      fact: {
        headline: `${type.label} moves with your mood`,
        detail: `On your top half of ${type.label.toLowerCase()} days, mood averages ${mean(high).toFixed(1)} — ${Math.abs(gap).toFixed(1)} points ${direction} than the rest. Your overall average is ${moodAverage.toFixed(1)}.`,
      },
    });
  }

  return out;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
