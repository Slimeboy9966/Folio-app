export type GradingMode = 'weighted' | 'points';

export interface GradeScaleEntry {
  letter: string;
  minPercent: number;
  gpa: number;
}

export interface Category {
  id: string;
  name: string;
  weight: number; // Percentage weight (0–100) used in 'weighted' mode
  dropLowest?: number; // Optional number of lowest graded assignments to drop
}

export interface Assignment {
  id: string;
  categoryId: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  earned: number | null; // null means upcoming / ungraded
  possible: number;
  extraCredit?: boolean;
  excused?: boolean;
  isHypotheticalOnly?: boolean; // True for temporary assignments created in hypothetical mode
}

export type CourseLevel = 'regular' | 'honors' | 'ap';

export interface Course {
  id: string;
  termId: string;
  code: string;
  name: string;
  instructor: string;
  credits: number;
  gradingMode: GradingMode;
  categories: Category[];
  assignments: Assignment[];
  source?: 'manual' | 'edupoint';
  officialPercent?: number | null;
  officialLetter?: string | null;
  courseLevel?: CourseLevel;
  excludeFromGpa?: boolean;
}

export interface EdupointStudentInfo {
  name: string;
  school: string;
  grade: string;
}

export interface EdupointReportPeriod {
  index: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface EdupointSessionInfo {
  token: string;
  host: string;
  studentInfo: EdupointStudentInfo;
  reportingPeriods: EdupointReportPeriod[];
  activePeriodIndex: string;
  syncedAt: string;
}

export interface EdupointMailMessage {
  id: string;
  subject: string;
  sender: string;
  date: string; // YYYY-MM-DD or display date
  preview: string;
  unread: boolean;
  folder?: string;
}

export type NotificationCategory = 'test' | 'quiz' | 'assignment' | 'mail';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  kind: 'upcoming' | 'overdue' | 'new-item' | 'grade-posted' | 'mail';
  title: string;
  subtitle: string;
  detail?: string;
  date: string;
  courseId?: string;
  courseCode?: string;
  createdAt: string;
  unread: boolean;
}

export interface NotificationPrefs {
  tests: boolean;
  quizzes: boolean;
  assignments: boolean;
  mail: boolean;
  browserAlerts: boolean;
  leadDays: 3 | 7 | 14 | 999;
}

export interface Term {
  id: string;
  name: string;
  isCurrent?: boolean;
}

export interface HypotheticalAssignmentEdit {
  earned?: number | null;
  possible?: number;
  excused?: boolean;
  extraCredit?: boolean;
}

export interface HypotheticalOverlay {
  // Keyed by `${courseId}:${assignmentId}`
  edits: Record<string, HypotheticalAssignmentEdit>;
  // Keyed by courseId -> temporary assignments added only in hypothetical mode
  addedAssignments: Record<string, Assignment[]>;
  // Keyed by `${courseId}:${assignmentId}` -> temporarily removed/ignored in hypothetical mode
  removedAssignmentKeys: Record<string, boolean>;
}

export interface SavedScenario {
  id: string;
  name: string;
  createdAt: string;
  overlay: HypotheticalOverlay;
}

export interface GradebookState {
  terms: Term[];
  activeTermId: string;
  courses: Course[];
  gradeScale: GradeScaleEntry[];
  priorGpa: number;
  priorCredits: number;
  savedScenarios: SavedScenario[];
}

export interface CategoryResult {
  category: Category;
  earnedPoints: number;
  possiblePoints: number;
  percentage: number | null; // null if no graded assignments
  gradedCount: number;
  totalCount: number;
  droppedAssignmentIds: string[];
  effectiveWeight: number; // Normalized weight if some categories have no graded items
  contribution: number; // Percentage points contributed to final grade
}

export interface CourseResult {
  percentage: number | null;
  letter: string;
  gpa: number | null;
  weightedGpa: number | null;
  excludedFromGpa: boolean;
  gradedCount: number;
  totalCount: number;
  gradedWeightPercent: number; // % of total course weight/points currently graded
  categoryResults: CategoryResult[];
  effectiveAssignments: Array<
    Assignment & {
      isModified: boolean;
      isRemoved: boolean;
      originalEarned: number | null;
      originalPossible: number;
      originalExcused: boolean;
      isDropped: boolean;
    }
  >;
  modifiedCount: number;
}

export interface TermSummary {
  termGpa: number | null;
  weightedTermGpa: number | null;
  cumulativeGpa: number | null;
  weightedCumulativeGpa: number | null;
  hasWeightedCourses: boolean;
  averagePercent: number | null;
  totalCredits: number;
  gradedCredits: number;
  gradedAssignments: number;
  totalAssignments: number;
}
