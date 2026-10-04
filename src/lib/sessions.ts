import type { Env } from '../contracts/env';
import { randomId, signSession, verifySession } from './crypto';
import { HttpError } from './http';

export const SESSION_COOKIE = 'cotly_session';
export const CSRF_COOKIE = 'cotly_csrf';
export const SESSION_TTL = 30 * 24 * 3600;

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie') ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Plain-http local dev must still work: omit Secure unless the request came in over https.
function secureOf(req: Request): boolean {
  return new URL(req.url).protocol === 'https:';
}

function attrs(secure: boolean, httpOnly: boolean): string {
  return `Path=/; Max-Age=${SESSION_TTL}; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}`;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; ${attrs(secure, true)}`;
}

export function csrfCookie(token: string, secure: boolean): string {
  return `${CSRF_COOKIE}=${token}; ${attrs(secure, false)}`;
}

export function clearedSessionCookies(secure: boolean): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    `${CSRF_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`,
  ];
}

export function newCsrfToken(): string {
  return randomId(18);
}

export async function sessionCookiePair(env: Env, req: Request, userId: string): Promise<string[]> {
  const secure = secureOf(req);
  const token = await signSession(env.SESSION_SECRET, userId, SESSION_TTL);
  return [sessionCookie(token, secure), csrfCookie(newCsrfToken(), secure)];
}

export async function getSessionUserId(env: Env, req: Request): Promise<string | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const userId = await verifySession(env.SESSION_SECRET, token);
  if (!userId) return null;
  // Server-side logout: signSession puts exp = iat + SESSION_TTL in the token,
  // so the issue time is derivable. A session issued before the user's last
  // logout is dead even though the signed cookie itself is still well-formed.
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(`session_cut_${userId}`)
    .first<{ value: string }>();
  if (!row) return userId;
  const cut = Number(row.value);
  if (!Number.isFinite(cut)) return userId;
  const exp = Number(token.split('.')[1]);
  if (exp - SESSION_TTL <= cut) return null;
  return userId;
}

export async function requireSession(env: Env, req: Request): Promise<string> {
  const userId = await getSessionUserId(env, req);
  if (!userId) throw new HttpError(401, 'Sign in to continue.');
  return userId;
}

// Double-submit check: header must equal the non-HttpOnly cookie.
export function requireCsrf(req: Request): void {
  const header = req.headers.get('x-csrf') ?? '';
  const cookie = parseCookies(req)[CSRF_COOKIE] ?? '';
  if (!header || !cookie || header !== cookie) {
    throw new HttpError(403, 'Your session timed out. Refresh the page and try again.');
  }
}
