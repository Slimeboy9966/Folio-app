import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookOpen,
  Mail,
  Moon,
  Search,
  Sliders,
  Sun,
} from 'lucide-react';
import {
  AppNotification,
  Assignment,
  Course,
  CourseResult,
  EdupointMailMessage,
  EdupointSessionInfo,
  GradeScaleEntry,
  GradebookState,
  HypotheticalOverlay,
  NotificationPrefs,
  SavedScenario,
} from './types/grades';
import {
  INITIAL_GRADEBOOK_STATE,
  PUSD_GRADE_SCALE,
  isLegacyCollegeScale,
} from './data/sampleData';
import {
  EMPTY_OVERLAY,
  computeCourseResult,
  computeTermSummary,
  makeAssignmentKey,
} from './utils/gradeMath';
import { OverviewView } from './components/OverviewView';
import { CourseDetailView } from './components/CourseDetailView';
import { GradeScaleView } from './components/GradeScaleView';
import { NotificationsView } from './components/NotificationsView';
import { SchoolEmailView } from './components/SchoolEmailView';
import { QuickSearchModal } from './components/QuickSearchModal';
import { AssignmentModal, CourseModal, NamePromptModal } from './components/Modals';
import {
  EdupointImportPayload,
  EdupointLoginPayload,
  EdupointModal,
} from './components/EdupointModal';
import { SignInScreen } from './components/SignInScreen';
import {
  SavedLoginSummary,
  authenticateWithFingerprint,
  clearSavedLogin,
  getSavedLoginSummary,
  loadDecryptedLogin,
} from './utils/credentialVault';
import {
  DEFAULT_NOTIFICATION_PREFS,
  buildCourseUpcomingNotifications,
  buildMailNotifications,
  diffSyncedCourseEvents,
  isCategoryEnabled,
  sendBrowserNotification,
} from './utils/notifications';
import {
  PusdSchoolId,
  detectSchoolIdFromName,
  getSchoolOption,
} from './utils/schools';
import { GmailAccountInfo, subscribeGmailAuth } from './utils/gmailAuth';

type MainTab = 'overview' | 'course' | 'email' | 'scale';
type ThemeMode = 'dark' | 'light';

const STORAGE_KEY_DATA = 'folio_gradebook_data_v1';
const STORAGE_KEY_OVERLAY = 'folio_gradebook_overlay_v1';
const STORAGE_KEY_THEME = 'folio_theme_v1';
const STORAGE_KEY_NOTIF_PREFS = 'folio_notif_prefs_v1';
const STORAGE_KEY_NOTIF_READ = 'folio_notif_read_v1';
const STORAGE_KEY_NOTIF_DISMISSED = 'folio_notif_dismissed_v1';
const STORAGE_KEY_SYNC_EVENTS = 'folio_sync_events_v1';
const STORAGE_KEY_MAIL = 'folio_edupoint_mail_v1';
const STORAGE_KEY_COMPLETED_TASKS = 'folio_completed_tasks_v1';
const STORAGE_KEY_SCHOOL = 'folio_selected_school_v1';

const EMPTY_GRADEBOOK_STATE: GradebookState = {
  terms: [{ id: 'term-current', name: 'Current Term' }],
  activeTermId: 'term-current',
  courses: [],
  gradeScale: PUSD_GRADE_SCALE,
  priorGpa: 0,
  priorCredits: 0,
  savedScenarios: [],
};

function wipeCachedGradebookStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_DATA);
    localStorage.removeItem(STORAGE_KEY_OVERLAY);
    localStorage.removeItem(STORAGE_KEY_SYNC_EVENTS);
    localStorage.removeItem(STORAGE_KEY_MAIL);
    localStorage.removeItem(STORAGE_KEY_COMPLETED_TASKS);
    localStorage.removeItem(STORAGE_KEY_NOTIF_READ);
    localStorage.removeItem(STORAGE_KEY_NOTIF_DISMISSED);
  } catch {
    // Ignore storage errors
  }
  try {
    sessionStorage.removeItem('folio_ai_chat_v1');
  } catch {
    // Ignore sessionStorage errors
  }
}

function loadInitialSchool(): PusdSchoolId {
  try {
    return localStorage.getItem(STORAGE_KEY_SCHOOL) === 'foothill' ? 'foothill' : 'amador-valley';
  } catch {
    return 'amador-valley';
  }
}

function loadInitialTheme(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY_THEME) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function loadStoredGradebookState(): GradebookState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATA);
    if (!raw) return EMPTY_GRADEBOOK_STATE;
    const parsed = JSON.parse(raw) as GradebookState;
    if (!parsed || !Array.isArray(parsed.courses) || !Array.isArray(parsed.terms)) {
      return EMPTY_GRADEBOOK_STATE;
    }

    const hasEdupoint = parsed.courses.some((c) => c.source === 'edupoint');
    let nextScale = Array.isArray(parsed.gradeScale) && parsed.gradeScale.length > 0
      ? parsed.gradeScale
      : PUSD_GRADE_SCALE;
    let nextPriorGpa = typeof parsed.priorGpa === 'number' ? parsed.priorGpa : 0;
    let nextPriorCredits = typeof parsed.priorCredits === 'number' ? parsed.priorCredits : 0;

    // One-time accuracy migration for existing Edupoint accounts that inherited
    // the old college +/- scale (A- = 3.7) or fake sample prior record (3.62 / 42 cr)
    if (hasEdupoint) {
      if (isLegacyCollegeScale(nextScale)) {
        nextScale = PUSD_GRADE_SCALE;
      }
      if (nextPriorGpa === 3.62 && nextPriorCredits === 42) {
        nextPriorGpa = 0;
        nextPriorCredits = 0;
      }
    }

    return {
      ...EMPTY_GRADEBOOK_STATE,
      ...parsed,
      gradeScale: nextScale,
      priorGpa: nextPriorGpa,
      priorCredits: nextPriorCredits,
      savedScenarios: Array.isArray(parsed.savedScenarios) ? parsed.savedScenarios : [],
    };
  } catch {
    return EMPTY_GRADEBOOK_STATE;
  }
}

function loadInitialOverlay(): HypotheticalOverlay {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OVERLAY);
    if (!raw) return EMPTY_OVERLAY;
    const parsed = JSON.parse(raw) as HypotheticalOverlay;
    return {
      edits: parsed?.edits || {},
      addedAssignments: parsed?.addedAssignments || {},
      removedAssignmentKeys: parsed?.removedAssignmentKeys || {},
    };
  } catch {
    return EMPTY_OVERLAY;
  }
}

function loadInitialNotifPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_NOTIF_PREFS);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      ...DEFAULT_NOTIFICATION_PREFS,
      ...parsed,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

function loadJsonMap(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function loadJsonArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  // Never hydrate cached grades until the encrypted login vault confirms a saved password exists
  const [state, setState] = useState<GradebookState>(EMPTY_GRADEBOOK_STATE);
  const [overlay, setOverlay] = useState<HypotheticalOverlay>(EMPTY_OVERLAY);
  const [isHypothetical, setIsHypothetical] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeMode>(loadInitialTheme);
  const [selectedSchool, setSelectedSchool] = useState<PusdSchoolId>(loadInitialSchool);

  const [activeTab, setActiveTab] = useState<MainTab>('overview');
  const [mailSubTab, setMailSubTab] = useState<'gmail' | 'alerts'>('gmail');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [showGpaOnOverview, setShowGpaOnOverview] = useState<boolean>(() => {
    try {
      return localStorage.getItem('folio_show_gpa_overview_v1') !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('folio_show_gpa_overview_v1', String(showGpaOnOverview));
    } catch {}
  }, [showGpaOnOverview]);

  // Modals
  const [courseModalState, setCourseModalState] = useState<{
    open: boolean;
    editingCourse: Course | null;
  }>({ open: false, editingCourse: null });

  const [assignmentModalState, setAssignmentModalState] = useState<{
    open: boolean;
    courseId: string | null;
    editingAssignment: Assignment | null;
  }>({ open: false, courseId: null, editingAssignment: null });

  const [addTermModalOpen, setAddTermModalOpen] = useState(false);
  const [saveScenarioModalOpen, setSaveScenarioModalOpen] = useState(false);

  // Edupoint StudentVUE live session (stored strictly in React memory, never localStorage)
  const [edupointSession, setEdupointSession] = useState<EdupointSessionInfo | null>(null);
  const [importedInSession, setImportedInSession] = useState(false);
  const [edupointModalOpen, setEdupointModalOpen] = useState(false);
  const [edupointModalError, setEdupointModalError] = useState<string | null>(null);
  const [isSyncingEdupoint, setIsSyncingEdupoint] = useState(false);
  const [isQuickSigningIn, setIsQuickSigningIn] = useState(false);
  const [edupointSyncError, setEdupointSyncError] = useState<string | null>(null);
  const [edupointNotice, setEdupointNotice] = useState<string | null>(null);
  const [savedLogin, setSavedLogin] = useState<SavedLoginSummary | null>(null);
  const [vaultChecked, setVaultChecked] = useState(false);

  // Notifications & Synergy Mail state (hydrated only when a saved password exists)
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(loadInitialNotifPrefs);
  const [readNotifIds, setReadNotifIds] = useState<Record<string, boolean>>({});
  const [dismissedNotifIds, setDismissedNotifIds] = useState<Record<string, boolean>>({});
  const [syncEventNotifications, setSyncEventNotifications] = useState<AppNotification[]>([]);
  const [mailMessages, setMailMessages] = useState<EdupointMailMessage[]>([]);
  const [isCheckingMail, setIsCheckingMail] = useState(false);
  const [lastMailCheck, setLastMailCheck] = useState<string | null>(null);
  const [mailCheckError, setMailCheckError] = useState<string | null>(null);

  // Quick Search (⌘K) state
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [completedTaskIds, setCompletedTaskIds] = useState<Record<string, boolean>>({});

  // Opt-in School Email (Gmail) state — OAuth access token stays strictly in memory
  const [gmailAccount, setGmailAccount] = useState<GmailAccountInfo | null>(null);
  const [hasGmailToken, setHasGmailToken] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeGmailAuth((account, hasToken) => {
      setGmailAccount(account);
      setHasGmailToken(hasToken);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    getSavedLoginSummary()
      .then((summary) => {
        if (!active) return;
        setSavedLogin(summary);
        if (summary) {
          // Saved password exists on this device — restore cached grades & metadata
          setState(loadStoredGradebookState());
          setOverlay(loadInitialOverlay());
          setReadNotifIds(loadJsonMap(STORAGE_KEY_NOTIF_READ));
          setDismissedNotifIds(loadJsonMap(STORAGE_KEY_NOTIF_DISMISSED));
          setSyncEventNotifications(loadJsonArray<AppNotification>(STORAGE_KEY_SYNC_EVENTS));
          setMailMessages(loadJsonArray<EdupointMailMessage>(STORAGE_KEY_MAIL));
          setCompletedTaskIds(loadJsonMap(STORAGE_KEY_COMPLETED_TASKS));
        } else {
          // No saved password — wipe any lingering old grades from browser storage
          wipeCachedGradebookStorage();
        }
        setVaultChecked(true);
      })
      .catch(() => {
        if (!active) return;
        wipeCachedGradebookStorage();
        setVaultChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Only persist gradebook data & mail to localStorage when the user has a saved password
  useEffect(() => {
    if (!vaultChecked) return;
    if (!savedLogin) {
      wipeCachedGradebookStorage();
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(state));
    } catch {
      // Ignore storage quota issues
    }
  }, [state, savedLogin, vaultChecked]);

  useEffect(() => {
    if (!vaultChecked || !savedLogin) return;
    try {
      localStorage.setItem(STORAGE_KEY_OVERLAY, JSON.stringify(overlay));
    } catch {
      // Ignore storage quota issues
    }
  }, [overlay, savedLogin, vaultChecked]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY_THEME, theme);
    } catch {
      // Ignore storage quota issues
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SCHOOL, selectedSchool);
    } catch {
      // Ignore storage quota issues
    }
  }, [selectedSchool]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NOTIF_PREFS, JSON.stringify(notifPrefs));
    } catch {
      // Ignore storage quota issues
    }
  }, [notifPrefs]);

  useEffect(() => {
    if (!vaultChecked || !savedLogin) return;
    try {
      localStorage.setItem(STORAGE_KEY_NOTIF_READ, JSON.stringify(readNotifIds));
    } catch {
      // Ignore storage quota issues
    }
  }, [readNotifIds, savedLogin, vaultChecked]);

  useEffect(() => {
    if (!vaultChecked || !savedLogin) return;
    try {
      localStorage.setItem(STORAGE_KEY_NOTIF_DISMISSED, JSON.stringify(dismissedNotifIds));
    } catch {
      // Ignore storage quota issues
    }
  }, [dismissedNotifIds, savedLogin, vaultChecked]);

  useEffect(() => {
    if (!vaultChecked || !savedLogin) return;
    try {
      localStorage.setItem(
        STORAGE_KEY_SYNC_EVENTS,
        JSON.stringify(syncEventNotifications.slice(0, 50))
      );
    } catch {
      // Ignore storage quota issues
    }
  }, [syncEventNotifications, savedLogin, vaultChecked]);

  useEffect(() => {
    if (!vaultChecked || !savedLogin) return;
    try {
      localStorage.setItem(STORAGE_KEY_MAIL, JSON.stringify(mailMessages.slice(0, 50)));
    } catch {
      // Ignore storage quota issues
    }
  }, [mailMessages, savedLogin, vaultChecked]);

  useEffect(() => {
    if (!vaultChecked || !savedLogin) return;
    try {
      localStorage.setItem(STORAGE_KEY_COMPLETED_TASKS, JSON.stringify(completedTaskIds));
    } catch {
      // Ignore storage quota issues
    }
  }, [completedTaskIds, savedLogin, vaultChecked]);

  const canAccessGrades = Boolean(edupointSession || savedLogin || importedInSession);

  // Global Cmd+K / Ctrl+K shortcut for Quick Search (only when unlocked)
  useEffect(() => {
    if (!canAccessGrades) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canAccessGrades]);


  const activeTerm =
    state.terms.find((t) => t.id === state.activeTermId) || state.terms[0] || null;

  const termCourses = useMemo(
    () => state.courses.filter((c) => c.termId === state.activeTermId),
    [state.courses, state.activeTermId]
  );

  const selectedCourse = useMemo(
    () => termCourses.find((c) => c.id === selectedCourseId) || null,
    [termCourses, selectedCourseId]
  );

  // Compute Actual and Hypothetical results for every course in the active term
  const actualCourseResults = useMemo(() => {
    const map: Record<string, CourseResult> = {};
    for (const c of termCourses) {
      map[c.id] = computeCourseResult(c, state.gradeScale, null);
    }
    return map;
  }, [termCourses, state.gradeScale]);

  const displayCourseResults = useMemo(() => {
    if (!isHypothetical || activeTab !== 'course') return actualCourseResults;
    const map: Record<string, CourseResult> = {};
    for (const c of termCourses) {
      map[c.id] = computeCourseResult(c, state.gradeScale, overlay);
    }
    return map;
  }, [termCourses, state.gradeScale, isHypothetical, activeTab, overlay, actualCourseResults]);

  const actualSummary = useMemo(
    () =>
      computeTermSummary(
        termCourses,
        state.gradeScale,
        null,
        state.priorGpa,
        state.priorCredits
      ),
    [termCourses, state.gradeScale, state.priorGpa, state.priorCredits]
  );

  // Merge upcoming tests/quizzes/assignments, live sync events, and Synergy Mail
  const allNotifications = useMemo(() => {
    const upcoming = buildCourseUpcomingNotifications(
      termCourses,
      notifPrefs,
      readNotifIds,
      dismissedNotifIds
    );
    const mail = buildMailNotifications(
      mailMessages,
      notifPrefs,
      readNotifIds,
      dismissedNotifIds
    );
    const syncEvents = syncEventNotifications
      .filter((n) => isCategoryEnabled(n.category, notifPrefs) && !dismissedNotifIds[n.id])
      .map((n) => ({ ...n, unread: !readNotifIds[n.id] }));

    const merged = new Map<string, AppNotification>();
    for (const item of [...syncEvents, ...mail, ...upcoming]) {
      if (!merged.has(item.id)) {
        merged.set(item.id, item);
      }
    }

    return Array.from(merged.values()).sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      if (a.kind === 'overdue' && b.kind !== 'overdue') return -1;
      if (b.kind === 'overdue' && a.kind !== 'overdue') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [
    termCourses,
    notifPrefs,
    readNotifIds,
    dismissedNotifIds,
    mailMessages,
    syncEventNotifications,
  ]);

  const unreadNotificationCount = useMemo(
    () => allNotifications.filter((n) => n.unread).length,
    [allNotifications]
  );

  const hasDismissedNotifications = useMemo(
    () => Object.keys(dismissedNotifIds).length > 0,
    [dismissedNotifIds]
  );

  /* ---------------- Navigation Handlers ---------------- */

  const handleSelectCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    setActiveTab('course');
  };

  const handleNavClick = (tab: MainTab) => {
    if (tab !== 'course') {
      setIsHypothetical(false);
    }
    if (tab === 'course') {
      const targetId = selectedCourse?.id || termCourses[0]?.id || null;
      if (targetId) {
        setSelectedCourseId(targetId);
        setActiveTab('course');
      } else {
        setActiveTab('overview');
      }
    } else {
      setActiveTab(tab);
    }
  };

  /* ---------------- Real Data CRUD Handlers ---------------- */

  const handleSaveCourse = (course: Course) => {
    setState((prev) => {
      const exists = prev.courses.some((c) => c.id === course.id);
      const nextCourses = exists
        ? prev.courses.map((c) => (c.id === course.id ? course : c))
        : [...prev.courses, course];
      return { ...prev, courses: nextCourses };
    });
    setCourseModalState({ open: false, editingCourse: null });
    setSelectedCourseId(course.id);
    setActiveTab('course');
  };

  const handleDeleteCourse = (courseId: string) => {
    setState((prev) => ({
      ...prev,
      courses: prev.courses.filter((c) => c.id !== courseId),
    }));
    setCourseModalState({ open: false, editingCourse: null });
    if (selectedCourseId === courseId) {
      setSelectedCourseId(null);
      setActiveTab('overview');
    }
  };

  const handleSaveAssignment = (assignment: Assignment) => {
    const targetCourseId = assignmentModalState.courseId;
    if (!targetCourseId) return;

    if (isHypothetical && !assignmentModalState.editingAssignment) {
      // Add to hypothetical overlay only
      setOverlay((prev) => ({
        ...prev,
        addedAssignments: {
          ...prev.addedAssignments,
          [targetCourseId]: [...(prev.addedAssignments[targetCourseId] || []), assignment],
        },
      }));
    } else {
      // Save to real course data (clear official snapshot so manual edit recalculates live)
      setState((prev) => ({
        ...prev,
        courses: prev.courses.map((c) => {
          if (c.id !== targetCourseId) return c;
          const exists = c.assignments.some((a) => a.id === assignment.id);
          return {
            ...c,
            officialPercent: null,
            officialLetter: null,
            assignments: exists
              ? c.assignments.map((a) => (a.id === assignment.id ? assignment : a))
              : [...c.assignments, assignment],
          };
        }),
      }));
    }

    setAssignmentModalState({ open: false, courseId: null, editingAssignment: null });
  };

  const handleDeleteRealAssignment = (courseId: string, assignmentId: string) => {
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((c) =>
        c.id === courseId
          ? {
              ...c,
              officialPercent: null,
              officialLetter: null,
              assignments: c.assignments.filter((a) => a.id !== assignmentId),
            }
          : c
      ),
    }));
  };

  const handleAddTerm = (name: string) => {
    const id = `term-${Date.now()}`;
    setState((prev) => ({
      ...prev,
      terms: [{ id, name, isCurrent: false }, ...prev.terms],
      activeTermId: id,
    }));
    setSelectedCourseId(null);
    setActiveTab('overview');
    setAddTermModalOpen(false);
  };

  /* ---------------- Hypothetical Mode Handlers ---------------- */

  const handleUpdateHypotheticalScore = (
    courseId: string,
    assignmentId: string,
    earned: number | null
  ) => {
    setOverlay((prev) => {
      // Check if it's a hypothetical-only added assignment
      const addedList = prev.addedAssignments[courseId] || [];
      if (addedList.some((a) => a.id === assignmentId)) {
        return {
          ...prev,
          addedAssignments: {
            ...prev.addedAssignments,
            [courseId]: addedList.map((a) =>
              a.id === assignmentId ? { ...a, earned } : a
            ),
          },
        };
      }

      const course = state.courses.find((c) => c.id === courseId);
      const original = course?.assignments.find((a) => a.id === assignmentId);
      const key = makeAssignmentKey(courseId, assignmentId);
      const nextEdits = { ...prev.edits };

      if (original && original.earned === earned) {
        // Revert edit if it matches original
        const existing = { ...(nextEdits[key] || {}) };
        delete existing.earned;
        if (Object.keys(existing).length === 0) {
          delete nextEdits[key];
        } else {
          nextEdits[key] = existing;
        }
      } else {
        nextEdits[key] = { ...(nextEdits[key] || {}), earned };
      }

      return { ...prev, edits: nextEdits };
    });
  };

  const handleToggleHypotheticalExclude = (courseId: string, assignmentId: string) => {
    const key = makeAssignmentKey(courseId, assignmentId);
    setOverlay((prev) => {
      const nextRemoved = { ...prev.removedAssignmentKeys };
      if (nextRemoved[key]) {
        delete nextRemoved[key];
      } else {
        nextRemoved[key] = true;
      }
      return { ...prev, removedAssignmentKeys: nextRemoved };
    });
  };

  const handleResetHypotheticalItem = (courseId: string, assignmentId: string) => {
    const key = makeAssignmentKey(courseId, assignmentId);
    setOverlay((prev) => {
      const nextEdits = { ...prev.edits };
      const nextRemoved = { ...prev.removedAssignmentKeys };
      delete nextEdits[key];
      delete nextRemoved[key];
      return { ...prev, edits: nextEdits, removedAssignmentKeys: nextRemoved };
    });
  };

  const handleRemoveHypotheticalAdded = (courseId: string, assignmentId: string) => {
    setOverlay((prev) => ({
      ...prev,
      addedAssignments: {
        ...prev.addedAssignments,
        [courseId]: (prev.addedAssignments[courseId] || []).filter((a) => a.id !== assignmentId),
      },
    }));
  };

  const handleFillUngraded = (courseId: string, percent: number) => {
    const course = state.courses.find((c) => c.id === courseId);
    if (!course) return;
    setOverlay((prev) => {
      const nextEdits = { ...prev.edits };
      for (const a of course.assignments) {
        if (a.earned === null && !a.excused && !a.extraCredit) {
          const key = makeAssignmentKey(courseId, a.id);
          const pts = Math.round(((percent / 100) * a.possible) * 10) / 10;
          nextEdits[key] = { ...(nextEdits[key] || {}), earned: pts };
        }
      }
      return { ...prev, edits: nextEdits };
    });
  };

  const handleSimulateTargetScore = (
    courseId: string,
    assignmentIds: string[],
    requiredPercent: number
  ) => {
    const course = state.courses.find((c) => c.id === courseId);
    if (!course) return;
    setIsHypothetical(true);
    setOverlay((prev) => {
      const nextEdits = { ...prev.edits };
      const addedList = [...(prev.addedAssignments[courseId] || [])];

      for (const id of assignmentIds) {
        const addedIdx = addedList.findIndex((a) => a.id === id);
        if (addedIdx >= 0) {
          const item = addedList[addedIdx];
          const pts = Math.round(((requiredPercent / 100) * item.possible) * 10) / 10;
          addedList[addedIdx] = { ...item, earned: pts };
        } else {
          const realItem = course.assignments.find((a) => a.id === id);
          if (realItem) {
            const key = makeAssignmentKey(courseId, id);
            const pts = Math.round(((requiredPercent / 100) * realItem.possible) * 10) / 10;
            nextEdits[key] = { ...(nextEdits[key] || {}), earned: pts };
          }
        }
      }

      return {
        ...prev,
        edits: nextEdits,
        addedAssignments:
          addedList.length > 0
            ? { ...prev.addedAssignments, [courseId]: addedList }
            : prev.addedAssignments,
      };
    });
    setSelectedCourseId(courseId);
    setActiveTab('course');
  };

  const handleResetCourseHypothetical = (courseId: string) => {
    const prefix = `${courseId}::`;
    setOverlay((prev) => {
      const nextEdits: HypotheticalOverlay['edits'] = {};
      for (const [k, v] of Object.entries(prev.edits)) {
        if (!k.startsWith(prefix)) nextEdits[k] = v;
      }
      const nextRemoved: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev.removedAssignmentKeys)) {
        if (!k.startsWith(prefix)) nextRemoved[k] = v;
      }
      const nextAdded = { ...prev.addedAssignments };
      delete nextAdded[courseId];
      return {
        edits: nextEdits,
        addedAssignments: nextAdded,
        removedAssignmentKeys: nextRemoved,
      };
    });
  };

  const handleApplyHypotheticalToReal = () => {
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((course) => {
        if (course.termId !== prev.activeTermId) return course;

        const updatedReal = course.assignments
          .filter((a) => !overlay.removedAssignmentKeys[makeAssignmentKey(course.id, a.id)])
          .map((a) => {
            const edit = overlay.edits[makeAssignmentKey(course.id, a.id)];
            if (!edit) return a;
            return {
              ...a,
              earned: 'earned' in edit ? (edit.earned ?? null) : a.earned,
              possible: edit.possible !== undefined ? edit.possible : a.possible,
              excused: edit.excused !== undefined ? edit.excused : a.excused,
              extraCredit: edit.extraCredit !== undefined ? edit.extraCredit : a.extraCredit,
            };
          });

        const addedReal = (overlay.addedAssignments[course.id] || []).map((a) => ({
          ...a,
          isHypotheticalOnly: false,
        }));

        return {
          ...course,
          officialPercent: null,
          officialLetter: null,
          assignments: [...updatedReal, ...addedReal],
        };
      }),
    }));

    setOverlay(EMPTY_OVERLAY);
    setIsHypothetical(false);
  };

  const handleSaveScenario = (name: string) => {
    const scenario: SavedScenario = {
      id: `scen-${Date.now()}`,
      name,
      createdAt: new Date().toISOString().slice(0, 10),
      overlay: JSON.parse(JSON.stringify(overlay)),
    };
    setState((prev) => ({
      ...prev,
      savedScenarios: [scenario, ...prev.savedScenarios],
    }));
    setSaveScenarioModalOpen(false);
  };

  /* ---------------- Settings & Import/Export Handlers ---------------- */

  const handleUpdateGradeScale = (next: GradeScaleEntry[]) => {
    setState((prev) => ({ ...prev, gradeScale: next }));
  };

  const handleUpdatePriorRecord = (gpa: number, credits: number) => {
    setState((prev) => ({ ...prev, priorGpa: gpa, priorCredits: credits }));
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `folio-grades-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (jsonText: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(jsonText) as GradebookState;
      if (!parsed || !Array.isArray(parsed.courses) || !Array.isArray(parsed.terms)) {
        return { ok: false, error: 'File does not contain valid Folio gradebook data.' };
      }
      setState({
        ...INITIAL_GRADEBOOK_STATE,
        ...parsed,
        savedScenarios: Array.isArray(parsed.savedScenarios) ? parsed.savedScenarios : [],
      });
      setOverlay(EMPTY_OVERLAY);
      setSelectedCourseId(null);
      setActiveTab('overview');
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not parse JSON file.' };
    }
  };

  const handleResetSampleData = () => {
    setState(INITIAL_GRADEBOOK_STATE);
    setOverlay(EMPTY_OVERLAY);
    setIsHypothetical(false);
    setSelectedCourseId(null);
    setActiveTab('overview');
  };

  const handleClearAllData = () => {
    const blankTermId = 'current-term';
    setState({
      terms: [{ id: blankTermId, name: 'Current Term', isCurrent: true }],
      activeTermId: blankTermId,
      courses: [],
      gradeScale: state.gradeScale,
      priorGpa: 0,
      priorCredits: 0,
      savedScenarios: [],
    });
    setOverlay(EMPTY_OVERLAY);
    setIsHypothetical(false);
    setSelectedCourseId(null);
    setActiveTab('overview');
  };

  /* ---------------- Edupoint StudentVUE Sync Handlers ---------------- */

  const applySyncedGradebookToState = (
    termId: string,
    activePeriodName: string,
    syncedCourses: Course[],
    reportingPeriods: EdupointSessionInfo['reportingPeriods'],
    host: string
  ) => {
    const sampleTermIds = new Set(INITIAL_GRADEBOOK_STATE.terms.map((t) => t.id));
    setState((prev) => {
      const onlySampleData =
        prev.courses.length > 0 &&
        prev.terms.every((t) => sampleTermIds.has(t.id)) &&
        prev.courses.every((c) => c.source !== 'edupoint');

      const baseTerms = onlySampleData ? [] : prev.terms;
      const baseCourses = onlySampleData ? [] : prev.courses;

      // Ensure all Edupoint reporting periods appear as selectable terms
      const nextTerms = [...baseTerms];
      for (const rp of reportingPeriods) {
        const rpTermId = `edupoint-${host}-${rp.index}`;
        if (!nextTerms.some((t) => t.id === rpTermId)) {
          nextTerms.push({
            id: rpTermId,
            name: rp.name,
            isCurrent: rpTermId === termId,
          });
        }
      }
      if (!nextTerms.some((t) => t.id === termId)) {
        nextTerms.unshift({ id: termId, name: activePeriodName, isCurrent: true });
      }

      // Preserve any manual GPA overrides (courseLevel, excludeFromGpa, custom credits)
      // on previously synced courses for this term
      const existingByKey = new Map<string, Course>();
      for (const c of baseCourses) {
        if (c.termId === termId && c.source === 'edupoint') {
          existingByKey.set(`${c.code.toLowerCase()}::${c.name.toLowerCase()}`, c);
          existingByKey.set(c.id, c);
        }
      }
      const mergedSyncedCourses = syncedCourses.map((c) => {
        const prevCourse =
          existingByKey.get(c.id) ||
          existingByKey.get(`${c.code.toLowerCase()}::${c.name.toLowerCase()}`);
        if (!prevCourse) return c;
        return {
          ...c,
          credits: prevCourse.credits !== 5 ? prevCourse.credits : c.credits,
          courseLevel: prevCourse.courseLevel ?? c.courseLevel,
          excludeFromGpa: prevCourse.excludeFromGpa ?? c.excludeFromGpa,
        };
      });

      // Replace previously synced courses for this exact term while keeping manual courses
      const retainedCourses = baseCourses.filter(
        (c) => !(c.termId === termId && c.source === 'edupoint')
      );

      const shouldClearSamplePrior =
        onlySampleData || (prev.priorGpa === 3.62 && prev.priorCredits === 42);
      const nextScale =
        onlySampleData || isLegacyCollegeScale(prev.gradeScale)
          ? PUSD_GRADE_SCALE
          : prev.gradeScale;

      return {
        ...prev,
        terms: nextTerms,
        activeTermId: termId,
        gradeScale: nextScale,
        priorGpa: shouldClearSamplePrior ? 0 : prev.priorGpa,
        priorCredits: shouldClearSamplePrior ? 0 : prev.priorCredits,
        courses: [...retainedCourses, ...mergedSyncedCourses],
      };
    });
  };

  /* ---------------- Notifications & Mail Helpers ---------------- */

  const emitSyncDiffNotifications = (
    previousCourses: Course[],
    incomingCourses: Course[]
  ) => {
    const events = diffSyncedCourseEvents(previousCourses, incomingCourses, notifPrefs);
    if (events.length === 0) return;

    setSyncEventNotifications((prev) => {
      const existingIds = new Set(prev.map((item) => item.id));
      const fresh = events.filter((e) => !existingIds.has(e.id));
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev].slice(0, 50);
    });

    if (notifPrefs.browserAlerts) {
      const first = events[0];
      const summaryBody =
        events.length === 1
          ? `${first.title} — ${first.subtitle}`
          : `${events.length} updates synced (including ${first.title})`;
      sendBrowserNotification('Folio Gradebook Update', summaryBody);
    }
  };

  const processIncomingMailMessages = (incoming?: EdupointMailMessage[]) => {
    if (!Array.isArray(incoming)) return;
    setLastMailCheck(new Date().toISOString());
    setMailCheckError(null);

    const prevIds = new Set(mailMessages.map((m) => m.id));
    const newlyArrivedUnread = incoming.filter((m) => m.unread && !prevIds.has(m.id));
    setMailMessages(incoming);

    if (
      notifPrefs.browserAlerts &&
      notifPrefs.mail &&
      newlyArrivedUnread.length > 0
    ) {
      const top = newlyArrivedUnread[0];
      const body =
        newlyArrivedUnread.length === 1
          ? `${top.sender}: ${top.subject}`
          : `${newlyArrivedUnread.length} new messages in Edupoint Mail`;
      sendBrowserNotification('New Edupoint Mail', body);
    }
  };

  const handleMarkNotifRead = (id: string) => {
    setReadNotifIds((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  };

  const handleMarkAllNotifRead = () => {
    setReadNotifIds((prev) => {
      const next = { ...prev };
      for (const n of allNotifications) {
        next[n.id] = true;
      }
      return next;
    });
  };

  const handleDismissNotif = (id: string) => {
    setDismissedNotifIds((prev) => ({ ...prev, [id]: true }));
  };

  const handleClearDismissedNotifs = () => {
    setDismissedNotifIds({});
  };

  const handleRefreshMail = async () => {
    if (!edupointSession) {
      setEdupointModalOpen(true);
      return;
    }
    setIsCheckingMail(true);
    setMailCheckError(null);
    try {
      const response = await fetch('/api/studentvue/mail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${edupointSession.token}`,
        },
      });
      const rawText = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }

      if (response.status === 401) {
        setEdupointSession(null);
        setMailCheckError('Session expired. Sign in to Edupoint again to check Synergy Mail.');
        return;
      }
      if (!response.ok || !data) {
        setMailCheckError(
          typeof data?.error === 'string'
            ? data.error
            : `Could not check Synergy Mail (HTTP ${response.status}).`
        );
        return;
      }

      const incoming = Array.isArray(data.messages)
        ? (data.messages as EdupointMailMessage[])
        : [];
      processIncomingMailMessages(incoming);
    } catch {
      setMailCheckError('Network error while checking Edupoint Synergy Mail.');
    } finally {
      setIsCheckingMail(false);
    }
  };

  const handleEdupointLoginSuccess = (payload: EdupointLoginPayload) => {
    const previousForTerm = state.courses.filter(
      (c) => c.termId === payload.termId && c.source === 'edupoint'
    );

    const detectedSchool = detectSchoolIdFromName(payload.studentInfo?.school);
    if (detectedSchool) {
      setSelectedSchool(detectedSchool);
    }

    setEdupointSession({
      token: payload.token,
      host: payload.host,
      studentInfo: payload.studentInfo,
      reportingPeriods: payload.reportingPeriods,
      activePeriodIndex: payload.activePeriodIndex,
      syncedAt: payload.syncedAt,
    });
    setEdupointSyncError(null);
    setEdupointModalError(null);
    setEdupointNotice(payload.notice || null);
    applySyncedGradebookToState(
      payload.termId,
      payload.activePeriodName,
      payload.courses,
      payload.reportingPeriods,
      payload.host
    );
    emitSyncDiffNotifications(previousForTerm, payload.courses);
    if (Array.isArray(payload.mailMessages)) {
      processIncomingMailMessages(payload.mailMessages);
    }
    setOverlay(EMPTY_OVERLAY);
    setSelectedCourseId(null);
    setActiveTab('overview');
    setEdupointModalOpen(false);
    void getSavedLoginSummary().then(setSavedLogin);
  };

  const handleQuickSignIn = async (useFingerprint: boolean) => {
    if (!savedLogin || isQuickSigningIn) return;
    setIsQuickSigningIn(true);
    setEdupointSyncError(null);
    setEdupointNotice(null);

    try {
      if (useFingerprint) {
        const bio = await authenticateWithFingerprint(savedLogin.credentialId);
        if (!bio.ok) {
          setEdupointModalError(bio.error);
          setEdupointModalOpen(true);
          return;
        }
      }

      const creds = await loadDecryptedLogin();
      if (!creds) {
        setEdupointModalError('Saved login could not be unlocked. Please sign in once to re-save it.');
        setEdupointModalOpen(true);
        return;
      }

      const response = await fetch('/api/studentvue/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: creds.username,
          password: creds.password,
          isParent: creds.isParent,
          districtUrl: creds.districtUrl,
        }),
      });

      const rawText = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }

      if (!response.ok || !data) {
        const msg =
          typeof data?.error === 'string'
            ? data.error
            : `Edupoint sign-in failed (HTTP ${response.status}). Please sign in again.`;
        setEdupointModalError(msg);
        setEdupointModalOpen(true);
        return;
      }

      handleEdupointLoginSuccess(data as unknown as EdupointLoginPayload);
    } catch {
      setEdupointModalError('Network error while signing in to Edupoint.');
      setEdupointModalOpen(true);
    } finally {
      setIsQuickSigningIn(false);
    }
  };

  const handleEdupointImportSuccess = (payload: EdupointImportPayload) => {
    const normalizeCourseKey = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, '');

    const isSingleClassWithAssignments =
      payload.courses.length === 1 && payload.courses[0].assignments.length > 0;

    if (isSingleClassWithAssignments) {
      const incoming = payload.courses[0];
      const activeTermCourses = state.courses.filter((c) => c.termId === state.activeTermId);
      const activeTermHasEdupoint = activeTermCourses.some((c) => c.source === 'edupoint');
      const incomingNorm = normalizeCourseKey(incoming.name);
      const isGenericName =
        incomingNorm === 'importedcourse' || incomingNorm === 'course' || incomingNorm.length < 3;

      let matchedCourse: Course | undefined;
      if (!isGenericName) {
        matchedCourse = activeTermCourses.find((c) => {
          const existingNorm = normalizeCourseKey(c.name);
          return (
            existingNorm === incomingNorm ||
            (existingNorm.length >= 4 &&
              (existingNorm.includes(incomingNorm) || incomingNorm.includes(existingNorm)))
          );
        });
      }
      if (!matchedCourse && incoming.code && /^P\d+$/i.test(incoming.code.trim())) {
        const incomingCode = incoming.code.trim().toUpperCase();
        matchedCourse = activeTermCourses.find(
          (c) => c.code.trim().toUpperCase() === incomingCode
        );
      }
      if (!matchedCourse && isGenericName && activeTab === 'course' && selectedCourse) {
        matchedCourse = selectedCourse;
      }

      if (matchedCourse) {
        const targetId = matchedCourse.id;
        setState((prev) => ({
          ...prev,
          courses: prev.courses.map((c) => {
            if (c.id !== targetId) return c;
            return {
              ...c,
              name: !isGenericName && normalizeCourseKey(c.name) === 'importedcourse'
                ? incoming.name
                : c.name,
              instructor: c.instructor || incoming.instructor,
              gradingMode: incoming.gradingMode,
              categories: incoming.categories,
              assignments: incoming.assignments,
              officialPercent:
                incoming.officialPercent !== undefined
                  ? incoming.officialPercent
                  : c.officialPercent,
              source: 'edupoint',
            };
          }),
        }));
        setOverlay(EMPTY_OVERLAY);
        setSelectedCourseId(targetId);
        setActiveTab('course');
        setEdupointModalOpen(false);
        return;
      }

      if (activeTermHasEdupoint) {
        const attachedCourse: Course = {
          ...incoming,
          termId: state.activeTermId,
          source: 'edupoint',
        };
        setState((prev) => ({
          ...prev,
          courses: [...prev.courses, attachedCourse],
        }));
        setOverlay(EMPTY_OVERLAY);
        setSelectedCourseId(attachedCourse.id);
        setActiveTab('course');
        setEdupointModalOpen(false);
        return;
      }
    }

    applySyncedGradebookToState(
      payload.termId,
      payload.termName,
      payload.courses,
      [{ index: payload.termId, name: payload.termName, startDate: '', endDate: '' }],
      'import'
    );
    setOverlay(EMPTY_OVERLAY);
    setSelectedCourseId(payload.courses.length === 1 ? payload.courses[0].id : null);
    setActiveTab(payload.courses.length === 1 ? 'course' : 'overview');
    setEdupointModalOpen(false);
  };

  const handleSyncEdupoint = async (reportPeriodIndex?: string) => {
    if (!edupointSession) {
      setEdupointModalOpen(true);
      return;
    }

    const targetPeriod =
      reportPeriodIndex !== undefined ? reportPeriodIndex : edupointSession.activePeriodIndex;
    setIsSyncingEdupoint(true);
    setEdupointSyncError(null);

    try {
      const response = await fetch('/api/studentvue/gradebook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${edupointSession.token}`,
        },
        body: JSON.stringify({ reportPeriod: targetPeriod }),
      });

      const rawText = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }

      if (response.status === 401) {
        setEdupointSession(null);
        setEdupointSyncError('Session expired. Please sign in to Edupoint again.');
        setEdupointModalOpen(true);
        return;
      }
      if (!response.ok || !data) {
        setEdupointSyncError(
          typeof data?.error === 'string'
            ? data.error
            : `Could not refresh grades from Edupoint (HTTP ${response.status}).`
        );
        return;
      }

      const nextPeriods = Array.isArray(data.reportingPeriods)
        ? (data.reportingPeriods as EdupointSessionInfo['reportingPeriods'])
        : edupointSession.reportingPeriods;
      const nextActivePeriod =
        typeof data.activePeriodIndex === 'string' ? data.activePeriodIndex : targetPeriod;
      const nextSyncedAt =
        typeof data.syncedAt === 'string' ? data.syncedAt : new Date().toISOString();

      setEdupointSession((prev) =>
        prev
          ? {
              ...prev,
              reportingPeriods: nextPeriods,
              activePeriodIndex: nextActivePeriod,
              syncedAt: nextSyncedAt,
            }
          : null
      );

      const incomingTermId = String(data.termId || '');
      const incomingCourses = (data.courses as Course[]) || [];
      const previousForTerm = state.courses.filter(
        (c) => c.termId === incomingTermId && c.source === 'edupoint'
      );

      applySyncedGradebookToState(
        incomingTermId,
        String(data.activePeriodName || 'Current Term'),
        incomingCourses,
        nextPeriods,
        edupointSession.host
      );
      emitSyncDiffNotifications(previousForTerm, incomingCourses);
      if (Array.isArray(data.mailMessages)) {
        processIncomingMailMessages(data.mailMessages as EdupointMailMessage[]);
      }
      if (reportPeriodIndex !== undefined) {
        setSelectedCourseId(null);
        if (activeTab === 'course') setActiveTab('overview');
      }
    } catch {
      setEdupointSyncError('Network error while syncing with Edupoint.');
    } finally {
      setIsSyncingEdupoint(false);
    }
  };

  const handleDisconnectEdupoint = async () => {
    const token = edupointSession?.token;
    setEdupointSession(null);
    setImportedInSession(false);
    setEdupointSyncError(null);

    if (!savedLogin) {
      setState(EMPTY_GRADEBOOK_STATE);
      setOverlay(EMPTY_OVERLAY);
      setIsHypothetical(false);
      setSelectedCourseId(null);
      setMailMessages([]);
      setSyncEventNotifications([]);
      setCompletedTaskIds({});
      wipeCachedGradebookStorage();
    }

    if (token) {
      try {
        await fetch('/api/studentvue/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore network errors on logout
      }
    }
  };

  const handleDeleteSavedLoginAndSignOut = async () => {
    const token = edupointSession?.token;
    await clearSavedLogin().catch(() => undefined);
    wipeCachedGradebookStorage();
    setSavedLogin(null);
    setEdupointSession(null);
    setImportedInSession(false);
    setEdupointSyncError(null);
    setState(EMPTY_GRADEBOOK_STATE);
    setOverlay(EMPTY_OVERLAY);
    setIsHypothetical(false);
    setSelectedCourseId(null);
    setMailMessages([]);
    setSyncEventNotifications([]);
    setCompletedTaskIds({});
    setActiveTab('overview');
    if (token) {
      try {
        await fetch('/api/studentvue/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore network errors on logout
      }
    }
  };

  const handleSelectTerm = (nextTermId: string) => {
    setState((prev) => ({ ...prev, activeTermId: nextTermId }));
    setSelectedCourseId(null);
    setIsHypothetical(false);
    if (activeTab === 'course') setActiveTab('overview');
    if (edupointSession && nextTermId.startsWith(`edupoint-${edupointSession.host}-`)) {
      const periodIdx = nextTermId.replace(`edupoint-${edupointSession.host}-`, '');
      const hasCourses = state.courses.some((c) => c.termId === nextTermId);
      if (!hasCourses) {
        void handleSyncEdupoint(periodIdx);
      }
    }
  };

  if (!vaultChecked) {
    return <div className="min-h-screen folio-canvas" aria-busy="true" />;
  }

  if (!canAccessGrades) {
    return (
      <SignInScreen
        theme={theme}
        selectedSchool={selectedSchool}
        onSelectSchool={setSelectedSchool}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onSuccess={handleEdupointLoginSuccess}
        onImportSuccess={(payload) => {
          setImportedInSession(true);
          handleEdupointImportSuccess(payload);
        }}
        onSavedLoginChange={(nextSaved) => {
          setSavedLogin(nextSaved);
          if (!nextSaved) {
            wipeCachedGradebookStorage();
          }
        }}
        savedLogin={savedLogin}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col folio-canvas text-slate-900 dark:text-slate-100 transition-colors overflow-x-clip">
      {/* Minimal Top Bar */}
      <header className="sticky top-0 z-30 glass-bar">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => handleNavClick('overview')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Folio
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setQuickSearchOpen(true)}
              aria-label="Quick search courses and assignments"
              title="Quick search (Ctrl+K)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/75 hover:bg-white dark:hover:bg-slate-800/85 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline text-slate-500 dark:text-slate-400">Search</span>
              <span className="hidden md:inline text-slate-400 dark:text-slate-500 font-mono text-[11px]">
                ⌘K
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/75 hover:bg-white dark:hover:bg-slate-800/85 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Single-Column Workspace (No Sidebar) */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-5 pb-24 space-y-6">
        {activeTab !== 'course' && (
          <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-slate-200/70 dark:border-white/10">
            <div className="min-w-0">
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {activeTerm?.name || 'Academic Term'}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white truncate mt-0.5">
                {activeTab === 'overview' && 'Grades'}
                {activeTab === 'email' && 'Mail & Alerts'}
                {activeTab === 'scale' && 'Settings'}
              </h1>
            </div>

            {activeTab === 'email' && (
              <div
                role="tablist"
                aria-label="Mail view"
                className="inline-flex items-center p-1 bg-white/80 dark:bg-slate-900/75 border border-slate-200/80 dark:border-white/10 rounded-xl shrink-0"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mailSubTab === 'gmail'}
                  onClick={() => setMailSubTab('gmail')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    mailSubTab === 'gmail'
                      ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  School Email
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mailSubTab === 'alerts'}
                  onClick={() => setMailSubTab('alerts')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    mailSubTab === 'alerts'
                      ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Bell className="w-3.5 h-3.5 shrink-0" />
                  Synergy &amp; Alerts
                  {unreadNotificationCount > 0 && (
                    <span
                      className={`font-mono text-[11px] font-semibold tabular-nums ${
                        mailSubTab === 'alerts'
                          ? 'text-sky-200 dark:text-slate-900'
                          : 'text-blue-700 dark:text-sky-400'
                      }`}
                    >
                      ({unreadNotificationCount})
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Active View */}
        {activeTab === 'overview' && (
          <OverviewView
            courses={termCourses}
            actualCourseResults={actualCourseResults}
            actualSummary={actualSummary}
            terms={state.terms}
            activeTermId={state.activeTermId}
            edupointSession={edupointSession}
            savedLogin={savedLogin}
            isSyncingEdupoint={isSyncingEdupoint}
            isQuickSigningIn={isQuickSigningIn}
            edupointSyncError={edupointSyncError}
            edupointNotice={edupointNotice}
            schoolName={getSchoolOption(selectedSchool).name}
            showGpaOnOverview={showGpaOnOverview}
            onSelectTerm={handleSelectTerm}
            onSyncEdupoint={(rp) => void handleSyncEdupoint(rp)}
            onQuickSignIn={(useFp) => void handleQuickSignIn(useFp)}
            onOpenEdupointModal={() => {
              setEdupointModalError(null);
              setEdupointModalOpen(true);
            }}
            onOpenAddCourse={() => setCourseModalState({ open: true, editingCourse: null })}
            onOpenAddTerm={() => setAddTermModalOpen(true)}
            onSelectCourse={handleSelectCourse}
          />
        )}

        {activeTab === 'course' && selectedCourse && (
          <CourseDetailView
            course={selectedCourse}
            actualResult={actualCourseResults[selectedCourse.id]}
            displayResult={displayCourseResults[selectedCourse.id]}
            gradeScale={state.gradeScale}
            isHypothetical={isHypothetical}
            overlay={overlay}
            onBack={() => {
              setIsHypothetical(false);
              setActiveTab('overview');
              setSelectedCourseId(null);
            }}
            onEditCourse={() =>
              setCourseModalState({ open: true, editingCourse: selectedCourse })
            }
            onAddAssignment={() =>
              setAssignmentModalState({
                open: true,
                courseId: selectedCourse.id,
                editingAssignment: null,
              })
            }
            onEditRealAssignment={(assignment) =>
              setAssignmentModalState({
                open: true,
                courseId: selectedCourse.id,
                editingAssignment: assignment,
              })
            }
            onDeleteRealAssignment={(assignmentId) =>
              handleDeleteRealAssignment(selectedCourse.id, assignmentId)
            }
            onUpdateHypotheticalScore={handleUpdateHypotheticalScore}
            onToggleHypotheticalExclude={handleToggleHypotheticalExclude}
            onResetHypotheticalItem={handleResetHypotheticalItem}
            onRemoveHypotheticalAdded={handleRemoveHypotheticalAdded}
            onResetCourseHypothetical={handleResetCourseHypothetical}
            onSaveScenario={() => setSaveScenarioModalOpen(true)}
            onApplyHypothetical={handleApplyHypotheticalToReal}
            onSimulateTargetScore={handleSimulateTargetScore}
            onSetHypothetical={setIsHypothetical}
          />
        )}

        {activeTab === 'email' && mailSubTab === 'gmail' && (
          <SchoolEmailView
            gmailAccount={gmailAccount}
            hasGmailToken={hasGmailToken}
            onGmailAuthSuccess={(account) => {
              setGmailAccount(account);
              setHasGmailToken(true);
            }}
            onGmailSignOut={() => {
              setHasGmailToken(false);
            }}
            studentName={edupointSession?.studentInfo.name}
            schoolName={getSchoolOption(selectedSchool).name}
          />
        )}

        {activeTab === 'email' && mailSubTab === 'alerts' && (
          <NotificationsView
            notifications={allNotifications}
            prefs={notifPrefs}
            edupointSession={edupointSession}
            isCheckingMail={isCheckingMail}
            lastMailCheck={lastMailCheck}
            mailCheckError={mailCheckError}
            onUpdatePrefs={setNotifPrefs}
            onMarkRead={handleMarkNotifRead}
            onMarkAllRead={handleMarkAllNotifRead}
            onDismiss={handleDismissNotif}
            onClearDismissed={handleClearDismissedNotifs}
            hasDismissed={hasDismissedNotifications}
            onSelectCourse={handleSelectCourse}
            onRefreshMail={() => void handleRefreshMail()}
            onOpenEdupointModal={() => {
              setEdupointModalError(null);
              setEdupointModalOpen(true);
            }}
          />
        )}

        {activeTab === 'scale' && (
          <GradeScaleView
            gradeScale={state.gradeScale}
            priorGpa={state.priorGpa}
            priorCredits={state.priorCredits}
            showGpaOnOverview={showGpaOnOverview}
            theme={theme}
            selectedSchool={selectedSchool}
            edupointSession={edupointSession}
            savedLogin={savedLogin}
            isSyncingEdupoint={isSyncingEdupoint}
            notifPrefs={notifPrefs}
            onSelectSchool={setSelectedSchool}
            onSyncEdupoint={() => void handleSyncEdupoint()}
            onOpenEdupointModal={() => {
              setEdupointModalError(null);
              setEdupointModalOpen(true);
            }}
            onSignOut={() => void handleDisconnectEdupoint()}
            onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            onUpdateNotifPrefs={setNotifPrefs}
            onDeleteSavedLogin={() => void handleDeleteSavedLoginAndSignOut()}
            onUpdateGradeScale={handleUpdateGradeScale}
            onUpdatePriorRecord={handleUpdatePriorRecord}
            onToggleShowGpaOnOverview={setShowGpaOnOverview}
            onExportJson={handleExportJson}
            onImportJson={handleImportJson}
            onClearAllData={handleClearAllData}
          />
        )}
      </main>

      {/* Universal 3-Button Bottom Navigation Bar (Mail, Grades, Settings) */}
      <nav
        aria-label="Primary navigation"
        className="fixed bottom-0 inset-x-0 z-30 glass-bar border-t border-slate-200/70 dark:border-white/10 h-16 px-4"
      >
        <div className="grid grid-cols-3 h-full max-w-md mx-auto">
          {(
            [
              { key: 'email', label: 'Mail', icon: Mail },
              { key: 'overview', label: 'Grades', icon: BookOpen },
              { key: 'scale', label: 'Settings', icon: Sliders },
            ] as const
          ).map(({ key, label, icon: Icon }) => {
            const isActive = activeTab === key || (key === 'overview' && activeTab === 'course');
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleNavClick(key)}
                className={`relative flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors px-2 cursor-pointer ${
                  isActive
                    ? 'text-blue-700 dark:text-sky-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-blue-600 dark:bg-sky-400"
                  />
                )}
                <span className="relative">
                  <Icon className="w-5 h-5" />
                  {key === 'email' && unreadNotificationCount > 0 && (
                    <span
                      aria-label={`${unreadNotificationCount} unread alerts`}
                      className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-blue-600 dark:bg-sky-400 text-white dark:text-slate-950 font-mono text-[10px] font-bold leading-none tabular-nums"
                    >
                      {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                    </span>
                  )}
                </span>
                <span className="leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      {courseModalState.open && (
        <CourseModal
          termId={state.activeTermId}
          existingCourse={courseModalState.editingCourse}
          onSave={handleSaveCourse}
          onDelete={handleDeleteCourse}
          onClose={() => setCourseModalState({ open: false, editingCourse: null })}
        />
      )}

      {assignmentModalState.open &&
        assignmentModalState.courseId &&
        (() => {
          const modalCourse = state.courses.find(
            (c) => c.id === assignmentModalState.courseId
          );
          if (!modalCourse) return null;
          return (
            <AssignmentModal
              course={modalCourse}
              existingAssignment={assignmentModalState.editingAssignment}
              isHypotheticalMode={isHypothetical}
              onSave={handleSaveAssignment}
              onClose={() =>
                setAssignmentModalState({
                  open: false,
                  courseId: null,
                  editingAssignment: null,
                })
              }
            />
          );
        })()}

      {addTermModalOpen && (
        <NamePromptModal
          title="Add Academic Term"
          subtitle="Create a new semester or quarter to organize courses."
          label="Term Name"
          placeholder="e.g., Spring 2027"
          submitLabel="Create Term"
          onSubmit={handleAddTerm}
          onClose={() => setAddTermModalOpen(false)}
        />
      )}

      {saveScenarioModalOpen && (
        <NamePromptModal
          title="Save Hypothetical Scenario"
          subtitle="Save your current simulated edits so you can compare different outcomes later."
          label="Scenario Name"
          placeholder="e.g., Ace Final Exams"
          submitLabel="Save Scenario"
          onSubmit={handleSaveScenario}
          onClose={() => setSaveScenarioModalOpen(false)}
        />
      )}

      {edupointModalOpen && (
        <EdupointModal
          initialError={edupointModalError}
          selectedSchool={selectedSchool}
          onSelectSchool={setSelectedSchool}
          onSuccess={handleEdupointLoginSuccess}
          onImportSuccess={handleEdupointImportSuccess}
          onSavedLoginChange={(nextSaved) => {
            setSavedLogin(nextSaved);
            if (!nextSaved) {
              wipeCachedGradebookStorage();
              if (!edupointSession && !importedInSession) {
                setState(EMPTY_GRADEBOOK_STATE);
                setOverlay(EMPTY_OVERLAY);
                setMailMessages([]);
                setSyncEventNotifications([]);
                setCompletedTaskIds({});
                setEdupointModalOpen(false);
              }
            }
          }}
          onClose={() => {
            setEdupointModalOpen(false);
            setEdupointModalError(null);
          }}
        />
      )}

      {quickSearchOpen && (
        <QuickSearchModal
          open={quickSearchOpen}
          courses={termCourses}
          courseResults={actualCourseResults}
          mailMessages={mailMessages}
          onSelectCourse={handleSelectCourse}
          onOpenTab={(tab) => {
            if (tab === 'notifications') {
              setMailSubTab('alerts');
              handleNavClick('email');
            } else if (tab === 'calculator') {
              handleNavClick('overview');
            } else {
              handleNavClick(tab);
            }
          }}
          onClose={() => setQuickSearchOpen(false)}
        />
      )}
    </div>
  );
}
