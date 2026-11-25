import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Assignment, Category, Course, CourseLevel, GradingMode } from '../types/grades';
import { getEffectiveCourseLevel, isCourseExcludedFromGpa } from '../utils/gradeMath';

interface ModalShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

const ModalShell: React.FC<ModalShellProps> = ({ title, subtitle, onClose, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg glass-modal rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200/70 dark:border-white/10 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30';

/* ---------------- Course Modal ---------------- */

interface CourseModalProps {
  termId: string;
  existingCourse?: Course | null;
  onSave: (course: Course) => void;
  onDelete?: (courseId: string) => void;
  onClose: () => void;
}

export const CourseModal: React.FC<CourseModalProps> = ({
  termId,
  existingCourse,
  onSave,
  onDelete,
  onClose,
}) => {
  const [code, setCode] = useState(existingCourse?.code || '');
  const [name, setName] = useState(existingCourse?.name || '');
  const [instructor, setInstructor] = useState(existingCourse?.instructor || '');
  const [credits, setCredits] = useState<string>(String(existingCourse?.credits ?? 5));
  const [courseLevel, setCourseLevel] = useState<CourseLevel>(
    existingCourse ? getEffectiveCourseLevel(existingCourse) : 'regular'
  );
  const [includeInGpa, setIncludeInGpa] = useState<boolean>(
    existingCourse ? !isCourseExcludedFromGpa(existingCourse) : true
  );
  const [gradingMode, setGradingMode] = useState<GradingMode>(
    existingCourse?.gradingMode || 'weighted'
  );
  const [categories, setCategories] = useState<Category[]>(
    existingCourse?.categories || [
      { id: `cat-${Date.now()}-1`, name: 'Homework', weight: 25, dropLowest: 0 },
      { id: `cat-${Date.now()}-2`, name: 'Tests & Quizzes', weight: 50, dropLowest: 0 },
      { id: `cat-${Date.now()}-3`, name: 'Final Exam', weight: 25, dropLowest: 0 },
    ]
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totalWeight = categories.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);

  const handleAddCategory = () => {
    setCategories((prev) => [
      ...prev,
      {
        id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: '',
        weight: 0,
        dropLowest: 0,
      },
    ]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    const cleanCategories = categories
      .filter((c) => c.name.trim())
      .map((c) => ({
        ...c,
        name: c.name.trim(),
        weight: Math.max(0, Number(c.weight) || 0),
        dropLowest: Math.max(0, Math.floor(Number(c.dropLowest) || 0)),
      }));

    if (cleanCategories.length === 0) {
      cleanCategories.push({
        id: `cat-${Date.now()}`,
        name: 'General',
        weight: 100,
        dropLowest: 0,
      });
    }

    const parsedCredits = parseFloat(credits);
    const course: Course = {
      id: existingCourse?.id || `course-${Date.now()}`,
      termId: existingCourse?.termId || termId,
      code: code.trim(),
      name: name.trim(),
      instructor: instructor.trim() || 'Instructor TBD',
      credits: Number.isFinite(parsedCredits) ? Math.max(0, parsedCredits) : 5,
      gradingMode,
      categories: cleanCategories,
      assignments: existingCourse?.assignments || [],
      source: existingCourse?.source,
      officialPercent: existingCourse?.officialPercent,
      officialLetter: existingCourse?.officialLetter,
      courseLevel,
      excludeFromGpa: !includeInGpa,
    };
    onSave(course);
  };

  return (
    <ModalShell
      title={existingCourse ? `Edit ${existingCourse.code}` : 'Add Course'}
      subtitle="Configure credit hours, grading structure, and syllabus categories."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Course Code
            </label>
            <input
              type="text"
              required
              placeholder="Period 1"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Course Title
            </label>
            <input
              type="text"
              required
              placeholder="AP Calculus BC"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Instructor
            </label>
            <input
              type="text"
              placeholder="Teacher Name"
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Credits
            </label>
            <input
              type="number"
              step="0.5"
              min={0}
              max={12}
              required
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              GPA Weighting
            </label>
            <select
              value={courseLevel}
              onChange={(e) => setCourseLevel(e.target.value as CourseLevel)}
              className={INPUT_CLASS}
            >
              <option value="regular" className="bg-white dark:bg-slate-900">
                Regular (4.0 scale)
              </option>
              <option value="honors" className="bg-white dark:bg-slate-900">
                Honors (+1.0 Weighted)
              </option>
              <option value="ap" className="bg-white dark:bg-slate-900">
                AP / IB (+1.0 Weighted)
              </option>
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer pb-2">
            <input
              type="checkbox"
              checked={includeInGpa}
              onChange={(e) => setIncludeInGpa(e.target.checked)}
              className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
            />
            Include course in GPA calculation
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Grading Structure
          </label>
          <div className="inline-flex p-0.5 bg-slate-200/70 dark:bg-white/[0.06] rounded-xl border border-slate-300/60 dark:border-white/10">
            <button
              type="button"
              onClick={() => setGradingMode('weighted')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                gradingMode === 'weighted'
                  ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Weighted Categories (%)
            </button>
            <button
              type="button"
              onClick={() => setGradingMode('points')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                gradingMode === 'points'
                  ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Total Points
            </button>
          </div>
        </div>

        {/* Categories */}
        <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Categories
            </span>
            {gradingMode === 'weighted' && (
              <span
                className={`font-mono text-xs tabular-nums ${
                  Math.abs(totalWeight - 100) < 0.01
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                Total weight: {totalWeight}%
              </span>
            )}
          </div>

          <div className="space-y-2">
            {categories.map((cat, idx) => (
              <div key={cat.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Category name"
                  value={cat.name}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c))
                    )
                  }
                  className="min-w-[140px] flex-1 px-2.5 py-1.5 text-xs bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                {gradingMode === 'weighted' && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      aria-label="Weight percent"
                      value={cat.weight}
                      onChange={(e) =>
                        setCategories((prev) =>
                          prev.map((c, i) =>
                            i === idx ? { ...c, weight: parseFloat(e.target.value) || 0 } : c
                          )
                        )
                      }
                      className="w-16 px-2 py-1.5 font-mono text-xs text-right bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-lg text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400">%</span>
                  </div>
                )}
                <div className="flex items-center gap-1" title="Drop lowest N scores">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Drop</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    aria-label="Drop lowest count"
                    value={cat.dropLowest || 0}
                    onChange={(e) =>
                      setCategories((prev) =>
                        prev.map((c, i) =>
                          i === idx ? { ...c, dropLowest: parseInt(e.target.value, 10) || 0 } : c
                        )
                      )
                    }
                    className="w-12 px-1.5 py-1.5 font-mono text-xs text-right bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-lg text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCategories((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Remove category"
                    className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddCategory}
            className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-sky-400 hover:text-blue-900 dark:hover:text-sky-300"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Category
          </button>
        </div>

        <div className="pt-4 border-t border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            {existingCourse && onDelete && !confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs font-medium text-rose-700 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-300"
              >
                Delete Course
              </button>
            )}
            {existingCourse && onDelete && confirmDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-700 dark:text-rose-400">Delete course?</span>
                <button
                  type="button"
                  onClick={() => onDelete(existingCourse.id)}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors"
            >
              {existingCourse ? 'Save Changes' : 'Create Course'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
};

/* ---------------- Assignment Modal ---------------- */

interface AssignmentModalProps {
  course: Course;
  existingAssignment?: Assignment | null;
  isHypotheticalMode: boolean;
  onSave: (assignment: Assignment) => void;
  onClose: () => void;
}

export const AssignmentModal: React.FC<AssignmentModalProps> = ({
  course,
  existingAssignment,
  isHypotheticalMode,
  onSave,
  onClose,
}) => {
  const [title, setTitle] = useState(existingAssignment?.title || '');
  const [categoryId, setCategoryId] = useState(
    existingAssignment?.categoryId || course.categories[0]?.id || ''
  );
  const [dueDate, setDueDate] = useState(
    existingAssignment?.dueDate || new Date().toISOString().slice(0, 10)
  );
  const [earned, setEarned] = useState<string>(
    existingAssignment?.earned !== null && existingAssignment?.earned !== undefined
      ? String(existingAssignment.earned)
      : ''
  );
  const [possible, setPossible] = useState<string>(String(existingAssignment?.possible ?? 100));
  const [extraCredit, setExtraCredit] = useState(Boolean(existingAssignment?.extraCredit));
  const [excused, setExcused] = useState(Boolean(existingAssignment?.excused));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const possibleNum = Math.max(1, parseFloat(possible) || 100);
    const earnedNum = earned.trim() === '' ? null : parseFloat(earned);

    onSave({
      id:
        existingAssignment?.id ||
        `asgn-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      categoryId,
      title: title.trim(),
      dueDate,
      earned: earnedNum !== null && !Number.isNaN(earnedNum) ? earnedNum : null,
      possible: possibleNum,
      extraCredit,
      excused,
      isHypotheticalOnly: isHypotheticalMode && !existingAssignment,
    });
  };

  return (
    <ModalShell
      title={
        existingAssignment
          ? 'Edit Assignment'
          : isHypotheticalMode
            ? `Add Hypothetical Assignment — ${course.code}`
            : `Add Assignment — ${course.code}`
      }
      subtitle={
        isHypotheticalMode && !existingAssignment
          ? 'This temporary assignment only exists in Hypothetical Mode until applied.'
          : 'Leave earned score blank for upcoming ungraded work.'
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Assignment Title
          </label>
          <input
            type="text"
            required
            placeholder="e.g., Extra Credit Project or Quiz 4"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Category
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={INPUT_CLASS}
            >
              {course.categories.map((cat) => (
                <option key={cat.id} value={cat.id} className="bg-white dark:bg-slate-900">
                  {cat.name} {course.gradingMode === 'weighted' ? `(${cat.weight}%)` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Earned Score (optional)
            </label>
            <input
              type="number"
              step="any"
              min={0}
              placeholder="Leave blank if upcoming"
              value={earned}
              onChange={(e) => setEarned(e.target.value)}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Points Possible
            </label>
            <input
              type="number"
              step="any"
              min={1}
              required
              value={possible}
              onChange={(e) => setPossible(e.target.value)}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={extraCredit}
              onChange={(e) => setExtraCredit(e.target.checked)}
              className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
            />
            Extra credit (bonus points)
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={excused}
              onChange={(e) => setExcused(e.target.checked)}
              className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
            />
            Excused (excluded from grade)
          </label>
        </div>

        <div className="pt-4 border-t border-slate-200/70 dark:border-white/10 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-xl"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`px-4 py-2 text-xs font-medium rounded-xl transition-colors ${
              isHypotheticalMode && !existingAssignment
                ? 'text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400'
                : 'text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400'
            }`}
          >
            {existingAssignment
              ? 'Save Assignment'
              : isHypotheticalMode
                ? 'Add to Simulation'
                : 'Add Assignment'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* ---------------- Simple Prompt Modal (Add Term / Save Scenario) ---------------- */

interface NamePromptModalProps {
  title: string;
  subtitle: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export const NamePromptModal: React.FC<NamePromptModalProps> = ({
  title,
  subtitle,
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
}) => {
  const [value, setValue] = useState('');

  return (
    <ModalShell title={title} subtitle={subtitle} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          onSubmit(value.trim());
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            {label}
          </label>
          <input
            type="text"
            required
            autoFocus
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-xl"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
