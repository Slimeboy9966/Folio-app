import {
  AppNotification,
  Course,
  EdupointMailMessage,
  NotificationCategory,
  NotificationPrefs,
} from '../types/grades';
import { cleanAssignmentDisplayTitle, formatPercent } from './gradeMath';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  tests: true,
  quizzes: true,
  assignments: true,
  mail: true,
  browserAlerts: false,
  leadDays: 7,
};

const QUIZ_PATTERN = /\b(quiz|quizzes|pop\s*quiz|mini[- ]?quiz|vocab\s*check|reading\s*check|check[- ]?in)\b/i;
const TEST_PATTERN =
  /\b(test|tests|exam|exams|midterm|final|unit\s*\d+|chapter\s*\d+\s*test|assessment|summative|frq|benchmark|ap\s*practice|practicum)\b/i;

export function classifyWorkCategory(
  title: string,
  categoryName?: string
): 'test' | 'quiz' | 'assignment' {
  const combined = `${title || ''} ${categoryName || ''}`;
  if (QUIZ_PATTERN.test(title)) return 'quiz';
  if (TEST_PATTERN.test(title)) return 'test';
  if (QUIZ_PATTERN.test(combined)) return 'quiz';
  if (TEST_PATTERN.test(combined)) return 'test';
  return 'assignment';
}

export function isCategoryEnabled(
  category: NotificationCategory,
  prefs: NotificationPrefs
): boolean {
  switch (category) {
    case 'test':
      return prefs.tests;
    case 'quiz':
      return prefs.quizzes;
    case 'assignment':
      return prefs.assignments;
    case 'mail':
      return prefs.mail;
  }
}

function parseIsoDayStart(isoDate: string): number | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

function formatDueCountdown(daysDiff: number): string {
  if (daysDiff < -1) return `Due ${Math.abs(daysDiff)} days ago`;
  if (daysDiff === -1) return 'Due yesterday';
  if (daysDiff === 0) return 'Due today';
  if (daysDiff === 1) return 'Due tomorrow';
  return `Due in ${daysDiff} days`;
}

export function getCategoryLabel(category: NotificationCategory): string {
  switch (category) {
    case 'test':
      return 'Test';
    case 'quiz':
      return 'Quiz';
    case 'assignment':
      return 'Assignment';
    case 'mail':
      return 'Mail';
  }
}

/**
 * Generates live upcoming / due-soon / ungraded alerts for tests, quizzes, and assignments
 * from the active term's courses.
 */
export function buildCourseUpcomingNotifications(
  courses: Course[],
  prefs: NotificationPrefs,
  readIds: Record<string, boolean>,
  dismissedIds: Record<string, boolean>,
  nowDate = new Date()
): AppNotification[] {
  const todayStart = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  ).getTime();
  const msPerDay = 86_400_000;
  const results: AppNotification[] = [];

  for (const course of courses) {
    const catMap = new Map(course.categories.map((c) => [c.id, c.name]));

    for (let idx = 0; idx < course.assignments.length; idx++) {
      const a = course.assignments[idx];
      if (a.excused || a.earned !== null || a.isHypotheticalOnly) continue;

      const catName = catMap.get(a.categoryId);
      const workKind = classifyWorkCategory(a.title, catName);
      if (!isCategoryEnabled(workKind, prefs)) continue;

      const displayTitle = cleanAssignmentDisplayTitle(a.title, catName, idx);
      const dueMs = parseIsoDayStart(a.dueDate);
      let daysDiff: number | null = null;
      if (dueMs !== null) {
        daysDiff = Math.round((dueMs - todayStart) / msPerDay);
      }

      // Filter by configured lookahead window (keep overdue within 14 days so student doesn't miss them)
      if (daysDiff !== null && prefs.leadDays < 999) {
        if (daysDiff > prefs.leadDays) continue;
        if (daysDiff < -14) continue;
      }

      const isOverdue = daysDiff !== null && daysDiff < 0;
      const notifId = `upcoming:${course.id}:${a.id}`;
      if (dismissedIds[notifId]) continue;

      const kindLabel = getCategoryLabel(workKind);
      const timingText =
        daysDiff !== null ? formatDueCountdown(daysDiff) : 'Upcoming ungraded';

      results.push({
        id: notifId,
        category: workKind,
        kind: isOverdue ? 'overdue' : 'upcoming',
        title: displayTitle,
        subtitle: `${course.code} · ${course.name} · ${timingText}`,
        detail: `${kindLabel} · ${catName || 'Coursework'} · ${a.possible} pts · Due ${a.dueDate || 'TBD'}`,
        date: a.dueDate || nowDate.toISOString().slice(0, 10),
        courseId: course.id,
        courseCode: course.code,
        createdAt: a.dueDate || nowDate.toISOString().slice(0, 10),
        unread: !readIds[notifId],
      });
    }
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compares previous courses against newly synced courses to emit event notifications
 * for newly posted tests, quizzes, assignments, and newly graded scores.
 */
export function diffSyncedCourseEvents(
  previousCourses: Course[],
  incomingCourses: Course[],
  prefs: NotificationPrefs
): AppNotification[] {
  if (previousCourses.length === 0) return [];

  const prevMap = new Map<
    string,
    { earned: number | null; possible: number; title: string }
  >();
  for (const c of previousCourses) {
    for (const a of c.assignments) {
      prevMap.set(`${c.code.toLowerCase()}::${a.id}`, {
        earned: a.earned,
        possible: a.possible,
        title: a.title,
      });
      prevMap.set(`${c.code.toLowerCase()}::title::${a.title.toLowerCase()}`, {
        earned: a.earned,
        possible: a.possible,
        title: a.title,
      });
    }
  }

  const nowIso = new Date().toISOString();
  const events: AppNotification[] = [];

  for (const course of incomingCourses) {
    const catMap = new Map(course.categories.map((c) => [c.id, c.name]));

    course.assignments.forEach((a, idx) => {
      if (a.excused) return;
      const catName = catMap.get(a.categoryId);
      const workKind = classifyWorkCategory(a.title, catName);
      if (!isCategoryEnabled(workKind, prefs)) return;

      const displayTitle = cleanAssignmentDisplayTitle(a.title, catName, idx);
      const prev =
        prevMap.get(`${course.code.toLowerCase()}::${a.id}`) ||
        prevMap.get(`${course.code.toLowerCase()}::title::${a.title.toLowerCase()}`);

      if (!prev) {
        const pct =
          a.earned !== null && a.possible > 0 ? (a.earned / a.possible) * 100 : null;
        events.push({
          id: `sync-new:${course.id}:${a.id}`,
          category: workKind,
          kind: a.earned !== null ? 'grade-posted' : 'new-item',
          title:
            a.earned !== null
              ? `New ${getCategoryLabel(workKind)} Grade: ${displayTitle}`
              : `New ${getCategoryLabel(workKind)} Posted: ${displayTitle}`,
          subtitle:
            a.earned !== null
              ? `${course.code} · ${a.earned}/${a.possible} (${formatPercent(pct)})`
              : `${course.code} · ${course.name} · Due ${a.dueDate || 'TBD'}`,
          detail: `${catName || 'Coursework'} · ${a.possible} pts`,
          date: a.dueDate || nowIso.slice(0, 10),
          courseId: course.id,
          courseCode: course.code,
          createdAt: nowIso,
          unread: true,
        });
      } else if (
        a.earned !== null &&
        (prev.earned === null || Math.abs(prev.earned - a.earned) >= 0.01)
      ) {
        const pct = a.possible > 0 ? (a.earned / a.possible) * 100 : null;
        events.push({
          id: `sync-grade:${course.id}:${a.id}:${a.earned}`,
          category: workKind,
          kind: 'grade-posted',
          title: `${getCategoryLabel(workKind)} Graded: ${displayTitle}`,
          subtitle: `${course.code} · ${a.earned}/${a.possible} (${formatPercent(pct)})`,
          detail:
            prev.earned !== null
              ? `Updated from ${prev.earned}/${prev.possible}`
              : `${catName || 'Coursework'}`,
          date: a.dueDate || nowIso.slice(0, 10),
          courseId: course.id,
          courseCode: course.code,
          createdAt: nowIso,
          unread: true,
        });
      }
    });
  }

  return events;
}

/**
 * Converts fetched Edupoint Synergy Mail messages into notification center items.
 */
export function buildMailNotifications(
  messages: EdupointMailMessage[],
  prefs: NotificationPrefs,
  readIds: Record<string, boolean>,
  dismissedIds: Record<string, boolean>
): AppNotification[] {
  if (!prefs.mail) return [];

  return messages
    .filter((m) => !dismissedIds[`mail:${m.id}`])
    .map((m) => {
      const id = `mail:${m.id}`;
      return {
        id,
        category: 'mail' as const,
        kind: 'mail' as const,
        title: m.subject || '(No Subject)',
        subtitle: `${m.sender || 'Edupoint Mail'} · ${m.date || 'Recent'}`,
        detail: m.preview || 'Open StudentVUE Synergy Mail to view the full message.',
        date: m.date || new Date().toISOString().slice(0, 10),
        createdAt: m.date || new Date().toISOString(),
        unread: m.unread && !readIds[id],
      };
    });
}

/* ---------------- Browser Notification API Helpers ---------------- */

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return 'unsupported';
  }
  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission;
  }
}

export function sendBrowserNotification(title: string, body: string): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.Notification === 'undefined' ||
    window.Notification.permission !== 'granted'
  ) {
    return false;
  }
  try {
    new window.Notification(title, {
      body,
      silent: false,
    });
    return true;
  } catch {
    return false;
  }
}
