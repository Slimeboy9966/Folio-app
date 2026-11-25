import React, { useMemo, useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import {
  Course,
  CourseResult,
  GradeScaleEntry,
  HypotheticalOverlay,
} from '../types/grades';
import {
  formatGpa,
  formatPercent,
  formatSignedDelta,
  getCourseGpaBoost,
  isCourseExcludedFromGpa,
  solveRequiredScore,
} from '../utils/gradeMath';

interface TargetCalculatorViewProps {
  courses: Course[];
  actualCourseResults: Record<string, CourseResult>;
  displayCourseResults: Record<string, CourseResult>;
  gradeScale: GradeScaleEntry[];
  priorGpa: number;
  priorCredits: number;
  isHypothetical: boolean;
  overlay: HypotheticalOverlay;
  onSimulateTargetScore: (courseId: string, assignmentIds: string[], requiredPercent: number) => void;
  onSelectCourse: (courseId: string) => void;
}

export const TargetCalculatorView: React.FC<TargetCalculatorViewProps> = ({
  courses,
  actualCourseResults,
  displayCourseResults,
  gradeScale,
  priorGpa,
  priorCredits,
  isHypothetical,
  overlay,
  onSimulateTargetScore,
  onSelectCourse,
}) => {
  const [selectedCourseId, setSelectedCourseId] = useState<string>(courses[0]?.id || '');
  const [targetPercent, setTargetPercent] = useState<number>(90);
  const [targetScope, setTargetScope] = useState<string>('all-ungraded');

  // GPA Goal Planner: map of courseId -> chosen target letter
  const [goalLetters, setGoalLetters] = useState<Record<string, string>>({});

  const activeCourse =
    courses.find((c) => c.id === selectedCourseId) || courses[0] || null;

  const activeResult = activeCourse ? displayCourseResults[activeCourse.id] : null;

  const validScope = useMemo(() => {
    if (!activeResult) return 'all-ungraded';
    if (targetScope === 'all-ungraded') return 'all-ungraded';
    const exists = activeResult.effectiveAssignments.some(
      (a) => a.id === targetScope && !a.isRemoved && !a.excused && !a.extraCredit
    );
    return exists ? targetScope : 'all-ungraded';
  }, [activeResult, targetScope]);

  const solveResult = useMemo(() => {
    if (!activeCourse) return null;
    return solveRequiredScore(
      activeCourse,
      targetPercent,
      validScope,
      gradeScale,
      isHypothetical ? overlay : null
    );
  }, [activeCourse, targetPercent, validScope, gradeScale, isHypothetical, overlay]);

  // Compute Term & Cumulative GPA (Unweighted + Weighted) from GPA Goal Planner selections
  const gpaPlan = useMemo(() => {
    let qualityPoints = 0;
    let weightedQualityPoints = 0;
    let creditsCounted = 0;
    let actualQualityPoints = 0;
    let actualCreditsCounted = 0;
    let hasWeighted = false;

    for (const course of courses) {
      const actual = actualCourseResults[course.id];
      if (actual?.excludedFromGpa || isCourseExcludedFromGpa(course) || course.credits <= 0) {
        continue;
      }

      if (actual && actual.gpa !== null) {
        actualQualityPoints += actual.gpa * course.credits;
        actualCreditsCounted += course.credits;
      }

      const chosenLetter = goalLetters[course.id] || actual?.letter || 'A';
      const entry = gradeScale.find((g) => g.letter === chosenLetter);
      if (entry) {
        const boost = getCourseGpaBoost(course);
        if (boost > 0) hasWeighted = true;
        const wPoints = entry.gpa >= 2.0 ? entry.gpa + boost : entry.gpa;
        qualityPoints += entry.gpa * course.credits;
        weightedQualityPoints += wPoints * course.credits;
        creditsCounted += course.credits;
      }
    }

    const plannedTermGpa = creditsCounted > 0 ? qualityPoints / creditsCounted : null;
    const plannedWeightedTermGpa =
      creditsCounted > 0 ? weightedQualityPoints / creditsCounted : null;
    const actualTermGpa =
      actualCreditsCounted > 0 ? actualQualityPoints / actualCreditsCounted : null;

    const totalCumCredits = priorCredits + creditsCounted;
    const plannedCumGpa =
      totalCumCredits > 0
        ? (priorGpa * priorCredits + qualityPoints) / totalCumCredits
        : plannedTermGpa;

    return {
      plannedTermGpa,
      plannedWeightedTermGpa,
      hasWeighted,
      actualTermGpa,
      plannedCumGpa,
      creditsCounted,
    };
  }, [courses, actualCourseResults, goalLetters, gradeScale, priorGpa, priorCredits]);

  if (courses.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-10 text-center text-sm text-slate-600 dark:text-slate-400">
        Add at least one course in the active term to use the Target &amp; GPA Calculator.
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {/* Section 1: Reverse Required-Score Solver */}
      <section className="glass-panel rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Required Score Calculator
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Solve for the exact score needed on your final exam or remaining work to reach a target course grade.
            </p>
          </div>
          {activeCourse && (
            <button
              type="button"
              onClick={() => onSelectCourse(activeCourse.id)}
              className="text-xs font-medium text-blue-700 dark:text-sky-400 hover:text-blue-900 dark:hover:text-sky-300 transition-colors whitespace-nowrap"
            >
              Open {activeCourse.code} Ledger →
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/70 dark:divide-white/10">
          {/* Controls Column */}
          <div className="lg:col-span-5 p-4 sm:p-6 space-y-5">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Course
              </label>
              <select
                value={activeCourse?.id || ''}
                onChange={(e) => {
                  setSelectedCourseId(e.target.value);
                  setTargetScope('all-ungraded');
                }}
                className="w-full px-3 py-2 text-sm bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
              >
                {courses.map((c) => {
                  const res = displayCourseResults[c.id];
                  return (
                    <option key={c.id} value={c.id} className="bg-white dark:bg-slate-900">
                      {c.code} — {c.name} ({formatPercent(res?.percentage ?? null)})
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Assignment to Solve For
              </label>
              <select
                value={validScope}
                onChange={(e) => setTargetScope(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
              >
                <option value="all-ungraded" className="bg-white dark:bg-slate-900">
                  All Remaining Ungraded Assignments
                </option>
                {activeResult?.effectiveAssignments
                  .filter((a) => !a.isRemoved && !a.excused && !a.extraCredit)
                  .map((a) => (
                    <option key={a.id} value={a.id} className="bg-white dark:bg-slate-900">
                      {a.title} ({a.earned === null ? 'Upcoming' : `${a.earned}/${a.possible} pts`})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="target-percent-input"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Desired Final Course Grade
                </label>
                <span className="font-mono text-xs font-semibold text-blue-700 dark:text-sky-400 tabular-nums">
                  {targetPercent.toFixed(1)}%
                </span>
              </div>

              {/* Letter Presets */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {gradeScale
                  .filter((g) => g.minPercent >= 70)
                  .map((g) => {
                    const isSelected = Math.abs(targetPercent - g.minPercent) < 0.05;
                    return (
                      <button
                        key={g.letter}
                        type="button"
                        onClick={() => setTargetPercent(g.minPercent)}
                        className={`px-2.5 py-1 text-xs font-mono font-medium rounded-lg border transition-colors ${
                          isSelected
                            ? 'bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950 border-blue-600 dark:border-sky-500'
                            : 'bg-white/60 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-white/10 hover:bg-white dark:hover:bg-white/[0.09]'
                        }`}
                      >
                        {g.letter} ({g.minPercent}%)
                      </button>
                    );
                  })}
              </div>

              <input
                id="target-percent-input"
                type="number"
                step="0.5"
                min={0}
                max={105}
                value={targetPercent}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!Number.isNaN(val)) setTargetPercent(val);
                }}
                className="w-full px-3 py-2 font-mono text-sm bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30 tabular-nums"
              />
            </div>
          </div>

          {/* Computed Answer Column */}
          <div className="lg:col-span-7 p-4 sm:p-6 flex flex-col justify-between bg-slate-50/40 dark:bg-white/[0.02]">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Required Score
              </div>

              {solveResult?.status === 'no-target' && (
                <div className="mt-3">
                  <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                    No ungraded assignments remaining
                  </div>
                  <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                    All regular assignments in this course already have scores. Select a specific
                    assignment to test what score would change your grade, or add a hypothetical
                    assignment.
                  </p>
                </div>
              )}

              {solveResult?.status === 'secured' && (
                <div className="mt-3">
                  <div className="font-mono text-4xl font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    0.0%
                  </div>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                    Your target of{' '}
                    <strong className="font-mono text-slate-900 dark:text-slate-100">
                      {formatPercent(targetPercent)}
                    </strong>{' '}
                    is already secured. Even scoring 0% leaves you at{' '}
                    <strong className="font-mono text-slate-900 dark:text-slate-100">
                      {formatPercent(solveResult.projectedFinalIfZero)}
                    </strong>
                    .
                  </p>
                </div>
              )}

              {solveResult?.status === 'impossible' && (
                <div className="mt-3">
                  <div className="text-2xl font-semibold text-rose-700 dark:text-rose-400">
                    Unreachable
                  </div>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                    Even scoring 100% on the selected work brings your course grade to{' '}
                    <strong className="font-mono text-slate-900 dark:text-slate-100">
                      {formatPercent(solveResult.projectedFinalIfPerfect)}
                    </strong>
                    , which is below {formatPercent(targetPercent)}.
                  </p>
                </div>
              )}

              {solveResult &&
                (solveResult.status === 'achievable' ||
                  solveResult.status === 'stretch' ||
                  solveResult.status === 'extra-credit') &&
                solveResult.requiredPercent !== null && (
                  <div className="mt-2">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span
                        className={`font-mono text-4xl font-semibold tabular-nums ${
                          solveResult.status === 'extra-credit'
                            ? 'text-rose-700 dark:text-rose-400'
                            : solveResult.status === 'stretch'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {formatPercent(solveResult.requiredPercent)}
                      </span>
                      {solveResult.requiredPoints !== null &&
                        solveResult.possiblePoints !== null && (
                          <span className="font-mono text-base text-slate-500 dark:text-slate-400 tabular-nums">
                            ({solveResult.requiredPoints} / {solveResult.possiblePoints} points)
                          </span>
                        )}
                    </div>

                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      {solveResult.status === 'extra-credit' &&
                        'Requires scoring above 100% (extra credit or curve needed).'}
                      {solveResult.status === 'stretch' &&
                        'Achievable, though it requires a near-perfect score above 94%.'}
                      {solveResult.status === 'achievable' &&
                        'Within realistic reach based on your current category averages.'}
                    </p>

                    {activeCourse && (
                      <button
                        type="button"
                        onClick={() =>
                          onSimulateTargetScore(
                            activeCourse.id,
                            solveResult.targetAssignmentIds,
                            solveResult.requiredPercent as number
                          )
                        }
                        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 rounded-xl transition-colors whitespace-nowrap"
                      >
                        Apply Score in Hypothetical Mode
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
            </div>

            {/* Possible Range Visualization */}
            {solveResult &&
              solveResult.projectedFinalIfZero !== null &&
              solveResult.projectedFinalIfPerfect !== null && (
                <div className="mt-6 pt-5 border-t border-slate-200/70 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-2 tabular-nums">
                    <span>
                      Floor (0%):{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                        {formatPercent(solveResult.projectedFinalIfZero)}
                      </strong>
                    </span>
                    <span>
                      Current:{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                        {formatPercent(activeResult?.percentage ?? null)}
                      </strong>
                    </span>
                    <span>
                      Ceiling (100%):{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                        {formatPercent(solveResult.projectedFinalIfPerfect)}
                      </strong>
                    </span>
                  </div>

                  <div className="relative h-2.5 bg-slate-200/80 dark:bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 bg-blue-500/35 dark:bg-sky-400/45 rounded-full"
                      style={{
                        left: `${Math.max(0, Math.min(100, solveResult.projectedFinalIfZero))}%`,
                        width: `${Math.max(
                          1,
                          Math.min(100, solveResult.projectedFinalIfPerfect) -
                            Math.max(0, Math.min(100, solveResult.projectedFinalIfZero))
                        )}%`,
                      }}
                    />
                    <div
                      title={`Target: ${targetPercent}%`}
                      className="absolute top-0 bottom-0 w-0.5 bg-amber-600 dark:bg-amber-400"
                      style={{ left: `${Math.max(0, Math.min(100, targetPercent))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Shaded band shows your achievable final course grade range from 0% to 100% on the selected work. Vertical amber marker indicates your target ({formatPercent(targetPercent)}).
                  </div>
                </div>
              )}
          </div>
        </div>
      </section>

      {/* Section 2: Semester GPA Scenario Planner */}
      <section className="glass-panel rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Term &amp; Cumulative GPA Planner
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Pick target letter grades for each course to preview your resulting Term and Cumulative GPA.
            </p>
          </div>
          {Object.keys(goalLetters).length > 0 && (
            <button
              type="button"
              onClick={() => setGoalLetters({})}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to Current
            </button>
          )}
        </div>

        {/* GPA Output Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/70 dark:divide-white/10 border-b border-slate-200/70 dark:border-white/10 bg-slate-50/40 dark:bg-white/[0.02]">
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Planned Term GPA</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatGpa(gpaPlan.plannedTermGpa)}
              </span>
              {gpaPlan.actualTermGpa !== null &&
                gpaPlan.plannedTermGpa !== null &&
                Math.abs(gpaPlan.plannedTermGpa - gpaPlan.actualTermGpa) >= 0.005 && (
                  <span
                    className={`font-mono text-xs font-medium tabular-nums ${
                      gpaPlan.plannedTermGpa > gpaPlan.actualTermGpa
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatSignedDelta(gpaPlan.plannedTermGpa - gpaPlan.actualTermGpa, '', 2)} vs current
                  </span>
                )}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {gpaPlan.hasWeighted && priorCredits <= 0
                ? 'Planned Weighted GPA'
                : 'Projected Cumulative GPA'}
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {gpaPlan.hasWeighted && priorCredits <= 0
                ? formatGpa(gpaPlan.plannedWeightedTermGpa)
                : formatGpa(gpaPlan.plannedCumGpa)}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Credit Basis</div>
            <div className="mt-1 font-mono text-sm text-slate-700 dark:text-slate-300 tabular-nums">
              {gpaPlan.creditsCounted} term credits · {priorCredits} prior ({formatGpa(priorGpa)} GPA)
            </div>
          </div>
        </div>

        {/* Course Target Letter Matrix */}
        <div className="divide-y divide-slate-200/60 dark:divide-white/[0.06]">
          {courses.map((course) => {
            const actual = actualCourseResults[course.id];
            const selectedLetter = goalLetters[course.id] || actual?.letter || 'A';
            const selectedEntry = gradeScale.find((g) => g.letter === selectedLetter);

            return (
              <div
                key={course.id}
                className="px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400 mr-2">
                      {course.code}
                    </span>
                    {course.name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    {course.credits.toFixed(1)} credits · Current:{' '}
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {formatPercent(actual?.percentage ?? null)} ({actual?.letter ?? '—'})
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                  <div className="flex items-center gap-1 flex-wrap">
                    {gradeScale
                      .filter((g) => g.minPercent >= 70 || g.letter === 'F')
                      .map((g) => {
                        const isActive = selectedLetter === g.letter;
                        return (
                          <button
                            key={g.letter}
                            type="button"
                            onClick={() =>
                              setGoalLetters((prev) => ({ ...prev, [course.id]: g.letter }))
                            }
                            className={`px-2 py-1 font-mono text-xs rounded-lg border transition-colors ${
                              isActive
                                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 border-slate-900 dark:border-sky-500 font-semibold'
                                : 'bg-white/60 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-white/10 hover:bg-white dark:hover:bg-white/[0.1]'
                            }`}
                          >
                            {g.letter}
                          </button>
                        );
                      })}
                  </div>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums w-12 text-right">
                    {selectedEntry ? selectedEntry.gpa.toFixed(1) : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
