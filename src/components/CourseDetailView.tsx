import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  EyeOff,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  Assignment,
  Course,
  CourseResult,
  GradeScaleEntry,
  HypotheticalOverlay,
} from '../types/grades';
import {
  cleanAssignmentDisplayTitle,
  formatGpa,
  formatPercent,
  formatSignedDelta,
  getGradeToneClass,
  solveRequiredScore,
} from '../utils/gradeMath';
import { CourseCategoryWeightsChart, GradeTrendChart } from './GradeCharts';

interface CourseDetailViewProps {
  course: Course;
  actualResult: CourseResult;
  displayResult: CourseResult;
  gradeScale: GradeScaleEntry[];
  isHypothetical: boolean;
  overlay: HypotheticalOverlay;
  onBack: () => void;
  onEditCourse: () => void;
  onAddAssignment: () => void;
  onEditRealAssignment: (assignment: Assignment) => void;
  onDeleteRealAssignment: (assignmentId: string) => void;
  onUpdateHypotheticalScore: (courseId: string, assignmentId: string, earned: number | null) => void;
  onToggleHypotheticalExclude: (courseId: string, assignmentId: string) => void;
  onResetHypotheticalItem: (courseId: string, assignmentId: string) => void;
  onRemoveHypotheticalAdded: (courseId: string, assignmentId: string) => void;
  onFillUngraded: (courseId: string, percent: number) => void;
  onSimulateTargetScore: (courseId: string, assignmentIds: string[], requiredPercent: number) => void;
}

export const CourseDetailView: React.FC<CourseDetailViewProps> = ({
  course,
  actualResult,
  displayResult,
  gradeScale,
  isHypothetical,
  overlay,
  onBack,
  onEditCourse,
  onAddAssignment,
  onEditRealAssignment,
  onDeleteRealAssignment,
  onUpdateHypotheticalScore,
  onToggleHypotheticalExclude,
  onResetHypotheticalItem,
  onRemoveHypotheticalAdded,
  onFillUngraded,
  onSimulateTargetScore,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'graded' | 'upcoming' | 'modified'>('all');

  const ungradedOptions = useMemo(
    () =>
      displayResult.effectiveAssignments.filter(
        (a) => !a.isRemoved && !a.excused && a.originalEarned === null && !a.extraCredit
      ),
    [displayResult.effectiveAssignments]
  );

  const [targetLetter, setTargetLetter] = useState<string>('A-');
  const [targetScope, setTargetScope] = useState<string>('all-ungraded');

  const selectedScaleEntry =
    gradeScale.find((g) => g.letter === targetLetter) || gradeScale[0];

  const validTargetScope =
    targetScope === 'all-ungraded' ||
    displayResult.effectiveAssignments.some((a) => a.id === targetScope && !a.isRemoved)
      ? targetScope
      : 'all-ungraded';

  const quickSolve = useMemo(() => {
    if (!selectedScaleEntry) return null;
    return solveRequiredScore(
      course,
      selectedScaleEntry.minPercent,
      validTargetScope,
      gradeScale,
      isHypothetical ? overlay : null
    );
  }, [course, selectedScaleEntry, validTargetScope, gradeScale, isHypothetical, overlay]);

  const pctDelta =
    isHypothetical && actualResult.percentage !== null && displayResult.percentage !== null
      ? displayResult.percentage - actualResult.percentage
      : null;

  const letterChanged = isHypothetical && actualResult.letter !== displayResult.letter;

  const categoryMap = useMemo(
    () => new Map(course.categories.map((c) => [c.id, c])),
    [course.categories]
  );

  const filteredAssignments = useMemo(() => {
    return displayResult.effectiveAssignments.filter((item) => {
      if (categoryFilter !== 'all' && item.categoryId !== categoryFilter) {
        return false;
      }
      if (statusFilter === 'graded' && (item.earned === null || item.isRemoved)) {
        return false;
      }
      if (statusFilter === 'upcoming' && (item.earned !== null || item.isRemoved)) {
        return false;
      }
      if (statusFilter === 'modified' && !item.isModified) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const catName = categoryMap.get(item.categoryId)?.name.toLowerCase() || '';
        if (!item.title.toLowerCase().includes(q) && !catName.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [displayResult.effectiveAssignments, categoryFilter, statusFilter, searchQuery, categoryMap]);

  const ungradedCount = displayResult.effectiveAssignments.filter(
    (a) => !a.isRemoved && !a.excused && a.originalEarned === null && !a.extraCredit
  ).length;

  return (
    <div className="space-y-6">
      {/* Course Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All Courses
          </button>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {course.name}
            </h1>
            <span className="font-mono text-sm text-slate-500 dark:text-slate-400">
              {course.code}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            <span>{course.instructor}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{course.credits.toFixed(1)} credits</span>
            <span aria-hidden="true">·</span>
            <span>
              {course.gradingMode === 'weighted' ? 'Weighted Categories' : 'Total Points'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {displayResult.gradedCount} of {displayResult.totalCount} graded
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onEditCourse}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/75 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/10 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Settings
          </button>
          <button
            type="button"
            onClick={onAddAssignment}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl transition-colors whitespace-nowrap ${
              isHypothetical
                ? 'text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-slate-950'
                : 'text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            {isHypothetical ? 'Add Hypothetical' : 'Add Assignment'}
          </button>
        </div>
      </div>

      {/* Standing & Category Breakdown Liquid Glass Panel */}
      <section
        className={`rounded-2xl overflow-hidden transition-colors ${
          isHypothetical ? 'glass-hypothetical' : 'glass-panel'
        }`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/70 dark:divide-white/[0.08]">
          {/* Course Grade Standing */}
          <div className="lg:col-span-4 p-6 flex flex-col justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {isHypothetical ? 'Hypothetical Grade' : 'Current Grade'}
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-4xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                  {formatPercent(displayResult.percentage)}
                </span>
                <span
                  className={`font-mono text-2xl font-semibold ${
                    letterChanged
                      ? 'text-amber-700 dark:text-amber-300'
                      : getGradeToneClass(displayResult.percentage)
                  }`}
                >
                  {displayResult.letter}
                </span>
              </div>

              {isHypothetical && (
                <div className="mt-3 pt-3 border-t border-amber-300/50 dark:border-amber-400/20 flex items-center justify-between text-xs tabular-nums">
                  <span className="text-slate-600 dark:text-slate-300">
                    Actual:{' '}
                    <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                      {formatPercent(actualResult.percentage)} ({actualResult.letter})
                    </span>
                  </span>
                  {pctDelta !== null && Math.abs(pctDelta) >= 0.05 ? (
                    <span
                      className={`font-mono font-semibold ${
                        pctDelta > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {pctDelta > 0 ? '▲' : '▼'} {formatSignedDelta(pctDelta, '%', 1)}
                    </span>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500">Unchanged</span>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-200/70 dark:border-white/[0.08] flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              <span>GPA: {formatGpa(displayResult.gpa)}</span>
              <span>{Math.round(displayResult.gradedWeightPercent)}% graded</span>
            </div>
          </div>

          {/* Category Weights Donut & Breakdown */}
          <div className="lg:col-span-8">
            <CourseCategoryWeightsChart
              course={course}
              actualResult={actualResult}
              displayResult={displayResult}
              isHypothetical={isHypothetical}
            />
          </div>
        </div>
      </section>

      {/* Course Grade Trajectory Over the Year */}
      <GradeTrendChart
        courses={[course]}
        gradeScale={gradeScale}
        isHypothetical={isHypothetical}
        overlay={overlay}
        singleCourseMode
        title={`${course.name} · Grade Over Time`}
      />

      {/* Inline Target Grade Solver Bar */}
      <section
        aria-label="Target grade calculator"
        className="glass-panel rounded-2xl px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3 sm:gap-4"
      >
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 text-sm w-full lg:w-auto">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">
            <Calculator className="w-4 h-4 text-blue-600 dark:text-sky-400" />
            Target Check
          </span>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span>Goal</span>
            <select
              value={targetLetter}
              onChange={(e) => setTargetLetter(e.target.value)}
              className="px-2.5 py-1.5 font-mono text-xs font-medium bg-white/80 dark:bg-slate-950/70 border border-slate-200 dark:border-white/10 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
            >
              {gradeScale
                .filter((g) => g.minPercent > 0)
                .map((g) => (
                  <option key={g.letter} value={g.letter}>
                    {g.letter} ({g.minPercent}%)
                  </option>
                ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 min-w-0 max-w-full flex-1 sm:flex-initial">
            <span className="shrink-0">on</span>
            <select
              value={validTargetScope}
              onChange={(e) => setTargetScope(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-medium bg-white/80 dark:bg-slate-950/70 border border-slate-200 dark:border-white/10 rounded-lg text-slate-900 dark:text-slate-100 w-full sm:w-auto sm:max-w-[240px] truncate focus:outline-none focus:ring-2 focus:ring-blue-400/30"
            >
              <option value="all-ungraded">
                All Remaining Ungraded ({ungradedOptions.length})
              </option>
              {displayResult.effectiveAssignments
                .filter((a) => !a.isRemoved && !a.excused && !a.extraCredit)
                .map((a, idx) => (
                  <option key={a.id} value={a.id}>
                    {cleanAssignmentDisplayTitle(a.title, categoryMap.get(a.categoryId)?.name, idx)} (
                    {a.earned === null ? 'Upcoming' : `${a.earned}/${a.possible}`})
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {quickSolve && quickSolve.status === 'no-target' && (
            <span className="text-slate-500 dark:text-slate-400">
              No ungraded assignments to solve.
            </span>
          )}
          {quickSolve && quickSolve.status === 'secured' && (
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              Secured — even 0% keeps {targetLetter} ({formatPercent(quickSolve.projectedFinalIfZero)}).
            </span>
          )}
          {quickSolve && quickSolve.status === 'impossible' && (
            <span className="font-medium text-rose-700 dark:text-rose-400">
              Unreachable via selected item (100% yields {formatPercent(quickSolve.projectedFinalIfPerfect)}).
            </span>
          )}
          {quickSolve &&
            (quickSolve.status === 'achievable' ||
              quickSolve.status === 'stretch' ||
              quickSolve.status === 'extra-credit') &&
            quickSolve.requiredPercent !== null && (
              <>
                <span className="text-slate-700 dark:text-slate-300 tabular-nums">
                  Need{' '}
                  <strong
                    className={`font-mono text-sm ${
                      quickSolve.status === 'extra-credit'
                        ? 'text-rose-700 dark:text-rose-400'
                        : quickSolve.status === 'stretch'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {formatPercent(quickSolve.requiredPercent)}
                  </strong>
                  {quickSolve.requiredPoints !== null && quickSolve.possiblePoints !== null && (
                    <span className="font-mono text-slate-500 dark:text-slate-400 ml-1">
                      ({quickSolve.requiredPoints} / {quickSolve.possiblePoints})
                    </span>
                  )}
                  {quickSolve.status === 'extra-credit' && (
                    <span className="text-rose-700 dark:text-rose-400 ml-1.5">· Extra credit</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onSimulateTargetScore(
                      course.id,
                      quickSolve.targetAssignmentIds,
                      quickSolve.requiredPercent as number
                    )
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200 bg-amber-100/90 dark:bg-amber-500/20 hover:bg-amber-200/90 dark:hover:bg-amber-500/30 rounded-lg transition-colors whitespace-nowrap"
                >
                  Simulate
                  <ArrowRight className="w-3 h-3" />
                </button>
              </>
            )}
        </div>
      </section>

      {/* Assignment Ledger Section */}
      <section aria-label="Assignment ledger">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 min-w-[160px] sm:flex-initial">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter assignments..."
                className="pl-8 pr-3 py-2 sm:py-1.5 text-xs bg-white/75 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-400/30 w-full sm:w-48"
              />
            </div>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
              className="px-2.5 py-2 sm:py-1.5 text-xs bg-white/75 dark:bg-slate-900/70 border border-slate-200/80 dark:border-white/10 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400/30 max-w-full"
            >
              <option value="all">All Categories</option>
              {course.categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>

            {/* Status Segmented Filter */}
            <div className="inline-flex flex-wrap items-center p-0.5 bg-slate-200/60 dark:bg-white/[0.06] rounded-xl border border-slate-200/80 dark:border-white/10 w-full sm:w-auto">
              {(['all', 'graded', 'upcoming'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`flex-1 sm:flex-initial px-2.5 py-1.5 sm:py-1 text-xs font-medium rounded-lg capitalize transition-colors whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {st}
                </button>
              ))}
              {isHypothetical && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('modified')}
                  className={`flex-1 sm:flex-initial px-2.5 py-1.5 sm:py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    statusFilter === 'modified'
                      ? 'bg-amber-100 dark:bg-amber-500/25 text-amber-900 dark:text-amber-200'
                      : 'text-amber-800 dark:text-amber-400 hover:text-amber-950 dark:hover:text-amber-200'
                  }`}
                >
                  Modified ({displayResult.modifiedCount})
                </button>
              )}
            </div>
          </div>

          {isHypothetical && ungradedCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500 dark:text-slate-400 mr-1">Fill upcoming:</span>
              <button
                type="button"
                onClick={() => onFillUngraded(course.id, 90)}
                className="px-2.5 py-1.5 sm:py-1 font-mono text-xs font-medium text-amber-900 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/25 border border-amber-300/60 dark:border-amber-400/25 rounded-lg transition-colors whitespace-nowrap"
              >
                90%
              </button>
              <button
                type="button"
                onClick={() => onFillUngraded(course.id, 100)}
                className="px-2.5 py-1.5 sm:py-1 font-mono text-xs font-medium text-amber-900 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/25 border border-amber-300/60 dark:border-amber-400/25 rounded-lg transition-colors whitespace-nowrap"
              >
                100%
              </button>
              {actualResult.percentage !== null && (
                <button
                  type="button"
                  onClick={() =>
                    onFillUngraded(course.id, Math.round(actualResult.percentage as number))
                  }
                  className="px-2.5 py-1.5 sm:py-1 text-xs font-medium text-amber-900 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/25 border border-amber-300/60 dark:border-amber-400/25 rounded-lg transition-colors whitespace-nowrap"
                >
                  Match avg ({Math.round(actualResult.percentage)}%)
                </button>
              )}
            </div>
          )}
        </div>

        {/* Ledger Container */}
        <div className="glass-panel rounded-2xl overflow-hidden">
          {/* Mobile Zero-Scroll Assignment Cards */}
          <div className="md:hidden divide-y divide-slate-200/60 dark:divide-white/[0.07]">
            {filteredAssignments.length === 0 ? (
              <div className="py-10 px-4 text-center text-sm text-slate-500 dark:text-slate-400">
                {displayResult.effectiveAssignments.length === 0
                  ? 'No assignments posted in this class yet.'
                  : 'No assignments match the current filter.'}
              </div>
            ) : (
              filteredAssignments.map((item, idx) => {
                const cat = categoryMap.get(item.categoryId);
                const displayTitle = cleanAssignmentDisplayTitle(item.title, cat?.name, idx);
                const pct =
                  item.earned !== null && item.possible > 0 && !item.isRemoved && !item.excused
                    ? (item.earned / item.possible) * 100
                    : null;
                const origPct =
                  item.originalEarned !== null && item.originalPossible > 0
                    ? (item.originalEarned / item.originalPossible) * 100
                    : null;
                const sliderMax = Math.max(item.possible, item.earned ?? 0);

                return (
                  <div
                    key={item.id}
                    className={`p-4 space-y-2.5 transition-colors ${
                      item.isRemoved
                        ? 'bg-slate-100/60 dark:bg-white/[0.02] opacity-55'
                        : isHypothetical && item.isModified
                          ? 'bg-amber-50/60 dark:bg-amber-500/10'
                          : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-sm font-medium break-words ${
                            item.isRemoved || item.excused
                              ? 'line-through text-slate-400 dark:text-slate-500'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {displayTitle}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                          <span>{cat?.name || 'Uncategorized'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{item.dueDate}</span>
                          {item.extraCredit && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                Extra Credit
                              </span>
                            </>
                          )}
                          {item.excused && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Excused</span>
                            </>
                          )}
                          {item.isDropped && !item.isRemoved && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Dropped</span>
                            </>
                          )}
                          {item.isRemoved && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-700 dark:text-amber-400 font-medium">
                                Excluded
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0 tabular-nums">
                        {item.isRemoved ? (
                          <span className="font-mono text-xs text-slate-400 dark:text-slate-500">
                            Excluded
                          </span>
                        ) : pct !== null ? (
                          <>
                            <div className={`font-mono text-sm font-semibold ${getGradeToneClass(pct)}`}>
                              {formatPercent(pct)}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {item.earned}/{item.possible}
                            </div>
                          </>
                        ) : (
                          <div className="font-mono text-xs text-slate-400 dark:text-slate-500">
                            — / {item.possible}
                          </div>
                        )}
                      </div>
                    </div>

                    {isHypothetical && !item.isRemoved && (
                      <div className="pt-1 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="any"
                              min={0}
                              placeholder="—"
                              aria-label={`Hypothetical score for ${item.title}`}
                              value={item.earned === null ? '' : item.earned}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === '') {
                                  onUpdateHypotheticalScore(course.id, item.id, null);
                                } else {
                                  const num = parseFloat(raw);
                                  if (!Number.isNaN(num)) {
                                    onUpdateHypotheticalScore(course.id, item.id, num);
                                  }
                                }
                              }}
                              className={`w-20 px-2.5 py-1.5 text-right font-mono text-xs bg-white/85 dark:bg-slate-950/75 border rounded-lg tabular-nums focus:outline-none focus:ring-2 ${
                                item.isModified
                                  ? 'border-amber-400 text-amber-950 dark:text-amber-200 focus:border-amber-500 focus:ring-amber-400/30 font-medium'
                                  : 'border-slate-300 dark:border-white/15 text-slate-900 dark:text-slate-100 focus:border-amber-500 focus:ring-amber-400/20'
                              }`}
                            />
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                              / {item.possible}
                            </span>
                          </div>
                          {item.isModified && origPct !== null && pct !== null && Math.abs(pct - origPct) >= 0.05 && (
                            <span className="font-mono text-[11px] text-amber-700 dark:text-amber-300 tabular-nums">
                              was {formatPercent(origPct)}
                            </span>
                          )}
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={sliderMax}
                          step={item.possible <= 30 ? 0.5 : 1}
                          value={item.earned ?? 0}
                          aria-label={`Adjust hypothetical score slider for ${item.title}`}
                          onChange={(e) =>
                            onUpdateHypotheticalScore(
                              course.id,
                              item.id,
                              parseFloat(e.target.value)
                            )
                          }
                          className="grade-slider w-full"
                        />
                      </div>
                    )}

                    {/* Action Footer Row */}
                    <div className="flex items-center justify-end gap-1 pt-0.5">
                      {isHypothetical ? (
                        item.isHypotheticalOnly ? (
                          <button
                            type="button"
                            onClick={() => onRemoveHypotheticalAdded(course.id, item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onToggleHypotheticalExclude(course.id, item.id)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg ${
                                item.isRemoved
                                  ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20'
                                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
                              }`}
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                              {item.isRemoved ? 'Restore' : 'Exclude'}
                            </button>
                            {item.isModified && (
                              <button
                                type="button"
                                onClick={() => onResetHypotheticalItem(course.id, item.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded-lg"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Reset
                              </button>
                            )}
                          </>
                        )
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onEditRealAssignment(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 rounded-lg"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRealAssignment(item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Ledger Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/70 dark:border-white/[0.08] bg-slate-50/50 dark:bg-white/[0.02] text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5">Assignment</th>
                  <th className="py-3 px-4 whitespace-nowrap">Due Date</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">
                    {isHypothetical ? 'Hypothetical Score' : 'Score'}
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Percent</th>
                  <th className="py-3 px-5 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-white/[0.06] text-sm">
                {filteredAssignments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-12 px-5 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      {displayResult.effectiveAssignments.length === 0
                        ? 'No assignments posted in this class yet.'
                        : 'No assignments match the current filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredAssignments.map((item, idx) => {
                    const cat = categoryMap.get(item.categoryId);
                    const displayTitle = cleanAssignmentDisplayTitle(item.title, cat?.name, idx);
                    const pct =
                      item.earned !== null && item.possible > 0 && !item.isRemoved && !item.excused
                        ? (item.earned / item.possible) * 100
                        : null;

                    const origPct =
                      item.originalEarned !== null && item.originalPossible > 0
                        ? (item.originalEarned / item.originalPossible) * 100
                        : null;

                    const sliderMax = Math.max(item.possible, item.earned ?? 0);

                    return (
                      <tr
                        key={item.id}
                        className={`transition-colors ${
                          item.isRemoved
                            ? 'bg-slate-100/60 dark:bg-white/[0.02] opacity-55'
                            : isHypothetical && item.isModified
                              ? 'bg-amber-50/60 dark:bg-amber-500/10'
                              : 'hover:bg-white/55 dark:hover:bg-white/[0.03]'
                        }`}
                      >
                        <td className="py-3.5 px-5">
                          <div
                            className={`font-medium ${
                              item.isRemoved || item.excused
                                ? 'line-through text-slate-400 dark:text-slate-500'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {displayTitle}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                            <span>{cat?.name || 'Uncategorized'}</span>
                            {item.extraCredit && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                  Extra Credit
                                </span>
                              </>
                            )}
                            {item.excused && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Excused</span>
                              </>
                            )}
                            {item.isDropped && !item.isRemoved && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Dropped lowest</span>
                              </>
                            )}
                            {item.isHypotheticalOnly && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-700 dark:text-amber-400 font-medium">
                                  Hypothetical addition
                                </span>
                              </>
                            )}
                            {item.isRemoved && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-700 dark:text-amber-400 font-medium">
                                  Excluded
                                </span>
                              </>
                            )}
                            {isHypothetical &&
                              item.isModified &&
                              !item.isHypotheticalOnly &&
                              !item.isRemoved && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-700 dark:text-amber-400 font-medium tabular-nums">
                                    Actual:{' '}
                                    {item.originalEarned === null
                                      ? 'Ungraded'
                                      : `${item.originalEarned}/${item.originalPossible}`}
                                  </span>
                                </>
                              )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                          {item.dueDate}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {isHypothetical && !item.isRemoved ? (
                            <div className="inline-flex flex-col items-end gap-1.5">
                              <div className="inline-flex items-center gap-1.5">
                                <input
                                  type="number"
                                  step="any"
                                  min={0}
                                  placeholder="—"
                                  aria-label={`Hypothetical score for ${item.title}`}
                                  value={item.earned === null ? '' : item.earned}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw === '') {
                                      onUpdateHypotheticalScore(course.id, item.id, null);
                                    } else {
                                      const num = parseFloat(raw);
                                      if (!Number.isNaN(num)) {
                                        onUpdateHypotheticalScore(course.id, item.id, num);
                                      }
                                    }
                                  }}
                                  className={`w-20 px-2 py-1 text-right font-mono text-xs bg-white/85 dark:bg-slate-950/75 border rounded-lg tabular-nums focus:outline-none focus:ring-2 ${
                                    item.isModified
                                      ? 'border-amber-400 text-amber-950 dark:text-amber-200 focus:border-amber-500 focus:ring-amber-400/30 font-medium'
                                      : 'border-slate-300 dark:border-white/15 text-slate-900 dark:text-slate-100 focus:border-amber-500 focus:ring-amber-400/20'
                                  }`}
                                />
                                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                  / {item.possible}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={sliderMax}
                                step={item.possible <= 30 ? 0.5 : 1}
                                value={item.earned ?? 0}
                                aria-label={`Adjust hypothetical score slider for ${item.title}`}
                                onChange={(e) =>
                                  onUpdateHypotheticalScore(
                                    course.id,
                                    item.id,
                                    parseFloat(e.target.value)
                                  )
                                }
                                className="grade-slider w-28"
                              />
                            </div>
                          ) : (
                            <span className="font-mono text-xs text-slate-900 dark:text-slate-100 tabular-nums">
                              {item.earned === null ? (
                                <span className="text-slate-400 dark:text-slate-500">
                                  Upcoming / {item.possible}
                                </span>
                              ) : (
                                <>
                                  <span className="font-medium">{item.earned}</span>
                                  <span className="text-slate-400 dark:text-slate-500">
                                    {' '}
                                    / {item.possible}
                                  </span>
                                </>
                              )}
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                          {item.isRemoved ? (
                            <span className="text-slate-400 dark:text-slate-500">Excluded</span>
                          ) : pct !== null ? (
                            <div>
                              <div className={`font-semibold ${getGradeToneClass(pct)}`}>
                                {formatPercent(pct)}
                              </div>
                              {isHypothetical &&
                                item.isModified &&
                                origPct !== null &&
                                Math.abs(pct - origPct) >= 0.05 && (
                                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                                    was {formatPercent(origPct)}
                                  </div>
                                )}
                            </div>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          {isHypothetical ? (
                            <div className="inline-flex items-center justify-end gap-1">
                              {item.isHypotheticalOnly ? (
                                <button
                                  type="button"
                                  onClick={() => onRemoveHypotheticalAdded(course.id, item.id)}
                                  title="Remove hypothetical assignment"
                                  className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onToggleHypotheticalExclude(course.id, item.id)}
                                    title={
                                      item.isRemoved
                                        ? 'Restore assignment to simulation'
                                        : 'Exclude assignment from simulation'
                                    }
                                    className={`p-1.5 rounded-lg transition-colors ${
                                      item.isRemoved
                                        ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20'
                                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10'
                                    }`}
                                  >
                                    <EyeOff className="w-3.5 h-3.5" />
                                  </button>
                                  {item.isModified && (
                                    <button
                                      type="button"
                                      onClick={() => onResetHypotheticalItem(course.id, item.id)}
                                      title="Reset to actual grade"
                                      className="p-1.5 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded-lg transition-colors"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => onEditRealAssignment(item)}
                                title="Edit assignment"
                                className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-white/10 rounded-lg transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteRealAssignment(item.id)}
                                title="Delete assignment"
                                className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
};
