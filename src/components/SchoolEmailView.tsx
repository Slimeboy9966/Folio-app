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
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2,
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

export type EmailTone =
  | 'polite-teacher'
  | 'concise'
  | 'clarification'
  | 'extension-help';

interface AiEmailAssistResponse {
  summary?: string;
  actionItems?: string[];
  formattedBody?: string;
  suggestedSubject?: string;
  improvements?: string[];
  error?: string;
}

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
  onAskAiWithEmail?: (prompt: string) => void;
}

const TONE_OPTIONS: Array<{ id: EmailTone; label: string }> = [
  { id: 'polite-teacher', label: 'Polite Teacher' },
  { id: 'concise', label: 'Short & Clear' },
  { id: 'clarification', label: 'Ask Question' },
  { id: 'extension-help', label: 'Request Help' },
];

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
  onAskAiWithEmail,
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
  const [composeInstruction, setComposeInstruction] = useState('');
  const [composePreviousBody, setComposePreviousBody] = useState<string | null>(null);
  const [composeImprovements, setComposeImprovements] = useState<string[]>([]);

  // Reply state for currently selected message
  const [replyBody, setReplyBody] = useState('');
  const [replyInstruction, setReplyInstruction] = useState('');
  const [replyTone, setReplyTone] = useState<EmailTone>('polite-teacher');
  const [replyPreviousBody, setReplyPreviousBody] = useState<string | null>(null);
  const [replyImprovements, setReplyImprovements] = useState<string[]>([]);

  // AI Summary state per message
  const [aiSummary, setAiSummary] = useState<{
    messageId: string;
    summary: string;
    actionItems: string[];
  } | null>(null);
  const [aiBusyAction, setAiBusyAction] = useState<
    null | 'summarize' | 'generate-reply' | 'format-grammar' | 'compose'
  >(null);
  const [aiError, setAiError] = useState<string | null>(null);

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
    async (opts?: { folderOverride?: 'inbox' | 'unread' | 'sent'; queryOverride?: string }) => {
      const token = getCachedGmailAccessToken();
      if (!token) return;

      const targetFolder = opts?.folderOverride ?? folder;
      const targetQuery = (opts?.queryOverride ?? activeQuery).trim();

      setLoadingList(true);
      setListError(null);
      try {
        const qParts: string[] = [];
        if (targetFolder === 'unread') {
          qParts.push('is:unread');
        }
        if (targetQuery) {
          qParts.push(targetQuery);
        }

        const fetched = await listGmailMessages(token, {
          labelId: targetFolder === 'sent' ? 'SENT' : 'INBOX',
          query: qParts.join(' '),
          maxResults: 20,
        });
        setMessages(fetched);
        onMessagesLoaded?.(fetched);
      } catch (err) {
        if (err instanceof GmailAuthExpiredError) {
          handleAuthExpired(err.message);
          return;
        }
        setListError(err instanceof Error ? err.message : 'Unable to load school emails.');
      } finally {
        setLoadingList(false);
      }
    },
    [folder, activeQuery, handleAuthExpired, onMessagesLoaded]
  );

  useEffect(() => {
    if (isConnected) {
      void loadInbox();
    }
  }, [isConnected, loadInbox]);

  const handleConnectGoogle = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setSentNotice(null);
    try {
      const { account } = await signInWithSchoolGoogle();
      onGmailAuthSuccess(account);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Could not connect Google account.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOutSchoolGoogle();
      setMessages([]);
      setSelectedId(null);
      setSelectedDetail(null);
      setAiSummary(null);
      setReplyBody('');
      setComposeOpen(false);
      onGmailSignOut();
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSelectMessage = async (msg: GmailMessageSummary) => {
    const token = getCachedGmailAccessToken();
    if (!token) {
      handleAuthExpired();
      return;
    }

    setComposeOpen(false);
    setSelectedId(msg.id);
    setLoadingDetail(true);
    setAiError(null);
    setSendError(null);
    setSentNotice(null);
    setReplyBody('');
    setReplyInstruction('');
    setReplyPreviousBody(null);
    setReplyImprovements([]);
    if (aiSummary?.messageId !== msg.id) {
      setAiSummary(null);
    }

    try {
      const detail = await getGmailMessageDetail(token, msg.id);
      setSelectedDetail(detail);
    } catch (err) {
      if (err instanceof GmailAuthExpiredError) {
        handleAuthExpired(err.message);
        return;
      }
      setAiError(err instanceof Error ? err.message : 'Could not load full email.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const callEmailAssist = async (payload: Record<string, unknown>): Promise<AiEmailAssistResponse> => {
    const response = await fetch('/api/ai/email-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        studentName: studentName || gmailAccount?.displayName || '',
        schoolName: schoolName || '',
      }),
    });
    const data = (await response.json().catch(() => null)) as AiEmailAssistResponse | null;
    if (!response.ok) {
      throw new Error(data?.error || `AI formatting request failed (HTTP ${response.status}).`);
    }
    if (!data) {
      throw new Error('Empty response from Folio AI.');
    }
    return data;
  };

  const handleSummarizeEmail = async () => {
    if (!selectedDetail || aiBusyAction) return;
    setAiBusyAction('summarize');
    setAiError(null);
    try {
      const data = await callEmailAssist({
        action: 'summarize',
        originalEmail: {
          from: selectedDetail.from,
          subject: selectedDetail.subject,
          date: selectedDetail.date,
          body: selectedDetail.bodyText,
        },
      });
      setAiSummary({
        messageId: selectedDetail.id,
        summary: data.summary || 'No summary generated.',
        actionItems: Array.isArray(data.actionItems) ? data.actionItems : [],
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not summarize email.');
    } finally {
      setAiBusyAction(null);
    }
  };

  const handleGenerateReply = async () => {
    if (!selectedDetail || aiBusyAction) return;
    setAiBusyAction('generate-reply');
    setAiError(null);
    try {
      const data = await callEmailAssist({
        action: 'generate-reply',
        tone: replyTone,
        instruction: replyInstruction.trim(),
        draft: replyBody.trim(),
        originalEmail: {
          from: selectedDetail.from,
          subject: selectedDetail.subject,
          date: selectedDetail.date,
          body: selectedDetail.bodyText,
        },
      });
      if (data.formattedBody) {
        if (replyBody.trim()) {
          setReplyPreviousBody(replyBody);
        }
        setReplyBody(data.formattedBody);
        setReplyImprovements(Array.isArray(data.improvements) ? data.improvements : []);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not generate a reply.');
    } finally {
      setAiBusyAction(null);
    }
  };

  const handleFormatReplyGrammar = async () => {
    if (!replyBody.trim() || aiBusyAction) return;
    setAiBusyAction('format-grammar');
    setAiError(null);
    try {
      const data = await callEmailAssist({
        action: 'format-grammar',
        tone: replyTone,
        draft: replyBody,
        originalEmail: selectedDetail
          ? {
              from: selectedDetail.from,
              subject: selectedDetail.subject,
              date: selectedDetail.date,
              body: selectedDetail.bodyText.slice(0, 3000),
            }
          : undefined,
      });
      if (data.formattedBody) {
        setReplyPreviousBody(replyBody);
        setReplyBody(data.formattedBody);
        setReplyImprovements(Array.isArray(data.improvements) ? data.improvements : []);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not format your draft.');
    } finally {
      setAiBusyAction(null);
    }
  };

  const handleAiCompose = async (mode: 'compose' | 'format-grammar') => {
    if (aiBusyAction) return;
    if (mode === 'format-grammar' && !composeBody.trim()) return;
    if (mode === 'compose' && !composeInstruction.trim() && !composeSubject.trim()) {
      setAiError('Describe briefly what you want the email to say first.');
      return;
    }

    setAiBusyAction(mode);
    setAiError(null);
    try {
      const data = await callEmailAssist({
        action: mode,
        tone: replyTone,
        instruction: composeInstruction.trim(),
        subject: composeSubject.trim(),
        recipient: composeTo.trim(),
        draft: composeBody,
      });
      if (data.formattedBody) {
        if (composeBody.trim()) {
          setComposePreviousBody(composeBody);
        }
        setComposeBody(data.formattedBody);
      }
      if (data.suggestedSubject && !composeSubject.trim()) {
        setComposeSubject(data.suggestedSubject);
      }
      setComposeImprovements(Array.isArray(data.improvements) ? data.improvements : []);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not format email draft.');
    } finally {
      setAiBusyAction(null);
    }
  };

  const replyRecipient = useMemo(() => {
    if (!selectedDetail) return '';
    return selectedDetail.replyTo || selectedDetail.fromEmail || selectedDetail.from;
  }, [selectedDetail]);

  const replySubject = useMemo(() => {
    if (!selectedDetail) return '';
    const subj = selectedDetail.subject || '(No Subject)';
    return /^re:/i.test(subj) ? subj : `Re: ${subj}`;
  }, [selectedDetail]);

  const requestSendReply = () => {
    setSendError(null);
    if (!selectedDetail) return;
    if (!isValidEmailRecipient(replyRecipient)) {
      setSendError('This email does not have a valid reply address.');
      return;
    }
    if (!replyBody.trim()) {
      setSendError('Write a reply or generate one with Folio AI first.');
      return;
    }
    setPendingSend({
      mode: 'reply',
      to: extractEmailAddress(replyRecipient),
      subject: replySubject,
      body: replyBody.trim(),
      threadId: selectedDetail.threadId,
      inReplyTo: selectedDetail.messageIdHeader || undefined,
      references: selectedDetail.referencesHeader || undefined,
    });
  };

  const requestSendCompose = () => {
    setSendError(null);
    if (!isValidEmailRecipient(composeTo)) {
      setSendError('Enter a valid recipient email address (for example, teacher@pleasantonusd.net).');
      return;
    }
    if (!composeBody.trim()) {
      setSendError('Write a message or draft one with Folio AI before sending.');
      return;
    }
    setPendingSend({
      mode: 'compose',
      to: extractEmailAddress(composeTo),
      subject: composeSubject.trim() || '(No Subject)',
      body: composeBody.trim(),
    });
  };

  const handleConfirmSend = async () => {
    if (!pendingSend || sendingEmail) return;
    const token = getCachedGmailAccessToken();
    if (!token) {
      setPendingSend(null);
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
      const mode = pendingSend.mode;
      setPendingSend(null);
      setSentNotice(`Email sent to ${sentTarget}.`);

      if (mode === 'reply') {
        setReplyBody('');
        setReplyInstruction('');
        setReplyPreviousBody(null);
        setReplyImprovements([]);
      } else {
        setComposeOpen(false);
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
        setComposeInstruction('');
        setComposePreviousBody(null);
        setComposeImprovements([]);
      }
      void loadInbox();
    } catch (err) {
      if (err instanceof GmailAuthExpiredError) {
        setPendingSend(null);
        handleAuthExpired(err.message);
        return;
      }
      setSendError(err instanceof Error ? err.message : 'Failed to send email.');
    } finally {
      setSendingEmail(false);
    }
  };

  // Opt-in Unconnected / Reconnect Screen
  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-blue-600/15 dark:bg-sky-500/15 text-blue-700 dark:text-sky-400 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {gmailAccount ? 'Reconnect Your School Email' : 'Link Your School Email'}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Read teacher messages, generate clear replies with Folio AI, fix grammar and
                formatting in one tap, and send responses directly from Folio.
              </p>
            </div>
          </div>

          {gmailAccount && (
            <div className="rounded-xl px-4 py-3 bg-blue-50/80 dark:bg-sky-500/10 border border-blue-200/80 dark:border-sky-400/25 text-xs text-blue-900 dark:text-sky-200">
              For your privacy, Folio does not store email tokens in browser storage. Sign in with{' '}
              <span className="font-semibold">{gmailAccount.email}</span> to start a fresh inbox
              session.
            </div>
          )}

          {authError && (
            <div className="rounded-xl px-4 py-3 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-400/30 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <GoogleSignInButton
              label={
                authBusy
                  ? 'Connecting...'
                  : gmailAccount
                    ? 'Sign in with Google to reconnect'
                    : 'Sign in with Google'
              }
              disabled={authBusy}
              onClick={() => void handleConnectGoogle()}
            />
            {gmailAccount && (
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                disabled={authBusy}
                className="px-3.5 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl border border-slate-200/80 dark:border-white/10 hover:bg-white/70 dark:hover:bg-white/10 transition-colors"
              >
                Switch or Remove Account
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200/70 dark:border-white/10">
            <div className="rounded-xl p-3.5 bg-white/60 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                100% Optional
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Every student decides for themselves whether to connect their own inbox.
              </p>
            </div>
            <div className="rounded-xl p-3.5 bg-white/60 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                <Wand2 className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
                AI Format &amp; Grammar
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Turn quick notes into polite, properly formatted emails with zero typos.
              </p>
            </div>
            <div className="rounded-xl p-3.5 bg-white/60 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
                Always Confirmed
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Folio never sends any message automatically—you review and confirm every send.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const showingDetailOnMobile = Boolean(selectedId || composeOpen);

  return (
    <div className="space-y-4">
      {/* Top Connected Email Header Bar */}
      <div className="glass-panel rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-600/15 dark:bg-sky-500/15 text-blue-700 dark:text-sky-400 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {gmailAccount?.email}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Connected privately for this browser session
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setComposeOpen(true);
              setSelectedId(null);
              setSelectedDetail(null);
              setAiError(null);
              setSendError(null);
              setSentNotice(null);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors"
          >
            <PenSquare className="w-3.5 h-3.5" />
            New Email
          </button>
          <button
            type="button"
            onClick={() => void loadInbox()}
            disabled={loadingList}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/75 hover:bg-white dark:hover:bg-slate-800 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={authBusy}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 bg-white/70 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      </div>

      {sentNotice && (
        <div className="rounded-2xl px-4 py-3 bg-emerald-50/90 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {sentNotice}
          </span>
          <button
            type="button"
            onClick={() => setSentNotice(null)}
            aria-label="Dismiss notification"
            className="p-1 text-emerald-700 dark:text-emerald-300 hover:opacity-75"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Split Inbox & Reader/Composer Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Pane: Inbox List */}
        <section
          className={`lg:col-span-5 glass-panel rounded-2xl overflow-hidden ${
            showingDetailOnMobile ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Search + Folder Filter */}
          <div className="p-3.5 border-b border-slate-200/70 dark:border-white/10 space-y-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setActiveQuery(searchInput);
                void loadInbox({ queryOverride: searchInput });
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search teachers, classes, or subjects..."
                  className="w-full pl-8 pr-3 py-2 text-xs bg-white/85 dark:bg-slate-900/75 border border-slate-200/80 dark:border-white/10 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/85 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/10 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors shrink-0"
              >
                Search
              </button>
            </form>

            <div className="flex items-center gap-1.5">
              {(
                [
                  ['inbox', 'Inbox'],
                  ['unread', 'Unread'],
                  ['sent', 'Sent'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setFolder(key);
                    void loadInbox({ folderOverride: key });
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    folder === key
                      ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/[0.07]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {listError && (
            <div className="m-3 rounded-xl px-3.5 py-2.5 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-400/30 text-xs text-rose-800 dark:text-rose-200">
              {listError}
            </div>
          )}

          {/* Email List */}
          <div className="divide-y divide-slate-200/60 dark:divide-white/[0.07] max-h-[68vh] overflow-y-auto">
            {loadingList && messages.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-sky-400" />
                Loading your school inbox...
              </div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
                <Inbox className="w-6 h-6 text-slate-400" />
                <div>No messages found in this view.</div>
              </div>
            ) : (
              messages.map((msg) => {
                const isSelected = selectedId === msg.id && !composeOpen;
                return (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => void handleSelectMessage(msg)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      isSelected
                        ? 'bg-blue-50/90 dark:bg-sky-500/15'
                        : 'hover:bg-white/60 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {msg.isUnread && (
                          <span
                            className="w-2 h-2 rounded-full bg-blue-600 dark:bg-sky-400 shrink-0"
                            aria-label="Unread"
                          />
                        )}
                        <span
                          className={`text-xs truncate ${
                            msg.isUnread
                              ? 'font-bold text-slate-900 dark:text-white'
                              : 'font-medium text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {msg.fromName}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                        {formatShortEmailDate(msg.date)}
                      </span>
                    </div>
                    <div
                      className={`mt-1 text-xs truncate ${
                        msg.isUnread
                          ? 'font-semibold text-slate-900 dark:text-white'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {msg.subject}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {msg.snippet}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Pane: Reader + AI Reply Studio OR Compose New Email */}
        <section
          className={`lg:col-span-7 glass-panel rounded-2xl overflow-hidden ${
            showingDetailOnMobile ? 'block' : 'hidden lg:block'
          }`}
        >
          {composeOpen ? (
            <div className="p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200/70 dark:border-white/10">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="lg:hidden p-1.5 -ml-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                    aria-label="Back to inbox"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Compose New School Email
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    To
                  </label>
                  <input
                    type="email"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    placeholder="teacher@pleasantonusd.net"
                    className="w-full px-3.5 py-2.5 text-sm bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Question about upcoming test or assignment"
                    className="w-full px-3.5 py-2.5 text-sm bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
                  />
                </div>
              </div>

              {/* AI Drafting & Formatting Bar */}
              <div className="rounded-xl p-3.5 bg-blue-50/70 dark:bg-sky-500/[0.08] border border-blue-200/70 dark:border-sky-400/20 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-900 dark:text-sky-200">
                    <Sparkles className="w-3.5 h-3.5" />
                    Folio AI Email Formatter
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {TONE_OPTIONS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setReplyTone(t.id)}
                        className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                          replyTone === t.id
                            ? 'bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950'
                            : 'bg-white/80 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-white/10'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="text"
                  value={composeInstruction}
                  onChange={(e) => setComposeInstruction(e.target.value)}
                  placeholder="Optional: Tell AI what to write (e.g., ask about retaking Friday's quiz during office hours)"
                  className="w-full px-3 py-2 text-xs bg-white/90 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/10 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(aiBusyAction)}
                    onClick={() => void handleAiCompose('compose')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {aiBusyAction === 'compose' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    Generate Draft
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(aiBusyAction) || !composeBody.trim()}
                    onClick={() => void handleAiCompose('format-grammar')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-800 dark:text-sky-200 bg-white/90 dark:bg-white/[0.08] hover:bg-white dark:hover:bg-white/15 border border-blue-200/80 dark:border-sky-400/25 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {aiBusyAction === 'format-grammar' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    Fix Grammar &amp; Format
                  </button>
                  {composePreviousBody !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setComposeBody(composePreviousBody);
                        setComposePreviousBody(null);
                        setComposeImprovements([]);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Undo AI Edit
                    </button>
                  )}
                </div>

                {composeImprovements.length > 0 && (
                  <div className="pt-2 border-t border-blue-200/60 dark:border-sky-400/15 space-y-1">
                    <div className="text-[11px] font-semibold text-blue-900 dark:text-sky-200">
                      Formatting &amp; Grammar Updates:
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-slate-700 dark:text-slate-300 list-disc pl-4">
                      {composeImprovements.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Message
                </label>
                <textarea
                  rows={8}
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Write your rough draft here, then click Fix Grammar & Format to polish it..."
                  className="w-full px-3.5 py-3 text-sm bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30 leading-relaxed"
                />
              </div>

              {(aiError || sendError) && (
                <div className="rounded-xl px-3.5 py-2.5 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-400/30 text-xs text-rose-800 dark:text-rose-200">
                  {sendError || aiError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setComposeBody('');
                    setComposePreviousBody(null);
                    setComposeImprovements([]);
                  }}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={requestSendCompose}
                  disabled={!composeTo.trim() || !composeBody.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  Review &amp; Send
                </button>
              </div>
            </div>
          ) : loadingDetail ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-sky-400" />
              Opening email...
            </div>
          ) : !selectedDetail ? (
            <div className="p-10 text-center space-y-2.5">
              <div className="w-10 h-10 mx-auto rounded-2xl bg-slate-200/70 dark:bg-white/[0.06] flex items-center justify-center text-slate-500 dark:text-slate-400">
                <Mail className="w-5 h-5" />
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Select an email to read or reply
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                Pick any message from your inbox to summarize it with AI, generate a reply, or
                format and fix your grammar before sending directly through Folio.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200/70 dark:divide-white/10">
              {/* Opened Email Header */}
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(null);
                        setSelectedDetail(null);
                      }}
                      className="lg:hidden p-1.5 -ml-1.5 mt-0.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white shrink-0"
                      aria-label="Back to inbox"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white break-words leading-snug">
                        {selectedDetail.subject}
                      </h3>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 break-all">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {selectedDetail.fromName}
                        </span>
                        {selectedDetail.fromEmail &&
                          selectedDetail.fromEmail !== selectedDetail.fromName && (
                            <span className="text-slate-500 dark:text-slate-400">
                              {' '}
                              &lt;{selectedDetail.fromEmail}&gt;
                            </span>
                          )}
                      </div>
                      <div className="mt-0.5 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        {selectedDetail.date}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick AI Read Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={Boolean(aiBusyAction)}
                    onClick={() => void handleSummarizeEmail()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-sky-300 bg-blue-50/90 dark:bg-sky-500/15 hover:bg-blue-100 dark:hover:bg-sky-500/25 border border-blue-200/80 dark:border-sky-400/25 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {aiBusyAction === 'summarize' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    AI Summarize
                  </button>
                  {onAskAiWithEmail && (
                    <button
                      type="button"
                      onClick={() =>
                        onAskAiWithEmail(
                          `Read this school email from ${selectedDetail.fromName} with subject "${selectedDetail.subject}" and help me understand what I need to do:\n\n${selectedDetail.bodyText.slice(0, 1400)}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/10 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors"
                    >
                      Ask Folio AI Coach
                    </button>
                  )}
                </div>

                {/* AI Summary Card */}
                {aiSummary && aiSummary.messageId === selectedDetail.id && (
                  <div className="rounded-xl p-3.5 bg-blue-50/80 dark:bg-sky-500/10 border border-blue-200/80 dark:border-sky-400/25 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-900 dark:text-sky-200">
                        <Sparkles className="w-3.5 h-3.5" />
                        AI Summary
                      </span>
                      <button
                        type="button"
                        onClick={() => setAiSummary(null)}
                        aria-label="Close summary"
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                      {aiSummary.summary}
                    </p>
                    {aiSummary.actionItems.length > 0 && (
                      <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 list-disc pl-4">
                        {aiSummary.actionItems.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Safe Plain-Text Email Body */}
              <div className="p-4 sm:p-5 max-h-[34vh] overflow-y-auto bg-white/40 dark:bg-slate-950/25">
                <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                  {selectedDetail.bodyText}
                </div>
              </div>

              {/* Direct Reply & AI Formatting Studio */}
              <div className="p-4 sm:p-5 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Reply directly to{' '}
                    <span className="text-blue-700 dark:text-sky-400 break-all">
                      {extractEmailAddress(replyRecipient) || selectedDetail.fromName}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {TONE_OPTIONS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setReplyTone(t.id)}
                        className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                          replyTone === t.id
                            ? 'bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950'
                            : 'bg-slate-200/70 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional student note for AI reply generation */}
                <input
                  type="text"
                  value={replyInstruction}
                  onChange={(e) => setReplyInstruction(e.target.value)}
                  placeholder="Optional note for AI (e.g., tell them I can come to office hours Thursday at lunch)"
                  className="w-full px-3 py-2 text-xs bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />

                {/* AI Reply & Grammar Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(aiBusyAction)}
                    onClick={() => void handleGenerateReply()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {aiBusyAction === 'generate-reply' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    Generate AI Reply
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(aiBusyAction) || !replyBody.trim()}
                    onClick={() => void handleFormatReplyGrammar()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-800 dark:text-sky-200 bg-blue-50/90 dark:bg-sky-500/15 hover:bg-blue-100 dark:hover:bg-sky-500/25 border border-blue-200/80 dark:border-sky-400/25 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {aiBusyAction === 'format-grammar' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    Fix Grammar &amp; Format
                  </button>
                  {replyPreviousBody !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setReplyBody(replyPreviousBody);
                        setReplyPreviousBody(null);
                        setReplyImprovements([]);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Undo AI Edit
                    </button>
                  )}
                </div>

                {replyImprovements.length > 0 && (
                  <div className="rounded-xl px-3.5 py-2.5 bg-emerald-50/80 dark:bg-emerald-500/10 border border-emerald-200/80 dark:border-emerald-400/20 space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                      <Check className="w-3.5 h-3.5" />
                      AI Formatted &amp; Polished
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-slate-700 dark:text-slate-300 list-disc pl-4">
                      {replyImprovements.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <textarea
                  rows={6}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Type your reply here (even rough notes work), then click Fix Grammar & Format—or click Generate AI Reply..."
                  className="w-full px-3.5 py-3 text-sm bg-white/85 dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30 leading-relaxed"
                />

                {(aiError || sendError) && (
                  <div className="rounded-xl px-3.5 py-2.5 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-400/30 text-xs text-rose-800 dark:text-rose-200">
                    {sendError || aiError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Subject: <span className="font-medium">{replySubject}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {replyBody.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          setReplyBody('');
                          setReplyPreviousBody(null);
                          setReplyImprovements([]);
                        }}
                        className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={requestSendReply}
                      disabled={!replyBody.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Review &amp; Send Reply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Mandatory Explicit Confirmation Modal Before Sending Any Email */}
      {pendingSend && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !sendingEmail) setPendingSend(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm send email"
            className="w-full max-w-lg glass-modal rounded-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-blue-600 dark:text-sky-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Confirm Send Email
                </h3>
              </div>
              <button
                type="button"
                disabled={sendingEmail}
                onClick={() => setPendingSend(null)}
                aria-label="Cancel sending email"
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Review the recipient, subject, and message below before sending from{' '}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {gmailAccount?.email}
                </span>
                .
              </p>

              <div className="rounded-xl p-3.5 bg-white/75 dark:bg-slate-900/75 border border-slate-200/80 dark:border-white/10 space-y-2 text-xs">
                <div className="flex gap-2">
                  <span className="text-slate-400 dark:text-slate-500 w-14 shrink-0">To:</span>
                  <span className="font-medium text-slate-900 dark:text-white break-all">
                    {pendingSend.to}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-slate-400 dark:text-slate-500 w-14 shrink-0">Subject:</span>
                  <span className="font-medium text-slate-900 dark:text-white break-words">
                    {pendingSend.subject}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200 leading-relaxed">
                  {pendingSend.body}
                </div>
              </div>

              {sendError && (
                <div className="rounded-xl px-3.5 py-2.5 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-400/30 text-xs text-rose-800 dark:text-rose-200">
                  {sendError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={sendingEmail}
                  onClick={() => setPendingSend(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/10 border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={sendingEmail}
                  onClick={() => void handleConfirmSend()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-xl transition-colors disabled:opacity-60"
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Confirm &amp; Send Email
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
