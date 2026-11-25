import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Calculator,
  Check,
  EyeOff,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
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
  countOverlayChanges,
  formatGpa,
  formatPercent,
  formatSignedDelta,
  getGradeToneClass,
  solveRequiredScore,
} from '../utils/gradeMath';
import { GradeTrendChart } from './GradeCharts';

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
  onResetCourseHypothetical: (courseId: string) => void;
  onSaveScenario: () => void;
  onApplyHypothetical: () => void;
  onSimulateTargetScore: (courseId: string, assignmentIds: string[], requiredPercent: number) => void;
  onSetHypothetical: (next: boolean) => void;
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
  onResetCourseHypothetical,
  onSaveScenario,
  onApplyHypothetical,
  onSimulateTargetScore,
  onSetHypothetical,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'graded' | 'upcoming' | 'modified'>('all');
  const [confirmApply, setConfirmApply] = useState(false);

  const [targetLetter, setTargetLetter] = useState<string>('A-');
  const [targetScope, setTargetScope] = useState<string>('all-ungraded');

  const courseHypotheticalChanges = useMemo(
    () => countOverlayChanges(overlay, course.id),
    [overlay, course.id]
  );

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

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Course Header with Dedicated Actual / What-If Slider */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Grades
          </button>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {course.name}
            </h1>
            <span className="font-mono text-sm text-slate-500 dark:text-slate-400">
              {course.code}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 flex-wrap">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              Teacher: {course.instructor}
            </span>
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

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Class-Only Actual / What-If Segmented Slider */}
          <div
            role="group"
            aria-label="Class grade viewing mode"
            className="inline-flex items-center p-1 bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl shrink-0"
          >
            <button
              type="button"
              aria-pressed={!isHypothetical}
              onClick={() => {
                onSetHypothetical(false);
                setConfirmApply(false);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                !isHypothetical
                  ? 'bg-slate-900 text-white dark:bg-white/15 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Actual
            </button>
            <button
              type="button"
              aria-pressed={isHypothetical}
              onClick={() => onSetHypothetical(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                isHypothetical
                  ? 'bg-amber-600 dark:bg-amber-500 text-white dark:text-slate-950 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              What-If
              {courseHypotheticalChanges > 0 && (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    isHypothetical
                      ? 'text-amber-100 dark:text-slate-900 font-semibold'
                      : 'text-amber-700 dark:text-amber-400 font-semibold'
                  }`}
                >
                  ({courseHypotheticalChanges})
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onEditCourse}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/10 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Course Info
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
            {isHypothetical ? 'Add What-If Assignment' : 'Add Assignment'}
          </button>
        </div>
      </div>

      {/* Hypothetical Mode Live Impact Bar (only shown inside this class when What-If is ON) */}
      {isHypothetical && (
        <section
          aria-label="Hypothetical grade impact"
          className="glass-hypothetical rounded-2xl px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2 flex-wrap">
              <span>What-If Sandbox Active</span>
              <span className="font-mono font-normal text-amber-800/80 dark:text-amber-300/80 tabular-nums">
                {formatPercent(actualResult.percentage)} ({actualResult.letter}) →{' '}
                <strong className="font-semibold text-slate-900 dark:text-white">
                  {formatPercent(displayResult.percentage)} ({displayResult.letter})
                </strong>
              </span>
              {pctDelta !== null && Math.abs(pctDelta) >= 0.05 && (
                <span
                  className={`font-mono font-bold tabular-nums ${
                    pctDelta > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {pctDelta > 0 ? '▲' : '▼'} {formatSignedDelta(pctDelta, '%', 2)}
                </span>
              )}
            </div>
            <p className="text-[11px] text-amber-900/75 dark:text-amber-200/75">
              Edit any assignment score below or add a new hypothetical assignment to test its impact on this class.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {courseHypotheticalChanges > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onResetCourseHypothetical(course.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/70 hover:bg-white dark:hover:bg-slate-800 border border-slate-200/80 dark:border-white/15 rounded-xl transition-colors whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={onSaveScenario}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/70 hover:bg-white dark:hover:bg-slate-800 border border-slate-200/80 dark:border-white/15 rounded-xl transition-colors whitespace-nowrap"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  Save
                </button>
                {confirmApply ? (
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onApplyHypothetical();
                        setConfirmApply(false);
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl whitespace-nowrap"
                    >
                      Confirm Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmApply(false)}
                      className="px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmApply(true)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:text-slate-950 rounded-xl transition-colors whitespace-nowrap"
                  >
                    Apply to Real
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* Standing & Category Breakdown Panel */}
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
                    <span className="text-slate-400 dark:text-slate-500">No change</span>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-200/70 dark:border-white/[0.08] flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              <span>Course GPA: {formatGpa(displayResult.gpa)}</span>
              <span>{Math.round(displayResult.gradedWeightPercent)}% weight graded</span>
            </div>
          </div>

          {/* Clean Category Breakdown Progress Bars */}
          <div className="lg:col-span-8 p-6 flex flex-col justify-center space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Category Breakdown
            </h3>
            <div className="space-y-3">
              {displayResult.categoryResults.map((catRes) => {
                const pct = catRes.percentage;
                return (
                  <div key={catRes.category.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate pr-2">
                        {catRes.category.name}
                        {course.gradingMode === 'weighted' && (
                          <span className="text-slate-400 ml-1.5 font-mono">
                            ({catRes.category.weight}%)
                          </span>
                        )}
                      </span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                        {pct !== null ? `${pct.toFixed(1)}%` : 'No grades'}
                        <span className="text-slate-400 font-normal ml-1.5">
                          ({catRes.earnedPoints.toFixed(1)}/{catRes.possiblePoints.toFixed(1)} pts)
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all bg-blue-600 dark:bg-sky-400"
                        style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Course Grade Performance Over the Year (Class-Specific Chart) */}
      <GradeTrendChart
        courses={[course]}
        gradeScale={gradeScale}
        isHypothetical={isHypothetical}
        overlay={overlay}
        singleCourseMode
        title={`${course.name} · Performance Over the Year`}
      />

      {/* Built-in Target Grade Calculator (Class-Specific) */}
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
              <option value="all-ungraded">All Remaining Ungraded</option>
              {displayResult.effectiveAssignments
                .filter((a) => !a.isRemoved && !a.excused && !a.extraCredit)
                .map((a, idx) => (
                  <option key={a.id} value={a.id}>
                    {cleanAssignmentDisplayTitle(a.title, categoryMap.get(a.categoryId)?.name, idx)}{' '}
                    ({a.earned === null ? 'Upcoming' : `${a.earned}/${a.possible}`})
                  </option>
                ))}
            </select>
          </label>
        </div>

        {quickSolve && quickSolve.requiredPercent !== null && (
          <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-end text-xs">
            <div className="font-mono tabular-nums">
              Required:{' '}
              <span
                className={`font-bold ${
                  quickSolve.requiredPercent <= 100
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {quickSolve.requiredPercent > 200
                  ? 'Over 200%'
                  : `${quickSolve.requiredPercent.toFixed(1)}%`}
              </span>{' '}
              <span className="text-slate-400">
                ({(quickSolve.requiredPoints ?? 0).toFixed(1)} pts)
              </span>
            </div>
            {quickSolve.requiredPercent <= 100 && quickSolve.requiredPercent >= 0 && (
              <button
                type="button"
                onClick={() =>
                  onSimulateTargetScore(
                    course.id,
                    quickSolve.targetAssignmentIds,
                    quickSolve.requiredPercent!
                  )
                }
                className="px-3 py-1.5 font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-lg transition-colors whitespace-nowrap shadow-xs"
              >
                Test in What-If
              </button>
            )}
          </div>
        )}
      </section>

      {/* Assignments Table & Filters */}
      <section className="glass-panel rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Assignments ({filteredAssignments.length})
            </h2>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl">
              {(['all', 'graded', 'upcoming', 'modified'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg capitalize transition-colors ${
                    statusFilter === st
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <select
              aria-label="Filter assignments by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="all">All Categories</option>
              {course.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="relative flex items-center">
              <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search assignments..."
                className="w-44 sm:w-56 bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200/70 dark:border-white/10 bg-slate-50/40 dark:bg-white/[0.02] text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 sm:px-6">Assignment</th>
                <th className="py-3 px-3 sm:px-4">Category</th>
                <th className="py-3 px-3 sm:px-4">Due Date</th>
                <th className="py-3 px-3 sm:px-4 text-right">Score</th>
                <th className="py-3 px-4 sm:px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50 dark:divide-white/[0.06] text-sm">
              {filteredAssignments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-xs text-slate-500">
                    No matching assignments found.
                  </td>
                </tr>
              ) : (
                filteredAssignments.map((item, idx) => {
                  const catName = categoryMap.get(item.categoryId)?.name || 'Coursework';
                  const cleanTitle = cleanAssignmentDisplayTitle(item.title, catName, idx);
                  const isDropped = item.isDropped;
                  const pct =
                    item.earned !== null && item.possible > 0
                      ? (item.earned / item.possible) * 100
                      : null;

                  const statusNote = [
                    item.extraCredit ? 'Extra Credit' : null,
                    item.excused ? 'Excused' : null,
                    isDropped ? 'Dropped' : null,
                    item.isModified && !item.isRemoved ? 'What-If' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-white/40 dark:hover:bg-white/[0.03] transition-colors ${
                        item.isRemoved ? 'opacity-45 bg-slate-100/50 dark:bg-slate-900/30' : ''
                      }`}
                    >
                      <td className="py-3 px-4 sm:px-6 max-w-xs sm:max-w-md">
                        <div className="min-w-0">
                          <div
                            className={`font-medium truncate ${
                              item.isRemoved
                                ? 'line-through text-slate-400'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {cleanTitle}
                          </div>
                          {statusNote && (
                            <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400 mt-0.5">
                              {statusNote}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-xs text-slate-600 dark:text-slate-400 truncate max-w-[140px]">
                        {catName}
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {item.dueDate || '—'}
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right font-mono tabular-nums">
                        {isHypothetical ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              step="0.1"
                              min={0}
                              max={item.possible * 2}
                              aria-label={`Hypothetical score for ${cleanTitle}`}
                              value={item.earned !== null ? item.earned : ''}
                              placeholder="—"
                              onChange={(e) => {
                                const val =
                                  e.target.value === '' ? null : parseFloat(e.target.value);
                                onUpdateHypotheticalScore(course.id, item.id, val);
                              }}
                              className="w-16 px-2 py-1 text-xs text-right font-mono bg-white/90 dark:bg-slate-900 border border-amber-300/80 dark:border-amber-400/30 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                            />
                            <span className="text-slate-400 text-xs">/ {item.possible}</span>
                          </div>
                        ) : (
                          <div>
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {item.earned !== null ? item.earned : '—'}
                            </span>
                            <span className="text-slate-400 text-xs"> / {item.possible}</span>
                            {pct !== null && (
                              <span className={`block text-[11px] ${getGradeToneClass(pct)}`}>
                                {pct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 sm:px-6 text-right whitespace-nowrap">
                        {isHypothetical ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onToggleHypotheticalExclude(course.id, item.id)}
                              title={item.isRemoved ? 'Restore assignment' : 'Temporarily exclude'}
                              className={`p-1.5 rounded-lg transition-colors ${
                                item.isRemoved
                                  ? 'text-amber-600 bg-amber-500/10'
                                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                              }`}
                            >
                              {item.isRemoved ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {item.isModified && (
                              <button
                                type="button"
                                onClick={() => onResetHypotheticalItem(course.id, item.id)}
                                title="Reset item to real grade"
                                className="p-1.5 text-slate-400 hover:text-amber-600 rounded-lg transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {item.isHypotheticalOnly && (
                              <button
                                type="button"
                                onClick={() => onRemoveHypotheticalAdded(course.id, item.id)}
                                title="Delete hypothetical assignment"
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEditRealAssignment(item)}
                              title="Edit assignment"
                              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteRealAssignment(item.id)}
                              title="Delete assignment"
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
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
      </section>
    </div>
  );
};
