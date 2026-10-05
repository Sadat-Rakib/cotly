// Shared adapter plumbing: safe provider calls, error mapping, media sharing.
// Constraint: tokens/secrets must never appear in thrown or returned error text.
import type { Env } from '../contracts/env';
import type { MediaRecord, PublishOutcome } from '../contracts/types';
import { mediaSigningReady, objectGet, presignGet } from '../lib/objectstore';

const FETCH_TIMEOUT_MS = 30_000;
const RAW_SUMMARY_MAX = 300;
export type Secrets = (string | undefined | null)[];

export class OutcomeError extends Error {
  constructor(readonly outcome: PublishOutcome) {
    super('provider_outcome');
  }
}

export interface ProviderResponse {
  ok: boolean;
  status: number;
  data: unknown;
  raw: string;
  headers: Headers;
}

export function redact(text: string, secrets: Secrets): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length > 8) out = out.split(s).join('[redacted]');
  }
  return out;
}

export function truncate(text: string, max = RAW_SUMMARY_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

// Throws (never returns) — publish() catches these and converts to the outcome.
export function fail(secrets: Secrets, errorCode: string, errorMessage: string, raw?: string): OutcomeError {
  return new OutcomeError({
    kind: 'failed',
    retryable: false,
    errorCode,
    errorMessage: redact(errorMessage, secrets),
    ...(raw !== undefined ? { raw: truncate(redact(raw, secrets)) } : {}),
  });
}

export function failRetryable(secrets: Secrets, errorCode: string, errorMessage: string, raw?: string): OutcomeError {
  return new OutcomeError({
    kind: 'failed',
    retryable: true,
    errorCode,
    errorMessage: redact(errorMessage, secrets),
    ...(raw !== undefined ? { raw: truncate(redact(raw, secrets)) } : {}),
  });
}

export function needsReconnect(secrets: Secrets, reason: string): OutcomeError {
  return new OutcomeError({ kind: 'needs_reconnect', reason: redact(reason, secrets) });
}

export function outcomeFromError(e: unknown): PublishOutcome {
  if (e instanceof OutcomeError) return e.outcome;
  return {
    kind: 'failed',
    retryable: false,
    errorCode: 'EUNKNOWN',
    errorMessage: 'Publishing failed unexpectedly. Check diagnostics for details.',
  };
}

// Every provider call goes through here: 30s timeout, network errors become retryable failures.
export async function httpJson(url: string, init: RequestInit = {}): Promise<ProviderResponse> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    const name = (e as Error | undefined)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new OutcomeError({
        kind: 'failed',
        retryable: true,
        errorCode: 'ETIMEDOUT',
        errorMessage: 'The platform did not respond in time. Cotly will retry automatically.',
      });
    }
    throw new OutcomeError({
      kind: 'failed',
      retryable: true,
      errorCode: 'ENETWORK',
      errorMessage: 'Cotly could not reach the platform. Cotly will retry automatically.',
    });
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data, raw: truncate(text), headers: res.headers };
}

export function requireId(resp: ProviderResponse, secrets: Secrets, platformName: string): string {
  const id = (resp.data as { id?: unknown } | null)?.id;
  if (typeof id === 'string' && id) return id;
  throw fail(secrets, 'NO_POST_ID', `${platformName} did not return an id for the published content.`, resp.raw);
}

// Meta Graph error mapping (Facebook + Threads share the error shape).
export function graphError(resp: ProviderResponse, secrets: Secrets, platformName: 'Facebook' | 'Threads' | 'Instagram'): OutcomeError {
  const gerr = (resp.data as { error?: Record<string, unknown> } | null)?.error ?? {};
  const code = Number(gerr.code ?? 0);
  const message =
    (typeof gerr.error_user_msg === 'string' && gerr.error_user_msg) ||
    (typeof gerr.message === 'string' && gerr.message) ||
    '';
  if (resp.status === 429 || code === 4 || code === 17 || code === 613) {
    return failRetryable(
      secrets,
      'RATE_LIMITED',
      `${platformName} is temporarily rate limiting this account. Cotly will retry automatically.`,
      resp.raw,
    );
  }
  if (code === 190 || code === 102 || /access token/i.test(message)) {
    return needsReconnect(secrets, `Your ${platformName} connection expired. Reconnect ${platformName} and retry.`);
  }
  return fail(secrets, `GRAPH_${code || resp.status}`, message || 'The platform rejected this request.', resp.raw);
}

// OAuth error redirect (provider sent ?error= instead of ?code=).
// Meta signed_request (deauthorize/data-deletion callbacks):
// base64url(HMAC-SHA256(payload, app_secret)) + '.' + base64url(payload JSON).
// Returns payload.user_id when the signature verifies, else null.
export async function parseSignedRequest(signed: string, secret: string): Promise<string | null> {
  const dot = signed.indexOf('.');
  if (dot <= 0) return null;
  const sigB64 = signed.slice(0, dot);
  const payloadB64 = signed.slice(dot + 1);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  let expected = '';
  for (const b of new Uint8Array(mac)) expected += String.fromCharCode(b);
  const sig = atob(sigB64.replace(/-/g, '+').replace(/_/g, '/'));
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  let json = '';
  for (const b of atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))) json += String.fromCharCode(b.charCodeAt(0));
  const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
  let data: { algorithm?: unknown; user_id?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (data.algorithm !== 'HMAC-SHA256' || typeof data.user_id !== 'string' || !data.user_id) return null;
  return data.user_id;
}

export function oauthError(params: URLSearchParams, platformName: string): void {
  const err = params.get('error');
  if (err) {
    const desc = params.get('error_description') || err;
    throw new Error(`${platformName} declined the connection: ${redact(desc, [])}`);
  }
}

// --- Connection tests (POST /api/accounts/:id/test) -------------------------------------
// testConnection never throws: every path returns {ok, detail}, and detail text is
// always human-readable, redacted and free of tokens or auth headers.
export interface TestConnectionResult {
  ok: boolean;
  detail: string;
}

// Non-auth provider rejection -> human detail, redacted + truncated, no reconnect advice.
export function testErrorDetail(message: string, secrets: Secrets, platformName: string): string {
  const summary = truncate(redact(message || `${platformName} returned an unexpected error.`, secrets), 200);
  return `${summary} Try again.`;
}

// Network-layer failures thrown by httpJson as a test result; undefined for anything else.
export function testNetworkResult(e: unknown, platformName: string): TestConnectionResult | undefined {
  if (e instanceof OutcomeError && e.outcome.kind === 'failed') {
    if (e.outcome.errorCode === 'ETIMEDOUT') {
      return { ok: false, detail: `${platformName} did not respond in time. Try again.` };
    }
    if (e.outcome.errorCode === 'ENETWORK') {
      return { ok: false, detail: `Cotly could not reach ${platformName}. Try again.` };
    }
  }
  return undefined;
}

// Shared /me identity probe for the Meta Graph providers (Facebook, Threads).
// Auth failures mirror graphError's reconnect mapping (status 401, code 190/102, token message).
export async function graphTestConnection(opts: {
  url: string;
  token: string;
  secrets: Secrets;
  platformName: 'Facebook' | 'Threads';
  identityField: 'name' | 'username';
  fallbackIdentity: string;
  okSuffix?: string;
}): Promise<TestConnectionResult> {
  let resp: ProviderResponse;
  try {
    resp = await httpJson(opts.url, { headers: { authorization: `Bearer ${opts.token}` } });
  } catch (e) {
    return (
      testNetworkResult(e, opts.platformName) ??
      { ok: false, detail: `${opts.platformName} connection test failed unexpectedly. Try again.` }
    );
  }
  if (resp.ok) {
    const data = (resp.data ?? {}) as Record<string, unknown>;
    if (typeof data.id === 'string' && data.id) {
      const raw = data[opts.identityField];
      const identity = redact(typeof raw === 'string' && raw ? raw : opts.fallbackIdentity, opts.secrets);
      return { ok: true, detail: `Token valid — identity ${identity}.${opts.okSuffix ? ` ${opts.okSuffix}` : ''}` };
    }
    return { ok: false, detail: `${opts.platformName} returned an unexpected response. Try again.` };
  }
  const gerr = (resp.data as { error?: Record<string, unknown> } | null)?.error ?? {};
  const code = Number(gerr.code ?? 0);
  const message =
    (typeof gerr.error_user_msg === 'string' && gerr.error_user_msg) ||
    (typeof gerr.message === 'string' && gerr.message) ||
    '';
  if (resp.status === 401 || code === 190 || code === 102 || /access token/i.test(message)) {
    return { ok: false, detail: `Your ${opts.platformName} connection expired. Reconnect ${opts.platformName}.` };
  }
  return { ok: false, detail: testErrorDetail(message, opts.secrets, opts.platformName) };
}

export async function mediaBytes(env: Env, media: MediaRecord): Promise<Uint8Array<ArrayBuffer>> {
  const obj = await objectGet(env, media.r2Key);
  if (!obj) {
    throw fail([], 'MEDIA_MISSING', 'The attached media file could not be found in storage. Re-upload it and try again.');
  }
  return new Uint8Array(await obj.arrayBuffer());
}

export function r2SigningConfigured(env: Env): boolean {
  return mediaSigningReady(env);
}

export const MEDIA_SIGNING_NOT_CONFIGURED =
  'Media signing is not configured. Add MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY so Cotly can share media with the platform.';

// URL-based providers fetch media over HTTPS, so hand them a ~1h signed GET URL.
export async function presignMediaGet(env: Env, r2Key: string): Promise<string> {
  if (!r2SigningConfigured(env)) {
    throw fail([], 'MEDIA_SIGNING_NOT_CONFIGURED', MEDIA_SIGNING_NOT_CONFIGURED);
  }
  return presignGet(env, r2Key);
}
