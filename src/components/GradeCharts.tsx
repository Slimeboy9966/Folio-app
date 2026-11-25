import React, { memo, useId, useMemo, useState } from 'react';
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
  CategoryResult,
  Course,
  CourseResult,
  GradeScaleEntry,
  HypotheticalOverlay,
} from '../types/grades';
import {
  GradeTimelinePoint,
  computeGradeTimeline,
  formatPercent,
  formatSignedDelta,
  getGradeToneClass,
} from '../utils/gradeMath';

// Refined, domain-appropriate palette with high legibility on both light & dark glass
const CATEGORY_PALETTE = [
  { hex: '#3b82f6', darkHex: '#38bdf8', bar: 'bg-blue-500 dark:bg-sky-400', dot: 'bg-blue-500 dark:bg-sky-400' },
  { hex: '#10b981', darkHex: '#34d399', bar: 'bg-emerald-500 dark:bg-emerald-400', dot: 'bg-emerald-500 dark:bg-emerald-400' },
  { hex: '#8b5cf6', darkHex: '#a78bfa', bar: 'bg-violet-500 dark:bg-violet-400', dot: 'bg-violet-500 dark:bg-violet-400' },
  { hex: '#f59e0b', darkHex: '#fbbf24', bar: 'bg-amber-500 dark:bg-amber-400', dot: 'bg-amber-500 dark:bg-amber-400' },
  { hex: '#ec4899', darkHex: '#f472b6', bar: 'bg-pink-500 dark:bg-pink-400', dot: 'bg-pink-500 dark:bg-pink-400' },
  { hex: '#06b6d4', darkHex: '#22d3ee', bar: 'bg-cyan-500 dark:bg-cyan-400', dot: 'bg-cyan-500 dark:bg-cyan-400' },
  { hex: '#f97316', darkHex: '#fb923c', bar: 'bg-orange-500 dark:bg-orange-400', dot: 'bg-orange-500 dark:bg-orange-400' },
];

function getPalette(index: number) {
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

/* ============================================================================
 * 1. Grade Trajectory Over the Year / Term Chart (Recharts AreaChart)
 * ========================================================================== */

interface GradeTrendChartProps {
  courses: Course[];
  allYearCourses?: Course[];
  gradeScale: GradeScaleEntry[];
  isHypothetical: boolean;
  overlay: HypotheticalOverlay;
  singleCourseMode?: boolean;
  title?: string;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: GradeTimelinePoint }>;
  isHypothetical: boolean;
}

const GradeTrendTooltip: React.FC<TrendTooltipProps> = ({
  active,
  payload,
  isHypothetical,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-white/15 rounded-xl shadow-xl px-3.5 py-3 text-xs w-[256px] max-w-[82vw] text-slate-800 dark:text-slate-100">
      <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-slate-200/70 dark:border-white/10">
        <span className="font-mono font-medium text-slate-500 dark:text-slate-400 shrink-0">
          {pt.label}
        </span>
        <span
          className={`font-mono text-sm font-semibold tabular-nums whitespace-nowrap ${getGradeToneClass(
            pt.displayPercent
          )}`}
        >
          {formatPercent(pt.displayPercent)} ({pt.letter})
        </span>
      </div>

      {isHypothetical &&
        pt.actualPercent !== null &&
        Math.abs(pt.displayPercent - pt.actualPercent) >= 0.05 && (
          <div className="mt-1.5 text-[11px] font-mono text-amber-700 dark:text-amber-300 tabular-nums">
            Actual: {formatPercent(pt.actualPercent)} (
            {formatSignedDelta(pt.displayPercent - pt.actualPercent, '%', 1)})
          </div>
        )}

      {pt.events.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-1.5">
          {pt.events.slice(0, 3).map((ev, idx) => (
            <div key={`${ev.courseCode}-${idx}`} className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {ev.title}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {ev.courseCode}
                </div>
              </div>
              <div className="font-mono text-right shrink-0 tabular-nums">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {ev.earned}/{ev.possible}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {ev.possible > 0 ? formatPercent((ev.earned / ev.possible) * 100, 0) : '—'}
                </div>
              </div>
            </div>
          ))}
          {pt.events.length > 3 && (
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              +{pt.events.length - 3} more graded items
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const GradeTrendChartInner: React.FC<GradeTrendChartProps> = ({
  courses,
  allYearCourses,
  gradeScale,
  isHypothetical,
  overlay,
  singleCourseMode = false,
  title,
}) => {
  const [scope, setScope] = useState<'term' | 'year'>('year');
  const [selectedCourseFilter, setSelectedCourseFilter] = useState<string>('all');
  const uid = useId().replace(/:/g, '');
  const gradId = `trend-area-${uid}`;

  const hasMultiTermData = useMemo(() => {
    if (singleCourseMode || !allYearCourses) return false;
    const termIds = new Set(
      allYearCourses
        .filter((c) => c.assignments.some((a) => a.earned !== null && !a.excused))
        .map((c) => c.termId)
    );
    return termIds.size > 1;
  }, [singleCourseMode, allYearCourses]);

  const scopedCourses = useMemo(() => {
    if (singleCourseMode) return courses;
    const pool = hasMultiTermData && scope === 'year' && allYearCourses ? allYearCourses : courses;
    if (selectedCourseFilter === 'all') return pool;
    const matched = pool.filter((c) => c.id === selectedCourseFilter);
    return matched.length > 0 ? matched : pool;
  }, [singleCourseMode, hasMultiTermData, scope, allYearCourses, courses, selectedCourseFilter]);

  const points = useMemo(
    () => computeGradeTimeline(scopedCourses, gradeScale, isHypothetical ? overlay : null),
    [scopedCourses, gradeScale, isHypothetical, overlay]
  );

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const vals: number[] = [];
    for (const p of points) {
      vals.push(p.displayPercent);
      if (p.actualPercent !== null) vals.push(p.actualPercent);
    }
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const yMin = Math.max(0, Math.floor((Math.min(rawMin, 82) - 4) / 5) * 5);
    const yMax = Math.min(105, Math.ceil((Math.max(rawMax, 95) + 3) / 5) * 5);
    const first = points[0].displayPercent;
    const latest = points[points.length - 1].displayPercent;
    const overallChange = points.length >= 2 ? latest - first : null;

    return {
      yDomain: [yMin, yMax] as [number, number],
      latest,
      latestLetter: points[points.length - 1].letter,
      latestPoint: points[points.length - 1],
      firstLabel: points[0].label,
      overallChange,
      high: Math.max(...points.map((p) => p.displayPercent)),
      low: Math.min(...points.map((p) => p.displayPercent)),
      thresholds: [90, 80, 70].filter((t) => t > yMin + 3 && t < yMax - 2),
    };
  }, [points]);

  const heading = title || (singleCourseMode ? 'Grade Trend Over Time' : 'Grade Trend Over the Year');
  const strokeColor = isHypothetical ? '#f59e0b' : 'var(--gpa-line-stroke)';

  return (
    <div
      className={`rounded-2xl p-4 sm:p-6 flex flex-col justify-between transition-colors ${
        isHypothetical ? 'glass-hypothetical' : 'glass-panel'
      }`}
    >
      {/* Header + Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 leading-snug break-words">
            {heading}
          </h2>
          {stats ? (
            <div className="mt-1.5 flex items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap tabular-nums">
              <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                {formatPercent(stats.latest)} ({stats.latestLetter})
              </span>
              {stats.overallChange !== null && Math.abs(stats.overallChange) >= 0.05 && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span
                    className={`font-mono font-medium ${
                      stats.overallChange > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {stats.overallChange > 0 ? '▲' : '▼'}{' '}
                    {formatSignedDelta(stats.overallChange, '%', 1)} since {stats.firstLabel}
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-mono">
                Range {formatPercent(stats.low, 0)}–{formatPercent(stats.high, 0)}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Chronological running grade as assignments are posted.
            </p>
          )}
        </div>

        {!singleCourseMode && (
          <div className="flex items-center gap-2 flex-wrap shrink-0 max-w-full">
            {hasMultiTermData && (
              <div className="inline-flex items-center p-0.5 bg-slate-200/60 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 rounded-lg">
                <button
                  type="button"
                  onClick={() => setScope('year')}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    scope === 'year'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Full Year
                </button>
                <button
                  type="button"
                  onClick={() => setScope('term')}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    scope === 'term'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  This Term
                </button>
              </div>
            )}

            {courses.length > 1 && (
              <select
                value={selectedCourseFilter}
                onChange={(e) => setSelectedCourseFilter(e.target.value)}
                aria-label="Filter grade trend by course"
                className="px-2.5 py-1 text-xs font-medium bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/10 rounded-lg text-slate-800 dark:text-slate-200 max-w-[175px] truncate focus:outline-none focus:ring-2 focus:ring-blue-400/30"
              >
                <option value="all" className="bg-white dark:bg-slate-900">
                  All Courses Avg
                </option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id} className="bg-white dark:bg-slate-900">
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Recharts Area Plot */}
      {!stats ? (
        <div className="h-52 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200/80 dark:border-white/10 rounded-xl px-4 text-center">
          Add or sync graded assignments with dates to plot your grade trajectory over the year.
        </div>
      ) : (
        <>
          <div className="w-full h-[236px] min-w-0">
            <ResponsiveContainer width="100%" height={236} minWidth={0}>
              <AreaChart
                data={points}
                margin={{ top: 12, right: 16, left: -4, bottom: 6 }}
              >
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={strokeColor} stopOpacity={0.28} />
                    <stop offset="85%" stopColor={strokeColor} stopOpacity={0.03} />
                    <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
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
                  domain={stats.yDomain}
                  tickCount={5}
                  tickFormatter={(v: number) => `${Math.round(v)}%`}
                  tick={{
                    fill: 'var(--chart-tick)',
                    fontSize: 11,
                    fontFamily: 'ui-monospace, monospace',
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />

                <Tooltip
                  content={<GradeTrendTooltip isHypothetical={isHypothetical} />}
                  cursor={{
                    stroke: 'rgba(148, 163, 184, 0.45)',
                    strokeWidth: 1,
                    strokeDasharray: '3 3',
                  }}
                />

                {stats.thresholds.map((t) => (
                  <ReferenceLine
                    key={t}
                    y={t}
                    stroke={
                      t === 90
                        ? 'rgba(16, 185, 129, 0.35)'
                        : t === 80
                          ? 'rgba(56, 189, 248, 0.3)'
                          : 'rgba(245, 158, 11, 0.3)'
                    }
                    strokeDasharray="4 4"
                  />
                ))}

                {isHypothetical && (
                  <Area
                    type="monotone"
                    dataKey="actualPercent"
                    name="Actual"
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
                  dataKey="displayPercent"
                  name={isHypothetical ? 'Simulated' : 'Grade'}
                  stroke={strokeColor}
                  strokeWidth={2.75}
                  fill={`url(#${gradId})`}
                  dot={
                    points.length <= 24
                      ? {
                          r: 3,
                          fill: strokeColor,
                          stroke: 'var(--gpa-dot-ring)',
                          strokeWidth: 1.5,
                        }
                      : false
                  }
                  activeDot={{
                    r: 5.5,
                    fill: strokeColor,
                    stroke: 'var(--gpa-dot-ring)',
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Latest Graded Activity Footer */}
          <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0 text-slate-600 dark:text-slate-300">
              <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
                Latest ({stats.latestPoint.label})
              </span>
              {stats.latestPoint.events[0] && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                    {stats.latestPoint.events[0].title}
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                    ({stats.latestPoint.events[0].earned}/{stats.latestPoint.events[0].possible})
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
              {stats.thresholds.includes(90) && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 border-t border-dashed border-emerald-500/70" />
                  90% A
                </span>
              )}
              {stats.thresholds.includes(80) && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 border-t border-dashed border-sky-400/70" />
                  80% B
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const GradeTrendChart = memo(GradeTrendChartInner);

/* ============================================================================
 * 2. All Courses Category Weights Chart (OverviewView)
 * ========================================================================== */

interface AllCoursesWeightsChartProps {
  courses: Course[];
  displayCourseResults: Record<string, CourseResult>;
  isHypothetical: boolean;
  onSelectCourse: (courseId: string) => void;
}

const AllCoursesWeightsChartInner: React.FC<AllCoursesWeightsChartProps> = ({
  courses,
  displayCourseResults,
  isHypothetical,
  onSelectCourse,
}) => {
  const [hoveredSegment, setHoveredSegment] = useState<{
    courseId: string;
    categoryId: string;
    courseName: string;
    categoryName: string;
    sharePercent: number;
    categoryGrade: number | null;
    gradedCount: number;
    totalCount: number;
    mode: 'weighted' | 'points';
  } | null>(null);

  return (
    <div
      className={`rounded-2xl p-4 sm:p-6 flex flex-col justify-between transition-colors ${
        isHypothetical ? 'glass-hypothetical' : 'glass-panel'
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              All Category Weights
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Syllabus weighting across all {courses.length}{' '}
              {courses.length === 1 ? 'course' : 'courses'}. Hover any segment for grade details.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {courses.map((course) => {
            const result = displayCourseResults[course.id];
            const catResults = result?.categoryResults || [];
            const isWeighted = course.gradingMode === 'weighted';
            const totalWeight = isWeighted
              ? catResults.reduce((s, cr) => s + Math.max(0, cr.category.weight), 0)
              : catResults.reduce((s, cr) => s + Math.max(0, cr.possiblePoints), 0);

            const segments = catResults.map((cr, idx) => {
              const rawVal = isWeighted ? cr.category.weight : cr.possiblePoints;
              const share =
                totalWeight > 0
                  ? (rawVal / totalWeight) * 100
                  : catResults.length > 0
                    ? 100 / catResults.length
                    : 100;
              return {
                cr,
                share,
                palette: getPalette(idx),
              };
            });

            const courseHasHover = hoveredSegment?.courseId === course.id;

            return (
              <div key={course.id} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectCourse(course.id)}
                    className="text-left text-xs font-medium text-slate-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-sky-400 transition-colors truncate min-w-0 flex-1"
                  >
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mr-1.5">
                      {course.code}
                    </span>
                    {course.name}
                  </button>
                  <div className="flex items-baseline gap-2 shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums">
                    {result?.percentage !== null && result?.percentage !== undefined && (
                      <span className={`font-semibold ${getGradeToneClass(result.percentage)}`}>
                        {formatPercent(result.percentage, 1)}
                      </span>
                    )}
                    <span className="text-slate-400 dark:text-slate-500">
                      {isWeighted ? `${Math.round(totalWeight)}%` : 'Pts'}
                    </span>
                  </div>
                </div>

                {/* Proportional Stacked Weight Bar */}
                <div
                  className="h-3.5 w-full rounded-lg overflow-hidden flex gap-0.5 bg-slate-200/70 dark:bg-white/[0.08] p-[1px]"
                  onMouseLeave={() => setHoveredSegment(null)}
                >
                  {segments.map(({ cr, share, palette }) => {
                    const isThisHovered =
                      courseHasHover && hoveredSegment?.categoryId === cr.category.id;
                    const isDimmed = courseHasHover && !isThisHovered;
                    return (
                      <button
                        key={cr.category.id}
                        type="button"
                        onClick={() => onSelectCourse(course.id)}
                        onMouseEnter={() =>
                          setHoveredSegment({
                            courseId: course.id,
                            categoryId: cr.category.id,
                            courseName: course.name,
                            categoryName: cr.category.name,
                            sharePercent: isWeighted ? cr.category.weight : share,
                            categoryGrade: cr.percentage,
                            gradedCount: cr.gradedCount,
                            totalCount: cr.totalCount,
                            mode: course.gradingMode,
                          })
                        }
                        aria-label={`${course.name} — ${cr.category.name}: ${Math.round(
                          isWeighted ? cr.category.weight : share
                        )}%`}
                        className={`h-full first:rounded-l-[6px] last:rounded-r-[6px] transition-opacity duration-150 cursor-pointer ${palette.bar}`}
                        style={{
                          width: `${Math.max(share, 2)}%`,
                          opacity: isDimmed ? 0.32 : 0.96,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Clean Unboxed Inline Category Legend */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {segments.map(({ cr, share, palette }) => {
                    const isActive =
                      courseHasHover && hoveredSegment?.categoryId === cr.category.id;
                    return (
                      <span
                        key={cr.category.id}
                        className={`inline-flex items-center gap-1.5 min-w-0 max-w-full transition-colors ${
                          isActive ? 'text-slate-900 dark:text-white font-medium' : ''
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-xs shrink-0 ${palette.dot}`} />
                        <span className="truncate max-w-[116px]">{cr.category.name}</span>
                        <span className="font-mono text-slate-700 dark:text-slate-300 font-medium shrink-0">
                          {Math.round(isWeighted ? cr.category.weight : share)}%
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Segment Readout Strip */}
      <div className="mt-4 pt-3 border-t border-slate-200/70 dark:border-white/[0.08] text-xs min-h-[28px] flex flex-wrap items-center justify-between gap-2">
        {hoveredSegment ? (
          <>
            <div className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
              <span className="font-semibold text-slate-900 dark:text-white">
                {hoveredSegment.categoryName}
              </span>
              <span className="text-slate-400 dark:text-slate-500 mx-1.5">·</span>
              <span className="text-slate-500 dark:text-slate-400">
                {hoveredSegment.courseName}
              </span>
            </div>
            <div className="font-mono text-slate-700 dark:text-slate-200 shrink-0 tabular-nums whitespace-nowrap">
              {Math.round(hoveredSegment.sharePercent)}%{' '}
              {hoveredSegment.mode === 'weighted' ? 'weight' : 'share'}
              <span className="text-slate-400 dark:text-slate-500 mx-1.5">·</span>
              <span className={getGradeToneClass(hoveredSegment.categoryGrade)}>
                {formatPercent(hoveredSegment.categoryGrade)}
              </span>
              <span className="text-slate-400 dark:text-slate-500 ml-1.5">
                ({hoveredSegment.gradedCount}/{hoveredSegment.totalCount})
              </span>
            </div>
          </>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">
            Tap any class bar to inspect assignments and simulate what-if scores.
          </span>
        )}
      </div>
    </div>
  );
};

export const AllCoursesWeightsChart = memo(AllCoursesWeightsChartInner);

/* ============================================================================
 * 3. Single-Course Category Weights Donut + Breakdown (CourseDetailView)
 * ========================================================================== */

interface CourseCategoryWeightsChartProps {
  course: Course;
  actualResult: CourseResult;
  displayResult: CourseResult;
  isHypothetical: boolean;
}

const CourseCategoryWeightsChartInner: React.FC<CourseCategoryWeightsChartProps> = ({
  course,
  actualResult,
  displayResult,
  isHypothetical,
}) => {
  const [hoveredCatId, setHoveredCatId] = useState<string | null>(null);

  const isWeighted = course.gradingMode === 'weighted';
  const catResults = displayResult.categoryResults;

  const totalBasis = useMemo(() => {
    if (isWeighted) {
      return catResults.reduce((s, cr) => s + Math.max(0, cr.category.weight), 0);
    }
    return catResults.reduce((s, cr) => s + Math.max(0, cr.possiblePoints), 0);
  }, [catResults, isWeighted]);

  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  const slices = useMemo(() => {
    let cumulativeFraction = 0;
    return catResults.map((cr, idx) => {
      const val = isWeighted ? Math.max(0, cr.category.weight) : Math.max(0, cr.possiblePoints);
      const fraction =
        totalBasis > 0
          ? val / totalBasis
          : catResults.length > 0
            ? 1 / catResults.length
            : 1;
      const startFraction = cumulativeFraction;
      cumulativeFraction += fraction;
      return {
        cr,
        fraction,
        percentShare: isWeighted ? cr.category.weight : fraction * 100,
        dashArray: `${Math.max(0, fraction * circumference - 2.5)} ${circumference}`,
        dashOffset: -startFraction * circumference,
        palette: getPalette(idx),
      };
    });
  }, [catResults, isWeighted, totalBasis, circumference]);

  const activeSlice = slices.find((s) => s.cr.category.id === hoveredCatId) || null;

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Category Weights &amp; Breakdown
        </h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {isWeighted
            ? 'Empty categories normalized until graded'
            : 'Weighted proportionally by total points'}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
        {/* SVG Donut Ring */}
        <div className="relative w-40 h-40 shrink-0 flex items-center justify-center">
          <svg
            viewBox="0 0 136 136"
            className="w-full h-full -rotate-90"
            role="img"
            aria-label="Category weights chart"
            onMouseLeave={() => setHoveredCatId(null)}
          >
            <circle
              cx="68"
              cy="68"
              r={radius}
              fill="none"
              className="stroke-slate-200/75 dark:stroke-white/[0.08]"
              strokeWidth="16"
            />
            {slices.map((s) => {
              const isDimmed = hoveredCatId !== null && hoveredCatId !== s.cr.category.id;
              return (
                <circle
                  key={s.cr.category.id}
                  cx="68"
                  cy="68"
                  r={radius}
                  fill="none"
                  stroke={s.palette.hex}
                  strokeWidth={hoveredCatId === s.cr.category.id ? 19 : 16}
                  strokeDasharray={s.dashArray}
                  strokeDashoffset={s.dashOffset}
                  className="transition-opacity duration-150 cursor-pointer"
                  style={{ opacity: isDimmed ? 0.3 : 0.96 }}
                  onMouseEnter={() => setHoveredCatId(s.cr.category.id)}
                />
              );
            })}
          </svg>

          {/* Center Readout — tightly bounded so it never touches the ring */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 pointer-events-none">
            {activeSlice ? (
              <>
                <span className="font-mono text-base font-semibold text-slate-900 dark:text-white tabular-nums leading-tight">
                  {Math.round(activeSlice.percentShare)}%
                </span>
                <span className="text-[10px] leading-tight text-slate-500 dark:text-slate-400 truncate max-w-[80px] mt-0.5">
                  {activeSlice.cr.category.name}
                </span>
                <span
                  className={`font-mono text-[10px] font-semibold tabular-nums mt-0.5 ${getGradeToneClass(
                    activeSlice.cr.percentage
                  )}`}
                >
                  {formatPercent(activeSlice.cr.percentage, 1)}
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-base font-semibold text-slate-900 dark:text-white tabular-nums leading-tight">
                  {isWeighted ? `${Math.round(totalBasis)}%` : `${catResults.length}`}
                </span>
                <span className="text-[10px] leading-tight text-slate-500 dark:text-slate-400 mt-0.5">
                  {isWeighted ? 'Total Weight' : 'Categories'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Synchronized Category Rows */}
        <div className="flex-1 w-full min-w-0 divide-y divide-slate-200/50 dark:divide-white/[0.06]">
          {slices.map(({ cr, percentShare, palette }) => {
            const actualCat: CategoryResult | undefined = actualResult.categoryResults.find(
              (a) => a.category.id === cr.category.id
            );
            const catDelta =
              isHypothetical &&
              actualCat &&
              actualCat.percentage !== null &&
              cr.percentage !== null
                ? cr.percentage - actualCat.percentage
                : null;
            const isHovered = hoveredCatId === cr.category.id;

            return (
              <div
                key={cr.category.id}
                onMouseEnter={() => setHoveredCatId(cr.category.id)}
                onMouseLeave={() => setHoveredCatId(null)}
                className={`py-2.5 px-2.5 -mx-2.5 rounded-xl flex items-center justify-between gap-3 text-sm transition-colors ${
                  isHovered ? 'bg-white/60 dark:bg-white/[0.05]' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-xs shrink-0 ${palette.dot}`} />
                    <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {cr.category.name}
                    </span>
                    {cr.category.dropLowest ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                        · drops {cr.category.dropLowest}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2.5 pl-4.5 min-w-0">
                    <div className="w-20 sm:w-32 h-1.5 bg-slate-200/80 dark:bg-white/[0.09] rounded-full overflow-hidden shrink-0">
                      <div
                        className={`h-full rounded-full ${
                          cr.percentage === null
                            ? 'bg-slate-300 dark:bg-white/10'
                            : isHypothetical && catDelta !== null && Math.abs(catDelta) >= 0.05
                              ? 'bg-amber-500'
                              : palette.bar
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(0, cr.percentage ?? 0))}%`,
                        }}
                      />
                    </div>
                    <span className="font-mono text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 tabular-nums truncate">
                      {cr.possiblePoints > 0
                        ? `${Number(cr.earnedPoints.toFixed(1))}/${cr.possiblePoints} pts`
                        : `${cr.totalCount} upcoming`}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0 flex items-center gap-3 tabular-nums">
                  <div className="text-right">
                    <div className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {Math.round(percentShare)}%
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                      {isWeighted ? 'weight' : 'share'}
                    </div>
                  </div>
                  <div className="min-w-[56px] sm:min-w-[68px] text-right">
                    <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                      {formatPercent(cr.percentage)}
                    </div>
                    {catDelta !== null && Math.abs(catDelta) >= 0.05 ? (
                      <div
                        className={`font-mono text-[11px] whitespace-nowrap ${
                          catDelta > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {formatSignedDelta(catDelta, '%', 1)}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                        {cr.gradedCount}/{cr.totalCount}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const CourseCategoryWeightsChart = memo(CourseCategoryWeightsChartInner);
