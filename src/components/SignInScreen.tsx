import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileUp,
  Fingerprint,
  Loader2,
  Moon,
  School,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { EdupointImportPayload, EdupointLoginPayload } from './EdupointModal';
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
} from '../utils/credentialVault';
import { PUSD_HOST, PUSD_SCHOOLS, PusdSchoolId, getSchoolOption } from '../utils/schools';

interface SignInScreenProps {
  theme: 'dark' | 'light';
  selectedSchool: PusdSchoolId;
  onSelectSchool: (school: PusdSchoolId) => void;
  onToggleTheme: () => void;
  onSuccess: (payload: EdupointLoginPayload) => void;
  onImportSuccess: (payload: EdupointImportPayload) => void;
  onSavedLoginChange: (summary: SavedLoginSummary | null) => void;
  savedLogin?: SavedLoginSummary | null;
}

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 text-sm bg-white/85 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30 disabled:opacity-60 transition-colors';

async function safeReadJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const SignInScreen: React.FC<SignInScreenProps> = ({
  theme,
  selectedSchool,
  onSelectSchool,
  onToggleTheme,
  onSuccess,
  onImportSuccess,
  onSavedLoginChange,
  savedLogin,
}) => {
  const activeSchool = getSchoolOption(selectedSchool);
  const [mode, setMode] = useState<'login' | 'sso-import'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isParent, setIsParent] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(true);
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [showCustomHost, setShowCustomHost] = useState(false);
  const [districtUrl, setDistrictUrl] = useState(PUSD_HOST);

  const [biometricSupport, setBiometricSupport] = useState<BiometricSupportInfo>({
    supported: false,
    platformAvailable: false,
  });

  const [pastedContent, setPastedContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Signing In & Syncing...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    checkBiometricSupport().then((bio) => {
      if (!active) return;
      setBiometricSupport(bio);
      setEnableBiometric(bio.platformAvailable);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (savedLogin) {
      setUsername(savedLogin.username);
      if (savedLogin.districtUrl) {
        setDistrictUrl(savedLogin.districtUrl);
      }
      setIsParent(savedLogin.isParent);
    }
  }, [savedLogin]);

  const handleQuickSignIn = async () => {
    setLoading(true);
    setLoadingLabel('Signing In with Saved Device Data...');
    setError(null);
    try {
      const creds = await loadDecryptedLogin();
      if (!creds) {
        setError('Saved login information could not be loaded. Please enter your password.');
        setLoading(false);
        return;
      }
      setUsername(creds.username);
      setDistrictUrl(creds.districtUrl);
      setIsParent(creds.isParent);
      setPassword(creds.password);

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

      const data = await safeReadJson(response);
      if (!response.ok || !data) {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : 'Sign in failed. Please check your password.'
        );
        setLoading(false);
        return;
      }

      onSuccess(data as unknown as EdupointLoginPayload);
    } catch {
      setError('Could not complete sign in.');
      setLoading(false);
    }
  };

  const handleFingerprintVerification = async () => {
    setLoading(true);
    setLoadingLabel('Confirming Fingerprint...');
    setError(null);
    try {
      const bioRes = await authenticateWithFingerprint(savedLogin?.credentialId);
      if (!bioRes.ok) {
        setError(bioRes.error);
        setLoading(false);
        return;
      }
      await handleQuickSignIn();
    } catch {
      setError('Fingerprint verification failed.');
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUser = username.trim();
    if (!trimmedUser || !password) return;

    setLoading(true);
    setLoadingLabel('Signing In & Syncing...');
    setError(null);

    const targetHost = districtUrl.trim() || PUSD_HOST;

    try {
      const response = await fetch('/api/studentvue/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmedUser,
          password,
          isParent,
          districtUrl: targetHost,
        }),
      });

      const data = await safeReadJson(response);
      if (!response.ok || !data) {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : `Edupoint sign-in failed (HTTP ${response.status}). Check your username and password and try again.`
        );
        setLoading(false);
        return;
      }

      let notice: string | undefined;
      if (rememberLogin) {
        try {
          const savedSummary = await saveEncryptedLogin({
            username: trimmedUser,
            password,
            districtUrl: targetHost,
            isParent,
          });
          onSavedLoginChange(savedSummary);

          if (enableBiometric && biometricSupport.supported && !savedSummary.biometricEnabled) {
            setLoadingLabel('Confirm Fingerprint...');
            const bioReg = await registerFingerprintCredential(trimmedUser);
            if (bioReg.ok) {
              const refreshed = await getSavedLoginSummary();
              onSavedLoginChange(refreshed);
            } else {
              notice = bioReg.iframeBlocked
                ? 'Login saved securely. Open Folio in its own browser tab to finish enabling fingerprint sign-in.'
                : 'Login saved securely. You can enable fingerprint sign-in anytime from Manage Saved Login.';
            }
          }
        } catch {
          notice = 'Signed in, though this browser blocked saving encrypted credentials.';
        }
      }

      onSuccess({ ...(data as unknown as EdupointLoginPayload), notice });
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      setError(
        detail
          ? `Could not reach the sync service (${detail}). Please try again.`
          : 'Could not reach the sync service. Please try again.'
      );
      setLoading(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pastedContent.trim()) return;

    setLoading(true);
    setLoadingLabel('Importing Grades...');
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

  return (
    <div className="min-h-screen flex flex-col folio-canvas text-slate-900 dark:text-slate-100">
      {/* Minimal Top Bar */}
      <header className="w-full max-w-[1440px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
          Folio
        </span>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/75 hover:bg-white dark:hover:bg-slate-800/85 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-slate-600" />
              <span>Dark</span>
            </>
          )}
        </button>
      </header>

      {/* Centered Sign-In Menu */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-[440px] glass-panel rounded-2xl p-6 sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Sign in to your gradebook
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Connect your StudentVUE account to sync classes, weighted grades, GPA trends, and
              upcoming assignments.
            </p>
          </div>

          {/* Saved Account Quick Access / Verification Required Banner */}
          {savedLogin && (
            <div className="mb-5 p-4 rounded-xl bg-blue-50/90 dark:bg-sky-500/10 border border-blue-200 dark:border-sky-400/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">
                    Saved Login Found on Device
                  </span>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    await clearSavedLogin();
                    onSavedLoginChange(null);
                    setUsername('');
                    setPassword('');
                  }}
                  className="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline"
                >
                  Forget Saved Data
                </button>
              </div>
              <div className="text-xs text-slate-700 dark:text-slate-300">
                Auto-filled for <strong className="font-mono">{savedLogin.username}</strong>. Verify with fingerprint or 1-tap sign in below.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {savedLogin.biometricEnabled && biometricSupport.supported && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleFingerprintVerification}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors shadow-xs whitespace-nowrap"
                  >
                    <Fingerprint className="w-4 h-4" />
                    Verify Fingerprint
                  </button>
                )}
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleQuickSignIn}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors shadow-xs whitespace-nowrap"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  Sign In Instantly
                </button>
              </div>
            </div>
          )}

          {/* Segmented Method Switch */}
          <div className="grid grid-cols-2 p-1 bg-slate-200/70 dark:bg-white/[0.06] border border-slate-300/60 dark:border-white/10 rounded-xl mb-5">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              StudentVUE Sign In
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setMode('sso-import');
                setError(null);
              }}
              className={`py-2 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                mode === 'sso-import'
                  ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Google SSO / Paste
            </button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* School Selector (Amador Valley HS / Foothill HS) */}
              <div className="space-y-2 pb-3.5 border-b border-slate-200/70 dark:border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <School className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                    High School
                  </span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setShowCustomHost((v) => !v)}
                    className="text-[11px] font-medium text-blue-700 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                  >
                    {showCustomHost ? 'Hide portal URL' : 'Other portal URL'}
                  </button>
                </div>

                <div
                  role="group"
                  aria-label="Select high school"
                  className="grid grid-cols-2 gap-2"
                >
                  {PUSD_SCHOOLS.map((school) => {
                    const isSelected = selectedSchool === school.id;
                    return (
                      <button
                        key={school.id}
                        type="button"
                        disabled={loading}
                        aria-pressed={isSelected}
                        onClick={() => {
                          onSelectSchool(school.id);
                          setDistrictUrl(school.host);
                        }}
                        className={`px-3 py-2 text-xs font-medium rounded-xl border text-center transition-colors whitespace-nowrap truncate ${
                          isSelected
                            ? 'bg-blue-600/10 dark:bg-sky-500/15 border-blue-600/50 dark:border-sky-400/50 text-blue-800 dark:text-sky-200'
                            : 'bg-white/60 dark:bg-white/[0.04] border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-white/[0.08]'
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
                    htmlFor="signin-host"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Edupoint District Portal URL
                  </label>
                  <input
                    id="signin-host"
                    type="text"
                    value={districtUrl}
                    onChange={(e) => setDistrictUrl(e.target.value)}
                    placeholder="ca-pleas-psv.edupoint.com"
                    disabled={loading}
                    className={`${INPUT_CLASS} font-mono text-xs`}
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="signin-username"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Student ID / Username
                </label>
                <input
                  id="signin-username"
                  type="text"
                  autoComplete="username"
                  required
                  autoFocus
                  placeholder="Enter your StudentVUE username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor="signin-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="signin-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    placeholder="Enter your StudentVUE password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className={`${INPUT_CLASS} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Save & Account Options */}
              <div className="space-y-2.5 pt-0.5">
                <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberLogin}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setRememberLogin(checked);
                      if (!checked) setEnableBiometric(false);
                    }}
                    disabled={loading}
                    className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Save my login encrypted on this device for next time</span>
                </label>

                {rememberLogin && biometricSupport.supported && (
                  <label className="flex items-start gap-2.5 pl-5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableBiometric}
                      onChange={(e) => setEnableBiometric(e.target.checked)}
                      disabled={loading}
                      className="mt-0.5 rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="inline-flex items-center gap-1.5">
                      <Fingerprint className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                      <span>Enable Fingerprint / Face ID sign-in</span>
                    </span>
                  </label>
                )}

                <label className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isParent}
                    onChange={(e) => setIsParent(e.target.checked)}
                    disabled={loading}
                    className="rounded border-slate-300 dark:border-white/20 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Sign in with a ParentVUE account</span>
                </label>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50/90 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-400/25 text-xs text-rose-800 dark:text-rose-200 space-y-1"
                >
                  <div>{error}</div>
                  <div className="text-rose-700 dark:text-rose-300/90">
                    If you use <strong>Login with Google</strong> on StudentVUE, switch to{' '}
                    <strong>Google SSO / Paste</strong> above.
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                {loading ? loadingLabel : 'Sign In & Sync Grades'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed">
                <p>
                  Using <strong className="text-slate-900 dark:text-white">Login with Google</strong>{' '}
                  on StudentVUE? Copy your Grade Book page or upload its saved HTML file:
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
                    and open your Grade Book.
                  </li>
                  <li>
                    Press <strong className="font-mono">Ctrl+A</strong> then{' '}
                    <strong className="font-mono">Ctrl+C</strong> and paste below.
                  </li>
                </ol>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="signin-paste"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Grade Book Content
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-sky-400 hover:underline"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    Upload HTML
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
                  id="signin-paste"
                  rows={5}
                  required
                  placeholder="Paste copied StudentVUE Grade Book text or HTML here..."
                  value={pastedContent}
                  onChange={(e) => setPastedContent(e.target.value)}
                  disabled={loading}
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

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? loadingLabel : 'Import Grades'}
              </button>
            </form>
          )}

          {/* Explicit Privacy Guarantee */}
          <div className="mt-6 pt-5 border-t border-slate-200/70 dark:border-white/10 flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Passwords and grades are not stored or accessed by anybody but the user.
              </span>{' '}
              Your data remains 100% private. Credentials connect directly to StudentVUE over HTTPS, and any saved login stays encrypted strictly on your own device.
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
          Sign in or use your saved login on this device to view your grades. Closing or reopening the website requires re-verification to protect your privacy.
        </p>
      </main>
    </div>
  );
};
