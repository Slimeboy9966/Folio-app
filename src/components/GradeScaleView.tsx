import React, { useRef, useState } from 'react';
import {
  Bell,
  Download,
  Fingerprint,
  KeyRound,
  Lightbulb,
  Link2,
  LogOut,
  Moon,
  RefreshCw,
  RotateCcw,
  School,
  Send,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  EdupointSessionInfo,
  GradeScaleEntry,
  NotificationPrefs,
} from '../types/grades';
import { SavedLoginSummary } from '../utils/credentialVault';
import { PUSD_SCHOOLS, PusdSchoolId } from '../utils/schools';
import {
  COLLEGE_PLUS_MINUS_GRADE_SCALE,
  PUSD_GRADE_SCALE,
} from '../data/sampleData';

interface GradeScaleViewProps {
  gradeScale: GradeScaleEntry[];
  priorGpa: number;
  priorCredits: number;
  showGpaOnOverview: boolean;
  theme: 'dark' | 'light';
  selectedSchool: PusdSchoolId;
  edupointSession: EdupointSessionInfo | null;
  savedLogin: SavedLoginSummary | null;
  isSyncingEdupoint: boolean;
  notifPrefs: NotificationPrefs;
  onSelectSchool: (school: PusdSchoolId) => void;
  onSyncEdupoint: () => void;
  onOpenEdupointModal: () => void;
  onSignOut: () => void;
  onToggleTheme: () => void;
  onUpdateNotifPrefs: (next: NotificationPrefs) => void;
  onDeleteSavedLogin: () => void;
  onUpdateGradeScale: (next: GradeScaleEntry[]) => void;
  onUpdatePriorRecord: (gpa: number, credits: number) => void;
  onToggleShowGpaOnOverview: (next: boolean) => void;
  onExportJson: () => void;
  onImportJson: (jsonText: string) => { ok: boolean; error?: string };
  onClearAllData: () => void;
}

export const GradeScaleView: React.FC<GradeScaleViewProps> = ({
  gradeScale,
  priorGpa,
  priorCredits,
  showGpaOnOverview,
  theme,
  selectedSchool,
  edupointSession,
  savedLogin,
  isSyncingEdupoint,
  notifPrefs,
  onSelectSchool,
  onSyncEdupoint,
  onOpenEdupointModal,
  onSignOut,
  onToggleTheme,
  onUpdateNotifPrefs,
  onDeleteSavedLogin,
  onUpdateGradeScale,
  onUpdatePriorRecord,
  onToggleShowGpaOnOverview,
  onExportJson,
  onImportJson,
  onClearAllData,
}) => {
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'clear' | 'vault' | null>(null);
  const [ideaText, setIdeaText] = useState('');
  const [ideaSubmitted, setIdeaSubmitted] = useState(false);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const notificationsMasterOn =
    notifPrefs.browserAlerts ||
    notifPrefs.assignments ||
    notifPrefs.tests ||
    notifPrefs.quizzes ||
    notifPrefs.mail;

  const handleToggleAllNotifications = async () => {
    if (notificationsMasterOn) {
      onUpdateNotifPrefs({
        ...notifPrefs,
        browserAlerts: false,
        assignments: false,
        tests: false,
        quizzes: false,
        mail: false,
      });
      setPushStatus('Notifications turned off.');
      return;
    }

    let allowBrowser = false;
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        allowBrowser = true;
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission().catch(() => 'denied');
        allowBrowser = perm === 'granted';
      }
    }

    onUpdateNotifPrefs({
      ...notifPrefs,
      browserAlerts: allowBrowser,
      assignments: true,
      tests: true,
      quizzes: true,
      mail: true,
    });
    setPushStatus(
      allowBrowser
        ? 'Push notifications enabled for new assignments and grades.'
        : 'In-app notifications enabled (allow browser notifications in site settings for push alerts).'
    );
  };

  const handleToggleBrowserPush = async () => {
    if (notifPrefs.browserAlerts) {
      onUpdateNotifPrefs({ ...notifPrefs, browserAlerts: false });
      return;
    }
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        onUpdateNotifPrefs({ ...notifPrefs, browserAlerts: true });
        setPushStatus('Browser push notifications enabled.');
        return;
      }
      if (Notification.permission === 'denied') {
        setPushStatus('Browser notifications are blocked in your browser settings.');
        return;
      }
      const perm = await Notification.requestPermission().catch(() => 'denied');
      if (perm === 'granted') {
        onUpdateNotifPrefs({ ...notifPrefs, browserAlerts: true });
        setPushStatus('Browser push notifications enabled.');
      } else {
        setPushStatus('Permission was not granted for browser push notifications.');
      }
    } else {
      setPushStatus('This browser does not support desktop push notifications.');
    }
  };

  const handleScaleChange = (
    index: number,
    field: 'minPercent' | 'gpa',
    rawValue: string
  ) => {
    const parsed = parseFloat(rawValue);
    if (Number.isNaN(parsed)) return;
    const next = gradeScale.map((entry, idx) =>
      idx === index ? { ...entry, [field]: parsed } : entry
    );
    onUpdateGradeScale(next);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = onImportJson(String(reader.result || ''));
      setImportStatus(
        result.ok ? 'Gradebook data imported successfully.' : result.error || 'Invalid file format.'
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleIdeaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ideaText.trim()) return;
    try {
      const existing = JSON.parse(localStorage.getItem('folio_user_ideas_v1') || '[]');
      const next = Array.isArray(existing) ? existing : [];
      next.unshift({ text: ideaText.trim(), submittedAt: new Date().toISOString() });
      localStorage.setItem('folio_user_ideas_v1', JSON.stringify(next.slice(0, 20)));
    } catch {
      // Ignore storage errors
    }
    setIdeaSubmitted(true);
    setIdeaText('');
    setTimeout(() => setIdeaSubmitted(false), 4000);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Account & Edupoint StudentVUE (all sidebar account controls consolidated here) */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              StudentVUE Account &amp; School
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {edupointSession
                ? `Signed in as ${edupointSession.studentInfo.name} · ${edupointSession.studentInfo.school}`
                : savedLogin
                  ? `Saved login ready for ${savedLogin.username}`
                  : 'Connect your Edupoint StudentVUE account to sync live grades.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {edupointSession ? (
              <>
                <button
                  type="button"
                  onClick={onSyncEdupoint}
                  disabled={isSyncingEdupoint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-sky-300 bg-blue-50/80 dark:bg-sky-500/15 hover:bg-blue-100/80 dark:hover:bg-sky-500/25 border border-blue-200/80 dark:border-sky-400/25 rounded-xl transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingEdupoint ? 'animate-spin' : ''}`} />
                  {isSyncingEdupoint ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  type="button"
                  onClick={onOpenEdupointModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
                >
                  <Fingerprint className="w-3.5 h-3.5" />
                  Manage Login
                </button>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-500/15 hover:bg-rose-100 dark:hover:bg-rose-500/25 border border-rose-200/80 dark:border-rose-400/30 rounded-xl transition-colors whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onOpenEdupointModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 rounded-xl transition-colors whitespace-nowrap"
              >
                <Link2 className="w-3.5 h-3.5" />
                Connect StudentVUE
              </button>
            )}
          </div>
        </div>

        {/* School Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/70 dark:border-white/10">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            <School className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
            <span>High School Campus</span>
          </div>
          <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-900/80 rounded-xl border border-slate-200/70 dark:border-white/10">
            {PUSD_SCHOOLS.map((school) => (
              <button
                key={school.id}
                type="button"
                onClick={() => onSelectSchool(school.id)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  selectedSchool === school.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {school.shortName}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy & Security Assurance + Delete Login Info */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Privacy &amp; Security
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Passwords and grades are not stored or accessed by anybody but the user.
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed bg-white/60 dark:bg-white/[0.03] p-3.5 rounded-xl border border-slate-200/60 dark:border-white/10">
          Your StudentVUE login and gradebook stay strictly private to your device. Any saved login is encrypted locally with AES-256 and can be permanently deleted below at any time.
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white/60 dark:bg-slate-900/60 border border-slate-200/70 dark:border-white/10 rounded-xl">
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-slate-900 dark:text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <span>Delete Saved Login Information</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Permanently remove saved username, password, fingerprint token, and cached grades from this device and sign out.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmAction('vault')}
            className="px-3.5 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 hover:bg-rose-100 dark:hover:bg-rose-500/25 border border-rose-200 dark:border-rose-400/30 rounded-xl transition-colors whitespace-nowrap"
          >
            Delete Login Info
          </button>
        </div>
      </section>

      {/* Appearance & Notification Customization */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Appearance &amp; Notifications
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Switch between light and dark mode and customize assignment push notifications.
          </p>
        </div>

        <div className="space-y-3">
          {/* Theme Toggle */}
          <div className="flex items-center justify-between gap-3 p-3.5 bg-white/60 dark:bg-slate-900/60 border border-slate-200/70 dark:border-white/10 rounded-xl">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-slate-900 dark:text-white flex items-center gap-2">
                {theme === 'dark' ? (
                  <Moon className="w-4 h-4 text-sky-400" />
                ) : (
                  <Sun className="w-4 h-4 text-amber-500" />
                )}
                <span>Theme Mode</span>
              </span>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Currently using {theme === 'dark' ? 'Dark' : 'Light'} mode.
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleTheme}
              className="px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
            >
              {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
            </button>
          </div>

          {/* Master Notifications Toggle */}
          <div className="flex items-center justify-between gap-3 p-3.5 bg-white/60 dark:bg-slate-900/60 border border-slate-200/70 dark:border-white/10 rounded-xl">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-slate-900 dark:text-white flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-600 dark:text-sky-400" />
                <span>All Notifications</span>
              </span>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Turn all gradebook alerts and push notifications on or off.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={notificationsMasterOn}
              onClick={() => void handleToggleAllNotifications()}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                notificationsMasterOn ? 'bg-blue-600 dark:bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  notificationsMasterOn ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Granular Notification Preferences */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <label className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/10 cursor-pointer text-xs text-slate-700 dark:text-slate-200">
              <span>Browser push alerts on new assignments</span>
              <input
                type="checkbox"
                checked={notifPrefs.browserAlerts}
                onChange={() => void handleToggleBrowserPush()}
                className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/10 cursor-pointer text-xs text-slate-700 dark:text-slate-200">
              <span>New assignments &amp; graded scores</span>
              <input
                type="checkbox"
                checked={notifPrefs.assignments}
                onChange={(e) =>
                  onUpdateNotifPrefs({ ...notifPrefs, assignments: e.target.checked })
                }
                className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/10 cursor-pointer text-xs text-slate-700 dark:text-slate-200">
              <span>Tests &amp; quizzes</span>
              <input
                type="checkbox"
                checked={notifPrefs.tests && notifPrefs.quizzes}
                onChange={(e) =>
                  onUpdateNotifPrefs({
                    ...notifPrefs,
                    tests: e.target.checked,
                    quizzes: e.target.checked,
                  })
                }
                className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/10 cursor-pointer text-xs text-slate-700 dark:text-slate-200">
              <span>Edupoint Synergy Mail alerts</span>
              <input
                type="checkbox"
                checked={notifPrefs.mail}
                onChange={(e) =>
                  onUpdateNotifPrefs({ ...notifPrefs, mail: e.target.checked })
                }
                className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
              />
            </label>
          </div>

          {pushStatus && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">{pushStatus}</p>
          )}
        </div>
      </section>

      {/* Suggest New Ideas */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <span>Suggest New Ideas &amp; Feedback</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Have a feature request or suggestion to improve Folio? Share it below.
          </p>
        </div>

        {ideaSubmitted ? (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 text-xs text-emerald-800 dark:text-emerald-200">
            Thank you! Your suggestion has been saved.
          </div>
        ) : (
          <form onSubmit={handleIdeaSubmit} className="space-y-3">
            <textarea
              value={ideaText}
              onChange={(e) => setIdeaText(e.target.value)}
              placeholder="Describe your idea or suggestion..."
              className="w-full h-24 bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none font-sans"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!ideaText.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 rounded-xl shadow-xs disabled:opacity-50 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                Submit Idea
              </button>
            </div>
          </form>
        )}
      </section>

      {/* GPA Display & Prior Academic Record */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              GPA Preferences
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Control GPA visibility on the Grades tab and add prior cumulative credits if desired.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={showGpaOnOverview}
              onChange={(e) => onToggleShowGpaOnOverview(e.target.checked)}
              className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
            />
            Show GPA box on Grades page
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Prior Cumulative GPA (optional)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="5"
              value={priorGpa}
              onChange={(e) => onUpdatePriorRecord(parseFloat(e.target.value) || 0, priorCredits)}
              className="w-full px-3 py-2 text-xs font-mono bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-white tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Prior Completed Credits
            </label>
            <input
              type="number"
              step="1"
              min="0"
              max="400"
              value={priorCredits}
              onChange={(e) => onUpdatePriorRecord(priorGpa, parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 text-xs font-mono bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-white tabular-nums"
            />
          </div>
        </div>
      </section>

      {/* Grading Scale Table */}
      <section className="glass-panel rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Letter Grade &amp; GPA Scale
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Customize grading scale thresholds and GPA point values.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onUpdateGradeScale(PUSD_GRADE_SCALE)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-sky-300 bg-blue-50/80 dark:bg-sky-500/15 hover:bg-blue-100/80 dark:hover:bg-sky-500/25 border border-blue-200/80 dark:border-sky-400/25 rounded-xl transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              PUSD / HS 4.0
            </button>
            <button
              type="button"
              onClick={() => onUpdateGradeScale(COLLEGE_PLUS_MINUS_GRADE_SCALE)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
            >
              College +/- 4.0
            </button>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200/70 dark:border-white/10 bg-slate-50/40 dark:bg-white/[0.02] text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 sm:px-6">Letter</th>
                <th className="py-2.5 px-4 sm:px-6">Min %</th>
                <th className="py-2.5 px-4 sm:px-6">GPA Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50 dark:divide-white/[0.06] text-sm">
              {gradeScale.map((entry, idx) => (
                <tr key={entry.letter} className="hover:bg-white/40 dark:hover:bg-white/[0.03]">
                  <td className="py-2.5 px-4 sm:px-6 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {entry.letter}
                  </td>
                  <td className="py-2.5 px-4 sm:px-6">
                    <input
                      type="number"
                      step="0.5"
                      value={entry.minPercent}
                      onChange={(e) => handleScaleChange(idx, 'minPercent', e.target.value)}
                      className="w-20 px-2.5 py-1 text-xs font-mono bg-white/80 dark:bg-slate-900/80 border border-slate-300 dark:border-white/15 rounded-lg text-slate-900 dark:text-white tabular-nums"
                    />
                  </td>
                  <td className="py-2.5 px-4 sm:px-6">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      value={entry.gpa}
                      onChange={(e) => handleScaleChange(idx, 'gpa', e.target.value)}
                      className="w-20 px-2.5 py-1 text-xs font-mono bg-white/80 dark:bg-slate-900/80 border border-slate-300 dark:border-white/15 rounded-lg text-slate-900 dark:text-white tabular-nums"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Data Backup & Reset */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Data Backup
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Export or import a local JSON backup of your gradebook.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onExportJson}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleFileImport}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => setConfirmAction('clear')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-500/15 hover:bg-rose-100 dark:hover:bg-rose-500/25 border border-rose-200/80 dark:border-rose-400/30 rounded-xl transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Gradebook
          </button>
        </div>

        {importStatus && (
          <p className="text-xs text-slate-600 dark:text-slate-300">{importStatus}</p>
        )}
      </section>

      {/* Confirmation Modal */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmAction(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm action"
            className="w-full max-w-sm glass-modal rounded-2xl p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {confirmAction === 'vault' ? 'Delete Saved Login Information?' : 'Clear Gradebook Data?'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {confirmAction === 'vault'
                ? 'This permanently removes your saved Edupoint credentials, fingerprint vault, and cached grades from this device. You will be returned to the sign-in screen.'
                : 'This clears all courses and assignments from the current workspace.'}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmAction === 'vault') {
                    onDeleteSavedLogin();
                  } else {
                    onClearAllData();
                  }
                  setConfirmAction(null);
                }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-xl"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
