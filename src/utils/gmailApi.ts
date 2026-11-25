export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromName: string;
  fromEmail: string;
  to: string;
  date: string;
  snippet: string;
  isUnread: boolean;
  labelIds: string[];
}

export interface GmailMessageDetail extends GmailMessageSummary {
  bodyText: string;
  messageIdHeader: string;
  referencesHeader: string;
  replyTo: string;
}

export class GmailAuthExpiredError extends Error {
  constructor(message = 'Your Gmail session expired. Please reconnect your school email.') {
    super(message);
    this.name = 'GmailAuthExpiredError';
  }
}

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailApiHeader {
  name?: string;
  value?: string;
}

interface GmailApiPart {
  mimeType?: string;
  body?: {
    data?: string;
    size?: number;
  };
  parts?: GmailApiPart[];
}

interface GmailApiMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    mimeType?: string;
    headers?: GmailApiHeader[];
    body?: {
      data?: string;
      size?: number;
    };
    parts?: GmailApiPart[];
  };
}

function getHeader(headers: GmailApiHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  const match = headers.find((h) => (h.name || '').toLowerCase() === target);
  return (match?.value || '').trim();
}

function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, 'text/html');
    return doc.documentElement.textContent || input;
  } catch {
    return input;
  }
}

export function parseSenderAddress(rawFrom: string): { name: string; email: string } {
  const cleaned = rawFrom.trim();
  if (!cleaned) return { name: 'Unknown Sender', email: '' };

  const angleMatch = /^(.*?)<([^>]+)>$/.exec(cleaned);
  if (angleMatch) {
    const rawName = angleMatch[1].trim().replace(/^["']|["']$/g, '');
    const email = angleMatch[2].trim();
    return {
      name: rawName || email,
      email,
    };
  }

  return {
    name: cleaned,
    email: cleaned.includes('@') ? cleaned : '',
  };
}

function decodeBase64UrlToUtf8(base64Url: string): string {
  if (!base64Url) return '';
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function encodeUtf8ToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function htmlToPlainText(html: string): string {
  if (!html) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, head, noscript').forEach((el) => el.remove());
    doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, blockquote').forEach((block) => {
      block.append('\n');
    });
    const raw = doc.body?.textContent || '';
    return raw
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

function extractBestBodyText(payload: GmailApiMessage['payload']): string {
  if (!payload) return '';

  let plainCandidate = '';
  let htmlCandidate = '';

  const walk = (part: GmailApiPart) => {
    const mime = (part.mimeType || '').toLowerCase();
    if (mime === 'text/plain' && part.body?.data && !plainCandidate) {
      plainCandidate = decodeBase64UrlToUtf8(part.body.data).trim();
    } else if (mime === 'text/html' && part.body?.data && !htmlCandidate) {
      htmlCandidate = decodeBase64UrlToUtf8(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  };

  walk(payload);

  if (plainCandidate) {
    return plainCandidate.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim();
  }
  if (htmlCandidate) {
    return htmlToPlainText(htmlCandidate);
  }
  return '';
}

function mapSummary(msg: GmailApiMessage): GmailMessageSummary {
  const headers = msg.payload?.headers;
  const from = getHeader(headers, 'From');
  const parsedFrom = parseSenderAddress(from);
  const subject = getHeader(headers, 'Subject') || '(No Subject)';
  const to = getHeader(headers, 'To');
  const dateHeader = getHeader(headers, 'Date');
  const date =
    dateHeader ||
    (msg.internalDate ? new Date(Number(msg.internalDate)).toUTCString() : '');
  const labelIds = Array.isArray(msg.labelIds) ? msg.labelIds : [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    subject,
    from,
    fromName: parsedFrom.name,
    fromEmail: parsedFrom.email,
    to,
    date,
    snippet: decodeHtmlEntities(msg.snippet || '').trim(),
    isUnread: labelIds.includes('UNREAD'),
    labelIds,
  };
}

async function gmailFetch<T>(accessToken: string, pathAndQuery: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GMAIL_API_BASE}${pathAndQuery}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });

  if (response.status === 401) {
    throw new GmailAuthExpiredError();
  }

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string; status?: string } })
    | null;

  if (!response.ok) {
    const apiMessage = data?.error?.message;
    if (response.status === 403 && /insufficient|scope|permission/i.test(apiMessage || '')) {
      throw new GmailAuthExpiredError(
        'Gmail permissions are incomplete. Please reconnect your school Google account and allow email access.'
      );
    }
    throw new Error(apiMessage || `Gmail request failed (HTTP ${response.status}).`);
  }

  return data as T;
}

export async function listGmailMessages(
  accessToken: string,
  options?: {
    query?: string;
    labelId?: 'INBOX' | 'SENT';
    maxResults?: number;
  }
): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams();
  params.set('maxResults', String(options?.maxResults ?? 18));
  if (options?.labelId) {
    params.set('labelIds', options.labelId);
  }
  if (options?.query?.trim()) {
    params.set('q', options.query.trim());
  }

  const listData = await gmailFetch<{
    messages?: Array<{ id: string; threadId: string }>;
  }>(accessToken, `/messages?${params.toString()}`);

  const refs = listData.messages || [];
  if (refs.length === 0) return [];

  const results: GmailMessageSummary[] = [];
  const batchSize = 6;
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = refs.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map((ref) =>
        gmailFetch<GmailApiMessage>(
          accessToken,
          `/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
        )
      )
    );
    for (const item of settled) {
      if (item.status === 'fulfilled') {
        results.push(mapSummary(item.value));
      } else if (item.reason instanceof GmailAuthExpiredError) {
        throw item.reason;
      }
    }
  }

  return results;
}

export async function getGmailMessageDetail(
  accessToken: string,
  messageId: string
): Promise<GmailMessageDetail> {
  const msg = await gmailFetch<GmailApiMessage>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}?format=full`
  );
  const summary = mapSummary(msg);
  const headers = msg.payload?.headers;
  const bodyText = extractBestBodyText(msg.payload) || summary.snippet || '(No message content)';

  return {
    ...summary,
    bodyText,
    messageIdHeader: getHeader(headers, 'Message-ID'),
    referencesHeader: getHeader(headers, 'References'),
    replyTo: getHeader(headers, 'Reply-To'),
  };
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function encodeRfc2047IfNeeded(value: string): string {
  const clean = sanitizeHeaderValue(value);
  // Use RFC 2047 UTF-8 Base64 encoding when subject contains non-ASCII characters
  if (/[^\x20-\x7E]/.test(clean)) {
    const bytes = new TextEncoder().encode(clean);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `=?UTF-8?B?${btoa(binary)}?=`;
  }
  return clean;
}

export function extractEmailAddress(rawRecipient: string): string {
  const cleaned = sanitizeHeaderValue(rawRecipient);
  const angleMatch = /<([^>\s]+@[^>\s]+)>/.exec(cleaned);
  if (angleMatch) return angleMatch[1].trim();
  return cleaned;
}

export function isValidEmailRecipient(rawRecipient: string): boolean {
  const email = extractEmailAddress(rawRecipient);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function sendGmailMessage(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<{ id: string; threadId: string }> {
  const cleanTo = sanitizeHeaderValue(params.to);
  if (!isValidEmailRecipient(cleanTo)) {
    throw new Error('Please enter a valid recipient email address before sending.');
  }

  const cleanSubject = sanitizeHeaderValue(params.subject) || '(No Subject)';
  const cleanBody = params.body.replace(/\r\n/g, '\n').trim();
  if (!cleanBody) {
    throw new Error('Please write a message before sending.');
  }

  const headers: string[] = [
    `To: ${cleanTo}`,
    `Subject: ${encodeRfc2047IfNeeded(cleanSubject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];

  const cleanInReplyTo = params.inReplyTo ? sanitizeHeaderValue(params.inReplyTo) : '';
  const cleanReferences = params.references ? sanitizeHeaderValue(params.references) : '';
  if (cleanInReplyTo) {
    headers.push(`In-Reply-To: ${cleanInReplyTo}`);
    const refChain = cleanReferences
      ? cleanReferences.includes(cleanInReplyTo)
        ? cleanReferences
        : `${cleanReferences} ${cleanInReplyTo}`
      : cleanInReplyTo;
    headers.push(`References: ${refChain}`);
  }

  const rawMime = `${headers.join('\r\n')}\r\n\r\n${cleanBody.replace(/\n/g, '\r\n')}`;
  const encodedRaw = encodeUtf8ToBase64Url(rawMime);

  const payload: { raw: string; threadId?: string } = { raw: encodedRaw };
  if (params.threadId) {
    payload.threadId = params.threadId;
  }

  return gmailFetch<{ id: string; threadId: string }>(accessToken, '/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function formatShortEmailDate(rawDate: string): string {
  if (!rawDate) return '';
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return rawDate.slice(0, 16);

  const now = new Date();
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  if (sameDay) {
    return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = parsed.getFullYear() === now.getFullYear();
  return parsed.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
