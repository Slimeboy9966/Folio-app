import React, { memo, useCallback, useId, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Course,
  GradeScaleEntry,
  HypotheticalOverlay,
} from '../types/grades';
import {
  GpaTimelinePoint,
  computeGpaTimeline,
  formatGpa,
  formatPercent,
  formatSignedDelta,
} from '../utils/gradeMath';

interface CumulativeGpaChartProps {
  courses: Course[];
  gradeScale: GradeScaleEntry[];
  isHypothetical: boolean;
  overlay: HypotheticalOverlay;
  priorGpa: number;
  priorCredits: number;
  onSelectCourse?: (courseId: string) => void;
}

interface CustomDotProps {
  cx?: number;
  cy?: number;
  payload?: GpaTimelinePoint;
  isHypothetical: boolean;
  metric: 'cumulative' | 'term';
  totalPoints: number;
}

const MilestoneDot: React.FC<CustomDotProps> = ({
  cx,
  cy,
  payload,
  isHypothetical,
  metric,
  totalPoints,
}) => {
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return null;

  const delta = metric === 'cumulative' ? payload.deltaCumulative : payload.deltaTerm;
  const isMajor = payload.hasMajorAssessment;

  if (!isMajor) {
    if (totalPoints > 28) return null;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={2.75}
        fill={isHypothetical ? '#f59e0b' : 'var(--gpa-line-stroke)'}
        fillOpacity={0.85}
        stroke="var(--gpa-dot-ring)"
        strokeWidth={1.25}
      />
    );
  }

  let fill = isHypothetical ? '#f59e0b' : 'var(--gpa-line-stroke)';
  if (!isHypothetical && delta !== null) {
    if (delta >= 0.015) fill = '#10b981';
    else if (delta <= -0.015) fill = '#f43f5e';
  }

  return (
    <g>
      <circle cx={cx} cy={cy} r={8.5} fill={fill} fillOpacity={0.18} />
      <circle
        cx={cx}
        cy={cy}
        r={4.5}
        fill={fill}
        stroke="var(--gpa-dot-ring)"
        strokeWidth={2}
      />
    </g>
  );
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: GpaTimelinePoint }>;
  isHypothetical: boolean;
  metric: 'cumulative' | 'term';
}

const GpaTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  isHypothetical,
  metric,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const primaryVal =
    metric === 'cumulative' ? point.displayCumulativeGpa : point.displayTermGpa;
  const actualVal =
    metric === 'cumulative' ? point.actualCumulativeGpa : point.actualTermGpa;
  const delta = metric === 'cumulative' ? point.deltaCumulative : point.deltaTerm;

  const sortedEvents = [...point.events].sort((a, b) => {
    if (a.isMajor !== b.isMajor) return a.isMajor ? -1 : 1;
    return b.possible - a.possible;
  });

  return (
    <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-white/15 rounded-xl shadow-xl px-3.5 py-3 text-xs w-[264px] max-w-[82vw] text-slate-800 dark:text-slate-100">
      <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-slate-200/70 dark:border-white/10">
        <span className="font-mono font-medium text-slate-500 dark:text-slate-400 shrink-0">
          {point.label}
        </span>
        <div className="flex items-baseline gap-1.5 tabular-nums min-w-0">
          <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap">
            {formatGpa(primaryVal)} GPA
          </span>
          {delta !== null && Math.abs(delta) >= 0.005 && (
            <span
              className={`font-mono font-semibold whitespace-nowrap ${
                delta > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {delta > 0 ? '▲' : '▼'} {formatSignedDelta(delta, '', 2)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
        <span>Term {formatGpa(point.displayTermGpa)}</span>
        <span>Cum. {formatGpa(point.displayCumulativeGpa)}</span>
      </div>

      {isHypothetical && actualVal !== null && Math.abs(primaryVal - actualVal) >= 0.005 && (
        <div className="mt-1 text-[11px] font-mono text-amber-700 dark:text-amber-300 tabular-nums">
          Actual baseline: {formatGpa(actualVal)} (
          {formatSignedDelta(primaryVal - actualVal, '', 2)})
        </div>
      )}

      {sortedEvents.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-1.5">
          {sortedEvents.slice(0, 4).map((ev, idx) => (
            <div key={`${ev.courseId}-${idx}`} className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {ev.title}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {ev.courseCode} · {ev.categoryName}
                  {ev.isMajor ? ' · Major' : ''}
                </div>
              </div>
              <div className="text-right font-mono shrink-0 tabular-nums">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {ev.earned}/{ev.possible}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {formatPercent(ev.percent, 0)}
                </div>
              </div>
            </div>
          ))}
          {sortedEvents.length > 4 && (
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              +{sortedEvents.length - 4} additional graded items
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const CumulativeGpaChartInner: React.FC<CumulativeGpaChartProps> = ({
  courses,
  gradeScale,
  isHypothetical,
  overlay,
  priorGpa,
  priorCredits,
  onSelectCourse,
}) => {
  const [metric, setMetric] = useState<'cumulative' | 'term'>('cumulative');
  const [filterMode, setFilterMode] = useState<'all' | 'major'>('all');
  const uid = useId().replace(/:/g, '');
  const areaGradId = `gpa-area-${uid}`;

  const allPoints = useMemo(
    () =>
      computeGpaTimeline(
        courses,
        gradeScale,
        isHypothetical ? overlay : null,
        priorGpa,
        priorCredits
      ),
    [courses, gradeScale, isHypothetical, overlay, priorGpa, priorCredits]
  );

  const majorPoints = useMemo(
    () => allPoints.filter((p) => p.hasMajorAssessment),
    [allPoints]
  );

  const chartPoints = useMemo(() => {
    const base =
      filterMode === 'major' && majorPoints.length >= 2 ? majorPoints : allPoints;
    if (
      base.length === 1 &&
      metric === 'cumulative' &&
      priorCredits > 0 &&
      priorGpa > 0
    ) {
      const first = base[0];
      const startPt: GpaTimelinePoint = {
        date: '0000-00-00',
        label: 'Term Start',
        actualTermGpa: first.actualTermGpa,
        actualCumulativeGpa: Number(priorGpa.toFixed(3)),
        hypotheticalTermGpa: first.hypotheticalTermGpa,
        hypotheticalCumulativeGpa: Number(priorGpa.toFixed(3)),
        displayCumulativeGpa: Number(priorGpa.toFixed(3)),
        displayTermGpa: first.displayTermGpa,
        deltaCumulative: null,
        deltaTerm: null,
        hasMajorAssessment: false,
        majorCount: 0,
        events: [],
      };
      return [startPt, first];
    }
    return base;
  }, [filterMode, majorPoints, allPoints, metric, priorCredits, priorGpa]);

  const yDomain = useMemo<[number, number]>(() => {
    if (chartPoints.length === 0) return [0, 4];
    const vals: number[] = [];
    for (const p of chartPoints) {
      vals.push(metric === 'cumulative' ? p.displayCumulativeGpa : p.displayTermGpa);
      const act = metric === 'cumulative' ? p.actualCumulativeGpa : p.actualTermGpa;
      if (act !== null) vals.push(act);
    }
    if (metric === 'cumulative' && priorCredits > 0 && priorGpa > 0) {
      vals.push(priorGpa);
    }
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const low = Math.max(0, Math.floor((minVal - 0.16) * 10) / 10);
    const high = Math.min(4.0, Math.ceil((maxVal + 0.12) * 10) / 10);
    if (high - low < 0.4) {
      const paddedLow = Math.max(0, Number((high - 0.4).toFixed(2)));
      return [paddedLow, Math.min(4.0, Number((paddedLow + 0.4).toFixed(2)))];
    }
    return [Number(low.toFixed(2)), Number(high.toFixed(2))];
  }, [chartPoints, metric, priorCredits, priorGpa]);

  const summary = useMemo(() => {
    if (allPoints.length === 0) return null;
    const first = allPoints[0];
    const last = allPoints[allPoints.length - 1];
    const firstVal = metric === 'cumulative' ? first.displayCumulativeGpa : first.displayTermGpa;
    const lastVal = metric === 'cumulative' ? last.displayCumulativeGpa : last.displayTermGpa;
    const netShift = allPoints.length >= 2 ? lastVal - firstVal : null;

    const vals = allPoints.map((p) =>
      metric === 'cumulative' ? p.displayCumulativeGpa : p.displayTermGpa
    );
    const peakVal = Math.max(...vals);
    const lowVal = Math.min(...vals);

    const notableShifts = [...allPoints]
      .filter((p) => p.hasMajorAssessment && p.events.length > 0)
      .sort((a, b) => {
        const dA = Math.abs((metric === 'cumulative' ? a.deltaCumulative : a.deltaTerm) ?? 0);
        const dB = Math.abs((metric === 'cumulative' ? b.deltaCumulative : b.deltaTerm) ?? 0);
        if (Math.abs(dB - dA) >= 0.005) return dB - dA;
        return b.date.localeCompare(a.date);
      })
      .slice(0, 3);

    return {
      firstLabel: first.label,
      lastVal,
      peakVal,
      lowVal,
      netShift,
      majorMilestoneCount: majorPoints.length,
      notableShifts,
    };
  }, [allPoints, majorPoints.length, metric]);

  const primaryKey = metric === 'cumulative' ? 'displayCumulativeGpa' : 'displayTermGpa';
  const actualKey = metric === 'cumulative' ? 'actualCumulativeGpa' : 'actualTermGpa';
  const activeStroke = isHypothetical ? '#f59e0b' : 'var(--gpa-line-stroke)';

  const renderDot = useCallback(
    (props: { cx?: number; cy?: number; index?: number; payload?: unknown }) => (
      <MilestoneDot
        key={`dot-${props.index}`}
        cx={props.cx}
        cy={props.cy}
        payload={props.payload as GpaTimelinePoint}
        isHypothetical={isHypothetical}
        metric={metric}
        totalPoints={chartPoints.length}
      />
    ),
    [isHypothetical, metric, chartPoints.length]
  );

  return (
    <section
      aria-label="Cumulative GPA progress over the term"
      className={`rounded-2xl p-4 sm:p-6 overflow-hidden transition-colors ${
        isHypothetical ? 'glass-hypothetical' : 'glass-panel'
      }`}
    >
      {/* Header & Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 leading-snug">
            {metric === 'cumulative'
              ? 'Cumulative GPA Progress Over the Term'
              : 'Term GPA Progress Over the Term'}
          </h2>
          {summary ? (
            <div className="mt-1.5 flex items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap tabular-nums">
              <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                {formatGpa(summary.lastVal)} GPA
              </span>
              {summary.netShift !== null && Math.abs(summary.netShift) >= 0.005 && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span
                    className={`font-mono font-medium ${
                      summary.netShift > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {summary.netShift > 0 ? '▲' : '▼'} {formatSignedDelta(summary.netShift, '', 2)}{' '}
                    since {summary.firstLabel}
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-mono">
                Range {formatGpa(summary.lowVal)}–{formatGpa(summary.peakVal)}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-mono">
                {summary.majorMilestoneCount} major{' '}
                {summary.majorMilestoneCount === 1 ? 'assessment' : 'assessments'}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Tracks how major exams, essays, labs, and projects shift your cumulative GPA.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {priorCredits > 0 && (
            <div className="inline-flex items-center p-0.5 bg-slate-200/60 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 rounded-lg">
              <button
                type="button"
                onClick={() => setMetric('cumulative')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  metric === 'cumulative'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Cumulative
              </button>
              <button
                type="button"
                onClick={() => setMetric('term')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  metric === 'term'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Term Only
              </button>
            </div>
          )}

          {majorPoints.length >= 2 && (
            <div className="inline-flex items-center p-0.5 bg-slate-200/60 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 rounded-lg">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterMode === 'all'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                All Dates
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('major')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterMode === 'major'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Major Only
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recharts Responsive Area Chart */}
      {chartPoints.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200/80 dark:border-white/10 rounded-xl px-4 text-center">
          Sync or add graded assignments with due dates to visualize your cumulative GPA trajectory.
        </div>
      ) : (
        <>
          <div className="w-full h-[252px] min-w-0">
            <ResponsiveContainer width="100%" height={252} minWidth={0}>
              <AreaChart
                data={chartPoints}
                margin={{ top: 14, right: 16, left: -4, bottom: 6 }}
              >
                <defs>
                  <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={isHypothetical ? '#f59e0b' : 'var(--gpa-line-stroke)'}
                      stopOpacity={0.28}
                    />
                    <stop
                      offset="85%"
                      stopColor={isHypothetical ? '#f59e0b' : 'var(--gpa-line-stroke)'}
                      stopOpacity={0.03}
                    />
                    <stop
                      offset="100%"
                      stopColor={isHypothetical ? '#f59e0b' : 'var(--gpa-line-stroke)'}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 4"
                  stroke="var(--chart-grid)"
                  vertical={false}
                />

                <XAxis
                  dataKey="label"
                  interval="preserveStartEnd"
                  minTickGap={48}
                  padding={{ left: 10, right: 10 }}
                  tick={{
                    fill: 'var(--chart-tick)',
                    fontSize: 11,
                    fontFamily: 'ui-monospace, monospace',
                  }}
                  axisLine={{ stroke: 'var(--chart-grid)' }}
                  tickLine={false}
                  tickMargin={8}
                />

                <YAxis
                  domain={yDomain}
                  tickCount={5}
                  tickFormatter={(val: number) => val.toFixed(2)}
                  tick={{
                    fill: 'var(--chart-tick)',
                    fontSize: 11,
                    fontFamily: 'ui-monospace, monospace',
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={46}
                />

                <Tooltip
                  content={
                    <GpaTooltip isHypothetical={isHypothetical} metric={metric} />
                  }
                  cursor={{
                    stroke: 'rgba(148, 163, 184, 0.45)',
                    strokeWidth: 1,
                    strokeDasharray: '3 3',
                  }}
                />

                {metric === 'cumulative' && priorCredits > 0 && priorGpa > 0 && (
                  <ReferenceLine
                    y={priorGpa}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    strokeOpacity={0.65}
                    label={{
                      value: `Prior ${priorGpa.toFixed(2)}`,
                      position: 'insideBottomRight',
                      fill: 'var(--chart-tick)',
                      fontSize: 10,
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  />
                )}

                {isHypothetical && (
                  <Area
                    type="monotone"
                    dataKey={actualKey}
                    name="Actual GPA"
                    stroke="#94a3b8"
                    strokeWidth={1.75}
                    strokeDasharray="5 4"
                    fill="none"
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: '#94a3b8',
                      stroke: 'var(--gpa-dot-ring)',
                      strokeWidth: 1.5,
                    }}
                    isAnimationActive={false}
                  />
                )}

                <Area
                  type="monotone"
                  dataKey={primaryKey}
                  name={isHypothetical ? 'Simulated GPA' : 'Cumulative GPA'}
                  stroke={activeStroke}
                  strokeWidth={2.75}
                  fill={`url(#${areaGradId})`}
                  dot={renderDot}
                  activeDot={{
                    r: 6,
                    fill: activeStroke,
                    stroke: 'var(--gpa-dot-ring)',
                    strokeWidth: 2.25,
                  }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Legend & Key Major Assessment Shifts */}
          <div className="mt-4 pt-3.5 border-t border-slate-200/70 dark:border-white/[0.08] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isHypothetical ? 'bg-amber-500' : 'bg-blue-600 dark:bg-sky-400'
                    }`}
                  />
                  <span>{isHypothetical ? 'Simulated GPA' : 'GPA Trajectory'}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-500 ring-2 ring-emerald-500/25" />
                  <span>Major assessment lift</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-rose-500 ring-2 ring-rose-500/25" />
                  <span>Major assessment dip</span>
                </span>
                {isHypothetical && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 border-t-2 border-dashed border-slate-400 shrink-0" />
                    <span>Actual baseline</span>
                  </span>
                )}
              </div>
              <span className="font-mono tabular-nums text-slate-400 dark:text-slate-500">
                Hover or tap points for details
              </span>
            </div>

            {summary && summary.notableShifts.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-0.5">
                {summary.notableShifts.map((pt) => {
                  const lead = pt.events.find((e) => e.isMajor) || pt.events[0];
                  const delta =
                    metric === 'cumulative' ? pt.deltaCumulative : pt.deltaTerm;
                  const gpaAfter =
                    metric === 'cumulative'
                      ? pt.displayCumulativeGpa
                      : pt.displayTermGpa;

                  return (
                    <button
                      key={pt.date}
                      type="button"
                      onClick={() => lead && onSelectCourse?.(lead.courseId)}
                      className="text-left p-3 rounded-xl bg-white/55 dark:bg-white/[0.035] hover:bg-white/85 dark:hover:bg-white/[0.07] border border-slate-200/70 dark:border-white/[0.07] group transition-colors min-w-0"
                    >
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate min-w-0">
                          {pt.label} · {lead?.courseCode}
                        </span>
                        <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white shrink-0 whitespace-nowrap">
                          {formatGpa(gpaAfter)}
                          {delta !== null && Math.abs(delta) >= 0.005 && (
                            <span
                              className={`ml-1.5 text-[11px] ${
                                delta > 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-700 dark:text-rose-400'
                              }`}
                            >
                              {formatSignedDelta(delta, '', 2)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-sky-400 truncate transition-colors min-w-0">
                          {lead?.title}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0 whitespace-nowrap">
                          {lead?.earned}/{lead?.possible}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export const CumulativeGpaChart = memo(CumulativeGpaChartInner);
