"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
  Cell,
} from "recharts";
import { formatDate, formatNumber } from "@/lib/utils";

/*
 * Every chart here is single-axis by construction. Two metrics on one plot are
 * z-scored onto a shared "standard deviations from mean" scale rather than
 * given an axis each — a dual-axis chart lets you place any two lines in any
 * relationship you like just by choosing the scales, which is exactly the
 * illusion this app exists to dispel.
 */

const AXIS = {
  stroke: "var(--viz-axis)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function TooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** A 60-day trace under a stat tile. No axes — the tile carries the number. */
export function MetricSparkline({
  series,
  unit,
}: {
  series: [string, number][];
  unit?: string | null;
}) {
  const data = series
    .slice(-60)
    .map(([date, value]) => ({ date, value }));

  if (data.length < 2) return <div className="h-12" />;

  return (
    <div className="mt-3 h-12">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <XAxis dataKey="date" hide />
          <Tooltip
            cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as { date: string; value: number };
              return (
                <TooltipShell>
                  <span className="text-muted">{formatDate(point.date)}</span>{" "}
                  <span className="tnum font-medium">{formatNumber(point.value, unit)}</span>
                </TooltipShell>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--viz-series-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
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
  if (points.length < 3) return null;

  const fit = leastSquares(points.map((p) => p.x), points.map((p) => p.y));
  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const fitLine = [
    { x: minX, y: fit.intercept + fit.slope * minX },
    { x: maxX, y: fit.intercept + fit.slope * maxX },
  ];

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 28, left: 8 }}>
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            domain={["dataMin", "dataMax"]}
            label={{
              value: xUnit ? `${xLabel} (${xUnit})` : xLabel,
              position: "insideBottom",
              offset: -16,
              style: { fill: "var(--text-muted)", fontSize: 11 },
            }}
            {...AXIS}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            domain={["dataMin", "dataMax"]}
            width={48}
            label={{
              value: yUnit ? `${yLabel} (${yUnit})` : yLabel,
              angle: -90,
              position: "insideLeft",
              style: { fill: "var(--text-muted)", fontSize: 11, textAnchor: "middle" },
            }}
            {...AXIS}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: "var(--viz-axis)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as PairPoint;
              if (point.date === undefined) return null;
              return (
                <TooltipShell>
                  <div className="font-medium">{formatDate(point.date)}</div>
                  <div className="tnum mt-0.5 text-muted">
                    {xLabel}: {formatNumber(point.x, xUnit)}
                  </div>
                  <div className="tnum text-muted">
                    {yLabel}: {formatNumber(point.y, yUnit)}
                  </div>
                </TooltipShell>
              );
            }}
          />
          {/* Fit first, so the points sit on top of it. */}
          <Scatter
            data={fitLine}
            line={{ stroke: "var(--viz-axis)", strokeWidth: 2 }}
            shape={() => <g />}
            isAnimationActive={false}
            legendType="none"
          />
          <Scatter
            data={points}
            fill="var(--viz-series-1)"
            fillOpacity={0.75}
            // A surface-coloured ring keeps overlapping days countable.
            stroke="var(--surface)"
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * How the coefficient changes as one metric is shifted against the other.
 * A peak away from zero is the interesting case: it says the effect takes a day
 * to show up.
 */
export function LagProfile({
  points,
}: {
  points: { lag: number; pearson: number; n: number }[];
}) {
  return (
    <div className="h-36">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="lag"
            label={{
              value: "shift (days)",
              position: "insideBottom",
              offset: -12,
              style: { fill: "var(--text-muted)", fontSize: 11 },
            }}
            {...AXIS}
          />
          <YAxis domain={[-1, 1]} width={36} ticks={[-1, -0.5, 0, 0.5, 1]} {...AXIS} />
          <ReferenceLine y={0} stroke="var(--viz-axis)" strokeWidth={1} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as { lag: number; pearson: number; n: number };
              return (
                <TooltipShell>
                  <div className="tnum">
                    r = {point.pearson.toFixed(2)}{" "}
                    <span className="text-muted">over {point.n} days</span>
                  </div>
                </TooltipShell>
              );
            }}
          />
          <Bar dataKey="pearson" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {points.map((point) => (
              <Cell
                key={point.lag}
                fill={point.pearson >= 0 ? "var(--viz-pos)" : "var(--viz-neg)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Two metrics over time on one scale. Both are z-scored, so the axis is in
 * standard deviations and neither series can be visually flattered by a
 * convenient choice of range.
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
  const bByDate = new Map(b);
  const rows = a
    .filter(([date]) => bByDate.has(date))
    .map(([date, value]) => ({ date, a: value, b: bByDate.get(date)! }));

  if (rows.length < 3) return null;

  const za = zScores(rows.map((row) => row.a));
  const zb = zScores(rows.map((row) => row.b));
  const data = rows.map((row, i) => ({ date: row.date, a: za[i], b: zb[i], rawA: row.a, rawB: row.b }));

  return (
    <div>
      {/* Two series, so identity is never carried by colour alone. */}
      <div className="mb-2 flex flex-wrap gap-4 text-xs">
        <LegendSwatch color="var(--viz-series-1)" label={aLabel} />
        <LegendSwatch color="var(--viz-series-2)" label={bLabel} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 20, left: 4 }}>
            <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              minTickGap={40}
              tickFormatter={(date: string) => formatDate(date).replace(/,.*/, "")}
              {...AXIS}
            />
            <YAxis
              width={44}
              label={{
                value: "sd from mean",
                angle: -90,
                position: "insideLeft",
                style: { fill: "var(--text-muted)", fontSize: 11, textAnchor: "middle" },
              }}
              {...AXIS}
            />
            <ReferenceLine y={0} stroke="var(--viz-axis)" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as {
                  date: string;
                  rawA: number;
                  rawB: number;
                };
                return (
                  <TooltipShell>
                    <div className="font-medium">{formatDate(point.date)}</div>
                    <div className="tnum mt-0.5 text-muted">
                      {aLabel}: {formatNumber(point.rawA)}
                    </div>
                    <div className="tnum text-muted">
                      {bLabel}: {formatNumber(point.rawB)}
                    </div>
                  </TooltipShell>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="a"
              stroke="var(--viz-series-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="b"
              stroke="var(--viz-series-2)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <span className="h-0.5 w-4 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
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
