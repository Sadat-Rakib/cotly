import type { Env } from '../contracts/env';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { HttpError, json, readJson } from '../lib/http';
import { allowAttempt } from '../lib/ratelimit';
import { clearedSessionCookies, getSessionUserId, sessionCookiePair } from '../lib/sessions';
import { isValidTimezone, nowS } from './_shared';

function withCookies(res: Response, cookies: string[]): Response {
  const headers = new Headers(res.headers);
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(res.body, { status: res.status, headers });
}

export async function setup(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const timezone = String(body.timezone ?? 'UTC').trim() || 'UTC';
  if (!email.includes('@') || email.length > 320) throw new HttpError(400, 'Enter a valid email address.');
  if (password.length < 8) throw new HttpError(400, 'Choose a password with at least 8 characters.');
  if (!isValidTimezone(timezone)) throw new HttpError(400, 'Pick a valid time zone.');
  const taken = await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
  if (taken) throw new HttpError(403, 'Owner already exists');
  const now = nowS();
  await env.DB.prepare('INSERT INTO users (id, email, password_hash, timezone, created_at) VALUES (?,?,?,?,?)').bind(
    'owner',
    email,
    await hashPassword(password),
    timezone,
    now,
  ).run();
  return withCookies(json({ ok: true }, 201), await sessionCookiePair(env, req, 'owner'));
}

export async function login(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const allowed = await allowAttempt(env, `${ip}:${email}`, 10, 15 * 60);
  if (!allowed) throw new HttpError(429, 'Too many sign-in attempts. Please wait 15 minutes and try again.');
  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?').bind(email).first<{ id: string; password_hash: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, 'Wrong email or password.');
  }
  return withCookies(json({ ok: true }), await sessionCookiePair(env, req, user.id));
}

// Registration stays closed unless the deployment explicitly allows it. New
// users get their own id; ownership scoping of existing tables lands with the
// Neon migration (see PLATFORM_BLOCKERS.md).
export async function register(req: Request, env: Env): Promise<Response> {
  if (env.ALLOW_REGISTRATION !== 'true') throw new HttpError(403, 'Registration is closed on this Cotly deployment.');
  const body = await readJson(req);
  const name = String(body.name ?? '').trim().slice(0, 80);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const timezone = String(body.timezone ?? 'UTC').trim() || 'UTC';
  if (!email.includes('@') || email.length > 320) throw new HttpError(400, 'Enter a valid email address.');
  if (password.length < 8) throw new HttpError(400, 'Choose a password with at least 8 characters.');
  if (!isValidTimezone(timezone)) throw new HttpError(400, 'Pick a valid time zone.');
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!(await allowAttempt(env, `register:${ip}`, 5, 15 * 60))) {
    throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
  }
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (taken) throw new HttpError(409, 'An account with that email already exists.');
  const id = crypto.randomUUID();
  const now = nowS();
  await env.DB.prepare('INSERT INTO users (id, name, email, password_hash, timezone, created_at) VALUES (?,?,?,?,?,?)').bind(
    id,
    name || null,
    email,
    await hashPassword(password),
    timezone,
    now,
  ).run();
  return withCookies(json({ ok: true }, 201), await sessionCookiePair(env, req, id));
}

export async function logout(req: Request): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const c of clearedSessionCookies(new URL(req.url).protocol === 'https:')) headers.append('set-cookie', c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// Pre-setup the UI needs one unauthenticated probe: owner missing => isSetup:false.
export async function me(req: Request, env: Env): Promise<Response> {
  const mockEnabled = env.MOCK_SOCIAL_ENABLED === 'true';
  const userId = await getSessionUserId(env, req);
  if (!userId) {
    const owner = await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
    if (!owner) return json({ email: null, timezone: 'UTC', isSetup: false, mockEnabled });
    throw new HttpError(401, 'Sign in to continue.');
  }
  const user = await env.DB.prepare('SELECT email, timezone FROM users WHERE id = ?').bind(userId).first<{ email: string; timezone: string }>();
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  return json({ email: user.email, timezone: user.timezone, isSetup: true, mockEnabled });
}
