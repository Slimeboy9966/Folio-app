import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  Course,
  CourseResult,
  TermSummary,
} from '../types/grades';
import {
  cleanAssignmentDisplayTitle,
  formatGpa,
  formatPercent,
  getEffectiveCourseLevel,
} from '../utils/gradeMath';
import { GmailMessageSummary } from '../utils/gmailApi';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isError?: boolean;
}

interface AiAssistantDrawerProps {
  open: boolean;
  initialPrompt?: string | null;
  onConsumeInitialPrompt?: () => void;
  termName: string;
  courses: Course[];
  courseResults: Record<string, CourseResult>;
  summary: TermSummary;
  isHypothetical: boolean;
  recentSchoolEmails?: GmailMessageSummary[];
  onClose: () => void;
}

const STORAGE_KEY_AI_CHAT = 'folio_ai_chat_v1';

function loadSavedChat(): AiChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_AI_CHAT);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AiChatMessage[]).slice(-20) : [];
  } catch {
    return [];
  }
}

/**
 * Builds a concise, credential-free snapshot of the student's current term
 * so the AI assistant can give mathematically grounded, personalized advice.
 */
function buildGradebookSnapshot(
  termName: string,
  courses: Course[],
  courseResults: Record<string, CourseResult>,
  summary: TermSummary,
  isHypothetical: boolean,
  recentSchoolEmails?: GmailMessageSummary[]
): string {
  const lines: string[] = [
    `Term: ${termName} (${isHypothetical ? 'Hypothetical Mode Active' : 'Actual Grades'})`,
    `Semester Unweighted GPA: ${formatGpa(summary.termGpa)} | Weighted GPA: ${formatGpa(
      summary.weightedTermGpa
    )} | Graded Credits: ${summary.gradedCredits}`,
    `Today's Date: ${new Date().toISOString().slice(0, 10)}`,
    '',
    'Courses:',
  ];

  for (const course of courses) {
    const res = courseResults[course.id];
    const level = getEffectiveCourseLevel(course);
    const levelTag = level === 'ap' ? ' [AP +1.0]' : level === 'honors' ? ' [Honors +1.0]' : '';
    const exclTag = res?.excludedFromGpa ? ' [Excluded from GPA]' : '';

    lines.push(
      `- ${course.code} ${course.name}${levelTag}${exclTag} (Instructor: ${course.instructor}, ${
        course.credits
      } cr, ${course.gradingMode}): ${formatPercent(res?.percentage ?? null)} (${
        res?.letter ?? '—'
      }, GPA ${formatGpa(res?.gpa ?? null)})`
    );

    if (res && res.categoryResults.length > 0) {
      const catSummary = res.categoryResults
        .map((cr) => {
          const weightPart =
            course.gradingMode === 'weighted' ? `${cr.category.weight}% wt` : 'pts';
          return `${cr.category.name} (${weightPart}): ${formatPercent(cr.percentage)}`;
        })
        .join('; ');
      lines.push(`  Categories: ${catSummary}`);
    }

    const catMap = new Map(course.categories.map((c) => [c.id, c.name]));

    const missing = (res?.effectiveAssignments || []).filter(
      (a) => !a.isRemoved && !a.excused && a.earned === 0 && a.possible > 0
    );
    if (missing.length > 0) {
      lines.push(
        `  Zero/Missing (${missing.length}): ${missing
          .slice(0, 5)
          .map(
            (a, idx) =>
              `${cleanAssignmentDisplayTitle(a.title, catMap.get(a.categoryId), idx)} (0/${
                a.possible
              }, due ${a.dueDate || 'TBD'})`
          )
          .join(', ')}`
      );
    }

    const upcoming = (res?.effectiveAssignments || []).filter(
      (a) => !a.isRemoved && !a.excused && a.earned === null
    );
    if (upcoming.length > 0) {
      lines.push(
        `  Upcoming/Ungraded (${upcoming.length}): ${upcoming
          .slice(0, 6)
          .map(
            (a, idx) =>
              `${cleanAssignmentDisplayTitle(a.title, catMap.get(a.categoryId), idx)} (${
                a.possible
              } pts, ${catMap.get(a.categoryId) || 'Coursework'}, due ${a.dueDate || 'TBD'})`
          )
          .join(', ')}`
      );
    }

    const recentLow = (res?.effectiveAssignments || [])
      .filter(
        (a) =>
          !a.isRemoved &&
          !a.excused &&
          a.earned !== null &&
          a.earned > 0 &&
          a.possible > 0 &&
          a.earned / a.possible < 0.8
      )
      .slice(-4);
    if (recentLow.length > 0) {
      lines.push(
        `  Below 80%: ${recentLow
          .map(
            (a, idx) =>
              `${cleanAssignmentDisplayTitle(a.title, catMap.get(a.categoryId), idx)} (${
                a.earned
              }/${a.possible})`
          )
          .join(', ')}`
      );
    }
  }

  if (recentSchoolEmails && recentSchoolEmails.length > 0) {
    lines.push('', 'Recent Linked School Emails (newest first):');
    for (const email of recentSchoolEmails.slice(0, 8)) {
      lines.push(
        `- From: ${email.fromName} | Subject: ${email.subject} | Date: ${email.date}${
          email.isUnread ? ' [Unread]' : ''
        }`
      );
      if (email.snippet) {
        lines.push(`  Preview: ${email.snippet.slice(0, 220)}`);
      }
    }
  }

  return lines.join('\n').slice(0, 11_800);
}

/**
 * Safely renders lightweight markdown (**bold**, `code`, bullet lists, numbered lists)
 * purely through React text/element nodes — zero dangerouslySetInnerHTML.
 */
function renderInlineSegments(line: string, keyPrefix: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-${idx}`} className="font-semibold text-slate-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={`${keyPrefix}-${idx}`}
          className="px-1 py-0.5 rounded bg-slate-200/75 dark:bg-white/10 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyPrefix}-${idx}`}>{part}</React.Fragment>;
  });
}

const FormattedMessageBody: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: Array<{ ordered: boolean; text: string }> = [];

  const flushList = (keyIdx: number) => {
    if (listItems.length === 0) return;
    const isOrdered = listItems[0].ordered;
    const Tag = isOrdered ? 'ol' : 'ul';
    blocks.push(
      <Tag
        key={`list-${keyIdx}`}
        className={`my-1.5 space-y-1 pl-4 ${
          isOrdered ? 'list-decimal' : 'list-disc'
        } marker:text-slate-400 dark:marker:text-slate-500`}
      >
        {listItems.map((item, i) => (
          <li key={`li-${keyIdx}-${i}`} className="leading-relaxed">
            {renderInlineSegments(item.text, `li-${keyIdx}-${i}`)}
          </li>
        ))}
      </Tag>
    );
    listItems = [];
  };

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList(idx);
      return;
    }

    const bulletMatch = /^[-*•]\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      if (listItems.length > 0 && listItems[0].ordered) flushList(idx);
      listItems.push({ ordered: false, text: bulletMatch[1] });
      return;
    }

    const numMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (numMatch) {
      if (listItems.length > 0 && !listItems[0].ordered) flushList(idx);
      listItems.push({ ordered: true, text: numMatch[1] });
      return;
    }

    flushList(idx);

    const headingMatch = /^#{1,3}\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push(
        <div
          key={`h-${idx}`}
          className="mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-sky-400"
        >
          {renderInlineSegments(headingMatch[1], `h-${idx}`)}
        </div>
      );
      return;
    }

    blocks.push(
      <p key={`p-${idx}`} className="my-1 leading-relaxed">
        {renderInlineSegments(trimmed, `p-${idx}`)}
      </p>
    );
  });

  flushList(lines.length);
  return <div className="space-y-0.5 break-words">{blocks}</div>;
};

export const AiAssistantDrawer: React.FC<AiAssistantDrawerProps> = ({
  open,
  initialPrompt,
  onConsumeInitialPrompt,
  termName,
  courses,
  courseResults,
  summary,
  isHypothetical,
  recentSchoolEmails,
  onClose,
}) => {
  const [messages, setMessages] = useState<AiChatMessage[]>(loadSavedChat);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_AI_CHAT, JSON.stringify(messages.slice(-20)));
    } catch {
      // Ignore quota errors
    }
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const sendMessage = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: AiChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    const modelMsgId = `m-${Date.now() + 1}`;
    const placeholderModelMsg: AiChatMessage = {
      id: modelMsgId,
      role: 'model',
      text: '',
    };

    const nextHistory = [...messages, userMsg];
    setMessages([...nextHistory, placeholderModelMsg]);
    setInput('');
    setIsStreaming(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const gradebookContext = buildGradebookSnapshot(
        termName,
        courses,
        courseResults,
        summary,
        isHypothetical,
        recentSchoolEmails
      );

      const payloadMessages = nextHistory
        .filter((m) => !m.isError && m.text.trim().length > 0)
        .slice(-14)
        .map((m) => ({ role: m.role, text: m.text }));

      const runJsonFallback = async (): Promise<boolean> => {
        const fallbackRes = await fetch('/api/ai/chat?mode=json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: payloadMessages,
            gradebookContext,
            stream: false,
          }),
          signal: controller.signal,
        });
        const data = (await fallbackRes.json().catch(() => null)) as {
          text?: string;
          error?: string;
        } | null;
        if (!fallbackRes.ok) {
          const errText =
            typeof data?.error === 'string'
              ? data.error
              : `AI Assistant request failed (HTTP ${fallbackRes.status}).`;
          setMessages((prev) =>
            prev.map((m) => (m.id === modelMsgId ? { ...m, text: errText, isError: true } : m))
          );
          return true;
        }
        if (typeof data?.text === 'string' && data.text.trim()) {
          setMessages((prev) =>
            prev.map((m) => (m.id === modelMsgId ? { ...m, text: data.text!.trim() } : m))
          );
          return true;
        }
        return false;
      };

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: payloadMessages,
          gradebookContext,
        }),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        const errPayload = await response.json().catch(() => null);
        const errText =
          typeof errPayload?.error === 'string'
            ? errPayload.error
            : `AI Assistant request failed (HTTP ${response.status}).`;
        setMessages((prev) =>
          prev.map((m) => (m.id === modelMsgId ? { ...m, text: errText, isError: true } : m))
        );
        return;
      }

      if (contentType.includes('application/json')) {
        const jsonPayload = (await response.json().catch(() => null)) as {
          text?: string;
          error?: string;
        } | null;
        const text =
          typeof jsonPayload?.text === 'string' && jsonPayload.text.trim()
            ? jsonPayload.text.trim()
            : typeof jsonPayload?.error === 'string'
              ? jsonPayload.error
              : 'No response received from Folio AI.';
        const isError = !jsonPayload?.text;
        setMessages((prev) =>
          prev.map((m) => (m.id === modelMsgId ? { ...m, text, isError } : m))
        );
        return;
      }

      const reader = response.body?.getReader();
      if (!reader || !contentType.includes('text/event-stream')) {
        const handled = await runJsonFallback();
        if (!handled) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === modelMsgId
                ? {
                    ...m,
                    text: 'Unable to read response stream. Please try again.',
                    isError: true,
                  }
                : m
            )
          );
        }
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let receivedAnyText = false;
      let receivedError = false;

      const processChunkBlock = (eventChunk: string) => {
        const dataLines = eventChunk
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());
        for (const rawJson of dataLines) {
          if (!rawJson) continue;
          try {
            const parsed = JSON.parse(rawJson) as {
              delta?: string;
              error?: string;
              done?: boolean;
            };
            if (parsed.delta) {
              receivedAnyText = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === modelMsgId ? { ...m, text: m.text + parsed.delta } : m
                )
              );
            }
            if (parsed.error) {
              receivedError = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === modelMsgId
                    ? { ...m, text: parsed.error as string, isError: true }
                    : m
                )
              );
            }
          } catch {
            // Ignore malformed SSE fragment
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            for (const tailChunk of buffer.split(/\r?\n\r?\n/)) {
              if (tailChunk.trim()) processChunkBlock(tailChunk);
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const eventChunk of events) {
          if (eventChunk.trim()) processChunkBlock(eventChunk);
        }
      }

      // If proxy buffered/stripped the SSE stream and nothing arrived, auto-retry via JSON mode
      if (!receivedAnyText && !receivedError) {
        const handled = await runJsonFallback();
        if (!handled) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === modelMsgId
                ? {
                    ...m,
                    text: 'Folio AI did not return a reply. Please try sending your question again.',
                    isError: true,
                  }
                : m
            )
          );
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === modelMsgId
            ? {
                ...m,
                text: 'Network error while reaching Folio AI. Please check your connection and try again.',
                isError: true,
              }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  useEffect(() => {
    if (open && initialPrompt && !isStreaming) {
      const promptToRun = initialPrompt;
      onConsumeInitialPrompt?.();
      void sendMessage(promptToRun);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPrompt]);

  if (!open) return null;

  const quickPrompts = [
    {
      label: 'Raise my lowest grade',
      prompt:
        'Look at my lowest or borderline classes and tell me the single highest-impact strategy to raise my semester GPA.',
    },
    {
      label: 'Weekly study plan',
      prompt:
        'Build a realistic 5-day study plan for my upcoming tests, quizzes, and high-weight assignments.',
    },
    {
      label: 'Missing & low work check',
      prompt:
        'Which missing or low-scoring assignments are hurting my grades the most right now, and what should I prioritize?',
    },
    {
      label: 'Draft teacher email',
      prompt:
        'Draft a polite, concise email to the teacher of my lowest class asking about office hours and how to improve before the next exam.',
    },
    {
      label: 'Quiz me for my next test',
      prompt:
        'Give me 4 quick practice quiz questions based on my next upcoming test or quiz topic, and wait for my answers.',
    },
  ];

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Folio AI Academic Assistant"
        className="w-full sm:w-[440px] max-w-full h-[100dvh] glass-modal flex flex-col border-l border-slate-200/70 dark:border-white/10"
      >
        {/* Header */}
        <div className="px-4 sm:px-5 h-14 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-xl bg-blue-600/15 dark:bg-sky-400/15 flex items-center justify-center text-blue-700 dark:text-sky-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                Folio AI Coach
              </h2>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate tabular-nums">
                {courses.length} {courses.length === 1 ? 'course' : 'courses'} · UW{' '}
                {formatGpa(summary.termGpa)}
                {summary.hasWeightedCourses ? ` · W ${formatGpa(summary.weightedTermGpa)}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  setIsStreaming(false);
                  setMessages([]);
                }}
                title="Clear conversation"
                aria-label="Clear conversation"
                className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-slate-200/50 dark:hover:bg-white/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close AI Assistant"
              className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-xl hover:bg-slate-200/50 dark:hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl p-4 bg-white/60 dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/10">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Your live gradebook coach
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Ask how to boost a borderline grade, plan your week around upcoming tests and
                  quizzes, draft an email to a teacher, or practice for your next exam.
                </p>
              </div>

              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                  Quick Actions
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {quickPrompts.map((qp) => (
                    <button
                      key={qp.label}
                      type="button"
                      onClick={() => void sendMessage(qp.prompt)}
                      className="text-left px-3.5 py-2.5 rounded-xl bg-white/70 dark:bg-white/[0.05] hover:bg-white dark:hover:bg-white/[0.1] border border-slate-200/80 dark:border-white/10 transition-colors"
                    >
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                        {qp.label}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                        {qp.prompt}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-xs ${
                      isUser
                        ? 'bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950 font-medium'
                        : msg.isError
                          ? 'bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-400/30 text-rose-800 dark:text-rose-200'
                          : 'bg-white/80 dark:bg-white/[0.06] border border-slate-200/75 dark:border-white/10 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
                    ) : msg.text ? (
                      <FormattedMessageBody text={msg.text} />
                    ) : isStreaming ? (
                      <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Analyzing your grades...
                      </span>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">
                        No response received. Try sending your question again.
                      </span>
                    )}
                  </div>

                  {!isUser && !msg.isError && msg.text && !isStreaming && (
                    <button
                      type="button"
                      onClick={() => void handleCopy(msg.id, msg.text)}
                      className="mt-1 ml-1 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}
          <div ref={scrollEndRef} />
        </div>

        {/* Prompt Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="p-3 sm:p-4 border-t border-slate-200/70 dark:border-white/10 bg-white/50 dark:bg-slate-950/40 shrink-0"
        >
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(input);
                }
              }}
              placeholder="Ask about your grades, GPA, or study plan..."
              disabled={isStreaming}
              className="flex-1 resize-none min-h-[42px] max-h-28 px-3.5 py-2.5 text-sm bg-white/85 dark:bg-slate-900/80 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              aria-label="Send message"
              className="h-[42px] w-[42px] shrink-0 inline-flex items-center justify-center rounded-xl text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors disabled:opacity-50"
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};
