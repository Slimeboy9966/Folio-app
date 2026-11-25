import React, { useMemo, useState } from 'react';
import {
  Bell,
  BellRing,
  BookOpen,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  Link2,
  Loader2,
  Mail,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  AppNotification,
  EdupointSessionInfo,
  NotificationCategory,
  NotificationPrefs,
} from '../types/grades';
import {
  BrowserNotificationPermission,
  getBrowserNotificationPermission,
  getCategoryLabel,
  requestBrowserNotificationPermission,
  sendBrowserNotification,
} from '../utils/notifications';

interface NotificationsViewProps {
  notifications: AppNotification[];
  prefs: NotificationPrefs;
  edupointSession: EdupointSessionInfo | null;
  isCheckingMail: boolean;
  lastMailCheck: string | null;
  mailCheckError: string | null;
  onUpdatePrefs: (next: NotificationPrefs) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClearDismissed: () => void;
  hasDismissed: boolean;
  onSelectCourse: (courseId: string) => void;
  onRefreshMail: () => void;
  onOpenEdupointModal: () => void;
}

type FilterKey = 'all' | NotificationCategory;

function getCategoryIcon(category: NotificationCategory) {
  switch (category) {
    case 'test':
      return FileCheck2;
    case 'quiz':
      return ClipboardList;
    case 'assignment':
      return BookOpen;
    case 'mail':
      return Mail;
  }
}

function getCategoryAccent(category: NotificationCategory): string {
  switch (category) {
    case 'test':
      return 'text-rose-600 dark:text-rose-400';
    case 'quiz':
      return 'text-amber-600 dark:text-amber-400';
    case 'assignment':
      return 'text-blue-600 dark:text-sky-400';
    case 'mail':
      return 'text-emerald-600 dark:text-emerald-400';
  }
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  notifications,
  prefs,
  edupointSession,
  isCheckingMail,
  lastMailCheck,
  mailCheckError,
  onUpdatePrefs,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearDismissed,
  hasDismissed,
  onSelectCourse,
  onRefreshMail,
  onOpenEdupointModal,
}) => {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showPrefs, setShowPrefs] = useState(false);
  const [expandedMailId, setExpandedMailId] = useState<string | null>(null);
  const [permission, setPermission] = useState<BrowserNotificationPermission>(() =>
    getBrowserNotificationPermission()
  );
  const [testAlertStatus, setTestAlertStatus] = useState<string | null>(null);

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = {
      all: notifications.length,
      test: 0,
      quiz: 0,
      assignment: 0,
      mail: 0,
    };
    for (const n of notifications) {
      out[n.category] += 1;
    }
    return out;
  }, [notifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications]
  );

  const visibleItems = useMemo(() => {
    if (filter === 'all') return notifications;
    return notifications.filter((n) => n.category === filter);
  }, [notifications, filter]);

  const handleToggleBrowserAlerts = async () => {
    setTestAlertStatus(null);
    if (prefs.browserAlerts && permission === 'granted') {
      onUpdatePrefs({ ...prefs, browserAlerts: false });
      return;
    }

    const result = await requestBrowserNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      onUpdatePrefs({ ...prefs, browserAlerts: true });
      sendBrowserNotification(
        'Folio Alerts Enabled',
        'You will be notified for upcoming tests, quizzes, assignments, and new Edupoint mail.'
      );
      setTestAlertStatus('Browser alerts are active on this device.');
    } else if (result === 'denied') {
      onUpdatePrefs({ ...prefs, browserAlerts: false });
      setTestAlertStatus(
        'Browser notifications are blocked in site settings. In-app alerts still work here.'
      );
    } else {
      onUpdatePrefs({ ...prefs, browserAlerts: false });
      setTestAlertStatus('Browser push alerts are unavailable here. In-app alerts remain active.');
    }
  };

  const handleSendTestAlert = () => {
    const sent = sendBrowserNotification(
      'Folio Reminder Preview',
      'Upcoming Test, Quiz, Assignment, and StudentVUE Mail alerts will appear like this.'
    );
    setTestAlertStatus(
      sent
        ? 'Test notification sent to your device.'
        : 'Enable Browser Alerts first (or check site permissions) to preview OS notifications.'
    );
  };

  const filterTabs: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'test', label: 'Tests' },
    { key: 'quiz', label: 'Quizzes' },
    { key: 'assignment', label: 'Assignments' },
    { key: 'mail', label: 'Mail' },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Top Action & Filter Strip */}
      <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Alerts &amp; Synergy Mail
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              <span aria-hidden="true"> · </span>
              <span>
                {counts.test} {counts.test === 1 ? 'test' : 'tests'}, {counts.quiz}{' '}
                {counts.quiz === 1 ? 'quiz' : 'quizzes'}, {counts.assignment}{' '}
                {counts.assignment === 1 ? 'assignment' : 'assignments'}, {counts.mail} mail
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {edupointSession && (
              <button
                type="button"
                disabled={isCheckingMail}
                onClick={onRefreshMail}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 dark:text-sky-300 bg-white/75 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {isCheckingMail ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Check Mail
              </button>
            )}

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/75 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowPrefs((v) => !v)}
              aria-expanded={showPrefs}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                showPrefs
                  ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 border-slate-900 dark:border-sky-500'
                  : 'text-slate-700 dark:text-slate-200 bg-white/75 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border-slate-200/80 dark:border-white/10'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Preferences
            </button>
          </div>
        </div>

        {/* Category Filter Tabs (wraps cleanly on narrow mobile, zero horizontal scroll) */}
        <div
          role="tablist"
          aria-label="Filter notifications by category"
          className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-200/60 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/10 rounded-xl"
        >
          {filterTabs.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setFilter(tab.key)}
                className={`flex-1 min-w-[78px] px-2.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap tabular-nums ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {tab.label} ({counts[tab.key]})
              </button>
            );
          })}
        </div>

        {/* Collapsible Notification Preferences */}
        {showPrefs && (
          <div className="pt-4 border-t border-slate-200/70 dark:border-white/10 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  ['tests', 'Tests & Exams', 'Unit exams, midterms, finals, and benchmarks'],
                  ['quizzes', 'Quizzes', 'Pop quizzes, vocab checks, and short assessments'],
                  ['assignments', 'Assignments', 'Homework, labs, essays, and projects'],
                  ['mail', 'New Mail', 'StudentVUE Synergy Mail from teachers & school'],
                ] as const
              ).map(([key, label, desc]) => (
                <label
                  key={key}
                  className="flex items-start gap-3 p-3 rounded-xl bg-white/60 dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/10 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={prefs[key]}
                    onChange={(e) => onUpdatePrefs({ ...prefs, [key]: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {desc}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-400 font-medium">
                  Upcoming reminder window:
                </span>
                <div className="inline-flex items-center p-0.5 bg-slate-200/60 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 rounded-lg">
                  {(
                    [
                      [3, '3 days'],
                      [7, '7 days'],
                      [14, '14 days'],
                      [999, 'All'],
                    ] as const
                  ).map(([days, label]) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => onUpdatePrefs({ ...prefs, leadDays: days })}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        prefs.leadDays === days
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggleBrowserAlerts()}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl transition-colors whitespace-nowrap ${
                    prefs.browserAlerts && permission === 'granted'
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 text-white'
                  }`}
                >
                  <BellRing className="w-3.5 h-3.5" />
                  {prefs.browserAlerts && permission === 'granted'
                    ? 'Browser Alerts On'
                    : 'Enable Browser Alerts'}
                </button>

                {permission === 'granted' && (
                  <button
                    type="button"
                    onClick={handleSendTestAlert}
                    className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/75 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
                  >
                    Send Test Alert
                  </button>
                )}

                {hasDismissed && (
                  <button
                    type="button"
                    onClick={onClearDismissed}
                    className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                  >
                    Restore dismissed
                  </button>
                )}
              </div>
            </div>

            {testAlertStatus && (
              <p className="text-xs text-slate-600 dark:text-slate-300">{testAlertStatus}</p>
            )}
          </div>
        )}
      </section>

      {/* Mail Connection Helper when viewing Mail tab without active Edupoint session */}
      {filter === 'mail' && !edupointSession && (
        <section className="glass-panel rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Connect StudentVUE to Check Synergy Mail
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Sign in to PUSD Edupoint StudentVUE to pull unread teacher emails and school messages
              right into your alert feed.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenEdupointModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors whitespace-nowrap"
          >
            <Link2 className="w-3.5 h-3.5" />
            Connect StudentVUE
          </button>
        </section>
      )}

      {mailCheckError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-50/90 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-400/25 text-xs text-rose-800 dark:text-rose-200"
        >
          {mailCheckError}
        </div>
      )}

      {/* Notification Feed */}
      <section aria-label="Notification items" className="glass-panel rounded-2xl overflow-hidden">
        {visibleItems.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Bell className="w-6 h-6 text-slate-400 dark:text-slate-500 mx-auto" />
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {filter === 'mail'
                ? edupointSession
                  ? 'No new Synergy Mail messages found'
                  : 'No mail synced yet'
                : 'No active alerts in this category'}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {filter === 'mail' && edupointSession
                ? lastMailCheck
                  ? `Last checked at ${new Date(lastMailCheck).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}. New teacher messages will show up automatically on sync.`
                  : 'Tap Check Mail above to scan your StudentVUE inbox.'
                : 'Upcoming tests, quizzes, assignments, and newly posted grades appear here automatically.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200/60 dark:divide-white/[0.07]">
            {visibleItems.map((item) => {
              const Icon = getCategoryIcon(item.category);
              const accentClass = getCategoryAccent(item.category);
              const isExpandedMail = item.category === 'mail' && expandedMailId === item.id;

              return (
                <div
                  key={item.id}
                  className={`p-4 sm:px-5 transition-colors ${
                    item.unread
                      ? 'bg-blue-50/45 dark:bg-sky-500/[0.06]'
                      : 'hover:bg-white/50 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 w-9 h-9 rounded-xl bg-white/80 dark:bg-white/[0.06] border border-slate-200/70 dark:border-white/10 flex items-center justify-center shrink-0 ${accentClass}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onMarkRead(item.id);
                        if (item.category === 'mail') {
                          setExpandedMailId((prev) => (prev === item.id ? null : item.id));
                        } else if (item.courseId) {
                          onSelectCourse(item.courseId);
                        }
                      }}
                      className="flex-1 min-w-0 text-left group"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className={`font-semibold ${accentClass}`}>
                          {getCategoryLabel(item.category)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {item.kind === 'overdue'
                            ? 'Past Due'
                            : item.kind === 'grade-posted'
                              ? 'Grade Posted'
                              : item.kind === 'new-item'
                                ? 'New'
                                : item.kind === 'mail'
                                  ? item.unread
                                    ? 'Unread Message'
                                    : 'Message'
                                  : 'Upcoming'}
                        </span>
                        {item.unread && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-blue-700 dark:text-sky-400">
                              Unread
                            </span>
                          </>
                        )}
                      </div>

                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-sky-400 transition-colors break-words">
                        {item.title}
                      </div>

                      <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 break-words">
                        {item.subtitle}
                      </div>

                      {item.detail && (
                        <div
                          className={`mt-1 text-xs text-slate-500 dark:text-slate-400 ${
                            isExpandedMail ? 'whitespace-pre-line' : 'line-clamp-2'
                          }`}
                        >
                          {item.detail}
                        </div>
                      )}
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      {item.courseId && (
                        <button
                          type="button"
                          onClick={() => {
                            onMarkRead(item.id);
                            onSelectCourse(item.courseId as string);
                          }}
                          aria-label={`Open course for ${item.title}`}
                          className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDismiss(item.id)}
                        aria-label={`Dismiss ${item.title}`}
                        title="Dismiss alert"
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-rose-500/10 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
