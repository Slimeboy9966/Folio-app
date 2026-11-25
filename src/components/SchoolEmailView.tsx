import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Inbox,
  Loader2,
  LogOut,
  Mail,
  PenSquare,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  GmailAccountInfo,
  clearCachedGmailAccessToken,
  getCachedGmailAccessToken,
  signInWithSchoolGoogle,
  signOutSchoolGoogle,
} from '../utils/gmailAuth';
import {
  GmailAuthExpiredError,
  GmailMessageDetail,
  GmailMessageSummary,
  extractEmailAddress,
  formatShortEmailDate,
  getGmailMessageDetail,
  isValidEmailRecipient,
  listGmailMessages,
  sendGmailMessage,
} from '../utils/gmailApi';

interface PendingSendConfirmation {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  mode: 'reply' | 'compose';
}

interface SchoolEmailViewProps {
  gmailAccount: GmailAccountInfo | null;
  hasGmailToken: boolean;
  onGmailAuthSuccess: (account: GmailAccountInfo) => void;
  onGmailSignOut: () => void;
  onMessagesLoaded?: (messages: GmailMessageSummary[]) => void;
  studentName?: string;
  schoolName?: string;
}

const GoogleSignInButton: React.FC<{
  label: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, disabled, onClick }) => (
  <button
    type="button"
    className="gsi-material-button"
    disabled={disabled}
    onClick={onClick}
  >
    <div className="gsi-material-button-state" />
    <div className="gsi-material-button-content-wrapper">
      <div className="gsi-material-button-icon">
        <svg
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 48 48"
          className="block w-5 h-5"
          aria-hidden="true"
        >
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
          <path fill="none" d="M0 0h48v48H0z" />
        </svg>
      </div>
      <span className="gsi-material-button-contents">{label}</span>
    </div>
  </button>
);

export const SchoolEmailView: React.FC<SchoolEmailViewProps> = ({
  gmailAccount,
  hasGmailToken,
  onGmailAuthSuccess,
  onGmailSignOut,
  onMessagesLoaded,
  studentName,
  schoolName,
}) => {
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [folder, setFolder] = useState<'inbox' | 'unread' | 'sent'>('inbox');
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');

  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<GmailMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Compose new email mode
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  // Reply state for currently selected message
  const [replyBody, setReplyBody] = useState('');

  // Explicit Send Confirmation Modal state
  const [pendingSend, setPendingSend] = useState<PendingSendConfirmation | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  const isConnected = Boolean(gmailAccount && hasGmailToken && getCachedGmailAccessToken());

  const handleAuthExpired = useCallback(
    (msg?: string) => {
      clearCachedGmailAccessToken();
      setListError(null);
      setAuthError(
        msg || 'Your Gmail session expired. Click Sign in with Google to reconnect.'
      );
      onGmailSignOut();
    },
    [onGmailSignOut]
  );

  const loadInbox = useCallback(
    async (queryTerm?: string) => {
      const token = getCachedGmailAccessToken();
      if (!token) return;
      setLoadingList(true);
      setListError(null);
      try {
        const list = await listGmailMessages(token, { query: queryTerm });
        setMessages(list);
        if (onMessagesLoaded) {
          onMessagesLoaded(list);
        }
      } catch (err) {
        if (err instanceof GmailAuthExpiredError) {
          handleAuthExpired(err.message);
        } else {
          setListError(err instanceof Error ? err.message : 'Failed to load school emails.');
        }
      } finally {
        setLoadingList(false);
      }
    },
    [handleAuthExpired, onMessagesLoaded]
  );

  useEffect(() => {
    if (isConnected) {
      void loadInbox(activeQuery);
    }
  }, [isConnected, activeQuery, loadInbox]);

  const handleConnectClick = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await signInWithSchoolGoogle();
      onGmailAuthSuccess(result.account);
      setAuthBusy(false);
      void loadInbox();
    } catch (err) {
      setAuthBusy(false);
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed or was cancelled.');
    }
  };

  const handleSignOutClick = () => {
    signOutSchoolGoogle();
    onGmailSignOut();
    setMessages([]);
    setSelectedId(null);
    setSelectedDetail(null);
    setComposeOpen(false);
  };

  const handleSelectMessage = async (msgId: string) => {
    setSelectedId(msgId);
    setComposeOpen(false);
    setReplyBody('');
    setSendError(null);
    const token = getCachedGmailAccessToken();
    if (!token) return;
    setLoadingDetail(true);
    try {
      const detail = await getGmailMessageDetail(token, msgId);
      setSelectedDetail(detail);
    } catch (err) {
      if (err instanceof GmailAuthExpiredError) {
        handleAuthExpired(err.message);
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const filteredMessages = useMemo(() => {
    if (folder === 'unread') {
      return messages.filter((m) => m.isUnread);
    }
    if (folder === 'sent') {
      return messages.filter((m) => m.labelIds?.includes('SENT'));
    }
    return messages;
  }, [messages, folder]);

  const replyRecipient = useMemo(() => {
    if (!selectedDetail) return '';
    return selectedDetail.replyTo || selectedDetail.fromEmail || selectedDetail.from;
  }, [selectedDetail]);

  const replySubjectLine = useMemo(() => {
    if (!selectedDetail) return '';
    const subj = selectedDetail.subject || '(No Subject)';
    return subj.toLowerCase().startsWith('re:') ? subj : `Re: ${subj}`;
  }, [selectedDetail]);

  const handleOpenReplyConfirm = () => {
    if (!selectedDetail) return;
    if (!isValidEmailRecipient(replyRecipient)) {
      setSendError('This email does not have a valid reply address.');
      return;
    }
    if (!replyBody.trim()) {
      setSendError('Write a reply before sending.');
      return;
    }
    setSendError(null);
    setPendingSend({
      to: extractEmailAddress(replyRecipient),
      subject: replySubjectLine,
      body: replyBody.trim(),
      threadId: selectedDetail.threadId,
      inReplyTo: selectedDetail.messageIdHeader || undefined,
      references: selectedDetail.referencesHeader || undefined,
      mode: 'reply',
    });
  };

  const handleOpenComposeConfirm = () => {
    if (!isValidEmailRecipient(composeTo)) {
      setSendError('Enter a valid recipient email address (for example, teacher@pleasantonusd.net).');
      return;
    }
    if (!composeBody.trim()) {
      setSendError('Write a message before sending.');
      return;
    }
    setSendError(null);
    setPendingSend({
      to: extractEmailAddress(composeTo),
      subject: composeSubject.trim() || 'Question regarding class',
      body: composeBody.trim(),
      mode: 'compose',
    });
  };

  const handleConfirmAndSend = async () => {
    if (!pendingSend || sendingEmail) return;
    const token = getCachedGmailAccessToken();
    if (!token) {
      handleAuthExpired();
      return;
    }
    setSendingEmail(true);
    setSendError(null);
    try {
      await sendGmailMessage(token, {
        to: pendingSend.to,
        subject: pendingSend.subject,
        body: pendingSend.body,
        threadId: pendingSend.threadId,
        inReplyTo: pendingSend.inReplyTo,
        references: pendingSend.references,
      });

      const sentTarget = pendingSend.to;
      setPendingSend(null);
      setSendingEmail(false);
      setSentNotice(`Email sent to ${sentTarget}.`);
      setTimeout(() => setSentNotice(null), 5000);

      if (pendingSend.mode === 'compose') {
        setComposeOpen(false);
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
      } else {
        setReplyBody('');
      }
      void loadInbox(activeQuery);
    } catch (err) {
      if (err instanceof GmailAuthExpiredError) {
        handleAuthExpired(err.message);
      } else {
        setSendError(err instanceof Error ? err.message : 'Failed to send email.');
      }
      setSendingEmail(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        <div className="glass-card rounded-2xl p-6 sm:p-10 text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 dark:bg-sky-500/15 flex items-center justify-center text-blue-600 dark:text-sky-400 shadow-sm">
            <Mail className="w-8 h-8" />
          </div>

          <div className="space-y-2 max-w-lg mx-auto">
            <h2 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
              {gmailAccount ? 'Reconnect Your School Email' : 'Link Your School Email'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Connect your student Google account to view teacher announcements, check inbox messages,
              and email teachers directly from Folio.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 max-w-md mx-auto flex items-center gap-2.5 text-left">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <div className="pt-2 flex flex-col items-center gap-3">
            <GoogleSignInButton
              label={gmailAccount ? `Sign in as ${gmailAccount.email}` : 'Sign in with School Google'}
              disabled={authBusy}
              onClick={() => void handleConnectClick()}
            />
            {authBusy && (
              <div className="inline-flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Connecting securely...
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-200/60 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>For your privacy, Folio does not store email tokens in browser storage.</span>
          </div>
        </div>
      </div>
    );
  }

  const showingDetailOnMobile = Boolean(selectedId || composeOpen);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* Top Bar */}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-sky-500/15 flex items-center justify-center text-blue-600 dark:text-sky-400">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900 dark:text-white">
              School Inbox & Mail
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              {gmailAccount?.email} {studentName ? `· ${studentName}` : ''} {schoolName ? `· ${schoolName}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadInbox(activeQuery)}
            disabled={loadingList}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/75 hover:bg-white dark:hover:bg-slate-800 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSignOutClick}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-500/15 hover:bg-rose-100 dark:hover:bg-rose-500/25 border border-rose-200/80 dark:border-rose-400/30 rounded-xl transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {sentNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{sentNotice}</span>
        </div>
      )}

      {/* Split Inbox Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left List Pane */}
        <div
          className={`lg:col-span-5 glass-card rounded-2xl overflow-hidden flex flex-col h-[640px] ${
            showingDetailOnMobile ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Controls & Search */}
          <div className="p-3.5 border-b border-slate-200/70 dark:border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl">
                {(['inbox', 'unread', 'sent'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFolder(f)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                      folder === f
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setComposeOpen(true);
                  setSelectedId(null);
                  setSelectedDetail(null);
                  setSendError(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white dark:text-slate-950 bg-blue-600 hover:bg-blue-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-xl transition-colors shadow-xs whitespace-nowrap"
              >
                <PenSquare className="w-3.5 h-3.5" />
                New Email
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setActiveQuery(searchInput.trim());
              }}
              className="relative flex items-center"
            >
              <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search messages..."
                className="w-full bg-slate-100 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setActiveQuery('');
                  }}
                  className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>
          </div>

          {/* Messages Scroll List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
            {loadingList ? (
              <div className="py-16 text-center space-y-2">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600 dark:text-sky-400" />
                <p className="text-xs text-slate-500">Loading school inbox...</p>
              </div>
            ) : listError ? (
              <div className="p-6 text-center space-y-2">
                <AlertTriangle className="w-6 h-6 mx-auto text-rose-500" />
                <p className="text-xs text-rose-600 dark:text-rose-400">{listError}</p>
                <button
                  type="button"
                  onClick={() => void loadInbox(activeQuery)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg"
                >
                  Retry
                </button>
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="py-16 text-center space-y-2 px-4">
                <Inbox className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  No messages found
                </p>
                <p className="text-[11px] text-slate-500">
                  Your inbox is clean or no messages match the selected filter.
                </p>
              </div>
            ) : (
              filteredMessages.map((msg) => {
                const isSelected = selectedId === msg.id && !composeOpen;
                return (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => void handleSelectMessage(msg.id)}
                    className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1 relative ${
                      isSelected
                        ? 'bg-blue-50/90 dark:bg-sky-500/15 border-l-4 border-blue-600 dark:border-sky-400'
                        : msg.isUnread
                        ? 'bg-white dark:bg-slate-900/60 font-semibold'
                        : 'bg-white/50 dark:bg-slate-900/30 hover:bg-slate-50 dark:hover:bg-slate-900/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {msg.fromName}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {formatShortEmailDate(msg.date)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-800 dark:text-slate-200 truncate">
                      {msg.subject || '(No Subject)'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {msg.snippet}
                    </div>
                    {msg.isUnread && (
                      <span className="absolute top-3.5 right-3 w-2 h-2 rounded-full bg-blue-600 dark:bg-sky-400" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Reader or Compose */}
        <div
          className={`lg:col-span-7 glass-card rounded-2xl overflow-hidden flex flex-col h-[640px] ${
            showingDetailOnMobile ? 'block' : 'hidden lg:flex'
          }`}
        >
          {composeOpen ? (
            /* Compose New Email */
            <div className="flex-1 flex flex-col h-full overflow-y-auto">
              <div className="p-4 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Compose New School Email
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-4 flex-1 flex flex-col">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    To (Teacher or Staff Email)
                  </label>
                  <input
                    type="email"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    placeholder="e.g. teacher@pleasantonusd.net"
                    className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="e.g. Question regarding upcoming quiz"
                    className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>

                <div className="flex-1 flex flex-col">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Message Body
                  </label>
                  <textarea
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    placeholder="Write your email here..."
                    className="w-full flex-1 min-h-[160px] bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none font-sans"
                  />
                </div>

                {sendError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 text-xs text-rose-700 dark:text-rose-300">
                    {sendError}
                  </div>
                )}

                <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200/60 dark:border-white/10">
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenComposeConfirm}
                    disabled={!composeTo.trim() || !composeBody.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white dark:text-slate-950 bg-blue-600 hover:bg-blue-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-xl shadow-xs disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Review & Send
                  </button>
                </div>
              </div>
            </div>
          ) : loadingDetail ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600 dark:text-sky-400" />
              <p className="text-xs text-slate-500">Opening email...</p>
            </div>
          ) : !selectedDetail ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-2">
              <Mail className="w-10 h-10 text-slate-300 dark:text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Select an email to read or reply
              </h3>
              <p className="text-xs text-slate-500 max-w-xs">
                Pick any message from your inbox to view full details and reply securely.
              </p>
            </div>
          ) : (
            /* Selected Message Reader & Reply Studio */
            <div className="flex-1 flex flex-col h-full overflow-y-auto">
              <div className="p-4 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(null);
                      setSelectedDetail(null);
                    }}
                    className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white truncate max-w-md">
                    {selectedDetail.subject}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedDetail(null);
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200/60 dark:border-white/10">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {selectedDetail.fromName}
                    </h4>
                    {selectedDetail.fromEmail &&
                      selectedDetail.fromEmail !== selectedDetail.fromName && (
                        <p className="text-xs text-slate-500 font-mono">
                          &lt;{selectedDetail.fromEmail}&gt;
                        </p>
                      )}
                  </div>
                  <span className="text-xs font-mono text-slate-400 shrink-0">
                    {selectedDetail.date}
                  </span>
                </div>

                {/* Plain-Text Email Body */}
                <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-4 text-xs text-slate-900 dark:text-slate-100 whitespace-pre-wrap leading-relaxed max-h-[220px] overflow-y-auto font-sans">
                  {selectedDetail.bodyText}
                </div>

                {/* Direct Reply Section */}
                <div className="pt-2 space-y-3 mt-auto">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Reply to <span className="font-semibold">{selectedDetail.fromName}</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 truncate max-w-[220px]">
                      {extractEmailAddress(replyRecipient)}
                    </span>
                  </div>

                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder="Type your reply here..."
                    className="w-full h-24 bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none font-sans"
                  />

                  {sendError && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 text-xs text-rose-700 dark:text-rose-300">
                      {sendError}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setReplyBody('')}
                      className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenReplyConfirm}
                      disabled={!replyBody.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white dark:text-slate-950 bg-blue-600 hover:bg-blue-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-xl shadow-xs disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Review & Send Reply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mandatory Explicit Confirmation Modal Before Sending Any Email */}
      {pendingSend && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !sendingEmail) setPendingSend(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm send email"
            className="w-full max-w-md glass-modal rounded-2xl p-6 space-y-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-sky-500/15 flex items-center justify-center text-blue-600 dark:text-sky-400 shrink-0">
                <Send className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Confirm Send Email
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  You are sending this message from your student email (<span className="font-semibold">{gmailAccount?.email}</span>).
                </p>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900/80 rounded-xl p-3.5 space-y-2 text-xs">
              <div>
                <span className="text-slate-500">To:</span>{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">{pendingSend.to}</span>
              </div>
              <div>
                <span className="text-slate-500">Subject:</span>{' '}
                <span className="font-medium text-slate-800 dark:text-slate-200">{pendingSend.subject}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 dark:border-white/10 text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                {pendingSend.body}
              </div>
            </div>

            {sendError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 text-xs text-rose-700 dark:text-rose-300">
                {sendError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingSend(null)}
                disabled={sendingEmail}
                aria-label="Cancel sending email"
                className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmAndSend()}
                disabled={sendingEmail}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-medium text-white dark:text-slate-950 bg-blue-600 hover:bg-blue-700 dark:bg-sky-400 dark:hover:bg-sky-300 rounded-xl shadow-xs disabled:opacity-50"
              >
                {sendingEmail ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Confirm & Send Email
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
