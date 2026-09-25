import { useState, type ReactNode } from "react";
import { Text, useColorScheme, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { formatDate, formatNumber } from "@youai/core/format";

/*
 * Every chart here is single-axis by construction. Two metrics on one plot are
 * z-scored onto a shared "standard deviations from mean" scale rather than
 * given an axis each — a dual-axis chart lets you place any two lines in any
 * relationship you like just by choosing the scales, which is exactly the
 * illusion this app exists to dispel.
 *
 * Colours are validated with the dataviz palette checker against these exact
 * surfaces, separately for light and dark. Do not hand-tune without re-running it.
 */

const PALETTE = {
  light: {
    series1: "#2a78d6",
    series2: "#eb6834",
    pos: "#2a78d6",
    neg: "#e34948",
    grid: "#e7e5e4",
    axis: "#a8a29e",
    surface: "#ffffff",
  },
  dark: {
    series1: "#3987e5",
    series2: "#d95926",
    pos: "#3987e5",
    neg: "#e66767",
    grid: "#2b2724",
    axis: "#78716c",
    surface: "#171514",
  },
};

export function useVizPalette() {
  return PALETTE[useColorScheme() === "dark" ? "dark" : "light"];
}

/** Width-aware container: SVG needs pixel sizes, so measure first. */
function useWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (event) => setWidth(Math.round(event.nativeEvent.layout.width))];
}

/** Touch-and-drag picks the nearest point by x — the tap equivalent of a hover crosshair. */
function useScrub(count: number, width: number, pad: number) {
  const [index, setIndex] = useState<number | null>(null);
  const pick = (event: GestureResponderEvent) => {
    if (count === 0 || width === 0) return;
    const x = event.nativeEvent.locationX - pad;
    const ratio = Math.min(Math.max(x / Math.max(width - pad * 2, 1), 0), 1);
    setIndex(Math.round(ratio * (count - 1)));
  };
  return {
    index,
    handlers: {
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      onResponderGrant: pick,
      onResponderMove: pick,
      onResponderRelease: () => setIndex(null),
      onResponderTerminate: () => setIndex(null),
    },
  };
}

function Tooltip({ children }: { children: ReactNode }) {
  return (
    <View className="absolute right-0 top-0 rounded-lg border border-border bg-surface px-2.5 py-1.5">
      {children}
    </View>
  );
}

function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/* -------------------------------------------------------------------------- */

/** A 60-day trace under a stat tile. No axes — the tile carries the number. */
export function MetricSparkline({ series, unit }: { series: [string, number][]; unit?: string | null }) {
  const colors = useVizPalette();
  const [width, onLayout] = useWidth();
  const data = series.slice(-60);
  const height = 48;
  const pad = 4;
  const scrub = useScrub(data.length, width, pad);

  if (data.length < 2) return <View className="h-12" />;

  const values = data.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = data.map(([, v], i) => ({
    x: pad + (i / (data.length - 1)) * (width - pad * 2),
    y: pad + (1 - (v - min) / span) * (height - pad * 2),
  }));
  const active = scrub.index !== null ? { point: points[scrub.index], row: data[scrub.index] } : null;

  return (
    <View className="mt-3 h-12" onLayout={onLayout} {...scrub.handlers}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {active ? (
            <Line x1={active.point.x} x2={active.point.x} y1={0} y2={height} stroke={colors.axis} strokeWidth={1} />
          ) : null}
          <Path d={linePath(points)} stroke={colors.series1} strokeWidth={2} fill="none" />
          {active ? (
            <Circle cx={active.point.x} cy={active.point.y} r={4} fill={colors.series1} stroke={colors.surface} strokeWidth={2} />
          ) : null}
        </Svg>
      ) : null}
      {active ? (
        <Tooltip>
          <Text className="text-xs text-muted">
            {formatDate(active.row[0])} <Text className="font-medium text-text">{formatNumber(active.row[1], unit)}</Text>
          </Text>
        </Tooltip>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */

export type PairPoint = { date: string; x: number; y: number };

/**
 * The scatter behind a correlation, with its least-squares fit. Seeing the
 * cloud is the honest version of a coefficient: it shows whether r came from a
 * real trend or from two outliers.
 */
export function CorrelationScatter({
  points,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
}: {
  points: PairPoint[];
  xLabel: string;
  yLabel: string;
  xUnit?: string | null;
  yUnit?: string | null;
}) {
  const colors = useVizPalette();
  const [width, onLayout] = useWidth();
  const [selected, setSelected] = useState<PairPoint | null>(null);
  if (points.length < 3) return null;

  const height = 220;
  const pad = 12;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (width - pad * 2);
  const sy = (y: number) => pad + (1 - (y - minY) / (maxY - minY || 1)) * (height - pad * 2);
  const fit = leastSquares(xs, ys);

  const pick = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    let best: PairPoint | null = null;
    let bestDistance = Infinity;
    for (const p of points) {
      const d = (sx(p.x) - locationX) ** 2 + (sy(p.y) - locationY) ** 2;
      if (d < bestDistance) [best, bestDistance] = [p, d];
    }
    setSelected(bestDistance < 30 ** 2 ? best : null);
  };

  return (
    <View>
      <View style={{ height }} onLayout={onLayout} onStartShouldSetResponder={() => true} onResponderGrant={pick}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {[0.25, 0.5, 0.75].map((t) => (
              <Line key={t} x1={pad} x2={width - pad} y1={pad + t * (height - pad * 2)} y2={pad + t * (height - pad * 2)} stroke={colors.grid} strokeDasharray="2 4" />
            ))}
            {/* Fit first, so the points sit on top of it. */}
            <Line
              x1={sx(minX)}
              y1={sy(fit.intercept + fit.slope * minX)}
              x2={sx(maxX)}
              y2={sy(fit.intercept + fit.slope * maxX)}
              stroke={colors.axis}
              strokeWidth={2}
            />
            {points.map((p) => (
              // A surface-coloured ring keeps overlapping days countable.
              <Circle key={p.date} cx={sx(p.x)} cy={sy(p.y)} r={4} fill={colors.series1} fillOpacity={0.75} stroke={colors.surface} strokeWidth={1.5} />
            ))}
            {selected ? <Circle cx={sx(selected.x)} cy={sy(selected.y)} r={6} fill="none" stroke={colors.series1} strokeWidth={2} /> : null}
          </Svg>
        ) : null}
        {selected ? (
          <Tooltip>
            <Text className="text-xs font-medium text-text">{formatDate(selected.date)}</Text>
            <Text className="text-xs text-muted">{xLabel}: {formatNumber(selected.x, xUnit)}</Text>
            <Text className="text-xs text-muted">{yLabel}: {formatNumber(selected.y, yUnit)}</Text>
          </Tooltip>
        ) : null}
      </View>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-xs text-muted">→ {xUnit ? `${xLabel} (${xUnit})` : xLabel}</Text>
        <Text className="text-xs text-muted">↑ {yUnit ? `${yLabel} (${yUnit})` : yLabel}</Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * How the coefficient changes as one metric is shifted against the other.
 * A peak away from zero is the interesting case: the effect takes a day to show.
 */
export function LagProfile({ points }: { points: { lag: number; pearson: number; n: number }[] }) {
  const colors = useVizPalette();
  const [width, onLayout] = useWidth();
  const height = 130;
  const pad = 8;
  const scrub = useScrub(points.length, width, pad);
  if (points.length === 0) return null;

  const slot = (width - pad * 2) / points.length;
  const barWidth = Math.max(slot - 2, 2); // 2px surface gap between bars
  const mid = height / 2;
  const active = scrub.index !== null ? points[scrub.index] : null;

  return (
    <View>
      <View style={{ height }} onLayout={onLayout} {...scrub.handlers}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {[-1, -0.5, 0.5, 1].map((t) => (
              <Line key={t} x1={pad} x2={width - pad} y1={mid - t * (mid - pad)} y2={mid - t * (mid - pad)} stroke={colors.grid} strokeDasharray="2 4" />
            ))}
            {points.map((p, i) => {
              const h = Math.abs(p.pearson) * (mid - pad);
              return (
                <Rect
                  key={p.lag}
                  x={pad + i * slot + 1}
                  y={p.pearson >= 0 ? mid - h : mid}
                  width={barWidth}
                  height={Math.max(h, 1)}
                  rx={Math.min(4, barWidth / 2)}
                  fill={p.pearson >= 0 ? colors.pos : colors.neg}
                  opacity={active && active.lag !== p.lag ? 0.5 : 1}
                />
              );
            })}
            <Line x1={pad} x2={width - pad} y1={mid} y2={mid} stroke={colors.axis} strokeWidth={1} />
          </Svg>
        ) : null}
        {active ? (
          <Tooltip>
            <Text className="text-xs text-text">
              shift {active.lag}d · r = {active.pearson.toFixed(2)} <Text className="text-muted">over {active.n} days</Text>
            </Text>
          </Tooltip>
        ) : null}
      </View>
      <View className="flex-row justify-between px-2">
        <Text className="text-xs text-muted">{points[0].lag}</Text>
        <Text className="text-xs text-muted">shift (days)</Text>
        <Text className="text-xs text-muted">{points[points.length - 1].lag}</Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Two metrics over time on one scale. Both are z-scored, so the axis is in
 * standard deviations and neither series can be flattered by a convenient range.
 */
export function ComparisonChart({
  a,
  b,
  aLabel,
  bLabel,
}: {
  a: [string, number][];
  b: [string, number][];
  aLabel: string;
  bLabel: string;
}) {
  const colors = useVizPalette();
  const [width, onLayout] = useWidth();
  const bByDate = new Map(b);
  const rows = a.filter(([date]) => bByDate.has(date)).map(([date, value]) => ({ date, a: value, b: bByDate.get(date)! }));
  const height = 200;
  const pad = 8;
  const scrub = useScrub(rows.length, width, pad);
  if (rows.length < 3) return null;

  const za = zScores(rows.map((row) => row.a));
  const zb = zScores(rows.map((row) => row.b));
  const all = [...za, ...zb];
  const [lo, hi] = [Math.min(...all, -1), Math.max(...all, 1)];
  const x = (i: number) => pad + (i / (rows.length - 1)) * (width - pad * 2);
  const y = (z: number) => pad + (1 - (z - lo) / (hi - lo)) * (height - pad * 2);
  const active = scrub.index !== null ? rows[scrub.index] : null;

  return (
    <View>
      {/* Two series, so identity is never carried by colour alone. */}
      <View className="mb-2 flex-row flex-wrap gap-4">
        <LegendSwatch color={colors.series1} label={aLabel} />
        <LegendSwatch color={colors.series2} label={bLabel} />
      </View>
      <View style={{ height }} onLayout={onLayout} {...scrub.handlers}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke={colors.axis} strokeDasharray="4 4" />
            {scrub.index !== null ? (
              <Line x1={x(scrub.index)} x2={x(scrub.index)} y1={0} y2={height} stroke={colors.axis} strokeWidth={1} />
            ) : null}
            <Path d={linePath(za.map((z, i) => ({ x: x(i), y: y(z) })))} stroke={colors.series1} strokeWidth={2} fill="none" />
            <Path d={linePath(zb.map((z, i) => ({ x: x(i), y: y(z) })))} stroke={colors.series2} strokeWidth={2} fill="none" />
          </Svg>
        ) : null}
        {active ? (
          <Tooltip>
            <Text className="text-xs font-medium text-text">{formatDate(active.date)}</Text>
            <Text className="text-xs text-muted">{aLabel}: {formatNumber(active.a)}</Text>
            <Text className="text-xs text-muted">{bLabel}: {formatNumber(active.b)}</Text>
          </Tooltip>
        ) : null}
      </View>
      <View className="flex-row justify-between">
        <Text className="text-xs text-muted">{formatDate(rows[0].date)}</Text>
        <Text className="text-xs text-muted">sd from mean</Text>
        <Text className="text-xs text-muted">{formatDate(rows[rows.length - 1].date)}</Text>
      </View>
    </View>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} />
      <Text className="text-xs text-muted">{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function leastSquares(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: meanY - slope * meanX };
}

function zScores(values: number[]): number[] {
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(n - 1, 1));
  return sd === 0 ? values.map(() => 0) : values.map((v) => (v - mean) / sd);
}
