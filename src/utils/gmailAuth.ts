import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

export interface GmailAccountInfo {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
}

let firebaseAuthInstance: Auth | null = null;

// Strictly in-memory OAuth access token cache — NEVER persisted to localStorage or sessionStorage.
let cachedAccessToken: string | null = null;

function getFirebaseAuth(): Auth {
  if (firebaseAuthInstance) return firebaseAuthInstance;
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  firebaseAuthInstance = getAuth(app);
  return firebaseAuthInstance;
}

function mapUser(user: User | null): GmailAccountInfo | null {
  if (!user || !user.email) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email.split('@')[0] || 'Student',
    photoURL: user.photoURL || null,
  };
}

export function subscribeGmailAuth(
  callback: (account: GmailAccountInfo | null, hasToken: boolean) => void
): () => void {
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      callback(null, false);
      return;
    }
    callback(mapUser(user), Boolean(cachedAccessToken));
  });
}

export function getCachedGmailAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearCachedGmailAccessToken(): void {
  cachedAccessToken = null;
}

export async function signInWithSchoolGoogle(): Promise<{
  account: GmailAccountInfo;
  accessToken: string;
}> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  for (const scope of GMAIL_SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({
    prompt: 'select_account',
  });

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken;

    if (!accessToken) {
      throw new Error(
        'Google sign-in completed, but Gmail permission was not granted. Please try again and allow email access.'
      );
    }

    cachedAccessToken = accessToken;
    const account = mapUser(result.user);
    if (!account) {
      throw new Error('Could not read your Google account email address.');
    }

    return { account, accessToken };
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';

    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in was canceled before finishing.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'This domain is not yet authorized for Google sign-in. Try opening Folio from its primary web link.'
      );
    }

    throw err instanceof Error
      ? err
      : new Error('Unable to connect your Google school email right now.');
  }
}

export async function signOutSchoolGoogle(): Promise<void> {
  cachedAccessToken = null;
  const auth = getFirebaseAuth();
  await signOut(auth);
}
