import React, { memo, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  Fingerprint,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import {
  Course,
  CourseResult,
  EdupointSessionInfo,
  Term,
  TermSummary,
} from '../types/grades';
import { SavedLoginSummary } from '../utils/credentialVault';
import {
  cleanAssignmentDisplayTitle,
  formatGpa,
  formatPercent,
  getEffectiveCourseLevel,
  getGradeToneClass,
  isCourseExcludedFromGpa,
} from '../utils/gradeMath';

interface OverviewViewProps {
  courses: Course[];
  actualCourseResults: Record<string, CourseResult>;
  actualSummary: TermSummary;
  terms: Term[];
  activeTermId: string;
  edupointSession: EdupointSessionInfo | null;
  savedLogin: SavedLoginSummary | null;
  isSyncingEdupoint: boolean;
  isQuickSigningIn: boolean;
  edupointSyncError: string | null;
  edupointNotice: string | null;
  schoolName: string;
  showGpaOnOverview: boolean;
  onSelectTerm: (termId: string) => void;
  onSyncEdupoint: (reportPeriodIndex?: string) => void;
  onQuickSignIn: (useFingerprint: boolean) => void;
  onOpenEdupointModal: () => void;
  onOpenAddCourse: () => void;
  onOpenAddTerm: () => void;
  onSelectCourse: (courseId: string) => void;
}

const OverviewViewInner: React.FC<OverviewViewProps> = ({
  courses,
  actualCourseResults,
  actualSummary,
  terms,
  activeTermId,
  edupointSession,
  savedLogin,
  isSyncingEdupoint,
  isQuickSigningIn,
  edupointSyncError,
  edupointNotice,
  schoolName,
  showGpaOnOverview,
  onSelectTerm,
  onSyncEdupoint,
  onQuickSignIn,
  onOpenEdupointModal,
  onOpenAddCourse,
  onOpenAddTerm,
  onSelectCourse,
}) => {
  const [showDetailedMetrics, setShowDetailedMetrics] = useState(false);

  // Top 3 newly graded assignments across all courses (actual grades only)
  const recentlyGradedAssignments = useMemo(() => {
    const list: Array<{
      id: string;
      course: Course;
      title: string;
      earned: number;
      possible: number;
      dueDate: string;
    }> = [];

    for (const course of courses) {
      const res = actualCourseResults[course.id];
      if (!res) continue;
      const catMap = new Map(course.categories.map((c) => [c.id, c.name]));
      res.effectiveAssignments.forEach((a, idx) => {
        if (!a.isRemoved && !a.excused && a.earned !== null && a.possible > 0) {
          list.push({
            id: `${course.id}-${a.id}`,
            course,
            title: cleanAssignmentDisplayTitle(a.title, catMap.get(a.categoryId), idx),
            earned: a.earned,
            possible: a.possible,
            dueDate: a.dueDate || '',
          });
        }
      });
    }

    return list
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
      .slice(0, 3);
  }, [courses, actualCourseResults]);

  // Recent missing assignments (minimalist list format, actual grades only)
  const missingAssignments = useMemo(() => {
    const list: Array<{
      id: string;
      course: Course;
      title: string;
      possible: number;
      dueDate: string;
    }> = [];

    for (const course of courses) {
      const res = actualCourseResults[course.id];
      if (!res) continue;
      const catMap = new Map(course.categories.map((c) => [c.id, c.name]));
      res.effectiveAssignments.forEach((a, idx) => {
        if (!a.isRemoved && !a.excused && a.earned === 0 && a.possible > 0) {
          list.push({
            id: `${course.id}-${a.id}`,
            course,
            title: cleanAssignmentDisplayTitle(a.title, catMap.get(a.categoryId), idx),
            possible: a.possible,
            dueDate: a.dueDate || '',
          });
        }
      });
    }

    return list
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
      .slice(0, 6);
  }, [courses, actualCourseResults]);

  const hasWeightedDiff =
    actualSummary.weightedTermGpa !== null &&
    actualSummary.termGpa !== null &&
    Math.abs(actualSummary.weightedTermGpa - actualSummary.termGpa) >= 0.005;

  const syncedTimeLabel = edupointSession?.syncedAt
    ? new Date(edupointSession.syncedAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Compact Account / Grading Period / Sync Controls (replaces removed sidebar) */}
      <section
        aria-label="Grading period and sync controls"
        className="glass-panel rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          {edupointSession && edupointSession.reportingPeriods.length > 0 ? (
            <select
              aria-label="Select Edupoint grading period"
              disabled={isSyncingEdupoint}
              value={edupointSession.activePeriodIndex}
              onChange={(e) => onSyncEdupoint(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
            >
              {edupointSession.reportingPeriods.map((rp) => (
                <option key={rp.index} value={rp.index} className="bg-white dark:bg-slate-900">
                  {rp.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Select academic term"
                value={activeTermId}
                onChange={(e) => onSelectTerm(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                {terms.map((t) => (
                  <option key={t.id} value={t.id} className="bg-white dark:bg-slate-900">
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onOpenAddTerm}
                title="Add new term"
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white/70 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
              >
                + Term
              </button>
            </div>
          )}

          {edupointSession ? (
            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {edupointSession.studentInfo.name}
              </span>
              {syncedTimeLabel ? ` · Synced ${syncedTimeLabel}` : ''}
            </span>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {schoolName} · Edupoint StudentVUE
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {edupointSession ? (
            <button
              type="button"
              onClick={() => onSyncEdupoint()}
              disabled={isSyncingEdupoint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-sky-300 bg-blue-50/80 dark:bg-sky-500/15 hover:bg-blue-100/80 dark:hover:bg-sky-500/25 border border-blue-200/80 dark:border-sky-400/25 rounded-xl transition-colors whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingEdupoint ? 'animate-spin' : ''}`} />
              {isSyncingEdupoint ? 'Syncing...' : 'Sync Grades'}
            </button>
          ) : savedLogin ? (
            <button
              type="button"
              onClick={() => onQuickSignIn(savedLogin.biometricEnabled)}
              disabled={isQuickSigningIn}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 rounded-xl transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {isQuickSigningIn ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : savedLogin.biometricEnabled ? (
                <Fingerprint className="w-3.5 h-3.5" />
              ) : (
                <KeyRound className="w-3.5 h-3.5" />
              )}
              {isQuickSigningIn ? 'Signing in...' : 'Sync Saved Login'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenEdupointModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 rounded-xl transition-colors whitespace-nowrap"
            >
              <Link2 className="w-3.5 h-3.5" />
              Connect StudentVUE
            </button>
          )}

          <button
            type="button"
            onClick={onOpenAddCourse}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Class
          </button>
        </div>
      </section>

      {(edupointSyncError || edupointNotice) && (
        <div
          className={`px-4 py-3 rounded-xl text-xs border ${
            edupointSyncError
              ? 'bg-rose-50/90 dark:bg-rose-500/15 border-rose-200 dark:border-rose-400/30 text-rose-700 dark:text-rose-300'
              : 'bg-blue-50/90 dark:bg-sky-500/15 border-blue-200 dark:border-sky-400/30 text-blue-800 dark:text-sky-200'
          }`}
        >
          {edupointSyncError || edupointNotice}
        </div>
      )}

      {courses.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            No classes in this grading period yet
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            Connect your {schoolName} Edupoint (StudentVUE) account to sync your real classes, teacher names, and assignments automatically.
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
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
            >
              Add Class Manually
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* SECTION 1 (TOP): Classes & Grades + GPA Box */}
          <section aria-label="Classes and grades" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 px-0.5">
              <div>
                <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                  Classes &amp; Grades
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Select a class to view its grade chart, assignments, and What-If calculator.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDetailedMetrics((prev) => !prev)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
              >
                {showDetailedMetrics ? 'Compact View' : 'Detailed GPA & Metrics'}
              </button>
            </div>

            {/* GPA Box */}
            {showGpaOnOverview && (
              <div className="glass-panel rounded-2xl p-4 sm:p-5">
                <div
                  className={`grid grid-cols-2 ${
                    hasWeightedDiff ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
                  } gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/70 dark:divide-white/[0.08]`}
                >
                  <div className="pt-1 sm:pt-0">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Term GPA
                    </div>
                    <div className="mt-1 font-mono text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                      {formatGpa(actualSummary.termGpa)}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Unweighted 4.0 scale
                    </div>
                  </div>

                  {hasWeightedDiff && (
                    <div className="pt-3 sm:pt-0 sm:pl-4">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Weighted GPA
                      </div>
                      <div className="mt-1 font-mono text-2xl sm:text-3xl font-bold tracking-tight text-blue-700 dark:text-sky-400 tabular-nums">
                        {formatGpa(actualSummary.weightedTermGpa)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Includes AP / Honors boost
                      </div>
                    </div>
                  )}

                  <div className="pt-3 sm:pt-0 sm:pl-4">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Average Grade
                    </div>
                    <div className="mt-1 font-mono text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                      {formatPercent(actualSummary.averagePercent)}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      {courses.length} {courses.length === 1 ? 'class' : 'classes'} ·{' '}
                      {actualSummary.totalCredits.toFixed(0)} credits
                    </div>
                  </div>

                  <div className="pt-3 sm:pt-0 sm:pl-4">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Graded Work
                    </div>
                    <div className="mt-1 font-mono text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                      {actualSummary.gradedAssignments}
                      <span className="text-base font-medium text-slate-400 dark:text-slate-500">
                        /{actualSummary.totalAssignments}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {actualSummary.cumulativeGpa !== null &&
                      actualSummary.cumulativeGpa !== actualSummary.termGpa
                        ? `Cumulative GPA: ${formatGpa(actualSummary.cumulativeGpa)}`
                        : 'Scored assignments'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Class Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {courses.map((course) => {
                const res = actualCourseResults[course.id];
                const level = getEffectiveCourseLevel(course);
                const isBoosted = level === 'ap' || level === 'honors';
                const excludedGpa = isCourseExcludedFromGpa(course);

                return (
                  <button
                    key={course.id}
                    type="button"
                    onClick={() => onSelectCourse(course.id)}
                    className="glass-panel rounded-2xl p-4 text-left hover:border-blue-500/40 dark:hover:border-sky-400/40 transition-all flex flex-col justify-between gap-3.5 group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {course.code}
                          {isBoosted ? ` · ${level.toUpperCase()}` : ''}
                        </div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5 truncate group-hover:text-blue-600 dark:group-hover:text-sky-400 transition-colors">
                          {course.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                          {course.instructor}
                        </div>
                      </div>

                      <div className="text-right shrink-0 tabular-nums">
                        <div
                          className={`font-mono text-xl font-bold leading-tight ${getGradeToneClass(
                            res?.percentage ?? null
                          )}`}
                        >
                          {res?.letter ?? '—'}
                        </div>
                        <div className="font-mono text-xs text-slate-600 dark:text-slate-300 font-semibold mt-0.5">
                          {formatPercent(res?.percentage ?? null)}
                        </div>
                      </div>
                    </div>

                    {showDetailedMetrics && res && (
                      <div className="pt-2.5 border-t border-slate-200/60 dark:border-white/[0.06] grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums">
                        <div>
                          <div className="text-slate-400 dark:text-slate-500 font-sans">GPA</div>
                          <div className="text-slate-800 dark:text-slate-200 font-semibold">
                            {excludedGpa ? 'Excluded' : formatGpa(res.gpa)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400 dark:text-slate-500 font-sans">Credits</div>
                          <div className="text-slate-800 dark:text-slate-200 font-semibold">
                            {course.credits.toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400 dark:text-slate-500 font-sans">Graded</div>
                          <div className="text-slate-800 dark:text-slate-200 font-semibold">
                            {res.gradedCount}/{res.totalCount}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-white/[0.06] text-xs text-slate-500 dark:text-slate-400">
                      <span className="tabular-nums">
                        {res?.gradedCount ?? 0} of {res?.totalCount ?? 0} graded
                      </span>
                      <span className="inline-flex items-center gap-1 text-blue-600 dark:text-sky-400 font-medium group-hover:translate-x-0.5 transition-transform">
                        Open Class <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* SECTION 2 (SECOND): Recently Graded Assignments (Top 3) */}
          <section
            aria-label="Recently graded assignments"
            className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Recently Graded Assignments
                </h2>
              </div>
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                Latest {recentlyGradedAssignments.length}
              </span>
            </div>

            {recentlyGradedAssignments.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                No graded assignments recorded yet for this grading period.
              </p>
            ) : (
              <div className="divide-y divide-slate-200/60 dark:divide-white/[0.06]">
                {recentlyGradedAssignments.map((item) => {
                  const pct = (item.earned / item.possible) * 100;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectCourse(item.course.id)}
                      className="w-full text-left py-2.5 px-1.5 flex items-center justify-between gap-3 hover:bg-white/50 dark:hover:bg-white/[0.04] transition-colors rounded-lg"
                    >
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {item.course.code} · {item.course.name}
                          {item.dueDate ? ` · ${item.dueDate}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono text-xs tabular-nums">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {item.earned} / {item.possible}
                        </div>
                        <div className={`text-[11px] font-medium ${getGradeToneClass(pct)}`}>
                          {pct.toFixed(1)}%
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 3 (THIRD): Recent Missing Assignments (Minimalist List) */}
          <section
            aria-label="Recent missing assignments"
            className={`glass-panel rounded-2xl p-4 sm:p-5 space-y-3 ${
              missingAssignments.length > 0
                ? 'border-rose-200/70 dark:border-rose-500/30'
                : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle
                  className={`w-4 h-4 shrink-0 ${
                    missingAssignments.length > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Recent Missing Assignments
                </h2>
              </div>
              {missingAssignments.length > 0 && (
                <span className="font-mono text-xs font-semibold text-rose-700 dark:text-rose-400 tabular-nums">
                  {missingAssignments.length}
                </span>
              )}
            </div>

            {missingAssignments.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-1">
                You&apos;re all caught up — no missing assignments detected.
              </p>
            ) : (
              <div className="divide-y divide-slate-200/60 dark:divide-white/[0.06]">
                {missingAssignments.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelectCourse(m.course.id)}
                    className="w-full text-left py-2 px-1.5 flex items-center justify-between gap-3 hover:bg-white/50 dark:hover:bg-white/[0.04] transition-colors rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {m.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {m.course.code} · {m.course.name}
                        {m.dueDate ? ` · Due ${m.dueDate}` : ''}
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold text-rose-700 dark:text-rose-400 shrink-0 tabular-nums">
                      0 / {m.possible} pts
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export const OverviewView = memo(OverviewViewInner);
