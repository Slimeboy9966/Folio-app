import { GradeScaleEntry, GradebookState } from '../types/grades';

/**
 * Amador Valley High School / Pleasanton Unified School District (PUSD) & California High School
 * standard 4.0 scale: plus/minus marks do not change unweighted GPA points (A+/A/A- = 4.0,
 * B+/B/B- = 3.0, C+/C/C- = 2.0, D+/D/D- = 1.0, F = 0.0). AP/Honors courses add +1.0 in Weighted GPA.
 */
export const PUSD_GRADE_SCALE: GradeScaleEntry[] = [
  { letter: 'A+', minPercent: 97, gpa: 4.0 },
  { letter: 'A', minPercent: 93, gpa: 4.0 },
  { letter: 'A-', minPercent: 90, gpa: 4.0 },
  { letter: 'B+', minPercent: 87, gpa: 3.0 },
  { letter: 'B', minPercent: 83, gpa: 3.0 },
  { letter: 'B-', minPercent: 80, gpa: 3.0 },
  { letter: 'C+', minPercent: 77, gpa: 2.0 },
  { letter: 'C', minPercent: 73, gpa: 2.0 },
  { letter: 'C-', minPercent: 70, gpa: 2.0 },
  { letter: 'D+', minPercent: 67, gpa: 1.0 },
  { letter: 'D', minPercent: 63, gpa: 1.0 },
  { letter: 'D-', minPercent: 60, gpa: 1.0 },
  { letter: 'F', minPercent: 0, gpa: 0.0 },
];

export const COLLEGE_PLUS_MINUS_GRADE_SCALE: GradeScaleEntry[] = [
  { letter: 'A', minPercent: 93, gpa: 4.0 },
  { letter: 'A-', minPercent: 90, gpa: 3.7 },
  { letter: 'B+', minPercent: 87, gpa: 3.3 },
  { letter: 'B', minPercent: 83, gpa: 3.0 },
  { letter: 'B-', minPercent: 80, gpa: 2.7 },
  { letter: 'C+', minPercent: 77, gpa: 2.3 },
  { letter: 'C', minPercent: 73, gpa: 2.0 },
  { letter: 'C-', minPercent: 70, gpa: 1.7 },
  { letter: 'D+', minPercent: 67, gpa: 1.3 },
  { letter: 'D', minPercent: 63, gpa: 1.0 },
  { letter: 'D-', minPercent: 60, gpa: 0.7 },
  { letter: 'F', minPercent: 0, gpa: 0.0 },
];

export const DEFAULT_GRADE_SCALE: GradeScaleEntry[] = PUSD_GRADE_SCALE;

export function isLegacyCollegeScale(scale: GradeScaleEntry[]): boolean {
  if (!Array.isArray(scale) || scale.length !== 11) return false;
  const aMinus = scale.find((s) => s.letter === 'A-');
  const bPlus = scale.find((s) => s.letter === 'B+');
  const hasDMinus = scale.some((s) => s.letter === 'D-');
  return Boolean(aMinus && aMinus.gpa === 3.7 && bPlus && bPlus.gpa === 3.3 && !hasDMinus);
}

export const INITIAL_GRADEBOOK_STATE: GradebookState = {
  terms: [
    { id: 'fall-2026', name: 'Fall 2026', isCurrent: true },
    { id: 'spring-2026', name: 'Spring 2026', isCurrent: false },
  ],
  activeTermId: 'fall-2026',
  gradeScale: DEFAULT_GRADE_SCALE,
  priorGpa: 3.62,
  priorCredits: 42,
  savedScenarios: [],
  courses: [
    {
      id: 'cs-240',
      termId: 'fall-2026',
      code: 'CS 240',
      name: 'Data Structures & Algorithms',
      instructor: 'Prof. Elena Rostova',
      credits: 4,
      gradingMode: 'weighted',
      categories: [
        { id: 'cs-labs', name: 'Programming Labs', weight: 30 },
        { id: 'cs-hw', name: 'Problem Sets', weight: 20, dropLowest: 1 },
        { id: 'cs-mid', name: 'Midterm Exams', weight: 25 },
        { id: 'cs-fin', name: 'Final Exam', weight: 25 },
      ],
      assignments: [
        { id: 'cs-a1', categoryId: 'cs-labs', title: 'Lab 1: Dynamic Arrays & Ring Buffers', dueDate: '2026-09-18', earned: 96, possible: 100 },
        { id: 'cs-a2', categoryId: 'cs-labs', title: 'Lab 2: Balanced BST Implementation', dueDate: '2026-10-09', earned: 88, possible: 100 },
        { id: 'cs-a3', categoryId: 'cs-labs', title: 'Lab 3: Dijkstra & A* Pathfinding', dueDate: '2026-11-06', earned: 94, possible: 100 },
        { id: 'cs-a4', categoryId: 'cs-labs', title: 'Lab 4: Hash Table Benchmarking', dueDate: '2026-12-04', earned: null, possible: 100 },
        { id: 'cs-a5', categoryId: 'cs-hw', title: 'PS 1: Asymptotic Complexity', dueDate: '2026-09-25', earned: 46, possible: 50 },
        { id: 'cs-a6', categoryId: 'cs-hw', title: 'PS 2: Recurrence Relations', dueDate: '2026-10-16', earned: 38, possible: 50 },
        { id: 'cs-a7', categoryId: 'cs-hw', title: 'PS 3: Heaps & Priority Queues', dueDate: '2026-11-02', earned: 48, possible: 50 },
        { id: 'cs-a8', categoryId: 'cs-hw', title: 'PS 4: Graph Traversals & Flows', dueDate: '2026-11-20', earned: 45, possible: 50 },
        { id: 'cs-a9', categoryId: 'cs-mid', title: 'Midterm 1: Trees & Recursion', dueDate: '2026-10-14', earned: 84, possible: 100 },
        { id: 'cs-a10', categoryId: 'cs-mid', title: 'Midterm 2: Graphs & Dynamic Programming', dueDate: '2026-11-18', earned: 89, possible: 100 },
        { id: 'cs-a11', categoryId: 'cs-fin', title: 'Comprehensive Final Exam', dueDate: '2026-12-15', earned: null, possible: 100 },
      ],
    },
    {
      id: 'math-221',
      termId: 'fall-2026',
      code: 'MATH 221',
      name: 'Linear Algebra',
      instructor: 'Dr. Kenji Takahashi',
      credits: 4,
      gradingMode: 'weighted',
      categories: [
        { id: 'm-hw', name: 'Weekly Homework', weight: 20, dropLowest: 1 },
        { id: 'm-quiz', name: 'Recitation Quizzes', weight: 15 },
        { id: 'm-exam', name: 'Unit Exams', weight: 40 },
        { id: 'm-fin', name: 'Final Exam', weight: 25 },
      ],
      assignments: [
        { id: 'm-a1', categoryId: 'm-hw', title: 'HW 1: Gaussian Elimination', dueDate: '2026-09-14', earned: 28, possible: 30 },
        { id: 'm-a2', categoryId: 'm-hw', title: 'HW 2: Vector Spaces & Bases', dueDate: '2026-09-28', earned: 25, possible: 30 },
        { id: 'm-a3', categoryId: 'm-hw', title: 'HW 3: Orthogonality & Projections', dueDate: '2026-10-19', earned: 29, possible: 30 },
        { id: 'm-a4', categoryId: 'm-hw', title: 'HW 4: Determinants & Eigenvalues', dueDate: '2026-11-09', earned: 27, possible: 30 },
        { id: 'm-a5', categoryId: 'm-hw', title: 'HW 5: Singular Value Decomposition', dueDate: '2026-12-01', earned: null, possible: 30 },
        { id: 'm-a6', categoryId: 'm-quiz', title: 'Quiz 1: Row Reduction', dueDate: '2026-09-21', earned: 18, possible: 20 },
        { id: 'm-a7', categoryId: 'm-quiz', title: 'Quiz 2: Linear Transformations', dueDate: '2026-10-12', earned: 16, possible: 20 },
        { id: 'm-a8', categoryId: 'm-quiz', title: 'Quiz 3: Diagonalization', dueDate: '2026-11-12', earned: 19, possible: 20 },
        { id: 'm-a9', categoryId: 'm-exam', title: 'Exam 1: Systems & Subspaces', dueDate: '2026-10-07', earned: 82, possible: 100 },
        { id: 'm-a10', categoryId: 'm-exam', title: 'Exam 2: Eigenvalues & Inner Products', dueDate: '2026-11-11', earned: 86, possible: 100 },
        { id: 'm-a11', categoryId: 'm-fin', title: 'Cumulative Final Exam', dueDate: '2026-12-17', earned: null, possible: 100 },
      ],
    },
    {
      id: 'phys-180',
      termId: 'fall-2026',
      code: 'PHYS 180',
      name: 'Classical Mechanics',
      instructor: 'Prof. Hannah Lindqvist',
      credits: 4,
      gradingMode: 'weighted',
      categories: [
        { id: 'p-lab', name: 'Laboratory Reports', weight: 25 },
        { id: 'p-hw', name: 'Problem Sets', weight: 20 },
        { id: 'p-mid', name: 'Midterm Exams', weight: 30 },
        { id: 'p-fin', name: 'Final Exam', weight: 25 },
      ],
      assignments: [
        { id: 'p-a1', categoryId: 'p-lab', title: 'Lab 1: Projectile Kinematics', dueDate: '2026-09-22', earned: 47, possible: 50 },
        { id: 'p-a2', categoryId: 'p-lab', title: 'Lab 2: Conservation of Momentum', dueDate: '2026-10-13', earned: 49, possible: 50 },
        { id: 'p-a3', categoryId: 'p-lab', title: 'Lab 3: Rotational Inertia', dueDate: '2026-11-03', earned: 46, possible: 50 },
        { id: 'p-a4', categoryId: 'p-lab', title: 'Lab 4: Harmonic Oscillators', dueDate: '2026-12-03', earned: null, possible: 50 },
        { id: 'p-a5', categoryId: 'p-hw', title: 'Problem Sets 1–4 Average', dueDate: '2026-10-15', earned: 91, possible: 100 },
        { id: 'p-a6', categoryId: 'p-hw', title: 'Problem Sets 5–8 Average', dueDate: '2026-11-19', earned: 88, possible: 100 },
        { id: 'p-a7', categoryId: 'p-mid', title: 'Midterm 1: Newtonian Dynamics', dueDate: '2026-10-08', earned: 92, possible: 100 },
        { id: 'p-a8', categoryId: 'p-mid', title: 'Midterm 2: Energy & Rotation', dueDate: '2026-11-13', earned: 90, possible: 100 },
        { id: 'p-a9', categoryId: 'p-fin', title: 'Final Examination', dueDate: '2026-12-16', earned: null, possible: 100 },
      ],
    },
    {
      id: 'econ-101',
      termId: 'fall-2026',
      code: 'ECON 101',
      name: 'Principles of Microeconomics',
      instructor: 'Dr. Marcus Vance',
      credits: 3,
      gradingMode: 'points',
      categories: [
        { id: 'e-case', name: 'Case Studies', weight: 30 },
        { id: 'e-exam', name: 'Exams', weight: 50 },
        { id: 'e-part', name: 'Weekly Briefs', weight: 20 },
      ],
      assignments: [
        { id: 'e-a1', categoryId: 'e-part', title: 'Supply & Demand Market Brief', dueDate: '2026-09-19', earned: 24, possible: 25 },
        { id: 'e-a2', categoryId: 'e-case', title: 'Case Study 1: Elasticity in Transit Pricing', dueDate: '2026-10-05', earned: 46, possible: 50 },
        { id: 'e-a3', categoryId: 'e-exam', title: 'Midterm Exam', dueDate: '2026-10-23', earned: 138, possible: 150 },
        { id: 'e-a4', categoryId: 'e-case', title: 'Case Study 2: Oligopoly & Game Theory', dueDate: '2026-11-16', earned: 48, possible: 50 },
        { id: 'e-a5', categoryId: 'e-part', title: 'Policy Memo Extra Credit', dueDate: '2026-11-22', earned: 6, possible: 10, extraCredit: true },
        { id: 'e-a6', categoryId: 'e-exam', title: 'Final Exam', dueDate: '2026-12-14', earned: null, possible: 150 },
      ],
    },
    {
      id: 'hist-215',
      termId: 'fall-2026',
      code: 'HIST 215',
      name: 'Modern European History',
      instructor: 'Prof. Claire Beaumont',
      credits: 3,
      gradingMode: 'weighted',
      categories: [
        { id: 'h-sem', name: 'Seminar Participation', weight: 15 },
        { id: 'h-ess', name: 'Analytical Essays', weight: 50 },
        { id: 'h-pap', name: 'Research Paper', weight: 35 },
      ],
      assignments: [
        { id: 'h-a1', categoryId: 'h-sem', title: 'Weeks 1–6 Seminar Discussion', dueDate: '2026-10-16', earned: 95, possible: 100 },
        { id: 'h-a2', categoryId: 'h-ess', title: 'Essay 1: Industrialization & Urban Life', dueDate: '2026-10-02', earned: 91, possible: 100 },
        { id: 'h-a3', categoryId: 'h-ess', title: 'Essay 2: Interwar Diplomatic Treaties', dueDate: '2026-11-06', earned: 94, possible: 100 },
        { id: 'h-a4', categoryId: 'h-sem', title: 'Weeks 7–13 Seminar Discussion', dueDate: '2026-12-08', earned: null, possible: 100 },
        { id: 'h-a5', categoryId: 'h-pap', title: 'Final Archival Research Paper', dueDate: '2026-12-12', earned: null, possible: 100 },
      ],
    },
    // Spring 2026 (Completed term for historical reference)
    {
      id: 'cs-120',
      termId: 'spring-2026',
      code: 'CS 120',
      name: 'Systems Programming',
      instructor: 'Prof. David Miller',
      credits: 4,
      gradingMode: 'weighted',
      categories: [
        { id: 'cs120-proj', name: 'Projects', weight: 50 },
        { id: 'cs120-exam', name: 'Exams', weight: 50 },
      ],
      assignments: [
        { id: 'cs120-a1', categoryId: 'cs120-proj', title: 'Memory Allocator & Shell Projects', dueDate: '2026-04-20', earned: 95, possible: 100 },
        { id: 'cs120-a2', categoryId: 'cs120-exam', title: 'Midterm & Final Composite', dueDate: '2026-05-12', earned: 91, possible: 100 },
      ],
    },
    {
      id: 'math-152',
      termId: 'spring-2026',
      code: 'MATH 152',
      name: 'Multivariable Calculus',
      instructor: 'Dr. Priya Nair',
      credits: 4,
      gradingMode: 'weighted',
      categories: [
        { id: 'm152-hw', name: 'Homework', weight: 25 },
        { id: 'm152-ex', name: 'Exams', weight: 75 },
      ],
      assignments: [
        { id: 'm152-a1', categoryId: 'm152-hw', title: 'Problem Sets 1–10', dueDate: '2026-04-28', earned: 93, possible: 100 },
        { id: 'm152-a2', categoryId: 'm152-ex', title: 'Midterms & Final Exam', dueDate: '2026-05-14', earned: 87, possible: 100 },
      ],
    },
    {
      id: 'writ-104',
      termId: 'spring-2026',
      code: 'WRIT 104',
      name: 'Scientific & Technical Writing',
      instructor: 'Prof. Arthur Sterling',
      credits: 3,
      gradingMode: 'points',
      categories: [
        { id: 'w104-port', name: 'Portfolio', weight: 100 },
      ],
      assignments: [
        { id: 'w104-a1', categoryId: 'w104-port', title: 'Literature Review & Grant Proposal', dueDate: '2026-05-05', earned: 192, possible: 200 },
      ],
    },
  ],
};
