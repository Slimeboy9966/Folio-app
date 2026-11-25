import React, { memo, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Link2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import {
  Course,
  CourseResult,
  EdupointSessionInfo,
  GradeScaleEntry,
  HypotheticalOverlay,
  TermSummary,
} from '../types/grades';
import {
  cleanAssignmentDisplayTitle,
  formatGpa,
  formatPercent,
  formatSignedDelta,
  getEffectiveCourseLevel,
  getGradeToneClass,
} from '../utils/gradeMath';
import { AllCoursesWeightsChart, GradeTrendChart } from './GradeCharts';
import { CumulativeGpaChart } from './CumulativeGpaChart';

interface OverviewViewProps {
  courses: Course[];
  allYearCourses: Course[];
  actualCourseResults: Record<string, CourseResult>;
  displayCourseResults: Record<string, CourseResult>;
  actualSummary: TermSummary;
  displaySummary: TermSummary;
  isHypothetical: boolean;
  gradeScale: GradeScaleEntry[];
  overlay: HypotheticalOverlay;
  priorGpa: number;
  priorCredits: number;
  edupointSession: EdupointSessionInfo | null;
  schoolName: string;
  onOpenEdupointModal: () => void;
  onSelectCourse: (courseId: string) => void;
  onEnableHypothetical: () => void;
  onUpdateHypotheticalScore: (courseId: string, assignmentId: string, earned: number | null) => void;
  onResetHypotheticalItem: (courseId: string, assignmentId: string) => void;
  onOpenAddCourse: () => void;
  onAskAi: (prompt: string) => void;
  completedTaskIds: Record<string, boolean>;
  onToggleTaskComplete: (taskKey: string) => void;
}

const OverviewViewInner: React.FC<OverviewViewProps> = ({
  courses,
  allYearCourses,
  actualCourseResults,
  displayCourseResults,
  actualSummary,
  displaySummary,
  isHypothetical,
  gradeScale,
  overlay,
  priorGpa,
  priorCredits,
  edupointSession,
  schoolName,
  onOpenEdupointModal,
  onSelectCourse,
  onEnableHypothetical,
  onUpdateHypotheticalScore,
  onResetHypotheticalItem,
  onOpenAddCourse,
  onAskAi,
  completedTaskIds,
  onToggleTaskComplete,
}) => {
  const [courseSort, setCourseSort] = useState<'default' | 'lowest' | 'highest'>('default');
  const gpaDelta =
    isHypothetical && actualSummary.termGpa !== null && displaySummary.termGpa !== null
      ? displaySummary.termGpa - actualSummary.termGpa
      : null;

  const weightedGpaDelta =
    isHypothetical &&
    actualSummary.weightedTermGpa !== null &&
    displaySummary.weightedTermGpa !== null
      ? displaySummary.weightedTermGpa - actualSummary.weightedTermGpa
      : null;

  const cumGpaDelta =
    isHypothetical &&
    actualSummary.cumulativeGpa !== null &&
    displaySummary.cumulativeGpa !== null
      ? displaySummary.cumulativeGpa - actualSummary.cumulativeGpa
      : null;

  const avgDelta =
    isHypothetical &&
    actualSummary.averagePercent !== null &&
    displaySummary.averagePercent !== null
      ? displaySummary.averagePercent - actualSummary.averagePercent
      : null;

  const showWeightedCard = priorCredits <= 0 && displaySummary.hasWeightedCourses;

  const sortedCourses = useMemo(() => {
    if (courseSort === 'default') return courses;
    return [...courses].sort((a, b) => {
      const pctA = displayCourseResults[a.id]?.percentage;
      const pctB = displayCourseResults[b.id]?.percentage;
      if (pctA === null || pctA === undefined) return 1;
      if (pctB === null || pctB === undefined) return -1;
      return courseSort === 'lowest' ? pctA - pctB : pctB - pctA;
    });
  }, [courses, courseSort, displayCourseResults]);

  const missingItems = useMemo(() => {
    const out: Array<{
      course: Course;
      assignmentId: string;
      title: string;
      possible: number;
      dueDate: string;
    }> = [];
    for (const course of courses) {
      const res = displayCourseResults[course.id];
      if (!res) continue;
      const catMap = new Map(course.categories.map((c) => [c.id, c.name]));
      res.effectiveAssignments.forEach((a, idx) => {
        if (!a.isRemoved && !a.excused && a.earned === 0 && a.possible > 0) {
          out.push({
            course,
            assignmentId: a.id,
            title: cleanAssignmentDisplayTitle(a.title, catMap.get(a.categoryId), idx),
            possible: a.possible,
            dueDate: a.dueDate,
          });
        }
      });
    }
    return out;
  }, [courses, displayCourseResults]);

  const borderlineCourses = useMemo(() => {
    const sortedScale = [...gradeScale].sort((a, b) => a.minPercent - b.minPercent);
    const out: Array<{
      course: Course;
      percentage: number;
      currentLetter: string;
      nextLetter: string;
      gap: number;
    }> = [];

    for (const course of courses) {
      const res = displayCourseResults[course.id];
      if (!res || res.excludedFromGpa || res.percentage === null) continue;
      const nextTier = sortedScale.find(
        (entry) => entry.minPercent > res.percentage! && entry.gpa > (res.gpa ?? -1)
      );
      if (nextTier) {
        const gap = nextTier.minPercent - res.percentage;
        if (gap > 0 && gap <= 2.5) {
          out.push({
            course,
            percentage: res.percentage,
            currentLetter: res.letter,
            nextLetter: nextTier.letter,
            gap,
          });
        }
      }
    }
    return out.sort((a, b) => a.gap - b.gap);
  }, [courses, displayCourseResults, gradeScale]);

  const upcomingItems = courses
    .flatMap((course) => {
      const res = displayCourseResults[course.id];
      if (!res) return [];
      const catMap = new Map(course.categories.map((c) => [c.id, c]));
      return res.effectiveAssignments
        .filter((a) => !a.isRemoved && !a.excused && a.originalEarned === null && !a.isHypotheticalOnly)
        .map((a) => ({
          course,
          assignment: a,
          category: catMap.get(a.categoryId),
        }));
    })
    .sort((a, b) => a.assignment.dueDate.localeCompare(b.assignment.dueDate));

  if (courses.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-12 text-center">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          No courses in this term yet
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
          Connect your {schoolName} Edupoint (StudentVUE) account to sync your real classes and
          assignments, or add a course manually.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={onOpenEdupointModal}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 rounded-xl transition-colors whitespace-nowrap"
          >
            Connect StudentVUE
          </button>
          <button
            type="button"
            onClick={onOpenAddCourse}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/10 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
          >
            Add Course Manually
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Subtle School Edupoint Connection Strip */}
      {!edupointSession && (
        <section
          aria-label={`Connect ${schoolName} Edupoint`}
          className="glass-panel rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Link2 className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
            <div className="text-xs text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {schoolName} · Edupoint StudentVUE
              </span>
              <span aria-hidden="true" className="mx-2 text-slate-300 dark:text-slate-600">
                ·
              </span>
              <span className="text-slate-600 dark:text-slate-400">
                Sync your live classes and assignments to view grades and run what-if scenarios.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenEdupointModal}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            Connect StudentVUE
          </button>
        </section>
      )}

      {/* 4-Column Liquid Glass Summary Strip (2x2 on mobile, 4-col on desktop) */}
      <section
        aria-label="Term summary metrics"
        className={`rounded-2xl overflow-hidden transition-colors ${
          isHypothetical ? 'glass-hypothetical' : 'glass-panel'
        }`}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {/* Term GPA (Unweighted) */}
          <div className="p-3.5 sm:p-6 border-b border-r lg:border-b-0 border-slate-200/70 dark:border-white/[0.08] min-w-0">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              {isHypothetical ? 'Sim. Unweighted GPA' : 'Semester GPA (UW)'}
            </div>
            <div className="mt-1.5 sm:mt-2 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
              <span className="font-mono text-xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatGpa(displaySummary.termGpa)}
              </span>
              {gpaDelta !== null && Math.abs(gpaDelta) >= 0.005 && (
                <span
                  className={`font-mono text-[11px] sm:text-xs font-medium tabular-nums whitespace-nowrap ${
                    gpaDelta > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {gpaDelta > 0 ? '▲' : '▼'} {formatSignedDelta(gpaDelta, '', 2)}
                </span>
              )}
            </div>
            <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs leading-snug text-slate-500 dark:text-slate-400 tabular-nums break-words">
              {isHypothetical && actualSummary.termGpa !== null ? (
                <span>Actual {formatGpa(actualSummary.termGpa)}</span>
              ) : displaySummary.hasWeightedCourses && !showWeightedCard ? (
                <span>
                  Weighted {formatGpa(displaySummary.weightedTermGpa)} · {displaySummary.gradedCredits} cr
                </span>
              ) : (
                <span>4.00 scale · {displaySummary.gradedCredits} cr</span>
              )}
            </div>
          </div>

          {/* Weighted GPA (when no prior record) or Cumulative GPA */}
          <div className="p-3.5 sm:p-6 border-b lg:border-b-0 lg:border-r border-slate-200/70 dark:border-white/[0.08] min-w-0">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              {showWeightedCard
                ? isHypothetical
                  ? 'Sim. Weighted GPA'
                  : 'Weighted GPA'
                : isHypothetical
                  ? 'Sim. Cumulative'
                  : 'Cumulative GPA'}
            </div>
            <div className="mt-1.5 sm:mt-2 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
              <span className="font-mono text-xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {showWeightedCard
                  ? formatGpa(displaySummary.weightedTermGpa)
                  : formatGpa(displaySummary.cumulativeGpa)}
              </span>
              {(showWeightedCard ? weightedGpaDelta : cumGpaDelta) !== null &&
                Math.abs((showWeightedCard ? weightedGpaDelta : cumGpaDelta) as number) >= 0.005 && (
                  <span
                    className={`font-mono text-[11px] sm:text-xs font-medium tabular-nums whitespace-nowrap ${
                      ((showWeightedCard ? weightedGpaDelta : cumGpaDelta) as number) > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {((showWeightedCard ? weightedGpaDelta : cumGpaDelta) as number) > 0 ? '▲' : '▼'}{' '}
                    {formatSignedDelta(
                      (showWeightedCard ? weightedGpaDelta : cumGpaDelta) as number,
                      '',
                      2
                    )}
                  </span>
                )}
            </div>
            <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs leading-snug text-slate-500 dark:text-slate-400 tabular-nums break-words">
              {showWeightedCard ? (
                isHypothetical && actualSummary.weightedTermGpa !== null ? (
                  <span>Actual {formatGpa(actualSummary.weightedTermGpa)}</span>
                ) : (
                  <span>AP &amp; Honors +1.0</span>
                )
              ) : isHypothetical && actualSummary.cumulativeGpa !== null ? (
                <span>Actual {formatGpa(actualSummary.cumulativeGpa)}</span>
              ) : priorCredits > 0 ? (
                <span>Includes {priorCredits} prior cr</span>
              ) : (
                <span>Current semester only</span>
              )}
            </div>
          </div>

          {/* Credit-Weighted Average */}
          <div className="p-3.5 sm:p-6 border-r border-slate-200/70 dark:border-white/[0.08] min-w-0">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              Weighted Avg
            </div>
            <div className="mt-1.5 sm:mt-2 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
              <span className="font-mono text-xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatPercent(displaySummary.averagePercent)}
              </span>
              {avgDelta !== null && Math.abs(avgDelta) >= 0.05 && (
                <span
                  className={`font-mono text-[11px] sm:text-xs font-medium tabular-nums whitespace-nowrap ${
                    avgDelta > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {avgDelta > 0 ? '▲' : '▼'} {formatSignedDelta(avgDelta, '%', 1)}
                </span>
              )}
            </div>
            <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs leading-snug text-slate-500 dark:text-slate-400 tabular-nums break-words">
              {isHypothetical && actualSummary.averagePercent !== null ? (
                <span>Actual {formatPercent(actualSummary.averagePercent)}</span>
              ) : (
                <span>{courses.length} active courses</span>
              )}
            </div>
          </div>

          {/* Graded Progress */}
          <div className="p-3.5 sm:p-6 min-w-0">
            <div className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              Graded Work
            </div>
            <div className="mt-1.5 sm:mt-2 flex items-baseline gap-2">
              <span className="font-mono text-xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {displaySummary.gradedAssignments}
                <span className="text-sm sm:text-lg font-normal text-slate-400 dark:text-slate-500">
                  /{displaySummary.totalAssignments}
                </span>
              </span>
            </div>
            <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs leading-snug text-slate-500 dark:text-slate-400 tabular-nums">
              {displaySummary.totalAssignments - displaySummary.gradedAssignments} upcoming
            </div>
          </div>
        </div>
      </section>

      {/* Action Radar: Missing Work Watchdog + Borderline Grade Opportunities */}
      {(missingItems.length > 0 || borderlineCourses.length > 0) && (
        <section
          aria-label="Actionable grade alerts"
          className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        >
          {borderlineCourses.length > 0 && (
            <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    Close to Next Grade
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onAskAi(
                      `Help me bump up my borderline classes (${borderlineCourses
                        .map(
                          (b) =>
                            `${b.course.name} at ${b.percentage.toFixed(1)}% (${b.gap.toFixed(
                              1
                            )}% from ${b.nextLetter})`
                        )
                        .join(', ')}). What is the fastest path?`
                    )
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI Boost Plan
                </button>
              </div>
              <div className="space-y-2">
                {borderlineCourses.slice(0, 3).map((b) => (
                  <button
                    key={b.course.id}
                    type="button"
                    onClick={() => onSelectCourse(b.course.id)}
                    className="w-full text-left px-3 py-2 rounded-xl bg-white/60 dark:bg-white/[0.04] hover:bg-white dark:hover:bg-white/[0.08] flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {b.course.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Only{' '}
                        <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                          {b.gap.toFixed(1)}%
                        </strong>{' '}
                        away from {b.nextLetter}
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">
                      {formatPercent(b.percentage)} ({b.currentLetter})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {missingItems.length > 0 && (
            <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    Zero / Missing Work ({missingItems.length})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onAskAi(
                      'Prioritize my zero/missing assignments by grade impact and draft a polite make-up email for the most urgent class.'
                    )
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI Recovery Plan
                </button>
              </div>
              <div className="space-y-2">
                {missingItems.slice(0, 3).map((m) => (
                  <button
                    key={`${m.course.id}-${m.assignmentId}`}
                    type="button"
                    onClick={() => onSelectCourse(m.course.id)}
                    className="w-full text-left px-3 py-2 rounded-xl bg-white/60 dark:bg-white/[0.04] hover:bg-white dark:hover:bg-white/[0.08] flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {m.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {m.course.code} · {m.course.name}
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold text-rose-700 dark:text-rose-400 tabular-nums shrink-0">
                      0 / {m.possible}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Cumulative GPA Progress Over the Term (Recharts Line Chart) */}
      <CumulativeGpaChart
        courses={courses}
        gradeScale={gradeScale}
        isHypothetical={isHypothetical}
        overlay={overlay}
        priorGpa={priorGpa}
        priorCredits={priorCredits}
        onSelectCourse={onSelectCourse}
      />

      {/* Grade Performance Over the Year & All Category Weights Charts */}
      <section
        aria-label="Grade trends and category weights"
        className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch"
      >
        <div className="xl:col-span-7 flex flex-col">
          <div className="flex-1 flex flex-col [&>div]:flex-1">
            <GradeTrendChart
              courses={courses}
              allYearCourses={allYearCourses}
              gradeScale={gradeScale}
              isHypothetical={isHypothetical}
              overlay={overlay}
            />
          </div>
        </div>
        <div className="xl:col-span-5 flex flex-col">
          <div className="flex-1 flex flex-col [&>div]:flex-1">
            <AllCoursesWeightsChart
              courses={courses}
              displayCourseResults={displayCourseResults}
              isHypothetical={isHypothetical}
              onSelectCourse={onSelectCourse}
            />
          </div>
        </div>
      </section>

      {/* Course Standings Ledger Table */}
      <section aria-label="Course standings">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Courses
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select any class to inspect weighted categories, assignments, and required scores.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div
              role="group"
              aria-label="Sort courses"
              className="inline-flex items-center rounded-xl p-0.5 bg-white/60 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/10"
            >
              {(
                [
                  { id: 'default', label: 'Period' },
                  { id: 'lowest', label: 'Lowest' },
                  { id: 'highest', label: 'Highest' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCourseSort(opt.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                    courseSort === opt.id
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {!isHypothetical && (
              <button
                type="button"
                onClick={onEnableHypothetical}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-500/15 hover:bg-amber-100/90 dark:hover:bg-amber-500/25 border border-amber-300/60 dark:border-amber-400/25 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Hypothetical Mode
              </button>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden">
          {/* Mobile Zero-Scroll Course Cards */}
          <div className="md:hidden divide-y divide-slate-200/60 dark:divide-white/[0.07]">
            {sortedCourses.map((course) => {
              const actual = actualCourseResults[course.id];
              const display = displayCourseResults[course.id];
              const pctDelta =
                isHypothetical &&
                actual?.percentage !== null &&
                display?.percentage !== null
                  ? display.percentage - actual.percentage
                  : null;
              const letterChanged =
                isHypothetical && actual && display && actual.letter !== display.letter;

              const level = getEffectiveCourseLevel(course);
              const isBoosted = level === 'ap' || level === 'honors';

              return (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => onSelectCourse(course.id)}
                  className="w-full text-left p-4 hover:bg-white/60 dark:hover:bg-white/[0.04] active:bg-white/75 dark:active:bg-white/[0.07] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {course.code} · {course.credits.toFixed(1)} cr
                        {display?.excludedFromGpa
                          ? ' · Non-GPA'
                          : isBoosted
                            ? ` · ${level === 'ap' ? 'AP +1.0' : 'Honors +1.0'}`
                            : ''}
                      </div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5 break-words">
                        {course.name}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {course.instructor} · {display?.totalCount ?? 0}{' '}
                        {(display?.totalCount ?? 0) === 1 ? 'item' : 'items'}
                      </div>
                    </div>

                    <div className="text-right shrink-0 tabular-nums">
                      <div className="flex items-baseline justify-end gap-1.5">
                        <span className="font-mono text-base font-semibold text-slate-900 dark:text-white">
                          {formatPercent(display?.percentage ?? null)}
                        </span>
                        {letterChanged ? (
                          <span className="font-mono text-sm font-semibold text-amber-700 dark:text-amber-300">
                            {actual.letter}→{display.letter}
                          </span>
                        ) : (
                          <span
                            className={`font-mono text-sm font-semibold ${getGradeToneClass(
                              display?.percentage ?? null
                            )}`}
                          >
                            {display?.letter ?? '—'}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px]">
                        {isHypothetical && pctDelta !== null && Math.abs(pctDelta) >= 0.05 ? (
                          <span
                            className={
                              pctDelta > 0
                                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                : 'text-rose-700 dark:text-rose-400 font-medium'
                            }
                          >
                            {pctDelta > 0 ? '▲' : '▼'} {formatSignedDelta(pctDelta, '%', 1)}
                          </span>
                        ) : display?.excludedFromGpa ? (
                          <span className="text-slate-400 dark:text-slate-500">Excluded</span>
                        ) : isBoosted &&
                          display?.weightedGpa !== null &&
                          display?.gpa !== null &&
                          display.weightedGpa > display.gpa ? (
                          <span className="text-slate-500 dark:text-slate-400">
                            {formatGpa(display.gpa)} / {formatGpa(display.weightedGpa)} W
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            GPA {formatGpa(display?.gpa ?? null)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2.5">
                    <div className="flex-1 h-1.5 bg-slate-200/80 dark:bg-white/[0.09] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isHypothetical && display?.modifiedCount > 0
                            ? 'bg-amber-500'
                            : 'bg-blue-600 dark:bg-sky-400'
                        }`}
                        style={{ width: `${Math.round(display?.gradedWeightPercent || 0)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                      {Math.round(display?.gradedWeightPercent || 0)}% graded
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop Courses Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/70 dark:border-white/[0.08] bg-slate-50/50 dark:bg-white/[0.02] text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5">Course</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Credits</th>
                  <th className="py-3 px-4 whitespace-nowrap">Progress</th>
                  {isHypothetical && (
                    <th className="py-3 px-4 text-right whitespace-nowrap">Actual</th>
                  )}
                  <th className="py-3 px-4 text-right whitespace-nowrap">
                    {isHypothetical ? 'Hypothetical' : 'Grade'}
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Letter</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">
                    {isHypothetical ? 'Change' : 'GPA'}
                  </th>
                  <th className="py-3 px-4 w-10" aria-label="Inspect" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-white/[0.06] text-sm">
                {sortedCourses.map((course) => {
                  const actual = actualCourseResults[course.id];
                  const display = displayCourseResults[course.id];
                  const pctDelta =
                    isHypothetical &&
                    actual?.percentage !== null &&
                    display?.percentage !== null
                      ? display.percentage - actual.percentage
                      : null;
                  const letterChanged =
                    isHypothetical && actual && display && actual.letter !== display.letter;

                  const level = getEffectiveCourseLevel(course);
                  const isBoosted = level === 'ap' || level === 'honors';

                  return (
                    <tr
                      key={course.id}
                      onClick={() => onSelectCourse(course.id)}
                      className="group hover:bg-white/60 dark:hover:bg-white/[0.04] cursor-pointer transition-colors"
                    >
                      <td className="py-4 px-5">
                        <div className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-sky-400 transition-colors">
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 mr-2">
                            {course.code}
                          </span>
                          {course.name}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                          <span>{course.instructor}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {display?.totalCount ?? 0}{' '}
                            {(display?.totalCount ?? 0) === 1 ? 'assignment' : 'assignments'}
                          </span>
                          {display?.excludedFromGpa ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-400 dark:text-slate-500">
                                Excluded from GPA
                              </span>
                            </>
                          ) : isBoosted ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-blue-700 dark:text-sky-400 font-medium">
                                {level === 'ap' ? 'AP (+1.0)' : 'Honors (+1.0)'}
                              </span>
                            </>
                          ) : null}
                          {isHypothetical && display?.modifiedCount > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-700 dark:text-amber-400 font-medium">
                                {display.modifiedCount} simulated{' '}
                                {display.modifiedCount === 1 ? 'edit' : 'edits'}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="py-4 px-4 text-right font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                        {course.credits.toFixed(1)}
                      </td>

                      <td className="py-4 px-4 min-w-[148px]">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1 h-1.5 bg-slate-200/80 dark:bg-white/[0.09] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isHypothetical && display?.modifiedCount > 0
                                  ? 'bg-amber-500'
                                  : 'bg-blue-600 dark:bg-sky-400'
                              }`}
                              style={{ width: `${Math.round(display?.gradedWeightPercent || 0)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums w-9 text-right">
                            {Math.round(display?.gradedWeightPercent || 0)}%
                          </span>
                        </div>
                      </td>

                      {isHypothetical && (
                        <td className="py-4 px-4 text-right font-mono text-xs text-slate-400 dark:text-slate-500 tabular-nums">
                          {formatPercent(actual?.percentage ?? null)} ({actual?.letter ?? '—'})
                        </td>
                      )}

                      <td className="py-4 px-4 text-right font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                        {formatPercent(display?.percentage ?? null)}
                      </td>

                      <td className="py-4 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                        {letterChanged ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <span className="text-slate-400 dark:text-slate-500 font-normal">
                              {actual.letter}
                            </span>
                            <ArrowRight className="w-3 h-3 text-amber-500" />
                            <span>{display.letter}</span>
                          </span>
                        ) : (
                          <span className={getGradeToneClass(display?.percentage ?? null)}>
                            {display?.letter ?? '—'}
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        {isHypothetical ? (
                          pctDelta !== null && Math.abs(pctDelta) >= 0.05 ? (
                            <span
                              className={`font-medium ${
                                pctDelta > 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-700 dark:text-rose-400'
                              }`}
                            >
                              {pctDelta > 0 ? '▲' : '▼'} {formatSignedDelta(pctDelta, '%', 1)}
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )
                        ) : display?.excludedFromGpa ? (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        ) : isBoosted &&
                          display?.weightedGpa !== null &&
                          display?.gpa !== null &&
                          display.weightedGpa > display.gpa ? (
                          <span className="text-slate-600 dark:text-slate-300">
                            {formatGpa(display.gpa)}{' '}
                            <span className="text-blue-700 dark:text-sky-400">
                              ({formatGpa(display.weightedGpa)})
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-400">
                            {formatGpa(display?.gpa ?? null)}
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-4 text-right text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200">
                        <ChevronRight className="w-4 h-4 inline-block" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Upcoming / Ungraded Assignments */}
      {upcomingItems.length > 0 && (
        <section aria-label="Upcoming assignments">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Upcoming &amp; Ungraded
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isHypothetical
                  ? 'Enter projected scores below to see how upcoming work moves your Term GPA.'
                  : 'Switch to Hypothetical Mode to test projected scores on upcoming assignments.'}
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              {upcomingItems.length} {upcomingItems.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="glass-panel rounded-2xl overflow-hidden">
            {/* Mobile Zero-Scroll Upcoming List */}
            <div className="md:hidden divide-y divide-slate-200/60 dark:divide-white/[0.07]">
              {upcomingItems.map(({ course, assignment, category }) => {
                const taskKey = `${course.id}:${assignment.id}`;
                const isDone = Boolean(completedTaskIds[taskKey]);
                const hasHypScore = assignment.earned !== null;
                const pct =
                  hasHypScore && assignment.possible > 0
                    ? ((assignment.earned as number) / assignment.possible) * 100
                    : null;

                return (
                  <div
                    key={`${course.id}-${assignment.id}`}
                    className={`p-4 space-y-2.5 ${
                      isHypothetical && hasHypScore
                        ? 'bg-amber-50/60 dark:bg-amber-500/10'
                        : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onToggleTaskComplete(taskKey)}
                        aria-label={isDone ? 'Mark as not done' : 'Mark assignment as done'}
                        className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          isDone
                            ? 'bg-emerald-600 dark:bg-emerald-500 border-emerald-600 dark:border-emerald-500 text-white dark:text-slate-950'
                            : 'border-slate-300 dark:border-white/25 bg-white/70 dark:bg-white/[0.04]'
                        }`}
                      >
                        {isDone && <Check className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectCourse(course.id)}
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {course.code} · {assignment.dueDate}
                        </div>
                        <div
                          className={`text-sm font-medium mt-0.5 break-words ${
                            isDone
                              ? 'line-through text-slate-400 dark:text-slate-500'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {cleanAssignmentDisplayTitle(assignment.title, category?.name)}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {category ? (
                            <>
                              {category.name}
                              {course.gradingMode === 'weighted' && category.weight > 0
                                ? ` · ${category.weight}%`
                                : ''}
                            </>
                          ) : (
                            'Coursework'
                          )}
                        </div>
                      </button>

                      {!isHypothetical && (
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                          — / {assignment.possible}
                        </span>
                      )}
                    </div>

                    {isHypothetical && (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="any"
                            min={0}
                            placeholder="Score"
                            aria-label={`Hypothetical score for ${assignment.title}`}
                            value={assignment.earned === null ? '' : assignment.earned}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') {
                                onUpdateHypotheticalScore(course.id, assignment.id, null);
                              } else {
                                const num = parseFloat(raw);
                                if (!Number.isNaN(num)) {
                                  onUpdateHypotheticalScore(course.id, assignment.id, num);
                                }
                              }
                            }}
                            className="w-20 px-2.5 py-2 text-right font-mono text-xs bg-white/85 dark:bg-slate-950/75 text-slate-900 dark:text-slate-100 border border-amber-400/70 dark:border-amber-400/40 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                          />
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            / {assignment.possible}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {pct !== null && (
                            <span className="font-mono text-xs font-medium tabular-nums text-amber-800 dark:text-amber-300">
                              {formatPercent(pct)}
                            </span>
                          )}
                          {hasHypScore && (
                            <button
                              type="button"
                              title="Clear hypothetical score"
                              aria-label="Clear hypothetical score"
                              onClick={() => onResetHypotheticalItem(course.id, assignment.id)}
                              className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-500 hover:text-amber-700 dark:hover:text-amber-300 rounded-lg"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Upcoming Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/70 dark:border-white/[0.08] bg-slate-50/50 dark:bg-white/[0.02] text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-5">Assignment</th>
                    <th className="py-3 px-4 whitespace-nowrap">Category</th>
                    <th className="py-3 px-4 whitespace-nowrap">Due Date</th>
                    <th className="py-3 px-5 text-right whitespace-nowrap">
                      {isHypothetical ? 'Projected Score' : 'Points'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/50 dark:divide-white/[0.06] text-sm">
                  {upcomingItems.map(({ course, assignment, category }) => {
                    const taskKey = `${course.id}:${assignment.id}`;
                    const isDone = Boolean(completedTaskIds[taskKey]);
                    const hasHypScore = assignment.earned !== null;
                    const pct =
                      hasHypScore && assignment.possible > 0
                        ? ((assignment.earned as number) / assignment.possible) * 100
                        : null;

                    return (
                      <tr
                        key={`${course.id}-${assignment.id}`}
                        className={
                          isHypothetical && hasHypScore
                            ? 'bg-amber-50/60 dark:bg-amber-500/10'
                            : 'hover:bg-white/50 dark:hover:bg-white/[0.03]'
                        }
                      >
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => onToggleTaskComplete(taskKey)}
                              title={isDone ? 'Mark as not done' : 'Mark as done / studied'}
                              aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                isDone
                                  ? 'bg-emerald-600 dark:bg-emerald-500 border-emerald-600 dark:border-emerald-500 text-white dark:text-slate-950'
                                  : 'border-slate-300 dark:border-white/25 bg-white/70 dark:bg-white/[0.04] hover:border-blue-500'
                              }`}
                            >
                              {isDone && <Check className="w-3 h-3" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => onSelectCourse(course.id)}
                              className="text-left group"
                            >
                              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 mr-2">
                                {course.code}
                              </span>
                              <span
                                className={`font-medium transition-colors ${
                                  isDone
                                    ? 'line-through text-slate-400 dark:text-slate-500'
                                    : 'text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-sky-400'
                                }`}
                              >
                                {cleanAssignmentDisplayTitle(assignment.title, category?.name)}
                              </span>
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {category ? (
                            <>
                              <span>{category.name}</span>
                              {course.gradingMode === 'weighted' && category.weight > 0 && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span className="font-mono tabular-nums">
                                    {category.weight}%
                                  </span>
                                </>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                          {assignment.dueDate}
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          {isHypothetical ? (
                            <div className="inline-flex items-center justify-end gap-2">
                              <input
                                type="number"
                                step="any"
                                min={0}
                                placeholder="—"
                                aria-label={`Hypothetical score for ${assignment.title}`}
                                value={assignment.earned === null ? '' : assignment.earned}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === '') {
                                    onUpdateHypotheticalScore(course.id, assignment.id, null);
                                  } else {
                                    const num = parseFloat(raw);
                                    if (!Number.isNaN(num)) {
                                      onUpdateHypotheticalScore(course.id, assignment.id, num);
                                    }
                                  }
                                }}
                                className="w-20 px-2 py-1 text-right font-mono text-xs bg-white/80 dark:bg-slate-950/70 text-slate-900 dark:text-slate-100 border border-amber-400/70 dark:border-amber-400/40 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-400/30 rounded-lg tabular-nums"
                              />
                              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                / {assignment.possible}
                              </span>
                              <span className="font-mono text-xs w-12 text-right tabular-nums text-amber-800 dark:text-amber-300">
                                {pct !== null ? formatPercent(pct) : ''}
                              </span>
                              {hasHypScore && (
                                <button
                                  type="button"
                                  title="Clear hypothetical score"
                                  onClick={() => onResetHypotheticalItem(course.id, assignment.id)}
                                  className="p-1 text-slate-400 hover:text-amber-700 dark:hover:text-amber-300 rounded transition-colors"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                              — / {assignment.possible}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export const OverviewView = memo(OverviewViewInner);
