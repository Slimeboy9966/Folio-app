import React, { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  FileUp,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  School,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  Course,
  EdupointMailMessage,
  EdupointReportPeriod,
  EdupointStudentInfo,
} from '../types/grades';
import {
  BiometricSupportInfo,
  SavedLoginSummary,
  authenticateWithFingerprint,
  checkBiometricSupport,
  clearSavedLogin,
  getSavedLoginSummary,
  loadDecryptedLogin,
  registerFingerprintCredential,
  saveEncryptedLogin,
  updateSavedLoginBiometric,
} from '../utils/credentialVault';
import { PUSD_HOST, PUSD_SCHOOLS, PusdSchoolId, getSchoolOption } from '../utils/schools';

export interface EdupointLoginPayload {
  token: string;
  host: string;
  studentInfo: EdupointStudentInfo;
  reportingPeriods: EdupointReportPeriod[];
  activePeriodIndex: string;
  activePeriodName: string;
  termId: string;
  courses: Course[];
  mailMessages?: EdupointMailMessage[];
  syncedAt: string;
  notice?: string;
}

export interface EdupointImportPayload {
  termId: string;
  termName: string;
  courses: Course[];
}

interface EdupointModalProps {
  initialError?: string | null;
  selectedSchool: PusdSchoolId;
  onSelectSchool: (school: PusdSchoolId) => void;
  onSuccess: (payload: EdupointLoginPayload) => void;
  onImportSuccess: (payload: EdupointImportPayload) => void;
  onSavedLoginChange?: (summary: SavedLoginSummary | null) => void;
  onClose: () => void;
}

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30 disabled:opacity-60';

async function safeReadJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const EdupointModal: React.FC<EdupointModalProps> = ({
  initialError = null,
  selectedSchool,
  onSelectSchool,
  onSuccess,
  onImportSuccess,
  onSavedLoginChange,
  onClose,
}) => {
  const activeSchool = getSchoolOption(selectedSchool);
  const [mode, setMode] = useState<'login' | 'sso-import'>('login');

  // Saved credential vault + biometric state
  const [savedSummary, setSavedSummary] = useState<SavedLoginSummary | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [biometricSupport, setBiometricSupport] = useState<BiometricSupportInfo>({
    supported: false,
    platformAvailable: false,
  });

  // Direct PUSD StudentVUE Login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isParent, setIsParent] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(true);
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [showCustomHost, setShowCustomHost] = useState(false);
  const [districtUrl, setDistrictUrl] = useState(PUSD_HOST);

  // Google SSO / Page Import state
  const [pastedContent, setPastedContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Syncing All Classes...');
  const [enrollingBiometric, setEnrollingBiometric] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getSavedLoginSummary(), checkBiometricSupport()]).then(([summary, bio]) => {
      if (!active) return;
      setSavedSummary(summary);
      setBiometricSupport(bio);
      if (summary) {
        setUsername(summary.username);
        setDistrictUrl(summary.districtUrl || PUSD_HOST);
        setIsParent(summary.isParent);
        setEnableBiometric(summary.biometricEnabled);
      } else {
        setEnableBiometric(bio.platformAvailable);
      }
      setVaultReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading && !enrollingBiometric) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, enrollingBiometric, onClose]);

  const executeEdupointLogin = async (creds: {
    username: string;
    password: string;
    isParent: boolean;
    districtUrl: string;
  }): Promise<{ ok: true; data: EdupointLoginPayload } | { ok: false; error: string }> => {
    try {
      const response = await fetch('/api/studentvue/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: creds.username.trim(),
          password: creds.password,
          isParent: creds.isParent,
          districtUrl: creds.districtUrl.trim() || PUSD_HOST,
        }),
      });

      const data = await safeReadJson(response);
      if (!response.ok) {
        const msg =
          typeof data?.error === 'string'
            ? data.error
            : `Edupoint sign-in failed (HTTP ${response.status}). Please try again.`;
        return { ok: false, error: msg };
      }

      if (!data) {
        return {
          ok: false,
          error: 'Received an empty response from the server. Please refresh and try again.',
        };
      }

      return { ok: true, data: data as unknown as EdupointLoginPayload };
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      return {
        ok: false,
        error: detail
          ? `Could not reach the sync service (${detail}). Try refreshing the page and signing in again.`
          : 'Could not reach the sync service. Try refreshing the page and signing in again.',
      };
    }
  };

  const handleSavedSignIn = async (useFingerprint: boolean) => {
    if (!savedSummary) return;
    setLoading(true);
    setError(null);
    setStatusMessage(null);

    if (useFingerprint) {
      setLoadingLabel('Waiting for Fingerprint...');
      const authResult = await authenticateWithFingerprint(savedSummary.credentialId);
      if (!authResult.ok) {
        setError(authResult.error);
        setLoading(false);
        return;
      }
    }

    setLoadingLabel('Unlocking Saved Login...');
    const decrypted = await loadDecryptedLogin();
    if (!decrypted) {
      setError('Could not decrypt your saved login on this device. Please sign in manually once to re-save it.');
      setShowManualForm(true);
      setLoading(false);
      return;
    }

    setLoadingLabel('Syncing All Classes...');
    const result = await executeEdupointLogin(decrypted);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    onSuccess(result.data);
  };

  const handleEnableFingerprintForSaved = async () => {
    if (!savedSummary) return;
    setEnrollingBiometric(true);
    setError(null);
    setStatusMessage(null);

    const reg = await registerFingerprintCredential(savedSummary.username);
    if (!reg.ok) {
      setError(reg.error);
      setEnrollingBiometric(false);
      return;
    }

    const updated = await getSavedLoginSummary();
    setSavedSummary(updated);
    onSavedLoginChange?.(updated);
    setStatusMessage('Fingerprint sign-in is now enabled for this device.');
    setEnrollingBiometric(false);
  };

  const handleDisableFingerprintForSaved = async () => {
    const updated = await updateSavedLoginBiometric(false, undefined);
    setSavedSummary(updated);
    onSavedLoginChange?.(updated);
    setStatusMessage('Fingerprint lock turned off. Your login stays saved on this device.');
    setError(null);
  };

  const handleForgetSavedLogin = async () => {
    await clearSavedLogin();
    setSavedSummary(null);
    onSavedLoginChange?.(null);
    setShowManualForm(true);
    setPassword('');
    setStatusMessage('Saved login removed from this device.');
    setError(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUser = username.trim();
    if (!trimmedUser || !password) return;

    setLoading(true);
    setLoadingLabel('Syncing All Classes...');
    setError(null);
    setStatusMessage(null);

    const targetHost = districtUrl.trim() || PUSD_HOST;
    const result = await executeEdupointLogin({
      username: trimmedUser,
      password,
      isParent,
      districtUrl: targetHost,
    });

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    let notice: string | undefined;

    if (rememberLogin) {
      try {
        const nextSummary = await saveEncryptedLogin({
          username: trimmedUser,
          password,
          districtUrl: targetHost,
          isParent,
        });
        setSavedSummary(nextSummary);
        onSavedLoginChange?.(nextSummary);

        if (enableBiometric && biometricSupport.supported && !nextSummary.biometricEnabled) {
          setLoadingLabel('Confirm Fingerprint...');
          const bioReg = await registerFingerprintCredential(trimmedUser);
          if (bioReg.ok) {
            const refreshed = await getSavedLoginSummary();
            setSavedSummary(refreshed);
            onSavedLoginChange?.(refreshed);
          } else {
            notice = bioReg.iframeBlocked
              ? 'Login saved securely. Open Folio in its own browser tab to finish enabling fingerprint sign-in.'
              : 'Login saved securely. You can enable fingerprint sign-in anytime from Manage Login.';
          }
        }
      } catch {
        notice = 'Signed in, but this browser blocked saving encrypted credentials.';
      }
    }

    onSuccess({ ...result.data, notice });
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pastedContent.trim()) return;

    setLoading(true);
    setLoadingLabel('Importing...');
    setError(null);

    try {
      const response = await fetch('/api/studentvue/parse-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: pastedContent }),
      });

      const data = await safeReadJson(response);
      if (!response.ok || !data) {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : 'Could not detect StudentVUE courses in the pasted content.'
        );
        setLoading(false);
        return;
      }

      onImportSuccess(data as unknown as EdupointImportPayload);
    } catch {
      setError('Could not process the imported StudentVUE page. Please try again.');
      setLoading(false);
    }
  };

  const handleHtmlFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPastedContent(String(reader.result || ''));
      setError(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const busy = loading || enrollingBiometric;
  const showingSavedCard = vaultReady && savedSummary !== null && !showManualForm;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edupoint-modal-title"
        className="w-full max-w-md glass-modal rounded-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-200/70 dark:border-white/10 flex items-start justify-between gap-4">
          <div>
            <h2
              id="edupoint-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Connect Edupoint StudentVUE
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {activeSchool.name} · {activeSchool.district}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close modal"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="grid grid-cols-2 p-1 bg-slate-200/70 dark:bg-white/[0.06] border border-slate-300/60 dark:border-white/10 rounded-xl">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-1.5 px-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              StudentVUE Login
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('sso-import');
                setError(null);
              }}
              className={`py-1.5 px-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                mode === 'sso-import'
                  ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Google SSO / Paste
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto">
          {mode === 'login' ? (
            showingSavedCard && savedSummary ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-white/65 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Saved {savedSummary.isParent ? 'ParentVUE' : 'StudentVUE'} Account
                      </div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                        {savedSummary.username}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {savedSummary.districtUrl === PUSD_HOST
                          ? activeSchool.name
                          : savedSummary.districtUrl}
                      </div>
                    </div>
                    <ShieldCheck
                      className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                      aria-label="Encrypted on this device"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    {savedSummary.biometricEnabled ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSavedSignIn(true)}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
                        >
                          {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Fingerprint className="w-4 h-4" />
                          )}
                          {loading ? loadingLabel : 'Sign In with Fingerprint'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSavedSignIn(false)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 hover:bg-white dark:hover:bg-white/[0.12] rounded-xl transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Quick Sign In Without Fingerprint
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSavedSignIn(false)}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
                        >
                          {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <KeyRound className="w-4 h-4" />
                          )}
                          {loading ? loadingLabel : 'Quick Sign In & Sync Grades'}
                        </button>
                        {biometricSupport.supported && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleEnableFingerprintForSaved()}
                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 dark:text-sky-300 bg-white/80 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 hover:bg-white dark:hover:bg-white/[0.12] rounded-xl transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            {enrollingBiometric ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Fingerprint className="w-3.5 h-3.5" />
                            )}
                            {enrollingBiometric
                              ? 'Setting Up Fingerprint...'
                              : 'Enable Fingerprint Sign-In'}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setShowManualForm(true);
                        setError(null);
                        setStatusMessage(null);
                      }}
                      className="font-medium text-blue-700 dark:text-sky-400 hover:text-blue-900 dark:hover:text-sky-300 disabled:opacity-50 whitespace-nowrap"
                    >
                      Use different account
                    </button>

                    <div className="flex items-center gap-3">
                      {savedSummary.biometricEnabled && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDisableFingerprintForSaved()}
                          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-50 whitespace-nowrap"
                        >
                          Disable fingerprint
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleForgetSavedLogin()}
                        className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Trash2 className="w-3 h-3" />
                        Forget login
                      </button>
                    </div>
                  </div>
                </div>

                {statusMessage && (
                  <div className="p-3 rounded-xl bg-emerald-50/90 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-400/25 text-xs text-emerald-800 dark:text-emerald-200">
                    {statusMessage}
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50/90 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-400/25 text-xs text-rose-800 dark:text-rose-200"
                  >
                    {error}
                  </div>
                )}

                <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <Lock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    Your saved StudentVUE credentials are encrypted on this device with Web Crypto
                    and unlocked only when you sign in.
                  </span>
                </div>
              </div>
            ) : (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                {savedSummary && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setShowManualForm(false);
                      setError(null);
                    }}
                    className="text-xs font-medium text-blue-700 dark:text-sky-400 hover:text-blue-900 dark:hover:text-sky-300"
                  >
                    ← Back to saved account ({savedSummary.username})
                  </button>
                )}

                {/* School Selector (Amador Valley HS / Foothill HS) */}
                <div className="p-3.5 rounded-xl bg-white/60 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <School className="w-4 h-4 text-blue-700 dark:text-sky-400 shrink-0" />
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        Select High School
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCustomHost((v) => !v)}
                      className="text-[11px] font-medium text-blue-700 dark:text-sky-400 hover:text-blue-900 dark:hover:text-sky-300 whitespace-nowrap shrink-0"
                    >
                      {showCustomHost ? 'Hide URL' : 'Change URL'}
                    </button>
                  </div>

                  <div role="group" aria-label="Select high school" className="grid grid-cols-2 gap-2">
                    {PUSD_SCHOOLS.map((school) => {
                      const isSelected = selectedSchool === school.id;
                      return (
                        <button
                          key={school.id}
                          type="button"
                          disabled={busy}
                          aria-pressed={isSelected}
                          onClick={() => {
                            onSelectSchool(school.id);
                            setDistrictUrl(school.host);
                          }}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border text-center transition-colors whitespace-nowrap truncate ${
                            isSelected
                              ? 'bg-blue-600/10 dark:bg-sky-500/15 border-blue-600/50 dark:border-sky-400/50 text-blue-800 dark:text-sky-200'
                              : 'bg-white/70 dark:bg-white/[0.04] border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-white/[0.08]'
                          }`}
                        >
                          {school.shortName}
                        </button>
                      );
                    })}
                  </div>

                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {activeSchool.name} · <span className="font-mono">{districtUrl}</span>
                  </div>
                </div>

                {showCustomHost && (
                  <div>
                    <label
                      htmlFor="edupoint-host"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Edupoint District Portal Host
                    </label>
                    <input
                      id="edupoint-host"
                      type="text"
                      value={districtUrl}
                      onChange={(e) => setDistrictUrl(e.target.value)}
                      placeholder="ca-pleas-psv.edupoint.com"
                      className={`${INPUT_CLASS} font-mono text-xs`}
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="edupoint-username"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    StudentVUE Username
                  </label>
                  <input
                    id="edupoint-username"
                    type="text"
                    autoComplete="username"
                    required
                    autoFocus
                    placeholder="Your PUSD Student ID / username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={busy}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label
                    htmlFor="edupoint-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="edupoint-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      placeholder="Your StudentVUE password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      className={`${INPUT_CLASS} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5 pt-0.5">
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberLogin}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setRememberLogin(checked);
                        if (!checked) setEnableBiometric(false);
                      }}
                      disabled={busy}
                      className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Save my login encrypted on this device</span>
                  </label>

                  {rememberLogin && biometricSupport.supported && (
                    <label className="flex items-start gap-2 pl-5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableBiometric}
                        onChange={(e) => setEnableBiometric(e.target.checked)}
                        disabled={busy}
                        className="mt-0.5 rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="flex items-center gap-1.5">
                        <Fingerprint className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                        <span>Enable Fingerprint / Biometric sign-in (Touch ID / Windows Hello)</span>
                      </span>
                    </label>
                  )}

                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isParent}
                      onChange={(e) => setIsParent(e.target.checked)}
                      disabled={busy}
                      className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Sign in using a ParentVUE account instead</span>
                  </label>
                </div>

                {statusMessage && (
                  <div className="p-3 rounded-xl bg-emerald-50/90 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-400/25 text-xs text-emerald-800 dark:text-emerald-200">
                    {statusMessage}
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50/90 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-400/25 text-xs text-rose-800 dark:text-rose-200 space-y-1"
                  >
                    <div>{error}</div>
                    <div className="text-rose-700 dark:text-rose-300/90">
                      If you usually click <strong>Login with Google</strong> on StudentVUE, switch
                      to the <strong>Google SSO / Paste</strong> tab above.
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 pt-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-900 dark:text-slate-100">
                      Your password and grades are not shared with anybody but you.
                    </strong>{' '}
                    {rememberLogin ? (
                      <>
                        Signs in directly over HTTPS to StudentVUE, and stores your saved login
                        encrypted only on this device.
                      </>
                    ) : (
                      <>
                        Signs in directly over HTTPS to StudentVUE without saving your password.
                      </>
                    )}
                  </span>
                </div>

                <div className="pt-3 border-t border-slate-200/70 dark:border-white/10 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-xl disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {loading ? loadingLabel : 'Sign In & Sync Grades'}
                  </button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                <p>
                  If you sign in to {activeSchool.shortName} StudentVUE with{' '}
                  <strong className="text-slate-900 dark:text-white">Login with Google</strong>:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-400">
                  <li>
                    Open{' '}
                    <a
                      href="https://ca-pleas-psv.edupoint.com/PXP2_Login_Student.aspx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 dark:text-sky-400 hover:underline font-medium"
                    >
                      PUSD StudentVUE
                    </a>{' '}
                    and go to your{' '}
                    <strong className="text-slate-800 dark:text-slate-200">Grade Book</strong> (or
                    open a specific class to include all assignments).
                  </li>
                  <li>
                    Press{' '}
                    <strong className="font-mono text-slate-800 dark:text-slate-200">Ctrl+A</strong>{' '}
                    then{' '}
                    <strong className="font-mono text-slate-800 dark:text-slate-200">Ctrl+C</strong>{' '}
                    (or save the page as HTML) and paste or upload it below.
                  </li>
                </ol>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="sv-paste"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Grade Book Content
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-sky-400 hover:text-blue-900 dark:hover:text-sky-300"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    Upload Saved HTML
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".html,.htm,.txt"
                    onChange={handleHtmlFileUpload}
                    className="hidden"
                  />
                </div>
                <textarea
                  id="sv-paste"
                  rows={6}
                  required
                  placeholder="Paste copied StudentVUE Grade Book text, assignment rows, or HTML here..."
                  value={pastedContent}
                  onChange={(e) => setPastedContent(e.target.value)}
                  disabled={busy}
                  className={`${INPUT_CLASS} font-mono text-xs`}
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50/90 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-400/25 text-xs text-rose-800 dark:text-rose-200"
                >
                  {error}
                </div>
              )}

              <div className="pt-3 border-t border-slate-200/70 dark:border-white/10 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-xl disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {loading ? loadingLabel : 'Import Grades'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
