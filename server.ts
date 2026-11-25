import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const DEFAULT_DISTRICT_HOST = 'ca-pleas-psv.edupoint.com';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 500;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 25;

interface EdupointSession {
  mode: 'soap' | 'web';
  host: string;
  cookies: Map<string, string>;
  isParent: boolean;
  agu: string;
  soapCreds?: {
    username: string;
    password: string;
  };
  studentInfo: {
    name: string;
    school: string;
    grade: string;
  };
  expiresAt: number;
}

interface ParsedCategory {
  id: string;
  name: string;
  weight: number;
  dropLowest?: number;
}

interface ParsedAssignment {
  id: string;
  categoryId: string;
  title: string;
  dueDate: string;
  earned: number | null;
  possible: number;
  extraCredit: boolean;
  excused: boolean;
}

interface ParsedCourse {
  id: string;
  termId: string;
  code: string;
  name: string;
  instructor: string;
  credits: number;
  gradingMode: 'weighted' | 'points';
  categories: ParsedCategory[];
  assignments: ParsedAssignment[];
  source: 'edupoint';
  officialPercent: number | null;
  officialLetter: string | null;
}

interface ReportingPeriodInfo {
  index: string;
  name: string;
  startDate: string;
  endDate: string;
  defaultMarkPeriodGU?: string;
}

interface ParsedMailMessage {
  id: string;
  subject: string;
  sender: string;
  date: string;
  preview: string;
  unread: boolean;
  folder: string;
}

const sessions = new Map<string, EdupointSession>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const WEBAUTHN_CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_WEBAUTHN_ENTRIES = 1000;

interface WebAuthnChallengeEntry {
  challenge: string;
  type: 'register' | 'auth';
  expectedOrigin: string;
  rpId: string;
  credentialId?: string;
  expiresAt: number;
}

interface StoredWebAuthnCredential {
  credentialId: string;
  publicKeySpki?: string;
  alg?: number;
  rpId: string;
  registeredAt: number;
}

const webauthnChallenges = new Map<string, WebAuthnChallengeEntry>();
const webauthnCredentials = new Map<string, StoredWebAuthnCredential>();

setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions.entries()) {
    if (sess.expiresAt <= now) {
      sessions.delete(token);
    }
  }
  for (const [ip, bucket] of loginAttempts.entries()) {
    if (bucket.resetAt <= now) {
      loginAttempts.delete(ip);
    }
  }
  for (const [id, entry] of webauthnChallenges.entries()) {
    if (entry.expiresAt <= now) {
      webauthnChallenges.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Strictly validates the Edupoint StudentVUE host to prevent SSRF.
 * Only HTTPS connections to verified *.edupoint.com district portals are allowed.
 */
function validateDistrictHost(rawInput?: string): string {
  const trimmed = (rawInput || DEFAULT_DISTRICT_HOST).trim();
  if (!trimmed) return DEFAULT_DISTRICT_HOST;

  let candidate = trimmed;
  if (!candidate.includes('://')) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Invalid Edupoint district URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only secure HTTPS Edupoint URLs are supported.');
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error('District URL must not contain credentials or custom ports.');
  }

  const host = parsed.hostname.toLowerCase();
  const hostPattern = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.edupoint\.com$/;
  if (!hostPattern.test(host)) {
    throw new Error(
      'District host must be a valid Edupoint Synergy domain (for example, ca-pleas-psv.edupoint.com).'
    );
  }

  return host;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = loginAttempts.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return false;
  }
  bucket.count += 1;
  return true;
}

function extractSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie();
  }
  const combined = headers.get('set-cookie');
  return combined ? [combined] : [];
}

function mergeCookies(jar: Map<string, string>, headers: Headers): void {
  const list = extractSetCookies(headers);
  for (const raw of list) {
    const firstPart = raw.split(';')[0]?.trim();
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();
    if (name) {
      jar.set(name, val);
    }
  }
}

function serializeCookies(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function fetchWithCookies(
  url: string,
  jar: Map<string, string>,
  init: RequestInit = {},
  maxRedirects = 6
): Promise<{ response: globalThis.Response; finalUrl: string }> {
  let currentUrl = url;
  let method = init.method || 'GET';
  let body = init.body;

  for (let i = 0; i <= maxRedirects; i++) {
    const headers = new Headers(init.headers || {});
    headers.set('User-Agent', BROWSER_USER_AGENT);
    const cookieHeader = serializeCookies(jar);
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    }

    const res = await fetch(currentUrl, {
      ...init,
      method,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });

    mergeCookies(jar, res.headers);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        return { response: res, finalUrl: currentUrl };
      }
      const nextUrl = new URL(loc, currentUrl);
      const origHost = new URL(url).hostname.toLowerCase();
      if (nextUrl.hostname.toLowerCase() !== origHost) {
        return { response: res, finalUrl: nextUrl.toString() };
      }
      currentUrl = nextUrl.toString();
      if (res.status === 301 || res.status === 302 || res.status === 303) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }

    return { response: res, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects while communicating with Edupoint.');
}

function parseUsDateToIso(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  const raw = String(dateStr).trim();

  // ASP.NET /Date(1728950400000)/ format
  const msMatch = raw.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);
  if (msMatch) {
    const d = new Date(parseInt(msMatch[1], 10));
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  const cleaned = raw.split(' ')[0].split('T')[0];
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const parts = cleaned.split('/');
  if (parts.length === 3) {
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
    if (/^\d{4}$/.test(year) && /^\d{2}$/.test(month) && /^\d{2}$/.test(day)) {
      return `${year}-${month}-${day}`;
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function parsePercentNumber(raw?: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const match = str.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

function isOpaqueRandomString(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  // Standard UUID / GUID or brace-wrapped GUID
  if (/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(s)) {
    return true;
  }
  // Pure hex token >= 16 chars (e.g. Synergy GUID without hyphens or MD5/SHA hash)
  if (/^[0-9a-f]{16,}$/i.test(s)) {
    return true;
  }
  // Pure long digits >= 7 chars (internal database row/measure ID; allows short numeric titles like "101" or "42")
  if (/^\d{7,}$/.test(s)) {
    return true;
  }
  // Serialized JSON object/array leaked into a field
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    return true;
  }
  // Internal framework/ASP.NET control IDs
  if (/^(?:PXP_|GB_|ctl\d+_|dx-[a-z0-9-]+|id_[a-z0-9_-]+)$/i.test(s)) {
    return true;
  }
  // Single unbroken Base64 token (no spaces) with high entropy
  if (!/\s/.test(s) && s.length >= 22) {
    if (
      /^[A-Za-z0-9+/]{22,}={0,2}$/.test(s) &&
      /[0-9]/.test(s) &&
      /[a-z]/.test(s) &&
      /[A-Z]/.test(s) &&
      (/[+/=]/.test(s) || s.length >= 28)
    ) {
      return true;
    }
  }
  return false;
}

function tryDecodeBase64Text(s: string): string | null {
  const trimmed = s.trim();
  if (trimmed.length < 8 || trimmed.length % 4 !== 0 || /\s/.test(trimmed)) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (!decoded || decoded.includes('\uFFFD')) return null;
    // Verify strict round-trip match so normal words like "Homework" are never corrupted
    const reencoded = Buffer.from(decoded, 'utf8').toString('base64');
    if (reencoded.replace(/=+$/, '') !== trimmed.replace(/=+$/, '')) return null;
    // Ensure decoded text is printable human text / HTML (no binary control characters)
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) return null;
    // Accept if it contains HTML tags, spaces, or normal punctuation/words
    if (/<[a-z][\s\S]*>/i.test(decoded) || (/\s/.test(decoded) && /[A-Za-z]{2,}/.test(decoded))) {
      return decoded;
    }
  } catch {
    return null;
  }
  return null;
}

function stripHtmlText(raw?: unknown): string {
  if (raw === undefined || raw === null) return '';

  // Handle nested object wrappers like { text: "...", title: "...", Measure: "...", value: "..." }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const preferred =
      obj.Measure ??
      obj.measure ??
      obj.MeasureDescription ??
      obj.Assignment ??
      obj.assignment ??
      obj.title ??
      obj.Title ??
      obj.text ??
      obj.Text ??
      obj.name ??
      obj.Name ??
      obj.label ??
      obj.Label ??
      obj.description ??
      obj.Description ??
      obj.DisplayValue ??
      obj.Html ??
      obj.html ??
      obj.value ??
      obj.Value;
    if (preferred !== undefined && preferred !== null && typeof preferred !== 'object') {
      return stripHtmlText(preferred);
    }
    return '';
  }

  let str = String(raw).trim();
  if (!str) return '';

  // Try decoding Base64-encoded HTML/title payloads if present
  const b64 = tryDecodeBase64Text(str);
  if (b64) {
    str = b64.trim();
  }

  // Safely decode URL-encoded titles (e.g. "Unit%203%20Quiz")
  if (/%[0-9A-Fa-f]{2}/.test(str) && !/\s/.test(str)) {
    try {
      const dec = decodeURIComponent(str);
      if (dec && dec !== str) str = dec;
    } catch {
      // Leave original if malformed URI sequence
    }
  }

  // Up to 3 passes to handle HTML-entity-encoded markup (&lt;button ...&gt;Title&lt;/button&gt;)
  for (let pass = 0; pass < 3; pass++) {
    if (!str.includes('<') && !str.includes('&')) break;
    const $ = cheerio.load(`<div>${str}</div>`);
    // Remove script/style/noscript tags so their code never leaks into visible text
    $('script, style, noscript').remove();
    let text = $('div').text().replace(/\s+/g, ' ').trim();
    if (!text) {
      // Fallback to accessible label/title attributes when tag has empty inner text
      const attrEl = $('div [title], div [aria-label], div [data-title], div [data-name], div [alt], div input[value]').first();
      if (attrEl.length) {
        text = (
          attrEl.attr('title') ||
          attrEl.attr('aria-label') ||
          attrEl.attr('data-title') ||
          attrEl.attr('data-name') ||
          attrEl.attr('alt') ||
          attrEl.attr('value') ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    if (text === str) break;
    str = text;
  }

  // Final check if decoded HTML revealed a Base64 string
  const b64After = tryDecodeBase64Text(str);
  if (b64After) {
    return stripHtmlText(b64After);
  }

  return str.replace(/\s+/g, ' ').trim();
}

function parseScoreString(
  pointsRaw: string,
  scoreRaw: string,
  notesRaw: string,
  maxRaw?: unknown,
  scoreTypeRaw?: unknown,
  explicitNotForGrading?: boolean,
  explicitExtraCredit?: boolean
): { earned: number | null; possible: number; extraCredit: boolean; excused: boolean } {
  const pointsStr = stripHtmlText(pointsRaw).replace(/,/g, '').trim();
  const scoreStr = stripHtmlText(scoreRaw).replace(/,/g, '').trim();
  const notesStr = stripHtmlText(notesRaw).trim();
  const scoreTypeStr = stripHtmlText(scoreTypeRaw).toLowerCase();

  const lowerNotes = notesStr.toLowerCase();
  const lowerScore = scoreStr.toLowerCase();
  const lowerPoints = pointsStr.toLowerCase();

  const excused =
    Boolean(explicitNotForGrading) ||
    lowerNotes.includes('not for grading') ||
    lowerNotes.includes('excused') ||
    lowerNotes.includes('exempt') ||
    lowerScore === 'excused' ||
    lowerScore === 'ex' ||
    lowerScore === 'not for grading' ||
    lowerPoints === 'excused' ||
    lowerPoints === 'not for grading';

  let earned: number | null = null;
  let possible = 0;

  // Format 1: "18.00 / 20.00" or "95/100"
  const slashMatch =
    pointsStr.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/) ||
    scoreStr.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);

  if (slashMatch) {
    earned = parseFloat(slashMatch[1]);
    possible = parseFloat(slashMatch[2]);
  } else {
    // Format 1b: "Not Graded / 25" or "-- / 20.00" or "N/A / 15"
    const ungradedSlashMatch =
      pointsStr.match(/(?:not\s+graded|n\/a|excused|ex|missing|-+|–|—)\s*\/\s*(\d+(?:\.\d+)?)/i) ||
      scoreStr.match(/(?:not\s+graded|n\/a|excused|ex|missing|-+|–|—)\s*\/\s*(\d+(?:\.\d+)?)/i);

    // Format 2: "20.00 Points Possible" (ungraded / upcoming)
    const possibleOnlyMatch =
      ungradedSlashMatch ||
      pointsStr.match(/(\d+(?:\.\d+)?)\s*points?\s*possible/i) ||
      scoreStr.match(/(\d+(?:\.\d+)?)\s*points?\s*possible/i);

    if (possibleOnlyMatch) {
      earned = null;
      possible = parseFloat(possibleOnlyMatch[1]);
    } else {
      // Format 3: "18 out of 20" or "18.00 out of 20.0000"
      const outOfMatch =
        scoreStr.match(/(-?\d+(?:\.\d+)?)\s*out of\s*(\d+(?:\.\d+)?)/i) ||
        pointsStr.match(/(-?\d+(?:\.\d+)?)\s*out of\s*(\d+(?:\.\d+)?)/i);
      if (outOfMatch) {
        earned = parseFloat(outOfMatch[1]);
        possible = parseFloat(outOfMatch[2]);
      } else {
        const parsedMax = parseFloat(String(maxRaw ?? '').replace(/,/g, ''));
        if (Number.isFinite(parsedMax) && parsedMax > 0) {
          possible = parsedMax;
        } else if (scoreTypeStr.includes('percent')) {
          possible = 100;
        }

        const isUngradedLabel =
          lowerPoints.includes('not graded') ||
          lowerScore.includes('not graded') ||
          lowerPoints.includes('possible') ||
          lowerScore.includes('possible') ||
          lowerScore === 'n/a' ||
          lowerPoints === 'n/a';

        if (!isUngradedLabel) {
          // Handle percentage strings like "92.5%"
          const pctMatch = (pointsStr || scoreStr).match(/^(-?\d+(?:\.\d+)?)\s*%$/);
          if (pctMatch) {
            const pctVal = parseFloat(pctMatch[1]);
            if (possible <= 0) possible = 100;
            earned = Math.round(((pctVal / 100) * possible) * 100) / 100;
          } else {
            const singleNum = parseFloat(pointsStr || scoreStr);
            if (Number.isFinite(singleNum) && possible > 0) {
              earned = singleNum;
            }
          }
        }
      }
    }
  }

  const extraCredit =
    Boolean(explicitExtraCredit) ||
    (earned !== null && earned > 0 && possible === 0) ||
    lowerNotes.includes('extra credit');

  if (possible <= 0) {
    possible = extraCredit ? Math.max(earned ?? 1, 1) : 100;
  }

  return { earned, possible, extraCredit, excused };
}

/**
 * Safely converts a relaxed JS object/array literal (handling DevExtreme `new Date(...)`,
 * `undefined`, trailing commas, single-quoted strings, and unquoted object keys)
 * into strict JSON and parses it — without ever using `eval` or `new Function`.
 */
function normalizeRelaxedJsToJson(rawText: string): string {
  // Step 1: Replace JS Date constructors outside or before token pass
  const pre = rawText
    .replace(
      /new\s+Date\(\s*Date\.UTC\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})(?:\s*,[^)]*)?\)\s*\)/g,
      (_, y, m, d) => {
        const mm = String(Number(m) + 1).padStart(2, '0');
        const dd = String(Number(d)).padStart(2, '0');
        return `"${y}-${mm}-${dd}"`;
      }
    )
    .replace(
      /new\s+Date\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})(?:\s*,[^)]*)?\)/g,
      (_, y, m, d) => {
        const mm = String(Number(m) + 1).padStart(2, '0');
        const dd = String(Number(d)).padStart(2, '0');
        return `"${y}-${mm}-${dd}"`;
      }
    )
    .replace(/new\s+Date\(\s*(['"])([^'"]*)\1\s*\)/g, '"$2"')
    .replace(/new\s+Date\(\s*(-?\d+)\s*\)/g, (_, ms) => {
      const dt = new Date(Number(ms));
      return Number.isNaN(dt.getTime()) ? '""' : `"${dt.toISOString().slice(0, 10)}"`;
    });

  // Step 2: Character-by-character pass to convert single-quoted strings,
  // quote unquoted object keys, and normalize undefined/NaN outside strings.
  let out = '';
  const len = pre.length;
  let i = 0;

  while (i < len) {
    const ch = pre[i];

    // Double-quoted string: copy verbatim (preserving escapes)
    if (ch === '"') {
      out += '"';
      i += 1;
      while (i < len) {
        const c = pre[i];
        out += c;
        i += 1;
        if (c === '\\' && i < len) {
          out += pre[i];
          i += 1;
        } else if (c === '"') {
          break;
        }
      }
      continue;
    }

    // Single-quoted string: convert to valid double-quoted JSON string
    if (ch === "'") {
      out += '"';
      i += 1;
      while (i < len) {
        const c = pre[i];
        i += 1;
        if (c === '\\' && i < len) {
          const next = pre[i];
          i += 1;
          if (next === "'") out += "'";
          else if (next === '"') out += '\\"';
          else out += '\\' + next;
        } else if (c === "'") {
          break;
        } else if (c === '"') {
          out += '\\"';
        } else if (c === '\n') {
          out += '\\n';
        } else if (c === '\r') {
          out += '\\r';
        } else if (c === '\t') {
          out += '\\t';
        } else {
          out += c;
        }
      }
      out += '"';
      continue;
    }

    // Identifier outside string: check for unquoted object key or undefined/NaN
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < len && /[A-Za-z0-9_$]/.test(pre[i])) i += 1;
      const ident = pre.slice(start, i);

      // Peek past whitespace for ':' to detect unquoted object keys
      let k = i;
      while (k < len && /\s/.test(pre[k])) k += 1;
      if (k < len && pre[k] === ':') {
        out += `"${ident}"`;
      } else if (ident === 'undefined' || ident === 'NaN' || ident === 'Infinity') {
        out += 'null';
      } else {
        out += ident;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  // Step 3: Remove trailing commas before ] or }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function parseRelaxedJson(rawText: string): unknown | null {
  try {
    return JSON.parse(rawText);
  } catch {
    try {
      return JSON.parse(normalizeRelaxedJsToJson(rawText));
    } catch {
      return null;
    }
  }
}

/**
 * Extracts a balanced JSON object or array starting at openIdx (`{` or `[`).
 */
function extractBalancedBracketAt(
  source: string,
  openIdx: number
): { raw: string; endIdx: number } | null {
  const openChar = source[openIdx];
  if (openChar !== '{' && openChar !== '[') return null;
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let escaped = false;

  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      continue;
    }

    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { raw: source.slice(openIdx, i + 1), endIdx: i };
      }
    }
  }
  return null;
}

/**
 * Extracts a balanced JSON object or array starting at the first `{` or `[` after `marker`.
 */
function extractBalancedJsonAfter(source: string, marker: string | RegExp): unknown | null {
  let startSearch = -1;
  if (typeof marker === 'string') {
    const idx = source.indexOf(marker);
    if (idx === -1) return null;
    startSearch = idx + marker.length;
  } else {
    const match = marker.exec(source);
    if (!match) return null;
    startSearch = match.index + match[0].length;
  }

  let openIdx = -1;
  for (let i = startSearch; i < Math.min(source.length, startSearch + 280); i++) {
    const ch = source[i];
    if (ch === '{' || ch === '[') {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return null;

  const extracted = extractBalancedBracketAt(source, openIdx);
  if (!extracted) return null;
  return parseRelaxedJson(extracted.raw);
}

/**
 * Recursively collects every array of plain objects inside a parsed JSON tree.
 */
function collectObjectArrays(node: unknown, out: Array<Record<string, unknown>[]>, depth = 0): void {
  if (depth > 8 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    const objItems = node.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    );
    if (objItems.length > 0) {
      out.push(objItems);
    }
    for (const item of node) {
      if (item && typeof item === 'object') {
        collectObjectArrays(item, out, depth + 1);
      }
    }
    return;
  }
  if (typeof node === 'object') {
    for (const val of Object.values(node as Record<string, unknown>)) {
      if (val && typeof val === 'object') {
        collectObjectArrays(val, out, depth + 1);
      }
    }
  }
}

/**
 * Universally scans script/text for EVERY balanced `[ { ... }, ... ]` array — even when nested
 * inside `new DevExpress.data.ArrayStore({ "data": [...] })`, `new DevExpress.data.DataSource(...)`,
 * or `JSON.parse("...")` string literals!
 */
function extractAllObjectArraysFromText(source: string): Array<Record<string, unknown>[]> {
  const results: Array<Record<string, unknown>[]> = [];

  const scanText = (text: string) => {
    const len = text.length;
    let inString = false;
    let stringQuote = '';
    let escaped = false;

    for (let i = 0; i < len; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === stringQuote) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringQuote = ch;
        continue;
      }

      if (ch === '[') {
        // Peek past whitespace to see if this array starts with `{`
        let j = i + 1;
        while (j < len && /\s/.test(text[j])) j += 1;
        if (j < len && text[j] === '{') {
          const extracted = extractBalancedBracketAt(text, i);
          if (extracted) {
            const parsed = parseRelaxedJson(extracted.raw);
            if (parsed) {
              collectObjectArrays(parsed, results);
              // Only skip past this array when it actually parsed cleanly;
              // otherwise keep scanning inside to find nested `data: [...]` arrays!
              i = extracted.endIdx;
            }
          }
        }
      }
    }
  };

  scanText(source);

  // Also check JSON.parse("...") / JSON.parse('...') encoded strings
  const jsonParseRegex = /JSON\.parse\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = jsonParseRegex.exec(source)) !== null) {
    const quote = m[1];
    const body = m[2];
    if (body.length < 12) continue;
    try {
      const unescaped =
        quote === '"'
          ? (JSON.parse(`"${body}"`) as string)
          : (JSON.parse(
              `"${body.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`
            ) as string);
      const parsed = parseRelaxedJson(unescaped);
      if (parsed) {
        collectObjectArrays(parsed, results);
      }
    } catch {
      // Ignore malformed string literals
    }
  }

  return results;
}

function cleanCourseNameAndCode(
  rawTitle: string,
  fallbackPeriod: string
): { code: string; name: string } {
  const cleaned = rawTitle.replace(/\s+/g, ' ').trim();
  const periodPrefix = cleaned.match(/^(?:Period\s*)?(\d+)\s*[:\-]\s*(.+)$/i);
  const periodNum = periodPrefix ? periodPrefix[1] : fallbackPeriod;
  const body = periodPrefix ? periodPrefix[2].trim() : cleaned;

  const parenMatch = body.match(/^(.+?)\s*\(([A-Za-z0-9\-_. ]{2,16})\)\s*$/);
  if (parenMatch) {
    return {
      name: parenMatch[1].trim(),
      code: periodNum ? `P${periodNum} · ${parenMatch[2].trim()}` : parenMatch[2].trim(),
    };
  }
  return {
    name: body || `Period ${periodNum}`,
    code: periodNum ? `Period ${periodNum}` : 'Course',
  };
}

async function authenticateWebPortal(
  host: string,
  username: string,
  password: string,
  isParent: boolean
): Promise<{ cookies: Map<string, string>; agu: string; landingHtml: string }> {
  const loginPage = isParent ? 'PXP2_Login_Parent.aspx' : 'PXP2_Login_Student.aspx';
  const loginUrl = `https://${host}/${loginPage}?regenerateSessionId=True`;

  async function tryLogin(encodedPassword: string) {
    const jar = new Map<string, string>();
    const { response: getRes } = await fetchWithCookies(loginUrl, jar, { method: 'GET' });
    if (!getRes.ok) {
      throw new Error(`Edupoint login page returned HTTP ${getRes.status}.`);
    }

    const getHtml = await getRes.text();
    const $get = cheerio.load(getHtml);

    const form = new URLSearchParams();
    $get('form input[type="hidden"]').each((_, el) => {
      const name = $get(el).attr('name');
      const val = $get(el).attr('value') ?? '';
      if (name) form.set(name, val);
    });

    form.set('ctl00$MainContent$username', username);
    form.set('ctl00$MainContent$password', encodedPassword);
    form.set('ctl00$MainContent$Submit1', 'Login');

    const { response: postRes, finalUrl } = await fetchWithCookies(loginUrl, jar, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: loginUrl,
        Origin: `https://${host}`,
      },
      body: form.toString(),
    });

    const postHtml = await postRes.text();
    const isStillOnLogin =
      finalUrl.toLowerCase().includes('pxp2_login') ||
      postHtml.includes('ctl00_MainContent_username');

    if (isStillOnLogin) {
      const $post = cheerio.load(postHtml);
      const errText =
        $post('#ctl00_MainContent_ERROR').text().trim() ||
        $post('.ERROR').first().text().trim() ||
        $post('.alert-danger').first().text().trim() ||
        'Invalid StudentVUE username or password.';
      return { ok: false as const, error: errText };
    }

    const aguMatch = postHtml.match(/PXP\.AGU\s*=\s*['"]?(\d+)['"]?/);
    const agu = aguMatch ? aguMatch[1] : '0';
    return { ok: true as const, cookies: jar, agu, landingHtml: postHtml };
  }

  const encodedPw = encodeURIComponent(password);
  const firstAttempt = await tryLogin(encodedPw);
  if (firstAttempt.ok) return firstAttempt;

  if (encodedPw !== password) {
    const secondAttempt = await tryLogin(password);
    if (secondAttempt.ok) return secondAttempt;
  }

  throw new Error(firstAttempt.error);
}

const ASSIGNMENT_TITLE_KEYS_TIER1 = [
  'Measure',
  'measure',
  'MeasureDescription',
  'GBMeasureDescription',
  'AssignmentTitle',
  'AssignmentName',
  'MeasureName',
  'GBAssignmentTitle',
  'GBAssignmentName',
  'CourseContentName',
  'ContentTitle',
  'ItemName',
  'TaskName',
  'WorkName',
  'AssignmentShortName',
  'MeasureShortName',
  'DisplayTitle',
  'ActivityName',
  'ActivityTitle',
  'MeasureTitle',
  'GBTitle',
  'AssignmentDescription',
  'ShortDescription',
  'LongDescription',
  'Description',
  'Title',
  'title',
  'DisplayName',
  'FullName',
  'Caption',
  'Label',
  'Text',
];

const ASSIGNMENT_TITLE_KEYS_TIER2 = [
  'GBAssignment',
  'Assignment',
  'assignment',
  'GBMeasure',
  'Name',
  'name',
];

function isNonTitleValue(val: string, _catName?: string): boolean {
  const s = val.trim();
  if (!s || s.toUpperCase() === 'TOTAL') return true;
  // Pure date string
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) || /^\/Date\(/.test(s)) {
    return true;
  }
  // Pure points / percentage / grade string
  if (
    /^-?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(s) ||
    /^-?\d+(?:\.\d+)?\s*%$/.test(s) ||
    /^[ABCDF][+-]?$/i.test(s) ||
    /^(?:not graded|excused|missing|n\/a|pending|none|true|false)$/i.test(s)
  ) {
    return true;
  }
  return false;
}

function getItemLookupIds(item: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const key of [
    'gradeBookId',
    'GradebookID',
    'GradeBookID',
    'AssignmentID',
    'assignmentID',
    'MeasureID',
    'MeasureGU',
    'GradebookGU',
    'AssignmentGU',
    'ID',
    'id',
  ]) {
    const v = item[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      ids.push(String(v).trim().toLowerCase());
    }
  }
  return ids;
}

function extractBestAssignmentTitle(
  item: Record<string, unknown>,
  catName?: string,
  titleLookup?: Map<string, string>
): { title: string; isHuman: boolean } {
  const seenKeys = new Set<string>();
  const opaqueFallbacks: string[] = [];

  const tryKey = (key: string): string | null => {
    if (seenKeys.has(key)) return null;
    seenKeys.add(key);
    const raw = item[key];
    if (raw === undefined || raw === null) return null;
    const cleaned = stripHtmlText(raw);
    if (!cleaned || isNonTitleValue(cleaned, catName)) return null;
    if (!isOpaqueRandomString(cleaned)) {
      return cleaned;
    }
    opaqueFallbacks.push(cleaned);
    return null;
  };

  // Tier 1: Explicitly descriptive title fields first
  for (const k of ASSIGNMENT_TITLE_KEYS_TIER1) {
    const found = tryKey(k);
    if (found) return { title: found, isHuman: true };
  }

  // Tier 2: Standard Synergy fields (GBAssignment, Assignment, Measure, Name)
  for (const k of ASSIGNMENT_TITLE_KEYS_TIER2) {
    const found = tryKey(k);
    if (found) return { title: found, isHuman: true };
  }

  // Tier 3: Any other key on the object whose name suggests a title/description (excluding IDs/GU/types/dates/scores)
  for (const k of Object.keys(item)) {
    if (seenKeys.has(k)) continue;
    const kl = k.toLowerCase();
    if (
      /(?:^|_)(?:id|gu|guid|key|hash|code|url|link|href|icon|color|class|course|teacher|student|type|category|date|score|point|max|weight|note|comment|status|mark|grade|period|term|org|school)/.test(
        kl
      ) ||
      /(?:id|gu|guid|key|hash|url|date|type|category|score|point|weight)$/.test(kl)
    ) {
      continue;
    }
    if (/(?:title|name|desc|assign|measure|activity|caption|label|text|display)/.test(kl)) {
      const found = tryKey(k);
      if (found) return { title: found, isHuman: true };
    }
  }

  // Cross-array / DOM ID lookup if available
  if (titleLookup && titleLookup.size > 0) {
    for (const id of getItemLookupIds(item)) {
      const mapped = titleLookup.get(id);
      if (mapped && !isOpaqueRandomString(mapped)) {
        return { title: mapped, isHuman: true };
      }
    }
  }

  // Tier 4: Last-resort scan of any remaining human-looking string field on the object
  for (const [k, raw] of Object.entries(item)) {
    if (seenKeys.has(k) || typeof raw !== 'string') continue;
    const kl = k.toLowerCase();
    if (
      /(?:type|category|date|score|point|note|comment|teacher|course|class|student|school|icon|url|href|style|css|color|gu|guid|id|hash|key)/.test(
        kl
      )
    ) {
      continue;
    }
    const cleaned = stripHtmlText(raw);
    if (
      cleaned.length >= 3 &&
      cleaned.length <= 160 &&
      !isNonTitleValue(cleaned, catName) &&
      !isOpaqueRandomString(cleaned) &&
      /[A-Za-z]{2,}/.test(cleaned)
    ) {
      return { title: cleaned, isHuman: true };
    }
  }

  if (opaqueFallbacks.length > 0) {
    return { title: opaqueFallbacks[0], isHuman: false };
  }
  return { title: '', isHuman: false };
}

function buildTitleLookupMap(
  $: cheerio.CheerioAPI | null,
  allArrays: Array<Record<string, unknown>[]>
): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const arr of allArrays) {
    for (const obj of arr) {
      const ids = getItemLookupIds(obj);
      if (ids.length === 0) continue;
      const { title, isHuman } = extractBestAssignmentTitle(obj);
      if (title && isHuman) {
        for (const id of ids) {
          if (!lookup.has(id)) lookup.set(id, title);
        }
      }
    }
  }

  // Also scan rendered DOM buttons/links with data-focus containing gradeBookId / assignmentID / measureGU
  if ($) {
    $('[data-focus], [data-assignment-id], [data-gradebook-id]').each((_, el) => {
      const label = $(el).text().replace(/\s+/g, ' ').trim();
      if (!label || label.length > 160 || isOpaqueRandomString(label)) return;

      const directId = $(el).attr('data-gradebook-id') || $(el).attr('data-assignment-id');
      if (directId) {
        lookup.set(directId.trim().toLowerCase(), label);
      }

      const focusAttr = $(el).attr('data-focus');
      if (focusAttr && focusAttr.includes('{')) {
        const parsed = parseRelaxedJson(focusAttr);
        if (parsed && typeof parsed === 'object') {
          const p = parsed as Record<string, unknown>;
          const fa = (p.FocusArgs as Record<string, unknown> | undefined) || p;
          for (const id of getItemLookupIds(fa)) {
            if (!lookup.has(id)) lookup.set(id, label);
          }
        }
      }
    });
  }

  return lookup;
}

function scoreAssignmentArrayCandidate(arr: Record<string, unknown>[]): number {
  if (arr.length === 0) return 0;
  let score = 0;
  let humanTitleRows = 0;
  const sample = arr.slice(0, 6);

  for (const obj of sample) {
    const keysLower = Object.keys(obj).map((k) => k.toLowerCase());

    // Exclude DevExtreme column definition arrays ({ dataField, caption, visible })
    if (keysLower.includes('datafield') && keysLower.includes('caption')) return 0;
    // Exclude category weight summary arrays ({ Type, Weight, Points, PointsPossible, WeightedPct })
    if (
      keysLower.some((k) => k === 'weight' || k === 'weightpct' || k === 'weightedpct') &&
      !keysLower.some((k) => k.includes('gbassignment') || k === 'gradebookid' || k === 'measure')
    ) {
      return 0;
    }

    const titleProbe = extractBestAssignmentTitle(obj);
    const hasTitleKey = keysLower.some((k) =>
      [
        'gbassignment',
        'assignment',
        'assignmentname',
        'assignmenttitle',
        'measure',
        'measuredescription',
        'measurename',
        'activityname',
        'coursecontentname',
        'contenttitle',
        'title',
        'name',
        'displaytitle',
        'description',
      ].includes(k)
    );
    if (!hasTitleKey && !titleProbe.isHuman) continue;

    let rowHits = 0;
    if (titleProbe.isHuman) {
      humanTitleRows += 1;
      rowHits += 8;
    } else if (titleProbe.title && !titleProbe.isHuman) {
      // Heavily penalize opaque GUID/hash-keyed arrays so real display grids always win
      rowHits -= 6;
    }

    if (keysLower.some((k) => k === 'gradebookid' || k === 'gbassignment' || k === 'measure')) {
      rowHits += 5;
    }
    if (
      keysLower.some((k) =>
        [
          'gbpoints',
          'points',
          'displaypoints',
          'pointsearned',
          'earnedpoints',
          'gbscore',
          'score',
          'displayscore',
          'scorevalue',
          'rawscore',
          'maxscore',
          'pointspossible',
          'maxvalue',
          'totalpoints',
        ].includes(k)
      )
    ) {
      rowHits += 3;
    }
    if (
      keysLower.some((k) =>
        ['gbduedate', 'duedate', 'date', 'gbdate', 'assigndate', 'datedue'].includes(k)
      )
    ) {
      rowHits += 2;
    }
    if (
      keysLower.some((k) =>
        ['gbassignmenttype', 'assignmenttype', 'type', 'category', 'categoryname', 'measuretype'].includes(k)
      )
    ) {
      rowHits += 2;
    }

    if (rowHits >= 3) score += rowHits;
  }

  // If NONE of the sampled rows had a human-readable title, cap score to 1 so any array or table with real titles beats it
  if (humanTitleRows === 0) {
    return score > 0 ? 1 : 0;
  }

  return score;
}

function looksLikeCategoryWeightArray(arr: Record<string, unknown>[]): boolean {
  if (arr.length === 0) return false;
  const first = arr[0];
  const keysLower = Object.keys(first).map((k) => k.toLowerCase());
  if (keysLower.includes('datafield') && keysLower.includes('caption')) return false;
  const hasWeight = keysLower.some(
    (k) => k === 'weight' || k === 'weightpct' || k === 'weightpercent' || k === 'pct' || k === 'categoryweight'
  );
  const hasName = keysLower.some((k) =>
    ['type', 'assignmenttype', 'gbassignmenttype', 'category', 'categoryname', 'name', 'title'].includes(k)
  );
  const isAssignment = keysLower.some(
    (k) => k.includes('gbassignment') || k === 'gradebookid' || k === 'measure' || k === 'gbduedate' || k === 'duedate'
  );
  return hasWeight && hasName && !isAssignment;
}

function extractAssignmentsFromObjectArray(
  items: Record<string, unknown>[],
  courseId: string,
  ensureCategory: (rawName: string, weight?: number) => string,
  titleLookup?: Map<string, string>
): { assignments: ParsedAssignment[]; humanTitleCount: number; fallbackTitleCount: number } {
  const out: ParsedAssignment[] = [];
  let humanTitleCount = 0;
  let fallbackTitleCount = 0;

  items.forEach((item, idx) => {
    const catName = stripHtmlText(
      item.GBAssignmentType ??
        item.AssignmentType ??
        item.MeasureType ??
        item.CategoryName ??
        item.Category ??
        item.Type ??
        item.GradebookType ??
        item.assignmentType ??
        item.category ??
        item.type ??
        'Coursework'
    );

    const resolved = extractBestAssignmentTitle(item, catName, titleLookup);
    if (!resolved.title) return;
    if (resolved.isHuman) {
      humanTitleCount += 1;
    } else {
      fallbackTitleCount += 1;
    }
    // Never surface a raw GUID / random alphanumeric hash as an assignment title
    const title = resolved.isHuman ? resolved.title : `${catName || 'Assignment'} #${idx + 1}`;
    if (title.toUpperCase() === 'TOTAL') return;

    const catId = ensureCategory(catName);

    const dateVal = String(
      item.GBDueDate ??
        item.DueDate ??
        item.dueDate ??
        item.DateDue ??
        item.Date ??
        item.date ??
        item.GBDate ??
        item.AssignDate ??
        item.AssignedDate ??
        ''
    );
    const pointsVal = String(
      item.GBPoints ??
        item.Points ??
        item.DisplayPoints ??
        item.PointsString ??
        item.points ??
        ''
    );
    const scoreVal = String(
      item.GBScore ??
        item.Score ??
        item.DisplayScore ??
        item.ScoreString ??
        item.score ??
        ''
    );
    const notesVal = String(
      item.GBNotes ?? item.Notes ?? item.Note ?? item.ScoreNotes ?? item.notes ?? ''
    );
    const maxVal =
      item.MaxScore ??
      item.maxScore ??
      item.PointsPossible ??
      item.pointsPossible ??
      item.PossiblePoints ??
      item.MaxValue ??
      item.TotalPoints ??
      item.possible;
    const scoreTypeVal = item.ScoreType ?? item.GBScoreType ?? item.ScoreCalType ?? '';
    const notForGrading = Boolean(
      item.NotForGrading ?? item.IsNotForGrading ?? item.Excused ?? item.IsExcused
    );
    const isExtraCredit = Boolean(item.IsExtraCredit ?? item.ExtraCredit);
    const gbId = String(
      item.gradeBookId ??
        item.GradebookID ??
        item.GradeBookID ??
        item.AssignmentID ??
        item.MeasureID ??
        item.ID ??
        item.id ??
        idx
    );

    const parsed = parseScoreString(
      pointsVal,
      scoreVal,
      notesVal,
      maxVal,
      scoreTypeVal,
      notForGrading,
      isExtraCredit
    );

    // Fallback to explicit numeric earned fields if string score was a letter or blank
    let earned = parsed.earned;
    const explicitEarnedRaw =
      item.PointsEarned ??
      item.EarnedPoints ??
      item.RawScore ??
      item.ScoreValue ??
      item.earned;
    if (earned === null && explicitEarnedRaw !== undefined && explicitEarnedRaw !== null && String(explicitEarnedRaw).trim() !== '') {
      const numEarned = parseFloat(String(explicitEarnedRaw).replace(/,/g, ''));
      if (Number.isFinite(numEarned)) {
        earned = numEarned;
      }
    }

    out.push({
      id: `${courseId}-a-${gbId}-${idx}`,
      categoryId: catId,
      title,
      dueDate: parseUsDateToIso(dateVal),
      earned,
      possible: parsed.possible,
      extraCredit: parsed.extraCredit,
      excused: parsed.excused,
    });
  });
  return { assignments: out, humanTitleCount, fallbackTitleCount };
}

interface RemoteCallDescriptor {
  kind: 'transfer' | 'url';
  url?: string;
  friendlyName?: string;
  method?: string;
  params?: Record<string, unknown>;
}

function parseClassDetailsHtml(
  html: string,
  courseId: string
): {
  categories: ParsedCategory[];
  assignments: ParsedAssignment[];
  gradingMode: 'weighted' | 'points';
  remoteCalls: RemoteCallDescriptor[];
  humanTitleCount: number;
  fallbackTitleCount: number;
  debugStats: { scriptArrays: number; bestScore: number; tables: number };
} {
  const $ = cheerio.load(html);
  const categories: ParsedCategory[] = [];
  const catIdByName = new Map<string, string>();
  let assignments: ParsedAssignment[] = [];
  let humanTitleCount = 0;
  let fallbackTitleCount = 0;
  const remoteCalls: RemoteCallDescriptor[] = [];

  const ensureCategory = (rawName: string, weight = 0): string => {
    const name = stripHtmlText(rawName) || 'Coursework';
    const key = name.toLowerCase();
    const existing = catIdByName.get(key);
    if (existing) {
      if (weight > 0) {
        const cat = categories.find((c) => c.id === existing);
        if (cat && cat.weight === 0) cat.weight = weight;
      }
      return existing;
    }
    const id = `${courseId}-cat-${categories.length}`;
    catIdByName.set(key, id);
    categories.push({ id, name, weight });
    return id;
  };

  const allScripts = $('script')
    .map((_, el) => $(el).html() || '')
    .get()
    .join('\n');

  // Detect any ep_Common.CallPromise('FriendlyName', 'Method', {...}) calls
  const callPromiseMatches = allScripts.matchAll(
    /CallPromise\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[\s\S]{0,600}?\}))?/g
  );
  for (const m of callPromiseMatches) {
    const friendlyName = m[1];
    const method = m[2];
    const params = m[3] ? (parseRelaxedJson(m[3]) as Record<string, unknown> | null) : {};
    if (friendlyName && method) {
      remoteCalls.push({
        kind: 'transfer',
        friendlyName,
        method,
        params: params && typeof params === 'object' ? params : {},
      });
    }
  }

  // Detect any DevExtreme createStore loadUrl / api/GB URLs
  const remoteUrlMatches = allScripts.matchAll(
    /(?:loadUrl\s*[:=]\s*|['"])((?:\/?api\/GB\/|\/?service\/)[^'"\s]+)['"]/gi
  );
  for (const rm of remoteUrlMatches) {
    if (rm[1] && !remoteCalls.some((rc) => rc.url === rm[1])) {
      remoteCalls.push({ kind: 'url', url: rm[1] });
    }
  }

  // Gather ALL object arrays from scripts, <script type="application/json">, and data-* / hidden inputs
  const allCandidateArrays: Array<Record<string, unknown>[]> =
    extractAllObjectArraysFromText(allScripts);

  $('[data-options], [data-grid], [data-assignments], [data-source], input[type="hidden"]').each(
    (_, el) => {
      const rawAttr =
        $(el).attr('data-assignments') ||
        $(el).attr('data-options') ||
        $(el).attr('data-grid') ||
        $(el).attr('data-source') ||
        ($(el).is('input') ? $(el).attr('value') : '') ||
        '';
      if (!rawAttr || (!rawAttr.includes('{') && !rawAttr.includes('['))) return;
      const parsed = parseRelaxedJson(rawAttr);
      if (parsed) {
        collectObjectArrays(parsed, allCandidateArrays);
      }
    }
  );

  // 1. Extract Category Weights from any matching weight summary array
  for (const arr of allCandidateArrays) {
    if (looksLikeCategoryWeightArray(arr)) {
      for (const rec of arr) {
        const typeName = stripHtmlText(
          rec.Type ??
            rec.AssignmentType ??
            rec.GBAssignmentType ??
            rec.Category ??
            rec.CategoryName ??
            rec.Name ??
            rec.name ??
            rec.Title ??
            ''
        );
        if (!typeName || typeName.toUpperCase() === 'TOTAL') continue;
        const w =
          parsePercentNumber(
            rec.Weight ??
              rec.weight ??
              rec.WeightPct ??
              rec.Pct ??
              rec.WeightPercent ??
              rec.CategoryWeight ??
              0
          ) ?? 0;
        ensureCategory(typeName, w);
      }
    }
  }

  // Also scan HTML tables for category weight rows
  const tableCount = $('table').length;
  $('table').each((_, table) => {
    const headers = $(table)
      .find('thead th, tr:first-child th, tr:first-child td')
      .map((__, cell) => $(cell).text().trim().toLowerCase())
      .get();

    const typeIdx = headers.findIndex(
      (h) => h.includes('assignment type') || h.includes('category') || h === 'type'
    );
    const weightIdx = headers.findIndex((h) => h.includes('weight'));
    if (typeIdx >= 0 && weightIdx >= 0) {
      $(table)
        .find('tbody tr, tr')
        .each((rIdx, tr) => {
          if (rIdx === 0 && $(tr).find('th').length > 0) return;
          const cells = $(tr)
            .find('td')
            .map((__, td) => $(td).text().trim())
            .get();
          if (cells.length <= Math.max(typeIdx, weightIdx)) return;
          const catName = cells[typeIdx];
          if (!catName || catName.toUpperCase() === 'TOTAL') return;
          const weightVal = parsePercentNumber(cells[weightIdx]) ?? 0;
          ensureCategory(catName, weightVal);
        });
    }
  });

  // 2. Pick the best-scoring assignment array from ALL discovered object arrays
  const titleLookup = buildTitleLookupMap($, allCandidateArrays);
  let bestArray: Record<string, unknown>[] | null = null;
  let bestScore = 0;

  for (const arr of allCandidateArrays) {
    const sc = scoreAssignmentArrayCandidate(arr);
    if (sc > bestScore || (sc > 0 && sc === bestScore && arr.length > (bestArray?.length ?? 0))) {
      bestScore = sc;
      bestArray = arr;
    }
  }

  if (bestArray && bestScore > 0) {
    const extracted = extractAssignmentsFromObjectArray(bestArray, courseId, ensureCategory, titleLookup);
    assignments = extracted.assignments;
    humanTitleCount = extracted.humanTitleCount;
    fallbackTitleCount = extracted.fallbackTitleCount;
  }

  // 3. Fallback / Upgrade: Parse Assignments from HTML tables when no assignments OR when JSON array had fallback titles
  if (assignments.length === 0 || fallbackTitleCount > 0) {
    let tableAssignments: ParsedAssignment[] = [];
    let tableHumanCount = 0;
    let tableFallbackCount = 0;

    $('table').each((_, table) => {
      if (tableAssignments.length > 0 && tableFallbackCount === 0) return;
      const headerRow = $(table).find('thead tr').first().length
        ? $(table).find('thead tr').first()
        : $(table).find('tr').first();
      const headers = headerRow
        .find('th, td')
        .map((__, cell) => $(cell).text().trim().toLowerCase())
        .get();

      let asgnIdx = headers.findIndex((h) =>
        ['assignment', 'measure', 'title', 'activity', 'assignment name', 'assignment title'].includes(h)
      );
      if (asgnIdx === -1) {
        asgnIdx = headers.findIndex(
          (h) =>
            (h.includes('assignment') || h.includes('measure') || h.includes('title') || h.includes('activity')) &&
            !/type|category|id|gu|guid|date|weight|point|score|note/.test(h)
        );
      }
      const pointsIdx = headers.findIndex(
        (h) => h.includes('point') || h.includes('score')
      );
      if (asgnIdx === -1 || pointsIdx === -1) return;

      const dateIdx = headers.findIndex((h) => h.includes('date'));
      const typeIdx = headers.findIndex((h) => h.includes('type') || h.includes('category'));
      const scoreColIdx = headers.findIndex((h, i) => i !== pointsIdx && h.includes('score'));
      const notesIdx = headers.findIndex((h) => h.includes('note'));

      const bodyRows = $(table).find('tbody tr').length
        ? $(table).find('tbody tr')
        : $(table).find('tr').slice(1);

      const currentRows: ParsedAssignment[] = [];
      let curHuman = 0;
      let curFallback = 0;

      bodyRows.each((rIdx, tr) => {
        const cells = $(tr)
          .find('td')
          .map((__, td) => {
            const cloned = $(td).clone();
            cloned.find('script, style, noscript').remove();
            return cloned.text().replace(/\s+/g, ' ').trim();
          })
          .get();
        if (cells.length <= Math.max(asgnIdx, pointsIdx)) return;

        const rawTitle = cells[asgnIdx];
        if (!rawTitle || rawTitle.toUpperCase() === 'TOTAL') return;
        const catName = typeIdx >= 0 ? cells[typeIdx] : 'Coursework';
        const isOpaque = isOpaqueRandomString(rawTitle);
        if (isOpaque) curFallback += 1;
        else curHuman += 1;
        const title = isOpaque ? `${catName || 'Assignment'} #${rIdx + 1}` : rawTitle;
        const catId = ensureCategory(catName);
        const parsed = parseScoreString(
          cells[pointsIdx] || '',
          scoreColIdx >= 0 ? cells[scoreColIdx] || '' : '',
          notesIdx >= 0 ? cells[notesIdx] || '' : ''
        );
        currentRows.push({
          id: `${courseId}-tr-${rIdx}`,
          categoryId: catId,
          title,
          dueDate: parseUsDateToIso(dateIdx >= 0 ? cells[dateIdx] : ''),
          earned: parsed.earned,
          possible: parsed.possible,
          extraCredit: parsed.extraCredit,
          excused: parsed.excused,
        });
      });

      if (curHuman > tableHumanCount || (curHuman === tableHumanCount && currentRows.length > tableAssignments.length)) {
        tableAssignments = currentRows;
        tableHumanCount = curHuman;
        tableFallbackCount = curFallback;
      }
    });

    if (
      tableAssignments.length > 0 &&
      (assignments.length === 0 || tableHumanCount > humanTitleCount)
    ) {
      assignments = tableAssignments;
      humanTitleCount = tableHumanCount;
      fallbackTitleCount = tableFallbackCount;
    }
  }

  if (categories.length === 0) {
    categories.push({ id: `${courseId}-cat-0`, name: 'Coursework', weight: 100 });
  }

  const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
  const gradingMode: 'weighted' | 'points' = totalWeight > 0 ? 'weighted' : 'points';

  return {
    categories,
    assignments,
    gradingMode,
    remoteCalls,
    humanTitleCount,
    fallbackTitleCount,
    debugStats: {
      scriptArrays: allCandidateArrays.length,
      bestScore,
      tables: tableCount,
    },
  };
}

function mergeFocusArgsSafe(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined || v === null) continue;
    if (v === '' && typeof merged[k] === 'string' && merged[k] !== '') continue;
    if (v === -1 && typeof merged[k] === 'number' && merged[k] !== -1) continue;
    merged[k] = v;
  }
  return merged;
}

async function fetchWebPortalGradebook(
  session: EdupointSession,
  requestedPeriodGU?: string
) {
  const gbUrl = requestedPeriodGU
    ? `https://${session.host}/PXP2_Gradebook.aspx?AGU=${encodeURIComponent(
        session.agu
      )}&gradePeriodGU=${encodeURIComponent(requestedPeriodGU)}`
    : `https://${session.host}/PXP2_Gradebook.aspx?AGU=${encodeURIComponent(session.agu)}`;

  const { response: gbRes, finalUrl } = await fetchWithCookies(gbUrl, session.cookies, {
    method: 'GET',
  });

  if (!gbRes.ok) {
    throw new Error(`Edupoint Gradebook returned HTTP ${gbRes.status}.`);
  }

  const gbHtml = await gbRes.text();
  if (
    finalUrl.toLowerCase().includes('pxp2_login') ||
    gbHtml.includes('ctl00_MainContent_username')
  ) {
    throw new Error('SESSION_EXPIRED');
  }

  const $ = cheerio.load(gbHtml);

  // Update AGU and extract CURRENT_WEB_PORTAL if embedded
  const aguMatch = gbHtml.match(/PXP\.AGU\s*=\s*['"]?(\d+)['"]?/);
  if (aguMatch) session.agu = aguMatch[1];
  const webPortalMatch = gbHtml.match(/CURRENT_WEB_PORTAL\s*=\s*['"]([^'"]+)['"]/);
  const currentWebPortal = webPortalMatch ? webPortalMatch[1] : '';

  // Extract Student Info
  const greetingText = $('#Greeting').text().trim();
  const greetingMatch = greetingText.match(/,\s*(.+?)(?:!|$)/);
  const studentName =
    (greetingMatch ? greetingMatch[1].trim() : '') ||
    $('.student-name').first().text().trim() ||
    session.studentInfo.name ||
    'Student';

  const schoolName =
    $('#SchoolName').text().trim() ||
    $('.school-name').first().text().trim() ||
    (session.host === DEFAULT_DISTRICT_HOST ? 'Amador Valley High School' : session.host);

  session.studentInfo = {
    name: studentName,
    school: schoolName,
    grade: session.studentInfo.grade,
  };

  const allScripts = $('script')
    .map((_, el) => $(el).html() || '')
    .get()
    .join('\n');

  const focusLoadData = extractBalancedJsonAfter(allScripts, /PXP\.GBFocus\.Load\s*\(/) as
    | Record<string, unknown>
    | null;
  const focusInitData = extractBalancedJsonAfter(allScripts, /PXP\.GBFocus\.Init\s*\(/) as
    | Record<string, unknown>
    | null;

  const initFocusArgs =
    (focusInitData?.FocusArgs as Record<string, unknown> | undefined) ||
    focusInitData ||
    {};

  const baseFocusArgs: Record<string, unknown> = mergeFocusArgsSafe(
    {
      schoolID: -1,
      classID: -1,
      gradePeriodGU: '',
      subjectID: -1,
      teacherID: -1,
      markPeriodGU: '',
      assignmentID: -1,
      standardIdentifier: '',
      viewName: 'assignment',
      studentGU: '',
      AGU: session.agu,
      OrgYearGU: '',
    },
    initFocusArgs
  );

  const reportingPeriods: ReportingPeriodInfo[] = [];
  let activePeriodGU = requestedPeriodGU || String(baseFocusArgs.gradePeriodGU || '');
  let activePeriodName = 'Current Grading Period';
  let activeMarkPeriodGU = String(baseFocusArgs.markPeriodGU || '');

  if (focusLoadData && Array.isArray(focusLoadData.Schools)) {
    for (const sch of focusLoadData.Schools as Array<Record<string, unknown>>) {
      if (typeof sch.Name === 'string' && sch.Name.trim()) {
        session.studentInfo.school = sch.Name.trim();
      }
      if (sch.SchoolID !== undefined && baseFocusArgs.schoolID === -1) {
        baseFocusArgs.schoolID = sch.SchoolID;
      }
      if (Array.isArray(sch.GradingPeriods)) {
        for (const gp of sch.GradingPeriods as Array<Record<string, unknown>>) {
          const gu = String(gp.GU || '');
          const name = String(gp.Name || gp.GradePeriod || 'Grading Period');
          const markPeriods = Array.isArray(gp.MarkPeriods)
            ? (gp.MarkPeriods as Array<Record<string, unknown>>)
            : [];
          const firstMarkGU = markPeriods[0]?.GU ? String(markPeriods[0].GU) : '';

          if (gu && !reportingPeriods.some((p) => p.index === gu)) {
            reportingPeriods.push({
              index: gu,
              name,
              startDate: String(gp.StartDate || ''),
              endDate: String(gp.EndDate || ''),
              defaultMarkPeriodGU: firstMarkGU,
            });
          }
          if (!activePeriodGU && gp.defaultFocus) {
            activePeriodGU = gu;
            activePeriodName = name;
            if (!activeMarkPeriodGU && firstMarkGU) activeMarkPeriodGU = firstMarkGU;
          }
        }
      }
    }
  }

  if (reportingPeriods.length === 0) {
    $('[data-period-gu], a[href*="gradePeriodGU="]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/gradePeriodGU=([^&]+)/i);
      const gu = $(el).attr('data-period-gu') || (m ? decodeURIComponent(m[1]) : '');
      const name = $(el).text().trim();
      if (gu && name && !reportingPeriods.some((p) => p.index === gu)) {
        reportingPeriods.push({ index: gu, name, startDate: '', endDate: '' });
      }
    });
  }

  const matchedPeriod = reportingPeriods.find((p) => p.index === activePeriodGU);
  if (matchedPeriod) {
    activePeriodName = matchedPeriod.name;
    if (!activeMarkPeriodGU && matchedPeriod.defaultMarkPeriodGU) {
      activeMarkPeriodGU = matchedPeriod.defaultMarkPeriodGU;
    }
  } else if (reportingPeriods.length > 0) {
    activePeriodGU = reportingPeriods[0].index;
    activePeriodName = reportingPeriods[0].name;
    if (!activeMarkPeriodGU && reportingPeriods[0].defaultMarkPeriodGU) {
      activeMarkPeriodGU = reportingPeriods[0].defaultMarkPeriodGU;
    }
  } else {
    activePeriodGU = 'current';
  }

  if (activePeriodGU && activePeriodGU !== 'current') {
    baseFocusArgs.gradePeriodGU = activePeriodGU;
  }
  if (activeMarkPeriodGU) {
    baseFocusArgs.markPeriodGU = activeMarkPeriodGU;
  }

  const termId = `edupoint-${session.host}-${activePeriodGU}`;

  // Collect course cards / rows from PXP2_Gradebook.aspx DOM
  interface CourseSummaryCandidate {
    rawTitle: string;
    period: string;
    instructor: string;
    officialLetter: string | null;
    officialPercent: number | null;
    controlName: string;
    focusArgs: Record<string, unknown>;
  }

  const candidates: CourseSummaryCandidate[] = [];
  const seenClassKeys = new Set<string>();

  $('[data-focus]').each((idx, el) => {
    const rawFocus = $(el).attr('data-focus');
    if (!rawFocus) return;
    const parsedFocus = parseRelaxedJson(rawFocus) as Record<string, unknown> | null;
    if (!parsedFocus || typeof parsedFocus !== 'object') return;

    const loadParams = (parsedFocus.LoadParams || {}) as Record<string, unknown>;
    const rowFocusArgs = (parsedFocus.FocusArgs || {}) as Record<string, unknown>;
    const controlName = String(loadParams.ControlName || '');
    const classID = rowFocusArgs.classID;

    if (
      classID === undefined ||
      classID === null ||
      classID === -1 ||
      classID === '-1' ||
      classID === '' ||
      (!controlName.includes('ClassDetails') &&
        rowFocusArgs.viewName !== 'assignment' &&
        rowFocusArgs.viewName !== 'courseContent')
    ) {
      return;
    }

    const dedupeKey = `${classID}-${rowFocusArgs.markPeriodGU || activeMarkPeriodGU}`;
    if (seenClassKeys.has(dedupeKey)) return;
    seenClassKeys.add(dedupeKey);

    const $row = $(el).closest('.gb-class-row, .row, tr, .course-row');
    const titleText =
      $(el).text().trim() ||
      $row.find('.course-title, .gb-class-title').first().text().trim() ||
      `Class ${idx + 1}`;
    const teacherText =
      $row.find('.teacher, .teacher-name, .gb-teacher').first().text().trim() || 'Instructor';
    const markText = $row.find('.mark').first().text().trim();
    const scoreText = $row.find('.score').first().text().trim();
    const periodText = $row.find('.period').first().text().replace(/\D/g, '');

    const mergedArgs = mergeFocusArgsSafe(baseFocusArgs, rowFocusArgs);
    if (!mergedArgs.viewName) {
      mergedArgs.viewName =
        controlName === 'Gradebook_RichContentClassDetails' ? 'courseContent' : 'assignment';
    }

    candidates.push({
      rawTitle: titleText,
      period: periodText || String(candidates.length + 1),
      instructor: teacherText.replace(/^Teacher:\s*/i, '').trim() || 'Instructor',
      officialLetter: markText && markText !== 'N/A' ? markText : null,
      officialPercent: parsePercentNumber(scoreText),
      controlName: controlName || 'Gradebook_ClassDetails',
      focusArgs: mergedArgs,
    });
  });

  // Also query GradebookFocusClassInfo to discover classes if DOM had none, or enrich missing control names
  try {
    const infoRes = await fetchWithCookies(
      `https://${session.host}/service/PXP2Communication.asmx/GradebookFocusClassInfo`,
      session.cookies,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          AGU: session.agu,
          'X-Requested-With': 'XMLHttpRequest',
          Origin: `https://${session.host}`,
          Referer: gbUrl,
          ...(currentWebPortal ? { CURRENT_WEB_PORTAL: currentWebPortal } : {}),
        },
        body: JSON.stringify({
          request: {
            gradingPeriodGU: baseFocusArgs.gradePeriodGU || '',
            AGU: session.agu,
            orgYearGU: baseFocusArgs.OrgYearGU || '',
            schoolID: baseFocusArgs.schoolID ?? -1,
            markPeriodGU: baseFocusArgs.markPeriodGU || '',
          },
        }),
      }
    );

    if (infoRes.response.ok) {
      const infoJson = (await infoRes.response.json()) as Record<string, unknown>;
      const d = (infoJson.d || {}) as Record<string, unknown>;
      const data = (d.Data || d) as Record<string, unknown>;
      const classes = Array.isArray(data.Classes)
        ? (data.Classes as Array<Record<string, unknown>>)
        : [];

      if (candidates.length === 0) {
        classes.forEach((cls, idx) => {
          const detailCtrl = String(cls.ClassDetailControl || 'Gradebook_ClassDetails');
          candidates.push({
            rawTitle: String(cls.Name || cls.Title || `Class ${idx + 1}`),
            period: String(cls.Period || idx + 1),
            instructor: String(cls.TeacherName || 'Instructor'),
            officialLetter: null,
            officialPercent: null,
            controlName: detailCtrl,
            focusArgs: {
              ...baseFocusArgs,
              classID: cls.ID,
              viewName:
                detailCtrl === 'Gradebook_RichContentClassDetails'
                  ? 'courseContent'
                  : 'assignment',
            },
          });
        });
      } else {
        // Enrich any candidate with authoritative ClassDetailControl & teacher name if provided
        for (const cand of candidates) {
          const match = classes.find((cls) => String(cls.ID) === String(cand.focusArgs.classID));
          if (match) {
            if (typeof match.ClassDetailControl === 'string' && match.ClassDetailControl) {
              cand.controlName = match.ClassDetailControl;
            }
            const staffName = String(
              match.TeacherName || match.Staff || match.Instructor || ''
            ).trim();
            if (staffName && (!cand.instructor || cand.instructor === 'Instructor')) {
              cand.instructor = staffName;
            }
          }
        }
      }
    }
  } catch {
    // Proceed with DOM-discovered candidates
  }

  // Helper to invoke LoadControl for a course
  const loadClassDetails = async (
    controlName: string,
    parameters: Record<string, unknown>
  ): Promise<{ html: string; rawData: unknown; errorMsg?: string }> => {
    const lcRes = await fetchWithCookies(
      `https://${session.host}/service/PXP2Communication.asmx/LoadControl`,
      session.cookies,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          AGU: String(parameters.AGU ?? session.agu),
          'X-Requested-With': 'XMLHttpRequest',
          Origin: `https://${session.host}`,
          Referer: gbUrl,
          ...(currentWebPortal ? { CURRENT_WEB_PORTAL: currentWebPortal } : {}),
        },
        body: JSON.stringify({
          request: {
            control: controlName,
            parameters,
          },
        }),
      }
    );
    if (!lcRes.response.ok) {
      return { html: '', rawData: null, errorMsg: `HTTP ${lcRes.response.status}` };
    }
    const lcJson = (await lcRes.response.json()) as Record<string, unknown>;
    const d = (lcJson.d || {}) as Record<string, unknown>;
    if (d.Error && typeof d.Error === 'object') {
      const errObj = d.Error as Record<string, unknown>;
      return { html: '', rawData: d, errorMsg: String(errObj.Message || 'LoadControl error') };
    }
    const data = (d.Data ?? d) as Record<string, unknown> | string;
    if (typeof data === 'string') {
      return { html: data, rawData: data };
    }
    const html =
      (typeof data?.html === 'string' && data.html) ||
      (typeof data?.Html === 'string' && data.Html) ||
      (typeof data?.HTML === 'string' && data.HTML) ||
      (typeof d?.html === 'string' && d.html) ||
      '';
    return { html, rawData: data };
  };

  // Helper to execute remote Synergy ClientSideData/Transfer POST or GET store URLs
  const fetchRemoteAssignments = async (
    remoteCalls: RemoteCallDescriptor[],
    courseId: string,
    existingCategories: ParsedCategory[]
  ): Promise<{ assignments: ParsedAssignment[]; humanTitleCount: number; fallbackTitleCount: number }> => {
    const catIdByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]));
    const ensureCat = (rawName: string, weight = 0) => {
      const clean = stripHtmlText(rawName) || 'Coursework';
      const existing = catIdByName.get(clean.toLowerCase());
      if (existing) {
        if (weight > 0) {
          const cat = existingCategories.find((c) => c.id === existing);
          if (cat && cat.weight === 0) cat.weight = weight;
        }
        return existing;
      }
      const id = `${courseId}-cat-${existingCategories.length}`;
      catIdByName.set(clean.toLowerCase(), id);
      existingCategories.push({ id, name: clean, weight });
      return id;
    };

    let bestRemote: { assignments: ParsedAssignment[]; humanTitleCount: number; fallbackTitleCount: number } = {
      assignments: [],
      humanTitleCount: 0,
      fallbackTitleCount: 0,
    };

    for (const rc of remoteCalls) {
      try {
        let remoteJson: unknown = null;
        if (rc.kind === 'transfer' && rc.friendlyName && rc.method) {
          const transferUrl = `https://${session.host}/api/GB/ClientSideData/Transfer?${encodeURIComponent(
            rc.friendlyName
          )}-${encodeURIComponent(rc.method)}`;
          const res = await fetchWithCookies(transferUrl, session.cookies, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              AGU: session.agu,
              'X-Requested-With': 'XMLHttpRequest',
              Origin: `https://${session.host}`,
              Referer: gbUrl,
              ...(currentWebPortal ? { CURRENT_WEB_PORTAL: currentWebPortal } : {}),
            },
            body: JSON.stringify({
              FriendlyName: rc.friendlyName,
              Method: rc.method,
              Async: false,
              Parameters: JSON.stringify(rc.params || {}),
            }),
          });
          if (res.response.ok) {
            remoteJson = await res.response.json();
          }
        } else if (rc.kind === 'url' && rc.url) {
          if (!rc.url.toLowerCase().includes('gb')) continue;
          const absUrl = new URL(rc.url, `https://${session.host}/`).toString();
          if (new URL(absUrl).hostname.toLowerCase() !== session.host) continue;
          const res = await fetchWithCookies(absUrl, session.cookies, {
            method: 'GET',
            headers: {
              AGU: session.agu,
              'X-Requested-With': 'XMLHttpRequest',
              Referer: gbUrl,
              ...(currentWebPortal ? { CURRENT_WEB_PORTAL: currentWebPortal } : {}),
            },
          });
          if (res.response.ok) {
            remoteJson = await res.response.json();
          }
        }

        if (!remoteJson) continue;
        const foundArrays: Array<Record<string, unknown>[]> = [];
        collectObjectArrays(remoteJson, foundArrays);

        for (const arr of foundArrays) {
          if (looksLikeCategoryWeightArray(arr)) {
            for (const rec of arr) {
              const name = stripHtmlText(rec.Type ?? rec.AssignmentType ?? rec.Category ?? rec.Name ?? '');
              const w = parsePercentNumber(rec.Weight ?? rec.weight ?? rec.WeightPct ?? 0) ?? 0;
              if (name && name.toUpperCase() !== 'TOTAL') ensureCat(name, w);
            }
          }
        }

        let bestArr: Record<string, unknown>[] | null = null;
        let bestSc = 0;
        for (const arr of foundArrays) {
          const sc = scoreAssignmentArrayCandidate(arr);
          if (sc > bestSc) {
            bestSc = sc;
            bestArr = arr;
          }
        }
        if (bestArr && bestSc > 0) {
          const remoteTitleLookup = buildTitleLookupMap(null, foundArrays);
          const extracted = extractAssignmentsFromObjectArray(
            bestArr,
            courseId,
            ensureCat,
            remoteTitleLookup
          );
          if (
            extracted.humanTitleCount > bestRemote.humanTitleCount ||
            (extracted.humanTitleCount === bestRemote.humanTitleCount &&
              extracted.assignments.length > bestRemote.assignments.length)
          ) {
            bestRemote = extracted;
          }
          if (extracted.assignments.length > 0 && extracted.fallbackTitleCount === 0) {
            return extracted;
          }
        }
      } catch {
        // Ignore individual remote probe failures
      }
    }
    return bestRemote;
  };

  // Fetch detailed categories & assignments sequentially (avoids ASP.NET session-state lock races)
  const courses: ParsedCourse[] = [];
  let totalAssignmentsFound = 0;

  for (let idx = 0; idx < candidates.length; idx++) {
    const cand = candidates[idx];
    const { code, name } = cleanCourseNameAndCode(cand.rawTitle, cand.period);
    const courseId = `edupoint-${activePeriodGU}-c${idx}`;

    let categories: ParsedCategory[] = [
      { id: `${courseId}-cat-0`, name: 'Coursework', weight: 100 },
    ];
    let assignments: ParsedAssignment[] = [];
    let bestHumanTitles = 0;
    let bestFallbackTitles = 0;
    let gradingMode: 'weighted' | 'points' = 'points';

    // Always try Gradebook_ClassDetails (assignment view) FIRST so exact StudentVUE assignment titles win
    const attempts: Array<{ control: string; params: Record<string, unknown> }> = [
      {
        control: 'Gradebook_ClassDetails',
        params: { ...cand.focusArgs, viewName: 'assignment' },
      },
    ];
    if (cand.controlName && cand.controlName !== 'Gradebook_ClassDetails') {
      attempts.push({ control: cand.controlName, params: cand.focusArgs });
    } else if (cand.focusArgs.viewName && cand.focusArgs.viewName !== 'assignment') {
      attempts.push({ control: 'Gradebook_ClassDetails', params: cand.focusArgs });
    }
    if (!attempts.some((a) => a.control === 'Gradebook_RichContentClassDetails')) {
      attempts.push({
        control: 'Gradebook_RichContentClassDetails',
        params: { ...cand.focusArgs, viewName: 'courseContent' },
      });
    }

    try {
      let bestParsed: ReturnType<typeof parseClassDetailsHtml> | null = null;
      const collectedRemoteCalls: RemoteCallDescriptor[] = [];

      for (const attempt of attempts) {
        const { html, rawData } = await loadClassDetails(attempt.control, attempt.params);

        // If LoadControl returned structured JSON data directly without HTML, scan it too
        if (!html && rawData && typeof rawData === 'object') {
          const arrays: Array<Record<string, unknown>[]> = [];
          collectObjectArrays(rawData, arrays);
          let bestArr: Record<string, unknown>[] | null = null;
          let bestSc = 0;
          for (const arr of arrays) {
            const sc = scoreAssignmentArrayCandidate(arr);
            if (sc > bestSc) {
              bestSc = sc;
              bestArr = arr;
            }
          }
          if (bestArr && bestSc > 0) {
            const cats: ParsedCategory[] = [];
            const catMap = new Map<string, string>();
            const ensureCat = (rawName: string, weight = 0) => {
              const clean = stripHtmlText(rawName) || 'Coursework';
              const ex = catMap.get(clean.toLowerCase());
              if (ex) return ex;
              const id = `${courseId}-cat-${cats.length}`;
              catMap.set(clean.toLowerCase(), id);
              cats.push({ id, name: clean, weight });
              return id;
            };
            const rawTitleLookup = buildTitleLookupMap(null, arrays);
            const extracted = extractAssignmentsFromObjectArray(
              bestArr,
              courseId,
              ensureCat,
              rawTitleLookup
            );
            if (
              extracted.humanTitleCount > bestHumanTitles ||
              (extracted.humanTitleCount === bestHumanTitles && extracted.assignments.length > assignments.length)
            ) {
              assignments = extracted.assignments;
              bestHumanTitles = extracted.humanTitleCount;
              bestFallbackTitles = extracted.fallbackTitleCount;
              categories = cats.length > 0 ? cats : categories;
              gradingMode = categories.some((c) => c.weight > 0) ? 'weighted' : 'points';
            }
            if (extracted.assignments.length > 0 && extracted.fallbackTitleCount === 0) {
              break;
            }
          }
          continue;
        }

        if (!html) continue;

        const parsed = parseClassDetailsHtml(html, courseId);
        for (const rc of parsed.remoteCalls) {
          collectedRemoteCalls.push(rc);
        }

        const isBetter =
          !bestParsed ||
          parsed.humanTitleCount > bestParsed.humanTitleCount ||
          (parsed.humanTitleCount === bestParsed.humanTitleCount &&
            parsed.assignments.length > bestParsed.assignments.length);

        if (isBetter) {
          bestParsed = parsed;
        }
        // Only stop early if we found real human-readable titles with zero fallbacks
        if (parsed.assignments.length > 0 && parsed.fallbackTitleCount === 0) {
          break;
        }
      }

      if (
        bestParsed &&
        (bestParsed.humanTitleCount > bestHumanTitles ||
          (bestParsed.humanTitleCount === bestHumanTitles &&
            bestParsed.assignments.length > assignments.length))
      ) {
        categories = bestParsed.categories;
        assignments = bestParsed.assignments;
        bestHumanTitles = bestParsed.humanTitleCount;
        bestFallbackTitles = bestParsed.fallbackTitleCount;
        gradingMode = bestParsed.gradingMode;
      }

      if ((assignments.length === 0 || bestFallbackTitles > 0) && collectedRemoteCalls.length > 0) {
        const remoteRes = await fetchRemoteAssignments(
          collectedRemoteCalls,
          courseId,
          categories
        );
        if (
          remoteRes.humanTitleCount > bestHumanTitles ||
          (assignments.length === 0 && remoteRes.assignments.length > 0)
        ) {
          assignments = remoteRes.assignments;
          gradingMode = categories.some((c) => c.weight > 0) ? 'weighted' : 'points';
        }
      }
    } catch {
      // Retain course summary even if detail fetch fails
    }

    totalAssignmentsFound += assignments.length;

    courses.push({
      id: courseId,
      termId,
      code,
      name,
      instructor: cand.instructor,
      credits: 5,
      gradingMode,
      categories,
      assignments,
      source: 'edupoint' as const,
      officialPercent: cand.officialPercent,
      officialLetter: cand.officialLetter,
    });
  }

  console.info(
    `[edupoint-sync] host=${session.host} courses=${courses.length} assignments=${totalAssignmentsFound}`
  );

  return {
    reportingPeriods: reportingPeriods.map(({ index, name, startDate, endDate }) => ({
      index,
      name,
      startDate,
      endDate,
    })),
    activePeriodIndex: activePeriodGU,
    activePeriodName,
    termId,
    courses,
  };
}

/**
 * Parses either a saved StudentVUE Gradebook HTML page OR copy-pasted Gradebook/Assignment text
 * for students who sign into Amador Valley High School via Google SSO.
 */
function parsePastedOrHtmlStudentVue(rawContent: string): {
  courses: ParsedCourse[];
  termName: string;
} {
  const termId = `edupoint-import-${Date.now()}`;
  const trimmed = rawContent.trim();

  // Case A: Full HTML saved from StudentVUE (PXP2_Gradebook.aspx or Class Details)
  if (trimmed.includes('<html') || trimmed.includes('<table') || trimmed.includes('gb-class') || trimmed.includes('AssignmentsGrid')) {
    const $ = cheerio.load(trimmed);
    const courses: ParsedCourse[] = [];

    const singleDetails = parseClassDetailsHtml(trimmed, `${termId}-c0`);
    if (singleDetails.assignments.length > 0) {
      const heading =
        $('.course-title, .gb-class-title, h1, h2').first().text().trim() ||
        'Imported StudentVUE Course';
      const { code, name } = cleanCourseNameAndCode(heading, '1');
      courses.push({
        id: `${termId}-c0`,
        termId,
        code,
        name,
        instructor: $('.teacher, .teacher-name').first().text().trim() || 'Instructor',
        credits: 5,
        gradingMode: singleDetails.gradingMode,
        categories: singleDetails.categories,
        assignments: singleDetails.assignments,
        source: 'edupoint',
        officialPercent: parsePercentNumber($('.score').first().text()),
        officialLetter: $('.mark').first().text().trim() || null,
      });
      return { courses, termName: 'Amador Valley HS (Imported)' };
    }

    $('.gb-class-row, .course-row, [data-focus]').each((idx, el) => {
      const $row = $(el).closest('.gb-class-row, .row, tr');
      const title =
        $row.find('.course-title, .gb-class-title').first().text().trim() ||
        $(el).text().trim();
      const mark = $row.find('.mark').first().text().trim();
      const score = $row.find('.score').first().text().trim();
      if (!title || (!mark && !score)) return;
      if (courses.some((c) => c.name === title)) return;
      const { code, name } = cleanCourseNameAndCode(title, String(courses.length + 1));
      courses.push({
        id: `${termId}-c${idx}`,
        termId,
        code,
        name,
        instructor: $row.find('.teacher').first().text().trim() || 'Instructor',
        credits: 5,
        gradingMode: 'points',
        categories: [{ id: `${termId}-c${idx}-cat0`, name: 'Coursework', weight: 100 }],
        assignments: [],
        source: 'edupoint',
        officialPercent: parsePercentNumber(score),
        officialLetter: mark && mark !== 'N/A' ? mark : null,
      });
    });

    if (courses.length > 0) {
      return { courses, termName: 'Amador Valley HS (Imported)' };
    }
  }

  // Case B: Copy-pasted StudentVUE Class Details (tab-separated OR multi-line DevExtreme copy)
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const pastedAssignments: ParsedAssignment[] = [];
  const catMap = new Map<string, string>();
  const cats: ParsedCategory[] = [];
  const ensureCat = (catName: string, weight = 0) => {
    const clean = catName.trim() || 'Coursework';
    const existing = catMap.get(clean.toLowerCase());
    if (existing) {
      if (weight > 0) {
        const c = cats.find((x) => x.id === existing);
        if (c && c.weight === 0) c.weight = weight;
      }
      return existing;
    }
    const id = `${termId}-pcat-${cats.length}`;
    catMap.set(clean.toLowerCase(), id);
    cats.push({ id, name: clean, weight });
    return id;
  };

  let detectedCourseTitle = '';
  const dateLineRe = /^(\d{1,2}\/\d{1,2}\/\d{2,4})$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      !detectedCourseTitle &&
      (/^(?:Period\s*)?[1-8]\s*[:\-]\s*.+/i.test(line) ||
        /^.{3,60}\(\s*(?:P|Per\.?\s*)[1-8]\s*\)$/i.test(line))
    ) {
      detectedCourseTitle = line;
    }

    // Detect pasted category weight rows like "Tests & Quizzes\t60%", "Homework  40%", or "Exams 60%"
    const weightRow = line.match(
      /^([A-Za-z][A-Za-z0-9 &\/\-]{1,40})(?:\t+|\s{2,}|\s+)(\d{1,3}(?:\.\d+)?)\s*%$/
    );
    if (weightRow && !/total|grade|score|average|overall/i.test(weightRow[1])) {
      ensureCat(weightRow[1], parseFloat(weightRow[2]));
    }

    // Subcase B1: Tab-separated single-line assignment row
    const cols = line.split('\t').map((c) => c.trim());
    if (cols.length >= 4 && dateLineRe.test(cols[0])) {
      const dateIso = parseUsDateToIso(cols[0]);
      const title = cols[1];
      const type = cols[2];
      const scoreOrPoints = cols.slice(3).join(' ');
      const parsed = parseScoreString(scoreOrPoints, scoreOrPoints, '');
      if (title) {
        pastedAssignments.push({
          id: `${termId}-tab-${i}`,
          categoryId: ensureCat(type),
          title,
          dueDate: dateIso,
          earned: parsed.earned,
          possible: parsed.possible,
          extraCredit: parsed.extraCredit,
          excused: parsed.excused,
        });
      }
      continue;
    }

    // Subcase B2: Multi-line copied DevExtreme row (Date on its own line, followed by Title, Category, Score/Points)
    if (dateLineRe.test(line) && i + 2 < lines.length) {
      const dateIso = parseUsDateToIso(line);
      const title = lines[i + 1];
      const maybeType = lines[i + 2];
      if (title && !dateLineRe.test(title) && !/^assignment$/i.test(title)) {
        const lookahead: string[] = [];
        let consumed = 2;
        for (let k = i + 2; k < Math.min(lines.length, i + 7); k++) {
          if (dateLineRe.test(lines[k])) break;
          lookahead.push(lines[k]);
          consumed = k - i;
        }
        const scoreChunk = lookahead.join(' ');
        const hasScorePattern =
          /(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)|points?\s*possible|out of|not graded|excused|\d+%/i.test(
            scoreChunk
          );
        if (hasScorePattern) {
          const parsed = parseScoreString(scoreChunk, scoreChunk, scoreChunk);
          const typeName =
            maybeType && !/(-?\d+(?:\.\d+)?)\s*\/|points?\s*possible|out of|not graded/i.test(maybeType)
              ? maybeType
              : 'Coursework';
          pastedAssignments.push({
            id: `${termId}-ml-${i}`,
            categoryId: ensureCat(typeName),
            title,
            dueDate: dateIso,
            earned: parsed.earned,
            possible: parsed.possible,
            extraCredit: parsed.extraCredit,
            excused: parsed.excused,
          });
          i += consumed;
        }
      }
    }
  }

  if (pastedAssignments.length > 0) {
    const { code, name } = cleanCourseNameAndCode(
      detectedCourseTitle || 'Imported StudentVUE Class',
      '1'
    );
    const totalW = cats.reduce((s, c) => s + c.weight, 0);
    return {
      termName: 'Amador Valley HS (Imported)',
      courses: [
        {
          id: `${termId}-c0`,
          termId,
          code,
          name,
          instructor: 'Instructor',
          credits: 5,
          gradingMode: totalW > 0 ? 'weighted' : 'points',
          categories:
            cats.length > 0 ? cats : [{ id: `${termId}-c0-cat0`, name: 'Coursework', weight: 100 }],
          assignments: pastedAssignments,
          source: 'edupoint',
          officialPercent: null,
          officialLetter: null,
        },
      ],
    };
  }

  // Case C: Copy-pasted plain text from StudentVUE Gradebook overview
  const courses: ParsedCourse[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(?:Period\s*)?([1-8])\s*[:\-]\s*(.+)$/i);
    if (!match) continue;

    const period = match[1];
    const { code, name } = cleanCourseNameAndCode(line, period);
    let instructor = 'Instructor';
    let officialPercent: number | null = null;
    let officialLetter: string | null = null;

    for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) {
      const next = lines[j];
      if (/^(?:Period\s*)?[1-8]\s*[:\-]\s*/i.test(next)) break;
      const pctMatch = next.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
      if (pctMatch && officialPercent === null) {
        officialPercent = parseFloat(pctMatch[1]);
      }
      const letterMatch = next.match(/^([ABCDF][+-]?)$/);
      if (letterMatch && !officialLetter) {
        officialLetter = letterMatch[1];
      }
      if (
        instructor === 'Instructor' &&
        !pctMatch &&
        !letterMatch &&
        !/room|missing|assignment|click|email/i.test(next) &&
        next.length >= 4 &&
        next.length <= 50
      ) {
        instructor = next;
      }
    }

    const courseId = `${termId}-p${period}-${courses.length}`;
    courses.push({
      id: courseId,
      termId,
      code,
      name,
      instructor,
      credits: 5,
      gradingMode: 'weighted',
      categories: [
        { id: `${courseId}-cat0`, name: 'Tests & Quizzes', weight: 60 },
        { id: `${courseId}-cat1`, name: 'Assignments & Labs', weight: 40 },
      ],
      assignments: [],
      source: 'edupoint',
      officialPercent,
      officialLetter,
    });
  }

  return { courses, termName: 'Amador Valley HS (Imported)' };
}

function looksLikeMailArray(arr: Record<string, unknown>[]): boolean {
  if (arr.length === 0) return false;
  let hits = 0;
  for (const item of arr.slice(0, 6)) {
    const keysLower = Object.keys(item).map((k) => k.toLowerCase());
    const hasSubject = keysLower.some((k) =>
      ['subject', 'messagesubject', 'mailtitle', 'title', 'topic'].includes(k)
    );
    const hasSender = keysLower.some((k) =>
      [
        'from',
        'sender',
        'sendername',
        'fromname',
        'fromdisplay',
        'author',
        'createdbyname',
        'sentby',
      ].includes(k)
    );
    const hasDate = keysLower.some((k) =>
      ['date', 'sentdate', 'datereceived', 'receiveddate', 'timestamp', 'postdate', 'createddate'].includes(k)
    );
    if (hasSubject && (hasSender || hasDate)) hits += 1;
  }
  return hits > 0;
}

function parseSynergyMailHtml(html: string): ParsedMailMessage[] {
  const $ = cheerio.load(html);
  const messages: ParsedMailMessage[] = [];
  const seen = new Set<string>();

  const pushMessage = (msg: ParsedMailMessage) => {
    const subject = stripHtmlText(msg.subject);
    const sender = stripHtmlText(msg.sender) || 'Edupoint Mail';
    if (!subject || subject.length < 2) return;
    if (/^(subject|message|inbox|sent|drafts|trash|folder|no messages|loading)$/i.test(subject)) {
      return;
    }
    const key = `${subject.toLowerCase()}::${sender.toLowerCase()}::${msg.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    messages.push({
      id: msg.id || crypto.createHash('sha1').update(key).digest('hex').slice(0, 14),
      subject: subject.slice(0, 180),
      sender: sender.slice(0, 100),
      date: msg.date || new Date().toISOString().slice(0, 10),
      preview: stripHtmlText(msg.preview).slice(0, 320),
      unread: Boolean(msg.unread),
      folder: msg.folder || 'Inbox',
    });
  };

  // 1. Scan embedded scripts & data attributes for Synergy Mail DevExtreme / Knockout JSON arrays
  const allScripts = $('script')
    .map((_, el) => $(el).html() || '')
    .get()
    .join('\n');
  const candidateArrays = extractAllObjectArraysFromText(allScripts);

  $('[data-messages], [data-mail], [data-source], [data-options]').each((_, el) => {
    const raw =
      $(el).attr('data-messages') ||
      $(el).attr('data-mail') ||
      $(el).attr('data-source') ||
      $(el).attr('data-options') ||
      '';
    if (!raw || (!raw.includes('{') && !raw.includes('['))) return;
    const parsed = parseRelaxedJson(raw);
    if (parsed) collectObjectArrays(parsed, candidateArrays);
  });

  for (const arr of candidateArrays) {
    if (!looksLikeMailArray(arr)) continue;
    arr.forEach((item, idx) => {
      const subject = String(
        item.Subject ?? item.MessageSubject ?? item.MailTitle ?? item.Title ?? item.Topic ?? ''
      );
      const sender = String(
        item.FromName ??
          item.SenderName ??
          item.FromDisplay ??
          item.From ??
          item.Sender ??
          item.SentBy ??
          item.Author ??
          'Edupoint Mail'
      );
      const rawDate = String(
        item.SentDate ??
          item.DateReceived ??
          item.ReceivedDate ??
          item.Date ??
          item.PostDate ??
          item.CreatedDate ??
          ''
      );
      const preview = String(
        item.Preview ??
          item.MessagePreview ??
          item.BodyPreview ??
          item.MessageText ??
          item.Body ??
          item.Snippet ??
          ''
      );
      const isReadVal = item.IsRead ?? item.Read ?? item.HasRead;
      const isUnreadVal = item.IsUnread ?? item.Unread;
      const unread =
        typeof isUnreadVal === 'boolean'
          ? isUnreadVal
          : typeof isReadVal === 'boolean'
            ? !isReadVal
            : false;
      const id = String(
        item.MessageGU ?? item.SMMessageGU ?? item.ID ?? item.Id ?? item.id ?? `mail-json-${idx}`
      );
      const folder = String(item.FolderName ?? item.Folder ?? 'Inbox');

      pushMessage({
        id,
        subject,
        sender,
        date: parseUsDateToIso(rawDate),
        preview,
        unread,
        folder,
      });
    });
  }

  // 2. Fallback: Scan HTML tables / message rows (PXP2_Messages.aspx & classic Synergy Mail views)
  if (messages.length === 0) {
    $('table').each((_, table) => {
      const headerRow = $(table).find('thead tr').first().length
        ? $(table).find('thead tr').first()
        : $(table).find('tr').first();
      const headers = headerRow
        .find('th, td')
        .map((__, cell) => $(cell).text().trim().toLowerCase())
        .get();

      const subjectIdx = headers.findIndex((h) => h.includes('subject') || h.includes('message'));
      const fromIdx = headers.findIndex(
        (h) => h.includes('from') || h.includes('sender') || h.includes('teacher')
      );
      const dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('sent'));

      if (subjectIdx === -1) return;

      const rows = $(table).find('tbody tr').length
        ? $(table).find('tbody tr')
        : $(table).find('tr').slice(1);

      rows.each((rIdx, tr) => {
        const $tr = $(tr);
        const cells = $tr
          .find('td')
          .map((__, td) => $(td).text().replace(/\s+/g, ' ').trim())
          .get();
        if (cells.length <= subjectIdx) return;

        const cls = ($tr.attr('class') || '').toLowerCase();
        const isBold =
          cls.includes('unread') ||
          cls.includes('bold') ||
          $tr.find('strong, b, .unread').length > 0;

        pushMessage({
          id: $tr.attr('data-gu') || $tr.attr('data-id') || `mail-row-${rIdx}`,
          subject: cells[subjectIdx] || '',
          sender: fromIdx >= 0 ? cells[fromIdx] || 'Edupoint Mail' : 'Edupoint Mail',
          date: dateIdx >= 0 ? parseUsDateToIso(cells[dateIdx] || '') : new Date().toISOString().slice(0, 10),
          preview: '',
          unread: isBold,
          folder: 'Inbox',
        });
      });
    });
  }

  // 3. Fallback: Message card/list elements (Synergy Mail inbox list items)
  if (messages.length === 0) {
    $('.message-row, .sm-message-row, .mail-item, [data-message-gu]').each((idx, el) => {
      const $el = $(el);
      const subject =
        $el.find('.subject, .message-subject, .sm-subject, h4, h3').first().text().trim() ||
        $el.attr('data-subject') ||
        '';
      const sender =
        $el.find('.from, .sender, .message-from, .sm-from').first().text().trim() ||
        'Edupoint Mail';
      const rawDate =
        $el.find('.date, .sent-date, .message-date, time').first().text().trim() || '';
      const preview =
        $el.find('.preview, .snippet, .message-body, p').first().text().trim() || '';
      const cls = ($el.attr('class') || '').toLowerCase();
      const unread = cls.includes('unread') || $el.find('.unread, strong').length > 0;

      pushMessage({
        id: $el.attr('data-message-gu') || $el.attr('data-id') || `mail-card-${idx}`,
        subject,
        sender,
        date: parseUsDateToIso(rawDate),
        preview,
        unread,
        folder: 'Inbox',
      });
    });
  }

  return messages.slice(0, 40);
}

async function fetchWebPortalMail(session: EdupointSession): Promise<ParsedMailMessage[]> {
  const candidatePaths = [
    `/PXP2_Messages.aspx?AGU=${encodeURIComponent(session.agu)}`,
    `/PXP2_SynergyMail.aspx?AGU=${encodeURIComponent(session.agu)}`,
  ];

  for (const relPath of candidatePaths) {
    try {
      const url = `https://${session.host}${relPath}`;
      const res = await fetchWithCookies(url, session.cookies, {
        method: 'GET',
        headers: {
          Referer: `https://${session.host}/PXP2_Gradebook.aspx?AGU=${encodeURIComponent(session.agu)}`,
        },
      });
      if (!res.response.ok) continue;
      if (/PXP2_Login/i.test(res.finalUrl)) continue;
      const html = await res.response.text();
      if (!html || /PXP2_Login/i.test(html.slice(0, 1500))) continue;

      const parsed = parseSynergyMailHtml(html);
      if (parsed.length > 0) return parsed;
    } catch {
      // Try next Synergy Mail path
    }
  }

  return [];
}

/* ============================================================================
 * Edupoint StudentVUE Official SOAP API (Service/PXPCommunication.asmx)
 * Returns authoritative XML with exact teacher-assigned Measure titles,
 * exact Staff teacher names, exact Points/Score/Notes, and ReportingPeriods.
 * ============================================================================ */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function callStudentVueSoap(
  host: string,
  username: string,
  password: string,
  isParent: boolean,
  methodName: string,
  paramXml: string
): Promise<string> {
  const endpoint = `https://${host}/Service/PXPCommunication.asmx`;
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ProcessWebServiceRequest xmlns="http://edupoint.com/webservices/">
      <userID>${escapeXml(username)}</userID>
      <password>${escapeXml(password)}</password>
      <skipLoginLog>1</skipLoginLog>
      <parent>${isParent ? '1' : '0'}</parent>
      <webServiceHandleName>PXPWebServices</webServiceHandleName>
      <methodName>${escapeXml(methodName)}</methodName>
      <paramStr>${escapeXml(paramXml)}</paramStr>
    </ProcessWebServiceRequest>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '"http://edupoint.com/webservices/ProcessWebServiceRequest"',
      'User-Agent': BROWSER_USER_AGENT,
    },
    body: envelope,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`SOAP_UNAVAILABLE_HTTP_${res.status}`);
  }

  const rawSoap = await res.text();
  const $soap = cheerio.load(rawSoap, { xmlMode: true });
  const fault = $soap('faultstring').first().text().trim();
  if (fault) {
    throw new Error(fault);
  }

  const innerXml = $soap('ProcessWebServiceRequestResult').first().text().trim();
  if (!innerXml) {
    throw new Error('SOAP_EMPTY_RESPONSE');
  }

  const $inner = cheerio.load(innerXml, { xmlMode: true });
  const rtError = $inner('RT_ERROR').first();
  if (rtError.length > 0) {
    const errMsg =
      rtError.attr('ERROR_MESSAGE') ||
      rtError.attr('ErrorMessage') ||
      rtError.text().trim() ||
      'StudentVUE request failed.';
    throw new Error(errMsg);
  }

  return innerXml;
}

async function fetchSoapStudentInfo(
  host: string,
  username: string,
  password: string,
  isParent: boolean
): Promise<{ name: string; school: string; grade: string } | null> {
  try {
    const xml = await callStudentVueSoap(
      host,
      username,
      password,
      isParent,
      'StudentInfo',
      '<Parms><ChildIntID>0</ChildIntID></Parms>'
    );
    const $ = cheerio.load(xml, { xmlMode: true });
    const name = $('FormattedName').first().text().trim() || username;
    const school =
      $('CurrentSchool').first().text().trim() ||
      (host === DEFAULT_DISTRICT_HOST ? 'Amador Valley High School' : host);
    const grade = $('Grade').first().text().trim() || '';
    return { name, school, grade };
  } catch {
    return null;
  }
}

async function fetchSoapMail(
  host: string,
  username: string,
  password: string,
  isParent: boolean
): Promise<ParsedMailMessage[]> {
  try {
    const xml = await callStudentVueSoap(
      host,
      username,
      password,
      isParent,
      'GetPXPMessages',
      '<Parms><ChildIntID>0</ChildIntID></Parms>'
    );
    const $ = cheerio.load(xml, { xmlMode: true });
    const messages: ParsedMailMessage[] = [];
    $('MessageListing').each((idx, el) => {
      const $el = $(el);
      const subject = stripHtmlText($el.attr('Subject') || '');
      if (!subject) return;
      const sender = stripHtmlText($el.attr('From') || '') || 'Edupoint Mail';
      const beginDate = $el.attr('BeginDate') || '';
      const readFlag = ($el.attr('Read') || '').toLowerCase();
      const preview = stripHtmlText($el.attr('Content') || '');
      messages.push({
        id: $el.attr('ID') || `soap-mail-${idx}`,
        subject: subject.slice(0, 180),
        sender: sender.slice(0, 100),
        date: parseUsDateToIso(beginDate),
        preview: preview.slice(0, 320),
        unread: readFlag === 'false' || readFlag === '0',
        folder: 'Inbox',
      });
    });
    return messages.slice(0, 40);
  } catch {
    return [];
  }
}

async function fetchSoapGradebook(
  host: string,
  username: string,
  password: string,
  isParent: boolean,
  reportPeriod?: string
): Promise<{
  reportingPeriods: ReportingPeriodInfo[];
  activePeriodIndex: string;
  activePeriodName: string;
  termId: string;
  courses: ParsedCourse[];
}> {
  const periodTag =
    reportPeriod !== undefined && reportPeriod !== '' && /^\d+$/.test(reportPeriod)
      ? `<ReportPeriod>${reportPeriod}</ReportPeriod>`
      : '';
  const xml = await callStudentVueSoap(
    host,
    username,
    password,
    isParent,
    'Gradebook',
    `<Parms><ChildIntID>0</ChildIntID>${periodTag}</Parms>`
  );

  const $ = cheerio.load(xml, { xmlMode: true });

  const reportingPeriods: ReportingPeriodInfo[] = [];
  $('ReportingPeriods > ReportPeriod').each((idx, el) => {
    const $el = $(el);
    const index = ($el.attr('Index') ?? String(idx)).trim();
    const name = ($el.attr('GradePeriod') || `Period ${idx + 1}`).trim();
    const startDate = ($el.attr('StartDate') || '').trim();
    const endDate = ($el.attr('EndDate') || '').trim();
    reportingPeriods.push({ index, name, startDate, endDate });
  });

  const activeRpNode = $('Gradebook > ReportingPeriod').first();
  const activePeriodName =
    (activeRpNode.attr('GradePeriod') || '').trim() ||
    reportingPeriods[0]?.name ||
    'Current Term';

  const matchedRp = reportingPeriods.find(
    (rp) =>
      (reportPeriod && rp.index === reportPeriod) ||
      rp.name.toLowerCase() === activePeriodName.toLowerCase()
  );
  const activePeriodIndex = matchedRp?.index || reportPeriod || reportingPeriods[0]?.index || '0';
  const termId = `edupoint-${host}-${activePeriodIndex}`;

  const courses: ParsedCourse[] = [];
  let totalAssignments = 0;

  $('Courses > Course').each((cIdx, courseEl) => {
    const $course = $(courseEl);
    const rawTitle = ($course.attr('Title') || `Class ${cIdx + 1}`).trim();
    const period = ($course.attr('Period') || String(cIdx + 1)).trim();
    const staff = stripHtmlText($course.attr('Staff') || '').trim() || 'Instructor';
    const { code, name } = cleanCourseNameAndCode(rawTitle, period);
    const courseId = `edupoint-${activePeriodIndex}-c${cIdx}`;

    const marks = $course.find('Marks > Mark');
    // Pick the active Mark (prefer one matching activePeriodName or having assignments, else last)
    let chosenMark = marks.last();
    marks.each((_, mEl) => {
      const $m = $(mEl);
      const markName = ($m.attr('MarkName') || '').trim().toLowerCase();
      if (markName && markName === activePeriodName.toLowerCase()) {
        chosenMark = $m;
      }
    });

    const officialLetterRaw = (chosenMark.attr('CalculatedScoreString') || '').trim();
    const officialLetter = /^[ABCDF][+-]?$/i.test(officialLetterRaw)
      ? officialLetterRaw.toUpperCase()
      : null;
    const officialPercentRaw = parsePercentNumber(chosenMark.attr('CalculatedScoreRaw'));
    const officialPercent =
      officialPercentRaw !== null && officialPercentRaw >= 0 && officialPercentRaw <= 150
        ? officialPercentRaw
        : null;

    const categories: ParsedCategory[] = [];
    const catIdByName = new Map<string, string>();
    const ensureCategory = (rawName: string, weight = 0): string => {
      const cleanName = stripHtmlText(rawName) || 'Coursework';
      const key = cleanName.toLowerCase();
      const existing = catIdByName.get(key);
      if (existing) {
        if (weight > 0) {
          const cat = categories.find((c) => c.id === existing);
          if (cat && cat.weight === 0) cat.weight = weight;
        }
        return existing;
      }
      const id = `${courseId}-cat-${categories.length}`;
      catIdByName.set(key, id);
      categories.push({ id, name: cleanName, weight });
      return id;
    };

    chosenMark.find('GradeCalculationSummary > AssignmentGradeCalc').each((_, calcEl) => {
      const $calc = $(calcEl);
      const typeName = stripHtmlText($calc.attr('Type') || '');
      if (!typeName || typeName.toUpperCase() === 'TOTAL') return;
      const weight = parsePercentNumber($calc.attr('Weight')) ?? 0;
      ensureCategory(typeName, weight);
    });

    const assignments: ParsedAssignment[] = [];
    chosenMark.find('Assignments > Assignment').each((aIdx, asgnEl) => {
      const $a = $(asgnEl);
      const rawMeasure = stripHtmlText($a.attr('Measure') || '');
      const rawDesc = stripHtmlText($a.attr('MeasureDescription') || '');
      const catName = stripHtmlText($a.attr('Type') || '') || 'Coursework';
      const title = rawMeasure || rawDesc || `${catName} #${aIdx + 1}`;
      if (!title || title.toUpperCase() === 'TOTAL') return;

      const catId = ensureCategory(catName);
      const pointsAttr = $a.attr('Points') || '';
      const scoreAttr = $a.attr('Score') || '';
      const notesAttr = $a.attr('Notes') || '';
      const scoreTypeAttr = $a.attr('ScoreType') || '';
      const dueDateAttr = $a.attr('DueDate') || $a.attr('Date') || '';
      const gbId = ($a.attr('GradebookID') || String(aIdx)).trim();

      const parsedScore = parseScoreString(
        pointsAttr,
        scoreAttr,
        notesAttr,
        undefined,
        scoreTypeAttr,
        false,
        false
      );

      assignments.push({
        id: `${courseId}-a-${gbId}-${aIdx}`,
        categoryId: catId,
        title,
        dueDate: parseUsDateToIso(dueDateAttr),
        earned: parsedScore.earned,
        possible: parsedScore.possible,
        extraCredit: parsedScore.extraCredit,
        excused: parsedScore.excused,
      });
    });

    if (categories.length === 0) {
      categories.push({ id: `${courseId}-cat-0`, name: 'Coursework', weight: 100 });
    }
    const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
    const gradingMode: 'weighted' | 'points' = totalWeight > 0 ? 'weighted' : 'points';

    totalAssignments += assignments.length;
    courses.push({
      id: courseId,
      termId,
      code,
      name,
      instructor: staff,
      credits: 5,
      gradingMode,
      categories,
      assignments,
      source: 'edupoint',
      officialPercent,
      officialLetter,
    });
  });

  console.info(
    `[edupoint-soap-sync] host=${host} courses=${courses.length} assignments=${totalAssignments}`
  );

  return {
    reportingPeriods,
    activePeriodIndex,
    activePeriodName,
    termId,
    courses,
  };
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  return token || null;
}

function resolveWebAuthnOrigin(req: Request): { origin: string; rpId: string } | null {
  const rawHost =
    (typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0]?.trim()
      : '') ||
    (typeof req.headers.host === 'string' ? req.headers.host.trim() : '');
  const expectedHostname = rawHost.replace(/:\d+$/, '').toLowerCase();

  const rawOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (rawOrigin) {
    try {
      const parsed = new URL(rawOrigin);
      const isHttps = parsed.protocol === 'https:';
      const isLocalDev =
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
      if (!isHttps && !isLocalDev) return null;
      if (expectedHostname && parsed.hostname.toLowerCase() !== expectedHostname) {
        return null;
      }
      return { origin: parsed.origin, rpId: parsed.hostname.toLowerCase() };
    } catch {
      return null;
    }
  }

  if (!expectedHostname) return null;
  const proto =
    typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0]?.trim()
      : req.protocol || 'https';
  if (proto !== 'https' && expectedHostname !== 'localhost' && expectedHostname !== '127.0.0.1') {
    return null;
  }
  return { origin: `${proto}://${rawHost}`, rpId: expectedHostname };
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyAuthenticatorDataFlagsAndRp(
  authDataBuf: Buffer,
  expectedRpId: string
): { ok: boolean; error?: string } {
  if (authDataBuf.length < 37) {
    return { ok: false, error: 'Invalid authenticator data.' };
  }
  const rpIdHash = authDataBuf.subarray(0, 32);
  const expectedRpIdHash = crypto.createHash('sha256').update(expectedRpId).digest();
  if (!crypto.timingSafeEqual(rpIdHash, expectedRpIdHash)) {
    return { ok: false, error: 'Authenticator domain mismatch.' };
  }
  const flags = authDataBuf[32];
  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;
  if (!userPresent || !userVerified) {
    return { ok: false, error: 'Biometric user verification was not confirmed by the device.' };
  }
  return { ok: true };
}

async function createServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/webauthn/register-options', (req: Request, res: Response) => {
    const clientIp = req.ip || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!username || username.length > 128) {
      res.status(400).json({ error: 'A valid username is required to set up fingerprint sign-in.' });
      return;
    }

    const originInfo = resolveWebAuthnOrigin(req);
    if (!originInfo) {
      res.status(400).json({ error: 'Fingerprint sign-in requires a valid secure origin.' });
      return;
    }

    if (webauthnChallenges.size >= MAX_WEBAUTHN_ENTRIES) {
      const oldest = webauthnChallenges.keys().next().value;
      if (oldest) webauthnChallenges.delete(oldest);
    }

    const challengeId = crypto.randomBytes(16).toString('hex');
    const challenge = crypto.randomBytes(32).toString('base64url');
    const userId = crypto.randomBytes(16).toString('base64url');

    webauthnChallenges.set(challengeId, {
      challenge,
      type: 'register',
      expectedOrigin: originInfo.origin,
      rpId: originInfo.rpId,
      expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS,
    });

    res.json({
      challengeId,
      challenge,
      rp: { id: originInfo.rpId, name: 'Folio' },
      user: { id: userId, name: username, displayName: username },
    });
  });

  app.post('/api/auth/webauthn/register-verify', (req: Request, res: Response) => {
    const clientIp = req.ip || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : '';
    const credentialId = typeof body.credentialId === 'string' ? body.credentialId.trim() : '';
    const clientDataB64 = typeof body.clientDataJSON === 'string' ? body.clientDataJSON.trim() : '';
    const authDataB64 =
      typeof body.authenticatorData === 'string' ? body.authenticatorData.trim() : '';
    const publicKeySpki =
      typeof body.publicKeySpki === 'string' ? body.publicKeySpki.trim() : undefined;
    const alg = typeof body.alg === 'number' ? body.alg : undefined;

    if (
      !challengeId ||
      !credentialId ||
      !clientDataB64 ||
      credentialId.length > 512 ||
      clientDataB64.length > 4096
    ) {
      res.status(400).json({ error: 'Invalid fingerprint registration payload.' });
      return;
    }

    const entry = webauthnChallenges.get(challengeId);
    webauthnChallenges.delete(challengeId); // Single-use challenge
    if (!entry || entry.type !== 'register' || entry.expiresAt <= Date.now()) {
      res.status(400).json({ error: 'Fingerprint setup session expired. Please try again.' });
      return;
    }

    let clientData: { type?: string; challenge?: string; origin?: string };
    try {
      clientData = JSON.parse(Buffer.from(clientDataB64, 'base64url').toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Malformed authenticator client data.' });
      return;
    }

    if (
      clientData.type !== 'webauthn.create' ||
      typeof clientData.challenge !== 'string' ||
      !timingSafeEqualUtf8(clientData.challenge, entry.challenge) ||
      clientData.origin !== entry.expectedOrigin
    ) {
      res.status(400).json({ error: 'Fingerprint registration verification failed.' });
      return;
    }

    if (authDataB64) {
      const authDataBuf = Buffer.from(authDataB64, 'base64url');
      const check = verifyAuthenticatorDataFlagsAndRp(authDataBuf, entry.rpId);
      if (!check.ok) {
        res.status(400).json({ error: check.error || 'Fingerprint verification failed.' });
        return;
      }
    }

    if (webauthnCredentials.size >= MAX_WEBAUTHN_ENTRIES) {
      const oldest = webauthnCredentials.keys().next().value;
      if (oldest) webauthnCredentials.delete(oldest);
    }

    webauthnCredentials.set(credentialId, {
      credentialId,
      publicKeySpki: publicKeySpki && publicKeySpki.length <= 2048 ? publicKeySpki : undefined,
      alg,
      rpId: entry.rpId,
      registeredAt: Date.now(),
    });

    res.json({ ok: true, credentialId });
  });

  app.post('/api/auth/webauthn/auth-options', (req: Request, res: Response) => {
    const clientIp = req.ip || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const credentialId =
      typeof body.credentialId === 'string' && body.credentialId.trim()
        ? body.credentialId.trim()
        : undefined;
    if (credentialId && !/^[A-Za-z0-9\-_]{8,512}$/.test(credentialId)) {
      res.status(400).json({ error: 'Invalid credential identifier.' });
      return;
    }

    const originInfo = resolveWebAuthnOrigin(req);
    if (!originInfo) {
      res.status(400).json({ error: 'Fingerprint sign-in requires a valid secure origin.' });
      return;
    }

    if (webauthnChallenges.size >= MAX_WEBAUTHN_ENTRIES) {
      const oldest = webauthnChallenges.keys().next().value;
      if (oldest) webauthnChallenges.delete(oldest);
    }

    const challengeId = crypto.randomBytes(16).toString('hex');
    const challenge = crypto.randomBytes(32).toString('base64url');

    webauthnChallenges.set(challengeId, {
      challenge,
      type: 'auth',
      expectedOrigin: originInfo.origin,
      rpId: originInfo.rpId,
      credentialId,
      expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS,
    });

    res.json({
      challengeId,
      challenge,
      rpId: originInfo.rpId,
    });
  });

  app.post('/api/auth/webauthn/auth-verify', (req: Request, res: Response) => {
    const clientIp = req.ip || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : '';
    const credentialId = typeof body.credentialId === 'string' ? body.credentialId.trim() : '';
    const clientDataB64 = typeof body.clientDataJSON === 'string' ? body.clientDataJSON.trim() : '';
    const authDataB64 =
      typeof body.authenticatorData === 'string' ? body.authenticatorData.trim() : '';
    const signatureB64 = typeof body.signature === 'string' ? body.signature.trim() : '';

    if (
      !challengeId ||
      !credentialId ||
      !clientDataB64 ||
      !authDataB64 ||
      !signatureB64 ||
      credentialId.length > 512 ||
      clientDataB64.length > 4096 ||
      authDataB64.length > 2048 ||
      signatureB64.length > 2048
    ) {
      res.status(400).json({ error: 'Invalid fingerprint verification payload.' });
      return;
    }

    const entry = webauthnChallenges.get(challengeId);
    webauthnChallenges.delete(challengeId); // Single-use challenge
    if (!entry || entry.type !== 'auth' || entry.expiresAt <= Date.now()) {
      res.status(400).json({ error: 'Fingerprint verification challenge expired. Please try again.' });
      return;
    }

    if (entry.credentialId && !timingSafeEqualUtf8(credentialId, entry.credentialId)) {
      res.status(401).json({ error: 'Authenticator credential mismatch.' });
      return;
    }

    const clientDataBuf = Buffer.from(clientDataB64, 'base64url');
    let clientData: { type?: string; challenge?: string; origin?: string };
    try {
      clientData = JSON.parse(clientDataBuf.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Malformed authenticator client data.' });
      return;
    }

    if (
      clientData.type !== 'webauthn.get' ||
      typeof clientData.challenge !== 'string' ||
      !timingSafeEqualUtf8(clientData.challenge, entry.challenge) ||
      clientData.origin !== entry.expectedOrigin
    ) {
      res.status(401).json({ error: 'Fingerprint verification failed.' });
      return;
    }

    const authDataBuf = Buffer.from(authDataB64, 'base64url');
    const authCheck = verifyAuthenticatorDataFlagsAndRp(authDataBuf, entry.rpId);
    if (!authCheck.ok) {
      res.status(401).json({ error: authCheck.error || 'Fingerprint verification failed.' });
      return;
    }

    const storedCred = webauthnCredentials.get(credentialId);
    if (storedCred?.publicKeySpki) {
      try {
        const pubKey = crypto.createPublicKey({
          key: Buffer.from(storedCred.publicKeySpki, 'base64url'),
          format: 'der',
          type: 'spki',
        });
        const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();
        const signedPayload = Buffer.concat([authDataBuf, clientDataHash]);
        const sigBuf = Buffer.from(signatureB64, 'base64url');
        const verified = crypto.verify('sha256', signedPayload, pubKey, sigBuf);
        if (!verified) {
          res.status(401).json({ error: 'Fingerprint cryptographic signature verification failed.' });
          return;
        }
      } catch {
        res.status(401).json({ error: 'Could not verify fingerprint signature.' });
        return;
      }
    }

    res.json({ ok: true });
  });

  app.post('/api/studentvue/login', async (req: Request, res: Response) => {
    const clientIp = req.ip || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({
        error: 'Too many sign-in attempts. Please wait a few minutes and try again.',
      });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const isParent = Boolean(body.isParent);
    const rawDistrict =
      typeof body.districtUrl === 'string' ? body.districtUrl : DEFAULT_DISTRICT_HOST;

    if (!username || !password || username.length > 128 || password.length > 256) {
      res.status(400).json({ error: 'Please enter a valid StudentVUE username and password.' });
      return;
    }

    let host: string;
    try {
      host = validateDistrictHost(rawDistrict);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid Edupoint district URL.',
      });
      return;
    }

    try {
      let session: EdupointSession;
      let gradebook: {
        reportingPeriods: ReportingPeriodInfo[];
        activePeriodIndex: string;
        activePeriodName: string;
        termId: string;
        courses: ParsedCourse[];
      };
      let mailMessages: ParsedMailMessage[] = [];

      // 1. Prefer official StudentVUE SOAP API (exact teacher-assigned Measure titles & Staff names)
      let usedSoap = false;
      try {
        const soapGradebook = await fetchSoapGradebook(host, username, password, isParent);
        if (soapGradebook.courses.length > 0) {
          const [soapStudentInfo, soapMail] = await Promise.all([
            fetchSoapStudentInfo(host, username, password, isParent),
            fetchSoapMail(host, username, password, isParent),
          ]);
          session = {
            mode: 'soap',
            host,
            cookies: new Map<string, string>(),
            isParent,
            agu: '0',
            soapCreds: { username, password },
            studentInfo: soapStudentInfo || {
              name: username,
              school: host === DEFAULT_DISTRICT_HOST ? 'Amador Valley High School' : host,
              grade: '',
            },
            expiresAt: Date.now() + SESSION_TTL_MS,
          };
          gradebook = soapGradebook;
          mailMessages = soapMail;
          usedSoap = true;
        }
      } catch (soapErr) {
        const soapMsg = soapErr instanceof Error ? soapErr.message : '';
        if (/invalid|password|user id|locked|expired|incorrect|disabled/i.test(soapMsg) && !/soap_unavailable|service/i.test(soapMsg)) {
          throw soapErr;
        }
        // Otherwise fall back to PXP2 web portal seamlessly
      }

      if (!usedSoap) {
        const authResult = await authenticateWebPortal(host, username, password, isParent);

        session = {
          mode: 'web',
          host,
          cookies: authResult.cookies,
          isParent,
          agu: authResult.agu,
          studentInfo: {
            name: username,
            school:
              host === DEFAULT_DISTRICT_HOST ? 'Amador Valley High School' : host,
            grade: '',
          },
          expiresAt: Date.now() + SESSION_TTL_MS,
        };

        gradebook = await fetchWebPortalGradebook(session);
        mailMessages = await fetchWebPortalMail(session).catch(() => [] as ParsedMailMessage[]);
      }

      if (sessions.size >= MAX_SESSIONS) {
        const oldestKey = sessions.keys().next().value;
        if (oldestKey) sessions.delete(oldestKey);
      }

      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, session!);

      res.json({
        token,
        host,
        studentInfo: session!.studentInfo,
        syncedAt: new Date().toISOString(),
        mailMessages,
        ...gradebook!,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to connect to Edupoint StudentVUE.';
      const status = /invalid|password|user id|locked|expired/i.test(message) ? 401 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/studentvue/gradebook', async (req: Request, res: Response) => {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'StudentVUE session expired. Please sign in again.' });
      return;
    }

    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) sessions.delete(token);
      res.status(401).json({ error: 'StudentVUE session expired. Please sign in again.' });
      return;
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;

    const body = (req.body || {}) as Record<string, unknown>;
    const reportPeriod =
      typeof body.reportPeriod === 'string' ? body.reportPeriod.trim() : '';

    if (reportPeriod && !/^[A-Za-z0-9\-_]{1,64}$/.test(reportPeriod)) {
      res.status(400).json({ error: 'Invalid grading period identifier.' });
      return;
    }

    try {
      const periodArg = reportPeriod && reportPeriod !== 'current' ? reportPeriod : undefined;
      const gradebook =
        session.mode === 'soap' && session.soapCreds
          ? await fetchSoapGradebook(
              session.host,
              session.soapCreds.username,
              session.soapCreds.password,
              session.isParent,
              periodArg
            )
          : await fetchWebPortalGradebook(session, periodArg);

      const mailMessages =
        session.mode === 'soap' && session.soapCreds
          ? await fetchSoapMail(
              session.host,
              session.soapCreds.username,
              session.soapCreds.password,
              session.isParent
            ).catch(() => [] as ParsedMailMessage[])
          : await fetchWebPortalMail(session).catch(() => [] as ParsedMailMessage[]);

      res.json({
        syncedAt: new Date().toISOString(),
        mailMessages,
        ...gradebook,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to refresh grades from Edupoint.';
      if (message === 'SESSION_EXPIRED' || /invalid|password|user id/i.test(message)) {
        sessions.delete(token);
        res.status(401).json({ error: 'StudentVUE session expired. Please sign in again.' });
        return;
      }
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/studentvue/mail', async (req: Request, res: Response) => {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'StudentVUE session expired. Please sign in again.' });
      return;
    }

    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) sessions.delete(token);
      res.status(401).json({ error: 'StudentVUE session expired. Please sign in again.' });
      return;
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;

    try {
      const messages =
        session.mode === 'soap' && session.soapCreds
          ? await fetchSoapMail(
              session.host,
              session.soapCreds.username,
              session.soapCreds.password,
              session.isParent
            )
          : await fetchWebPortalMail(session);
      res.json({
        messages,
        unreadCount: messages.filter((m) => m.unread).length,
        checkedAt: new Date().toISOString(),
      });
    } catch {
      res.status(502).json({ error: 'Unable to check StudentVUE Synergy Mail right now.' });
    }
  });

  app.post('/api/studentvue/parse-import', (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const content = typeof body.content === 'string' ? body.content : '';
    if (!content.trim() || content.length > 1_500_000) {
      res.status(400).json({
        error: 'Please paste your StudentVUE gradebook content or upload a saved HTML file.',
      });
      return;
    }

    const parsed = parsePastedOrHtmlStudentVue(content);
    if (parsed.courses.length === 0) {
      res.status(422).json({
        error:
          'No courses or assignments were detected. Open your Amador Valley StudentVUE Grade Book (or a specific class), press Ctrl+A then Ctrl+C (or Save Page as HTML), and paste or upload it here.',
      });
      return;
    }

    res.json({
      termId: parsed.courses[0].termId,
      termName: parsed.termName,
      courses: parsed.courses,
    });
  });

  app.post('/api/studentvue/logout', (req: Request, res: Response) => {
    const token = getBearerToken(req);
    if (token) {
      sessions.delete(token);
    }
    res.json({ ok: true });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio server running on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
