import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  Calculator,
  Mail,
  Search,
  X,
} from 'lucide-react';
import {
  Course,
  CourseResult,
  EdupointMailMessage,
} from '../types/grades';
import {
  cleanAssignmentDisplayTitle,
  formatPercent,
  getGradeToneClass,
} from '../utils/gradeMath';

interface QuickSearchModalProps {
  open: boolean;
  courses: Course[];
  courseResults: Record<string, CourseResult>;
  mailMessages: EdupointMailMessage[];
  onSelectCourse: (courseId: string) => void;
  onOpenTab: (tab: 'overview' | 'calculator' | 'notifications' | 'scale') => void;
  onClose: () => void;
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  open,
  courses,
  courseResults,
  mailMessages,
  onSelectCourse,
  onOpenTab,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const trimmed = query.trim().toLowerCase();

  const matchingCourses = useMemo(() => {
    if (!trimmed) return courses.slice(0, 6);
    return courses
      .filter(
        (c) =>
          c.name.toLowerCase().includes(trimmed) ||
          c.code.toLowerCase().includes(trimmed) ||
          c.instructor.toLowerCase().includes(trimmed)
      )
      .slice(0, 6);
  }, [courses, trimmed]);

  const matchingAssignments = useMemo(() => {
    if (!trimmed) return [];
    const results: Array<{
      course: Course;
      title: string;
      categoryName: string;
      dueDate: string;
      earned: number | null;
      possible: number;
    }> = [];

    for (const course of courses) {
      const catMap = new Map(course.categories.map((c) => [c.id, c.name]));
      course.assignments.forEach((a, idx) => {
        const catName = catMap.get(a.categoryId) || 'Coursework';
        const title = cleanAssignmentDisplayTitle(a.title, catName, idx);
        if (
          title.toLowerCase().includes(trimmed) ||
          catName.toLowerCase().includes(trimmed) ||
          (a.dueDate && a.dueDate.includes(trimmed))
        ) {
          results.push({
            course,
            title,
            categoryName: catName,
            dueDate: a.dueDate,
            earned: a.earned,
            possible: a.possible,
          });
        }
      });
    }
    return results.slice(0, 8);
  }, [courses, trimmed]);

  const matchingMail = useMemo(() => {
    if (!trimmed) return [];
    return mailMessages
      .filter(
        (m) =>
          m.subject.toLowerCase().includes(trimmed) ||
          m.sender.toLowerCase().includes(trimmed) ||
          m.preview.toLowerCase().includes(trimmed)
      )
      .slice(0, 4);
  }, [mailMessages, trimmed]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/55 backdrop-blur-sm p-3 sm:pt-16 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick search gradebook"
        className="w-full max-w-xl glass-modal rounded-2xl overflow-hidden max-h-[82vh] flex flex-col"
      >
        <div className="px-4 py-3 border-b border-slate-200/70 dark:border-white/10 flex items-center gap-2.5">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search courses, assignments, tests, or mail..."
            className="flex-1 min-w-0 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-3 space-y-4">
          {matchingCourses.length > 0 && (
            <div>
              <div className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Courses
              </div>
              <div className="space-y-1">
                {matchingCourses.map((course) => {
                  const res = courseResults[course.id];
                  return (
                    <button
                      key={course.id}
                      type="button"
                      onClick={() => {
                        onSelectCourse(course.id);
                        onClose();
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/70 dark:hover:bg-white/[0.07] flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                            <span className="font-mono text-slate-500 dark:text-slate-400 mr-1.5">
                              {course.code}
                            </span>
                            {course.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {course.instructor}
                          </div>
                        </div>
                      </div>
                      <div className="font-mono text-xs font-semibold shrink-0 tabular-nums">
                        <span className={getGradeToneClass(res?.percentage ?? null)}>
                          {res?.letter ?? '—'}
                        </span>{' '}
                        <span className="text-slate-500 dark:text-slate-400 font-normal">
                          {formatPercent(res?.percentage ?? null)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {matchingAssignments.length > 0 && (
            <div>
              <div className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Assignments &amp; Exams
              </div>
              <div className="space-y-1">
                {matchingAssignments.map((item, idx) => (
                  <button
                    key={`${item.course.id}-${idx}`}
                    type="button"
                    onClick={() => {
                      onSelectCourse(item.course.id);
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/70 dark:hover:bg-white/[0.07] flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.course.code} · {item.categoryName} · {item.dueDate || 'TBD'}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-slate-700 dark:text-slate-300 shrink-0 tabular-nums">
                      {item.earned === null ? 'Upcoming' : `${item.earned}/${item.possible}`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchingMail.length > 0 && (
            <div>
              <div className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Edupoint Synergy Mail
              </div>
              <div className="space-y-1">
                {matchingMail.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onOpenTab('notifications');
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/70 dark:hover:bg-white/[0.07] flex items-center gap-2.5 transition-colors"
                  >
                    <Mail className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {m.subject}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {m.sender} · {m.date}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!trimmed && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10">
              <div className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Quick Jump
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onOpenTab('calculator');
                    onClose();
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/60 dark:bg-white/[0.04] hover:bg-white dark:hover:bg-white/[0.09] text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Calculator className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
                  Target Calculator
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenTab('notifications');
                    onClose();
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/60 dark:bg-white/[0.04] hover:bg-white dark:hover:bg-white/[0.09] text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Bell className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  Alerts &amp; Mail
                </button>
              </div>
            </div>
          )}

          {trimmed &&
            matchingCourses.length === 0 &&
            matchingAssignments.length === 0 &&
            matchingMail.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No matching courses, assignments, or mail found.
              </div>
            )}
        </div>
      </div>
    </div>
  );
};
