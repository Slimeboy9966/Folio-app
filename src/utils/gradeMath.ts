import {
  Assignment,
  CategoryResult,
  Course,
  CourseLevel,
  CourseResult,
  GradeScaleEntry,
  HypotheticalOverlay,
  TermSummary,
} from '../types/grades';

export const EMPTY_OVERLAY: HypotheticalOverlay = {
  edits: {},
  addedAssignments: {},
  removedAssignmentKeys: {},
};

export function makeAssignmentKey(courseId: string, assignmentId: string): string {
  return `${courseId}:${assignmentId}`;
}

const NON_GPA_MARK_SET = new Set([
  'P',
  'PASS',
  'CR',
  'CREDIT',
  'NC',
  'NP',
  'NM',
  'NG',
  'I',
  'INC',
  'W',
  'WD',
  'S',
  'U',
  'N/A',
  'NA',
  '—',
  '-',
  '--',
]);

const NON_GPA_COURSE_NAME_REGEX =
  /\b(access|advisory|homeroom|study\s*hall|unscheduled|open\s*period|free\s*period|teacher\s*aide|office\s*aide|library\s*aide|student\s*aide|peer\s*tutor|ta|attendance\s*aide|counseling\s*aide)\b/i;

const AP_COURSE_REGEX = /\b(ap|advanced\s+placement|ib|dual\s+enroll(?:ment)?)\b/i;
const HONORS_COURSE_REGEX = /\b(honors?|hon)\b|\(h\)|^h\s+[a-z]|[a-z]\s+h$/i;

export function detectCourseLevel(courseName: string): CourseLevel {
  const name = (courseName || '').trim();
  if (!name) return 'regular';
  if (AP_COURSE_REGEX.test(name)) return 'ap';
  if (HONORS_COURSE_REGEX.test(name)) return 'honors';
  return 'regular';
}

export function getEffectiveCourseLevel(course: Course): CourseLevel {
  return course.courseLevel ?? detectCourseLevel(course.name);
}

export function getCourseGpaBoost(course: Course): number {
  const level = getEffectiveCourseLevel(course);
  return level === 'ap' || level === 'honors' ? 1.0 : 0;
}

export function isNonGpaMark(rawLetter?: string | null): boolean {
  if (!rawLetter) return false;
  return NON_GPA_MARK_SET.has(rawLetter.trim().toUpperCase());
}

export function isCourseExcludedFromGpa(course: Course): boolean {
  if (typeof course.excludeFromGpa === 'boolean') return course.excludeFromGpa;
  if (course.credits <= 0) return true;
  if (isNonGpaMark(course.officialLetter)) return true;
  if (NON_GPA_COURSE_NAME_REGEX.test(course.name || '')) return true;
  return false;
}

export function getGpaForLetter(
  rawLetter: string | null | undefined,
  scale: GradeScaleEntry[]
): { letter: string; gpa: number | null; isPassFail: boolean } {
  const cleaned = (rawLetter || '').trim().toUpperCase();
  if (!cleaned) return { letter: '—', gpa: null, isPassFail: false };
  if (NON_GPA_MARK_SET.has(cleaned)) {
    return { letter: cleaned, gpa: null, isPassFail: true };
  }

  // Exact letter match (e.g. A-, B+, A+)
  const exact = scale.find((e) => e.letter.trim().toUpperCase() === cleaned);
  if (exact) return { letter: exact.letter, gpa: exact.gpa, isPassFail: false };

  // Base letter fallback (e.g. A+ -> A, D- -> D)
  const baseChar = cleaned.charAt(0);
  if (['A', 'B', 'C', 'D', 'F'].includes(baseChar)) {
    const baseEntry = scale.find((e) => e.letter.trim().toUpperCase() === baseChar);
    if (baseEntry) return { letter: cleaned, gpa: baseEntry.gpa, isPassFail: false };
    const fallbackMap: Record<string, number> = { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 };
    return { letter: cleaned, gpa: fallbackMap[baseChar] ?? 0, isPassFail: false };
  }

  return { letter: cleaned, gpa: null, isPassFail: true };
}

export function getLetterAndGpa(
  percentage: number | null,
  scale: GradeScaleEntry[]
): { letter: string; gpa: number | null } {
  if (percentage === null || Number.isNaN(percentage)) {
    return { letter: '—', gpa: null };
  }
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  // Round to 2 decimal places to match standard LMS display thresholds
  const rounded = Math.round(percentage * 100) / 100;
  for (const entry of sorted) {
    if (rounded >= entry.minPercent) {
      return { letter: entry.letter, gpa: entry.gpa };
    }
  }
  const lowest = sorted[sorted.length - 1];
  return lowest ? { letter: lowest.letter, gpa: lowest.gpa } : { letter: 'F', gpa: 0 };
}

export function countOverlayChanges(overlay: HypotheticalOverlay, courseId?: string): number {
  let count = 0;
  for (const key of Object.keys(overlay.edits)) {
    if (!courseId || key.startsWith(`${courseId}:`)) {
      count += 1;
    }
  }
  for (const key of Object.keys(overlay.removedAssignmentKeys)) {
    if (overlay.removedAssignmentKeys[key] && (!courseId || key.startsWith(`${courseId}:`))) {
      count += 1;
    }
  }
  if (courseId) {
    count += (overlay.addedAssignments[courseId] || []).length;
  } else {
    for (const list of Object.values(overlay.addedAssignments)) {
      count += list.length;
    }
  }
  return count;
}

export function computeCourseResult(
  course: Course,
  scale: GradeScaleEntry[],
  overlay?: HypotheticalOverlay | null
): CourseResult {
  const effectiveList: CourseResult['effectiveAssignments'] = [];
  let modifiedCount = 0;

  for (const base of course.assignments) {
    const key = makeAssignmentKey(course.id, base.id);
    const edit = overlay?.edits[key];
    const isRemoved = Boolean(overlay?.removedAssignmentKeys[key]);

    const earned = edit && 'earned' in edit ? (edit.earned ?? null) : base.earned;
    const possible = edit && edit.possible !== undefined ? edit.possible : base.possible;
    const excused = edit && edit.excused !== undefined ? edit.excused : Boolean(base.excused);
    const extraCredit =
      edit && edit.extraCredit !== undefined ? edit.extraCredit : Boolean(base.extraCredit);

    const isModified =
      isRemoved ||
      earned !== base.earned ||
      possible !== base.possible ||
      excused !== Boolean(base.excused) ||
      extraCredit !== Boolean(base.extraCredit);

    if (isModified) {
      modifiedCount += 1;
    }

    effectiveList.push({
      ...base,
      earned,
      possible,
      excused,
      extraCredit,
      isModified,
      isRemoved,
      originalEarned: base.earned,
      originalPossible: base.possible,
      originalExcused: Boolean(base.excused),
      isDropped: false,
    });
  }

  const added = overlay?.addedAssignments[course.id] || [];
  for (const extra of added) {
    modifiedCount += 1;
    effectiveList.push({
      ...extra,
      isHypotheticalOnly: true,
      isModified: true,
      isRemoved: false,
      originalEarned: null,
      originalPossible: extra.possible,
      originalExcused: false,
      isDropped: false,
    });
  }

  const activeAssignments = effectiveList.filter((a) => !a.isRemoved);
  const droppedSet = new Set<string>();

  const categoryResults: CategoryResult[] = course.categories.map((category) => {
    const catAssignments = activeAssignments.filter((a) => a.categoryId === category.id);
    const nonExcused = catAssignments.filter((a) => !a.excused);
    const gradedRegular = nonExcused.filter(
      (a) => a.earned !== null && !a.extraCredit && a.possible > 0
    );
    const gradedExtra = nonExcused.filter((a) => a.earned !== null && a.extraCredit);

    const dropCount = Math.max(0, category.dropLowest || 0);
    const droppedIds: string[] = [];

    if (dropCount > 0 && gradedRegular.length > dropCount) {
      // Drop the lowest percentage regular assignments
      const ranked = [...gradedRegular].sort((a, b) => {
        const pctA = (a.earned as number) / a.possible;
        const pctB = (b.earned as number) / b.possible;
        if (pctA !== pctB) return pctA - pctB;
        // Tie-breaker: drop higher possible points if ratio < 100%, else lower
        return b.possible - a.possible;
      });
      for (let i = 0; i < dropCount; i++) {
        droppedIds.push(ranked[i].id);
        droppedSet.add(ranked[i].id);
      }
    }

    const keptRegular = gradedRegular.filter((a) => !droppedIds.includes(a.id));

    const earnedPoints =
      keptRegular.reduce((sum, a) => sum + (a.earned as number), 0) +
      gradedExtra.reduce((sum, a) => sum + (a.earned as number), 0);
    const possiblePoints = keptRegular.reduce((sum, a) => sum + a.possible, 0);

    const percentage = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : null;

    return {
      category,
      earnedPoints,
      possiblePoints,
      percentage,
      gradedCount: gradedRegular.length + gradedExtra.length,
      totalCount: nonExcused.length,
      droppedAssignmentIds: droppedIds,
      effectiveWeight: 0,
      contribution: 0,
    };
  });

  // Mark dropped flags on effective assignments
  for (const item of effectiveList) {
    if (droppedSet.has(item.id)) {
      item.isDropped = true;
    }
  }

  let overallPercentage: number | null = null;
  let gradedWeightPercent = 0;

  if (course.gradingMode === 'weighted') {
    const totalConfiguredWeight = course.categories.reduce((sum, c) => sum + c.weight, 0);
    const gradedCats = categoryResults.filter((cr) => cr.percentage !== null && cr.category.weight > 0);
    const gradedWeightSum = gradedCats.reduce((sum, cr) => sum + cr.category.weight, 0);

    if (gradedWeightSum > 0) {
      let weightedSum = 0;
      for (const cr of categoryResults) {
        if (cr.percentage !== null && cr.category.weight > 0) {
          cr.effectiveWeight = (cr.category.weight / gradedWeightSum) * 100;
          cr.contribution = (cr.percentage * cr.effectiveWeight) / 100;
          weightedSum += cr.contribution;
        }
      }
      overallPercentage = weightedSum;
    }

    // Estimate % of total syllabus weight completed based on proportion of points graded per category
    if (totalConfiguredWeight > 0) {
      let completedWeight = 0;
      for (const cr of categoryResults) {
        const catAllRegular = activeAssignments.filter(
          (a) => a.categoryId === cr.category.id && !a.excused && !a.extraCredit && a.possible > 0
        );
        const totalCatPossible = catAllRegular.reduce((sum, a) => sum + a.possible, 0);
        const gradedCatPossible = catAllRegular
          .filter((a) => a.earned !== null)
          .reduce((sum, a) => sum + a.possible, 0);
        if (totalCatPossible > 0) {
          completedWeight += cr.category.weight * (gradedCatPossible / totalCatPossible);
        }
      }
      gradedWeightPercent = Math.min(100, (completedWeight / totalConfiguredWeight) * 100);
    }
  } else {
    // Total Points mode
    const totalEarned = categoryResults.reduce((sum, cr) => sum + cr.earnedPoints, 0);
    const totalPossible = categoryResults.reduce((sum, cr) => sum + cr.possiblePoints, 0);

    if (totalPossible > 0) {
      overallPercentage = (totalEarned / totalPossible) * 100;
      for (const cr of categoryResults) {
        cr.effectiveWeight = (cr.possiblePoints / totalPossible) * 100;
        cr.contribution = (cr.earnedPoints / totalPossible) * 100;
      }
    }

    const allNonExcusedRegular = activeAssignments.filter(
      (a) => !a.excused && !a.extraCredit && a.possible > 0
    );
    const allPossibleSum = allNonExcusedRegular.reduce((sum, a) => sum + a.possible, 0);
    const gradedPossibleSum = allNonExcusedRegular
      .filter((a) => a.earned !== null)
      .reduce((sum, a) => sum + a.possible, 0);
    gradedWeightPercent = allPossibleSum > 0 ? Math.min(100, (gradedPossibleSum / allPossibleSum) * 100) : 0;
  }

  const gradedCount = activeAssignments.filter((a) => !a.excused && a.earned !== null).length;
  const totalCount = activeAssignments.filter((a) => !a.excused).length;

  // In Actual Grades mode (no hypothetical edits), trust Edupoint's official teacher mark
  // and percentage when present so Folio matches StudentVUE even when a teacher uses custom
  // rounding, drop-lowest rules, or a custom letter scale.
  const hasOfficialPercent =
    course.officialPercent !== undefined &&
    course.officialPercent !== null &&
    !Number.isNaN(course.officialPercent);
  const hasOfficialLetter = Boolean(course.officialLetter && course.officialLetter.trim());

  if (modifiedCount === 0 && course.source === 'edupoint' && hasOfficialPercent) {
    overallPercentage = course.officialPercent as number;
  } else if (overallPercentage === null && modifiedCount === 0 && hasOfficialPercent) {
    overallPercentage = course.officialPercent as number;
  }

  let letter = '—';
  let gpa: number | null = null;

  if (modifiedCount === 0 && course.source === 'edupoint' && hasOfficialLetter) {
    const officialResolved = getGpaForLetter(course.officialLetter, scale);
    letter = officialResolved.letter;
    gpa = officialResolved.gpa;
  } else if (overallPercentage !== null) {
    const computed = getLetterAndGpa(overallPercentage, scale);
    letter = computed.letter;
    gpa = computed.gpa;
  } else if (modifiedCount === 0 && hasOfficialLetter) {
    const officialResolved = getGpaForLetter(course.officialLetter, scale);
    letter = officialResolved.letter;
    gpa = officialResolved.gpa;
  }

  const excludedFromGpa = isCourseExcludedFromGpa(course) || isNonGpaMark(letter);
  const boost = getCourseGpaBoost(course);
  // Standard PUSD / UC / CSU rule: AP & Honors add +1.0 GPA point for C- or higher (gpa >= 2.0)
  const weightedGpa =
    gpa !== null ? (gpa >= 2.0 ? gpa + boost : gpa) : null;

  return {
    percentage: overallPercentage,
    letter,
    gpa,
    weightedGpa,
    excludedFromGpa,
    gradedCount,
    totalCount,
    gradedWeightPercent,
    categoryResults,
    effectiveAssignments: effectiveList,
    modifiedCount,
  };
}

export function computeTermSummary(
  courses: Course[],
  scale: GradeScaleEntry[],
  overlay?: HypotheticalOverlay | null,
  priorGpa = 0,
  priorCredits = 0
): TermSummary {
  let qualityPoints = 0;
  let weightedQualityPoints = 0;
  let gradedCredits = 0;
  let totalCredits = 0;
  let percentWeightedSum = 0;
  let percentCredits = 0;
  let gradedAssignments = 0;
  let totalAssignments = 0;
  let hasWeightedCourses = false;

  for (const course of courses) {
    const res = computeCourseResult(course, scale, overlay);
    gradedAssignments += res.gradedCount;
    totalAssignments += res.totalCount;

    if (!res.excludedFromGpa) {
      totalCredits += course.credits;
    }

    if (!res.excludedFromGpa && course.credits > 0 && res.gpa !== null) {
      qualityPoints += res.gpa * course.credits;
      weightedQualityPoints += (res.weightedGpa ?? res.gpa) * course.credits;
      gradedCredits += course.credits;
      if (getCourseGpaBoost(course) > 0) {
        hasWeightedCourses = true;
      }
    }

    if (!res.excludedFromGpa && course.credits > 0 && res.percentage !== null) {
      percentWeightedSum += res.percentage * course.credits;
      percentCredits += course.credits;
    }
  }

  const termGpa = gradedCredits > 0 ? qualityPoints / gradedCredits : null;
  const weightedTermGpa = gradedCredits > 0 ? weightedQualityPoints / gradedCredits : null;
  const averagePercent = percentCredits > 0 ? percentWeightedSum / percentCredits : null;

  let cumulativeGpa: number | null = termGpa;
  let weightedCumulativeGpa: number | null = weightedTermGpa;
  if (priorCredits > 0) {
    const totalCumCredits = priorCredits + gradedCredits;
    const totalCumPoints = priorGpa * priorCredits + qualityPoints;
    const totalWeightedCumPoints = priorGpa * priorCredits + weightedQualityPoints;
    cumulativeGpa = totalCumCredits > 0 ? totalCumPoints / totalCumCredits : null;
    weightedCumulativeGpa =
      totalCumCredits > 0 ? totalWeightedCumPoints / totalCumCredits : null;
  }

  return {
    termGpa,
    weightedTermGpa,
    cumulativeGpa,
    weightedCumulativeGpa,
    hasWeightedCourses,
    averagePercent,
    totalCredits,
    gradedCredits,
    gradedAssignments,
    totalAssignments,
  };
}

export interface TargetSolveResult {
  requiredPercent: number | null;
  requiredPoints: number | null;
  possiblePoints: number | null;
  status: 'achievable' | 'stretch' | 'extra-credit' | 'secured' | 'impossible' | 'no-target';
  projectedFinalIfZero: number | null;
  projectedFinalIfPerfect: number | null;
  targetAssignmentIds: string[];
}

/**
 * Solves for the uniform percentage required across one specific assignment or all remaining
 * ungraded assignments in a course to achieve `targetCoursePercent`.
 * Uses monotonic binary search over `computeCourseResult` so weighted normalization,
 * points mode, and drop-lowest rules are all handled with exact precision.
 */
export function solveRequiredScore(
  course: Course,
  targetCoursePercent: number,
  targetScope: 'all-ungraded' | string, // assignmentId or 'all-ungraded'
  scale: GradeScaleEntry[],
  baseOverlay?: HypotheticalOverlay | null
): TargetSolveResult {
  const currentRes = computeCourseResult(course, scale, baseOverlay);
  const candidates = currentRes.effectiveAssignments.filter((a) => {
    if (a.isRemoved || a.excused || a.possible <= 0) return false;
    if (targetScope === 'all-ungraded') {
      return a.earned === null && !a.extraCredit;
    }
    return a.id === targetScope;
  });

  if (candidates.length === 0) {
    return {
      requiredPercent: null,
      requiredPoints: null,
      possiblePoints: null,
      status: 'no-target',
      projectedFinalIfZero: currentRes.percentage,
      projectedFinalIfPerfect: currentRes.percentage,
      targetAssignmentIds: [],
    };
  }

  const evaluateAtPercent = (pct: number): number | null => {
    const nextEdits = { ...(baseOverlay?.edits || {}) };
    const nextAdded = { ...(baseOverlay?.addedAssignments || {}) };
    const addedForCourse = [...(nextAdded[course.id] || [])];

    for (const item of candidates) {
      const earnedVal = (pct / 100) * item.possible;
      if (item.isHypotheticalOnly) {
        const idx = addedForCourse.findIndex((a) => a.id === item.id);
        if (idx >= 0) {
          addedForCourse[idx] = { ...addedForCourse[idx], earned: earnedVal };
        }
      } else {
        const key = makeAssignmentKey(course.id, item.id);
        nextEdits[key] = { ...(nextEdits[key] || {}), earned: earnedVal };
      }
    }
    if (addedForCourse.length > 0) {
      nextAdded[course.id] = addedForCourse;
    }

    const testOverlay: HypotheticalOverlay = {
      edits: nextEdits,
      addedAssignments: nextAdded,
      removedAssignmentKeys: baseOverlay?.removedAssignmentKeys || {},
    };
    return computeCourseResult(course, scale, testOverlay).percentage;
  };

  const atZero = evaluateAtPercent(0);
  const atHundred = evaluateAtPercent(100);
  const atMax = evaluateAtPercent(250); // Allow extra-credit check up to 250%

  const singlePossible = candidates.length === 1 ? candidates[0].possible : null;
  const targetIds = candidates.map((c) => c.id);

  if (atZero === null || atHundred === null || atMax === null) {
    return {
      requiredPercent: null,
      requiredPoints: null,
      possiblePoints: singlePossible,
      status: 'no-target',
      projectedFinalIfZero: atZero,
      projectedFinalIfPerfect: atHundred,
      targetAssignmentIds: targetIds,
    };
  }

  if (atZero >= targetCoursePercent - 0.005) {
    return {
      requiredPercent: 0,
      requiredPoints: singlePossible !== null ? 0 : null,
      possiblePoints: singlePossible,
      status: 'secured',
      projectedFinalIfZero: atZero,
      projectedFinalIfPerfect: atHundred,
      targetAssignmentIds: targetIds,
    };
  }

  if (atMax < targetCoursePercent - 0.005) {
    return {
      requiredPercent: null,
      requiredPoints: null,
      possiblePoints: singlePossible,
      status: 'impossible',
      projectedFinalIfZero: atZero,
      projectedFinalIfPerfect: atHundred,
      targetAssignmentIds: targetIds,
    };
  }

  // Binary search in [0, 250]
  let low = 0;
  let high = 250;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const val = evaluateAtPercent(mid) ?? 0;
    if (val >= targetCoursePercent) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const requiredPercent = Math.round(high * 10) / 10;
  const requiredPoints =
    singlePossible !== null ? Math.round(((requiredPercent / 100) * singlePossible) * 10) / 10 : null;

  let status: TargetSolveResult['status'] = 'achievable';
  if (requiredPercent > 100) {
    status = 'extra-credit';
  } else if (requiredPercent > 94) {
    status = 'stretch';
  }

  return {
    requiredPercent,
    requiredPoints,
    possiblePoints: singlePossible,
    status,
    projectedFinalIfZero: atZero,
    projectedFinalIfPerfect: atHundred,
    targetAssignmentIds: targetIds,
  };
}

export function formatPercent(val: number | null, decimals = 1): string {
  if (val === null || Number.isNaN(val)) return '—';
  return `${val.toFixed(decimals)}%`;
}

export function formatGpa(val: number | null): string {
  if (val === null || Number.isNaN(val)) return '—';
  return val.toFixed(2);
}

export function formatSignedDelta(delta: number, suffix = '', decimals = 1): string {
  const rounded = Number(delta.toFixed(decimals));
  if (rounded === 0) return `0${decimals > 0 ? '.' + '0'.repeat(decimals) : ''}${suffix}`;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(decimals)}${suffix}`;
}

export function getGradeToneClass(percentage: number | null): string {
  if (percentage === null) return 'text-slate-400 dark:text-slate-500';
  if (percentage >= 90) return 'text-emerald-700 dark:text-emerald-400';
  if (percentage >= 80) return 'text-blue-700 dark:text-sky-400';
  if (percentage >= 70) return 'text-amber-700 dark:text-amber-400';
  return 'text-rose-700 dark:text-rose-400';
}

export function looksLikeOpaqueId(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  if (/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(s)) {
    return true;
  }
  if (/^[0-9a-f]{16,}$/i.test(s) || /^\d{7,}$/.test(s)) return true;
  if (!/\s/.test(s) && s.length >= 22) {
    if (
      /^[A-Za-z0-9+/]{22,}={0,2}$/.test(s) &&
      /[0-9]/.test(s) &&
      /[a-z]/.test(s) &&
      /[A-Z]/.test(s) &&
      (/[+/=]/.test(s) || s.length >= 28)
    ) {
      return true;
    }
  }
  return false;
}

export function cleanAssignmentDisplayTitle(
  rawTitle: string,
  categoryName?: string,
  index?: number
): string {
  const cleaned = rawTitle.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || looksLikeOpaqueId(cleaned)) {
    const label = categoryName && categoryName.trim() ? categoryName.trim() : 'Assignment';
    return index !== undefined ? `${label} #${index + 1}` : label;
  }
  return cleaned;
}

export function formatShortDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoDate;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = Math.max(0, Math.min(11, parseInt(m[2], 10) - 1));
  const day = parseInt(m[3], 10);
  return `${months[monthIdx]} ${day}`;
}

export interface GradeTimelineEvent {
  courseId: string;
  courseCode: string;
  courseName: string;
  title: string;
  categoryName: string;
  earned: number;
  possible: number;
  percent: number | null;
  isHypothetical: boolean;
}

export interface GradeTimelinePoint {
  date: string;
  label: string;
  actualPercent: number | null;
  hypotheticalPercent: number | null;
  displayPercent: number;
  letter: string;
  events: GradeTimelineEvent[];
}

/**
 * Computes chronological running grade percentage across one or more courses
 * using exact syllabus weighting / drop-lowest rules at every graded date milestone.
 */
export function computeGradeTimeline(
  courses: Course[],
  scale: GradeScaleEntry[],
  overlay?: HypotheticalOverlay | null
): GradeTimelinePoint[] {
  if (courses.length === 0) return [];

  const isHypActive = Boolean(overlay);
  const dateSet = new Set<string>();
  const eventsByDate = new Map<string, GradeTimelineEvent[]>();

  const perCourseEffective = courses.map((course) => {
    const actualRes = computeCourseResult(course, scale, null);
    const displayRes = isHypActive ? computeCourseResult(course, scale, overlay) : actualRes;
    const catMap = new Map(course.categories.map((c) => [c.id, c.name]));

    displayRes.effectiveAssignments.forEach((a, idx) => {
      if (a.isRemoved || a.excused || a.earned === null || !a.dueDate) return;
      const d = a.dueDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      dateSet.add(d);
      const list = eventsByDate.get(d) || [];
      const catName = catMap.get(a.categoryId) || 'Coursework';
      list.push({
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        title: cleanAssignmentDisplayTitle(a.title, catName, idx),
        categoryName: catName,
        earned: a.earned,
        possible: a.possible,
        percent: a.possible > 0 ? (a.earned / a.possible) * 100 : null,
        isHypothetical: Boolean(isHypActive && a.isModified),
      });
      eventsByDate.set(d, list);
    });

    if (isHypActive) {
      actualRes.effectiveAssignments.forEach((a) => {
        if (a.excused || a.earned === null || !a.dueDate) return;
        const d = a.dueDate.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dateSet.add(d);
      });
    }

    return { course, actualRes, displayRes };
  });

  const sortedDates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  if (sortedDates.length === 0) return [];

  const points: GradeTimelinePoint[] = [];

  for (const date of sortedDates) {
    let actualWeightedSum = 0;
    let actualCredits = 0;
    let hypWeightedSum = 0;
    let hypCredits = 0;

    for (const { course } of perCourseEffective) {
      const weight = course.credits > 0 ? course.credits : 1;

      const actualSlice: Course = {
        ...course,
        officialPercent: null,
        officialLetter: null,
        assignments: course.assignments.filter(
          (a) => a.dueDate && a.dueDate.slice(0, 10) <= date
        ),
      };
      const aRes = computeCourseResult(actualSlice, scale, null);
      if (aRes.percentage !== null) {
        actualWeightedSum += aRes.percentage * weight;
        actualCredits += weight;
      }

      if (isHypActive && overlay) {
        const filteredOverlay: HypotheticalOverlay = {
          edits: overlay.edits,
          removedAssignmentKeys: overlay.removedAssignmentKeys,
          addedAssignments: {
            ...overlay.addedAssignments,
            [course.id]: (overlay.addedAssignments[course.id] || []).filter(
              (a) => a.dueDate && a.dueDate.slice(0, 10) <= date
            ),
          },
        };
        const hRes = computeCourseResult(actualSlice, scale, filteredOverlay);
        if (hRes.percentage !== null) {
          hypWeightedSum += hRes.percentage * weight;
          hypCredits += weight;
        }
      }
    }

    const actualPercent = actualCredits > 0 ? actualWeightedSum / actualCredits : null;
    const hypotheticalPercent =
      isHypActive && hypCredits > 0 ? hypWeightedSum / hypCredits : null;
    const primary = isHypActive
      ? (hypotheticalPercent ?? actualPercent)
      : actualPercent;

    if (primary === null) continue;

    const { letter } = getLetterAndGpa(primary, scale);
    points.push({
      date,
      label: formatShortDate(date),
      actualPercent,
      hypotheticalPercent,
      displayPercent: primary,
      letter,
      events: eventsByDate.get(date) || [],
    });
  }

  return points;
}

export interface GpaTimelineEvent {
  courseId: string;
  courseCode: string;
  courseName: string;
  title: string;
  categoryName: string;
  categoryWeight: number;
  earned: number;
  possible: number;
  percent: number | null;
  isMajor: boolean;
  isHypothetical: boolean;
}

export interface GpaTimelinePoint {
  date: string;
  label: string;
  actualTermGpa: number | null;
  actualCumulativeGpa: number | null;
  hypotheticalTermGpa: number | null;
  hypotheticalCumulativeGpa: number | null;
  displayCumulativeGpa: number;
  displayTermGpa: number;
  deltaCumulative: number | null;
  deltaTerm: number | null;
  hasMajorAssessment: boolean;
  majorCount: number;
  events: GpaTimelineEvent[];
}

const MAJOR_ASSESSMENT_RE =
  /\b(exam|midterm|final|test|assessment|quiz|project|essay|paper|dbq|frq|lab\s*report|practicum|presentation|benchmark)\b/i;

/**
 * Computes chronological Term GPA and Cumulative GPA progress across the term,
 * detecting major assessments and GPA shifts at each graded date milestone.
 */
export function computeGpaTimeline(
  courses: Course[],
  scale: GradeScaleEntry[],
  overlay?: HypotheticalOverlay | null,
  priorGpa = 0,
  priorCredits = 0
): GpaTimelinePoint[] {
  if (courses.length === 0) return [];

  const isHypActive = Boolean(overlay);
  const dateSet = new Set<string>();
  const eventsByDate = new Map<string, GpaTimelineEvent[]>();

  courses.forEach((course) => {
    const actualRes = computeCourseResult(course, scale, null);
    const displayRes = isHypActive ? computeCourseResult(course, scale, overlay) : actualRes;
    const catMap = new Map(course.categories.map((c) => [c.id, c]));

    displayRes.effectiveAssignments.forEach((a, idx) => {
      if (a.isRemoved || a.excused || a.earned === null || !a.dueDate) return;
      const d = a.dueDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      dateSet.add(d);

      const cat = catMap.get(a.categoryId);
      const catName = cat?.name || 'Coursework';
      const catWeight = cat?.weight || 0;
      const cleanTitle = cleanAssignmentDisplayTitle(a.title, catName, idx);

      const isMajor =
        (course.gradingMode === 'weighted' && catWeight >= 25) ||
        a.possible >= 50 ||
        MAJOR_ASSESSMENT_RE.test(cleanTitle) ||
        MAJOR_ASSESSMENT_RE.test(catName);

      const list = eventsByDate.get(d) || [];
      list.push({
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        title: cleanTitle,
        categoryName: catName,
        categoryWeight: catWeight,
        earned: a.earned,
        possible: a.possible,
        percent: a.possible > 0 ? (a.earned / a.possible) * 100 : null,
        isMajor,
        isHypothetical: Boolean(isHypActive && a.isModified),
      });
      eventsByDate.set(d, list);
    });

    if (isHypActive) {
      actualRes.effectiveAssignments.forEach((a) => {
        if (a.excused || a.earned === null || !a.dueDate) return;
        const d = a.dueDate.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dateSet.add(d);
      });
    }
  });

  const sortedDates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  if (sortedDates.length === 0) return [];

  const points: GpaTimelinePoint[] = [];
  let prevDisplayCum: number | null = null;
  let prevDisplayTerm: number | null = null;

  for (const date of sortedDates) {
    const slicedCourses: Course[] = courses.map((course) => ({
      ...course,
      officialPercent: null,
      officialLetter: null,
      assignments: course.assignments.filter(
        (a) => a.dueDate && a.dueDate.slice(0, 10) <= date
      ),
    }));

    const actualSummary = computeTermSummary(
      slicedCourses,
      scale,
      null,
      priorGpa,
      priorCredits
    );

    let hypSummary: TermSummary | null = null;
    if (isHypActive && overlay) {
      const slicedAdded: Record<string, Assignment[]> = {};
      for (const [cid, list] of Object.entries(overlay.addedAssignments)) {
        slicedAdded[cid] = list.filter((a) => a.dueDate && a.dueDate.slice(0, 10) <= date);
      }
      const filteredOverlay: HypotheticalOverlay = {
        edits: overlay.edits,
        removedAssignmentKeys: overlay.removedAssignmentKeys,
        addedAssignments: slicedAdded,
      };
      hypSummary = computeTermSummary(
        slicedCourses,
        scale,
        filteredOverlay,
        priorGpa,
        priorCredits
      );
    }

    const actualTermGpa =
      actualSummary.termGpa !== null ? Number(actualSummary.termGpa.toFixed(3)) : null;
    const actualCumulativeGpa =
      actualSummary.cumulativeGpa !== null
        ? Number(actualSummary.cumulativeGpa.toFixed(3))
        : null;
    const hypotheticalTermGpa =
      hypSummary && hypSummary.termGpa !== null ? Number(hypSummary.termGpa.toFixed(3)) : null;
    const hypotheticalCumulativeGpa =
      hypSummary && hypSummary.cumulativeGpa !== null
        ? Number(hypSummary.cumulativeGpa.toFixed(3))
        : null;

    const displayCumulativeGpa = isHypActive
      ? (hypotheticalCumulativeGpa ?? actualCumulativeGpa)
      : actualCumulativeGpa;
    const displayTermGpa = isHypActive
      ? (hypotheticalTermGpa ?? actualTermGpa)
      : actualTermGpa;

    if (displayCumulativeGpa === null || displayTermGpa === null) continue;

    const deltaCumulative =
      prevDisplayCum !== null ? Number((displayCumulativeGpa - prevDisplayCum).toFixed(3)) : null;
    const deltaTerm =
      prevDisplayTerm !== null ? Number((displayTermGpa - prevDisplayTerm).toFixed(3)) : null;

    const events = eventsByDate.get(date) || [];
    const majorEvents = events.filter((e) => e.isMajor);
    const hasSignificantShift =
      (deltaCumulative !== null && Math.abs(deltaCumulative) >= 0.02) ||
      (deltaTerm !== null && Math.abs(deltaTerm) >= 0.05);

    points.push({
      date,
      label: formatShortDate(date),
      actualTermGpa,
      actualCumulativeGpa,
      hypotheticalTermGpa,
      hypotheticalCumulativeGpa,
      displayCumulativeGpa,
      displayTermGpa,
      deltaCumulative,
      deltaTerm,
      hasMajorAssessment: majorEvents.length > 0 || hasSignificantShift,
      majorCount: majorEvents.length,
      events,
    });

    prevDisplayCum = displayCumulativeGpa;
    prevDisplayTerm = displayTermGpa;
  }

  return points;
}


