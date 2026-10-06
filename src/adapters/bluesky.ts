import { getCapabilities } from '../contracts/capabilities';
import type { Env } from '../contracts/env';
import type { AccountTokens, MediaRecord, PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../contracts/types';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import {
  fail,
  failRetryable,
  httpJson,
  mediaBytes,
  needsReconnect,
  oauthCallbackBase,
  OutcomeError,
  outcomeFromError,
  redact,
  testErrorDetail,
  testNetworkResult,
  type ProviderResponse,
  type Secrets,
  type TestConnectionResult,
} from './_shared';

// Official AT Protocol OAuth (confidential client). Cotly serves its client
// metadata + JWKS from the worker, authorizes through PAR against the user's
// authorization server, and stores DPoP-bound tokens encrypted per owner.
// Every Bluesky API call is signed with a DPoP proof tied to the account key.
const MAX_CHARS = 300;
const MAX_IMAGES = 4;
const SCOPE = 'atproto transition:generic';

const AUTH_SERVER = 'https://bsky.social'; // default entrypoint (accounts on the bsky.social PDS)
const CLIENT_ASSERTION_TTL_S = 300;

const secretsOf = (token: string, refreshToken?: string): Secrets => [token, refreshToken];

interface DpopPrivateJwk extends JsonWebKey {
  kty: 'EC';
  crv: 'P-256';
  d?: string;
}

interface AtprotoAuthBlob {
  pkce: string;
  dpop: DpopPrivateJwk;
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomId(len = 24): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes.buffer);
}

// ---------- Server (confidential-client) key handling ----------

// The confidential-client signing key is generated once per deployment and
// stored encrypted in the settings KV; jwks.json serves the public half.
export async function getServerPrivateKeyJwk(env: Env): Promise<DpopPrivateJwk> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'bluesky_oauth_key'`).first<{ value: string }>();
  if (row?.value) {
    try {
      return JSON.parse(await decryptSecret(env.ENCRYPTION_SECRET, row.value)) as DpopPrivateJwk;
    } catch {
      // regenerate below
    }
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as DpopPrivateJwk;
  const enc = await encryptSecret(env.ENCRYPTION_SECRET, JSON.stringify(jwk));
  await env.DB
    .prepare(`INSERT INTO settings (key, value) VALUES ('bluesky_oauth_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(enc)
    .run();
  return jwk;
}

// Stable key id shared by the JWKS entry and the client-assertion header so
// the authorization server can pick the right verification key.
const CLIENT_KEY_ID = 'cotly-atproto-client-key-1';

function publicJwkOf(jwk: DpopPrivateJwk): Record<string, string> {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x ?? '', y: jwk.y ?? '' };
}

function jwksKeyOf(jwk: DpopPrivateJwk): Record<string, string> {
  return { ...publicJwkOf(jwk), kid: CLIENT_KEY_ID, use: 'sig', alg: 'ES256' };
}

export async function getPublicJwks(env: Env): Promise<{ keys: Record<string, string>[] }> {
  return { keys: [jwksKeyOf(await getServerPrivateKeyJwk(env))] };
}

async function importPrivateJwk(jwk: DpopPrivateJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function signEs256(privateJwk: DpopPrivateJwk, headerB64: string, payloadB64: string): Promise<string> {
  const key = await importPrivateJwk(privateJwk);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return b64url(sig);
}

function jwtHeaderFor(jwk: DpopPrivateJwk, kind: 'JWT' | 'dpop+jwt'): Record<string, unknown> {
  // The jwk header parameter must be an embedded JSON object (never a string).
  // DPoP proofs require typ 'dpop+jwt'; client assertions use typ 'JWT'.
  return { typ: kind, alg: 'ES256', jwk: publicJwkOf(jwk) };
}

async function encodeJwt(jwk: DpopPrivateJwk, payload: Record<string, unknown>, kind: 'JWT' | 'dpop+jwt', kid?: string): Promise<string> {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ ...jwtHeaderFor(jwk, kind), ...(kid ? { kid } : {}) })).buffer as ArrayBuffer);
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const sig = await signEs256(jwk, header, payloadB64);
  return `${header}.${payloadB64}.${sig}`;
}

// OAuth metadata + token endpoints reject a proof whose DPoP nonce is missing
// or stale with 400 use_dpop_nonce and hand back the expected nonce in the
// dpop-nonce response header. Every auth-server caller must run that one-shot
// handshake — a proof without it always fails on the first attempt.
function isNonceChallenge(resp: ProviderResponse): boolean {
  return (resp.status === 400 || resp.status === 401) && resp.raw.includes('use_dpop_nonce');
}

function providerErrorDetail(resp: ProviderResponse): string {
  const d = (resp.data ?? {}) as { error?: unknown; error_description?: unknown; message?: unknown };
  const parts: string[] = [];
  if (typeof d.error === 'string' && d.error) parts.push(d.error);
  if (typeof d.error_description === 'string' && d.error_description) parts.push(d.error_description);
  else if (typeof d.message === 'string' && d.message) parts.push(d.message);
  return parts.length ? `HTTP ${resp.status}: ${parts.join(' — ')}` : `HTTP ${resp.status}`;
}

// ---------- DPoP ----------

async function dpopProof(jwk: DpopPrivateJwk, htm: string, htu: string, opts: { nonce?: string; ath?: string } = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    jti: randomId(16),
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000),
  };
  if (opts.nonce) payload.nonce = opts.nonce;
  if (opts.ath) payload.ath = opts.ath;
  return encodeJwt(jwk, payload, 'dpop+jwt');
}

// Cached DPoP nonces, one slot PER SERVER: bsky.social (auth server) and the
// account's PDS rotate nonces independently, so a shared slot would make each
// server's nonce clobber the other's and force a handshake on every call.
// Servers reject a stale nonce by returning the next one — retry once.
function nonceKey(url: string): string {
  const origin = new URL(url).origin;
  return `bluesky_dpop_nonce:${origin}`;
}

async function getNonce(env: Env, url: string): Promise<string | undefined> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(nonceKey(url)).first<{ value: string }>();
  return row?.value || undefined;
}

async function setNonce(env: Env, url: string, nonce: string | null): Promise<void> {
  if (!nonce) return;
  await env.DB
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(nonceKey(url), nonce)
    .run();
}

// ---------- Token endpoint (authorization_code + refresh_token) ----------

// POST {AUTH_SERVER}/oauth/token with a DPoP proof, transparently handling the
// server's nonce rotation (one retry with the fresh nonce — the same handshake
// the PAR call performs). Returns the raw provider response so callers can show
// the real rejection instead of a generic message.
async function oauthTokenRequest(env: Env, dpopJwk: DpopPrivateJwk, body: URLSearchParams): Promise<ProviderResponse> {
  const tokenUrl = `${AUTH_SERVER}/oauth/token`;
  const send = async (nonce?: string): Promise<ProviderResponse> =>
    httpJson(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', dpop: await dpopProof(dpopJwk, 'POST', tokenUrl, { nonce }) },
      body,
    });
  let res = await send(await getNonce(env, tokenUrl));
  const fresh = res.headers.get('dpop-nonce');
  if (fresh) await setNonce(env, tokenUrl, fresh);
  if (isNonceChallenge(res) && fresh) {
    res = await send(fresh);
    const retryNonce = res.headers.get('dpop-nonce');
    if (retryNonce) await setNonce(env, tokenUrl, retryNonce);
  }
  return res;
}

// ---------- Identity resolution ----------

interface DidDocument {
  service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
}

export async function resolveDidDocument(did: string): Promise<{ pdsUrl: string }> {
  let doc: DidDocument = {};
  if (did.startsWith('did:plc:')) {
    const resp = await httpJson(`https://plc.directory/${did}`);
    doc = (resp.data ?? {}) as DidDocument;
  } else if (did.startsWith('did:web:')) {
    const host = did.slice('did:web:'.length).split(':')[0];
    const resp = await httpJson(`https://${host}/.well-known/did.json`);
    doc = (resp.data ?? {}) as DidDocument;
  }
  const pds = doc.service?.find((svc) => svc.id.endsWith('#atproto_pds'))?.serviceEndpoint;
  if (!pds) throw new Error('Cotly could not resolve the Bluesky PDS for this account.');
  return { pdsUrl: pds.replace(/\/+$/, '') };
}

// ---------- Helpers ----------

function clientId(env: Env): string {
  // The client_id IS the metadata URL and must be served by this deployment
  // without redirects: the callback base (Worker URL) is the stable origin,
  // independent of which frontend domain hosts the SPA.
  return `${oauthCallbackBase(env)}/oauth/bluesky/client-metadata.json`;
}

function redirectUri(env: Env): string {
  return `${oauthCallbackBase(env)}/oauth/bluesky/callback`;
}

async function clientAssertion(env: Env, aud: string): Promise<string> {
  const jwk = await getServerPrivateKeyJwk(env);
  const now = Math.floor(Date.now() / 1000);
  return encodeJwt(
    jwk,
    { iss: clientId(env), sub: clientId(env), aud, jti: randomId(16), iat: now, exp: now + CLIENT_ASSERTION_TTL_S },
    'JWT',
    CLIENT_KEY_ID,
  );
}

// Perform an XRPC call with Bearer + DPoP auth, transparently handling the
// server's DPoP nonce rotation (one retry with the fresh nonce).
async function dpopXrpc(
  env: Env,
  meta: Record<string, unknown>,
  accessToken: string,
  method: string,
  url: string,
  init: { body?: BodyInit | null; contentType?: string } = {},
): Promise<ProviderResponse> {
  const dpopEnc = typeof meta.dpopKeyEnc === 'string' ? meta.dpopKeyEnc : '';
  if (!dpopEnc) throw new Error('missing dpop key');

  const jwk = JSON.parse(await decryptSecret(env.ENCRYPTION_SECRET, dpopEnc)) as DpopPrivateJwk;
  const ath = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken)));
  const send = async (nonce?: string): Promise<Response> => {
    // RFC 9449: the DPoP htu claim is the request URI WITHOUT query/fragment —
    // the PDS rejects proofs whose htu carries the query string.
    const htu = url.split('?')[0] ?? url;
    const proof = await dpopProof(jwk, method, htu, { nonce, ath });
    const headers: Record<string, string> = {
      // RFC 9449: DPoP-bound tokens use the DPoP authorization scheme — the
      // atproto resource servers route Bearer requests to their legacy
      // app-password verifier, which rejects OAuth tokens.
      authorization: `DPoP ${accessToken}`,
      dpop: proof,
      ...(init.contentType ? { 'content-type': init.contentType } : {}),
    };
    try {
      return await fetch(url, { method, headers, body: init.body ?? null });
    } catch (e) {
      const name = (e as Error | undefined)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new OutcomeError({ kind: 'failed', retryable: true, errorCode: 'ETIMEDOUT', errorMessage: 'Bluesky did not respond in time. Cotly will retry automatically.' });
      }
      throw new OutcomeError({ kind: 'failed', retryable: true, errorCode: 'ENETWORK', errorMessage: 'Cotly could not reach Bluesky. Cotly will retry automatically.' });
    }
  };
  let nonce = await getNonce(env, url);
  let res = await send(nonce);
  const retryWith = res.headers.get('dpop-nonce');
  const bodyText = await res.clone().text().catch(() => '');
  if ((res.status === 400 || res.status === 401) && retryWith) {
    // Surface the real nonce-challenge shape (PDS and auth server word it
    // differently); never log tokens — bodies carry only provider errors.
    console.error(`[bluesky-xrpc] dpop challenge ${res.status}:`, bodyText.slice(0, 180));
  }
  if ((res.status === 400 || res.status === 401) && retryWith && bodyText.includes('use_dpop_nonce')) {
    await setNonce(env, url, retryWith);
    res = await send(retryWith);
  } else if (retryWith) {
    await setNonce(env, url, retryWith);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 600), headers: res.headers };
}

function isAuthFailure(resp: ProviderResponse): boolean {
  const err = (resp.data as { error?: unknown } | null)?.error;
  return resp.status === 401 || err === 'InvalidToken' || err === 'ExpiredToken' || err === 'AuthenticationRequired' || err === 'use_dpop_nonce';
}

function mapXrpcError(resp: ProviderResponse, secrets: Secrets): never {
  // 401 or a token-named XRPC error means the session is dead; a bare 403
  // (e.g. a repo/record policy refusal) must not flip the account — only a
  // genuine auth failure earns needs_reconnect.
  if (isAuthFailure(resp)) {
    throw needsReconnect(secrets, 'Your Bluesky authorization expired. Reconnect Bluesky and retry.');
  }
  if (resp.status === 429) {
    throw failRetryable(secrets, 'RATE_LIMITED', 'Bluesky is temporarily rate limiting this account. Cotly will retry automatically.', resp.raw);
  }
  const message =
    (typeof (resp.data as { message?: unknown } | null)?.message === 'string'
      ? String((resp.data as { message: string }).message)
      : '') || 'Bluesky rejected this request.';
  throw fail(secrets, `BSKY_${resp.status}`, message, resp.raw);
}

export class BlueskyAdapter implements PlatformAdapter {
  readonly provider = 'bluesky' as const;
  readonly capabilities = getCapabilities('bluesky');

  // AT Protocol OAuth: resolve nothing up front (the bsky.social authorization
  // server authenticates the user), push the authorization request via PAR,
  // and keep the per-attempt DPoP key + PKCE verifier in the state blob.
  async buildAuthUrl(env: Env, redirectUri: string, state: string): Promise<{ url: string; verifier: string }> {
    const dpopPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const dpopJwk = (await crypto.subtle.exportKey('jwk', dpopPair.privateKey)) as DpopPrivateJwk;
    const pkce = randomId(32);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pkce)));

    // Confidential-client authentication (private_key_jwt) is separate from
    // DPoP: the client assertion is signed with the JWKS key, while the session
    // DPoP key signs the PAR proof — and per the ATProto spec that session key
    // "is used starting with the PAR request", so the auth server binds it here
    // and every later call (token, refresh, XRPC) must reuse the same key.
    const assertion = await clientAssertion(env, AUTH_SERVER);
    const parBody = new URLSearchParams({
      client_id: clientId(env),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    });
    const parUrl = `${AUTH_SERVER}/oauth/par`;
    const nonce = await getNonce(env, parUrl);
    const proof = await dpopProof(dpopJwk, 'POST', parUrl, { nonce });
    let par: Response;
    try {
      par = await fetch(`${AUTH_SERVER}/oauth/par`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', dpop: proof },
        body: parBody,
      });
    } catch {
      throw new Error('Cotly could not reach Bluesky to start the connection. Try again in a moment.');
    }
    if (par.status === 400 || par.status === 401) {
      const freshNonce = par.headers.get('dpop-nonce');
      const firstBody = (await par.clone().text()).slice(0, 300);
      console.error('[bluesky-par] nonce retry needed:', par.status, firstBody);
      if (freshNonce) {
        await setNonce(env, parUrl, freshNonce);
        const retryProof = await dpopProof(dpopJwk, 'POST', `${AUTH_SERVER}/oauth/par`, { nonce: freshNonce });
        par = await fetch(`${AUTH_SERVER}/oauth/par`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', dpop: retryProof },
          body: parBody,
        });
        console.error('[bluesky-par] retry status:', par.status, (await par.clone().text()).slice(0, 300));
      } else {
        // A real rejection (invalid_client, invalid_redirect_uri, ...) — show it.
        throw new Error(`Bluesky rejected the connection start (${par.status}: ${firstBody.slice(0, 200)}). Try again in a moment.`);
      }
    }
    if (!par.ok) {
      const body = (await par.text().catch(() => '')).slice(0, 200);
      throw new Error(`Bluesky rejected the connection start (HTTP ${par.status}${body ? `: ${body}` : ''}). Try again in a moment.`);
    }
    const parData = (await par.json().catch(() => ({}))) as { request_uri?: string };
    if (!parData.request_uri) throw new Error('Bluesky did not return an authorization request. Try again.');

    const url =
      `${AUTH_SERVER}/oauth/authorize?client_id=${encodeURIComponent(clientId(env))}` +
      `&request_uri=${encodeURIComponent(parData.request_uri)}`;
    // The per-attempt DPoP key + PKCE verifier travel encrypted inside the state row.
    const blob = await encryptSecret(env.ENCRYPTION_SECRET, JSON.stringify({ pkce, dpop: dpopJwk } satisfies AtprotoAuthBlob));
    return { url, verifier: blob };
  }

  async handleCallback(env: Env, params: URLSearchParams, verifier?: string) {
    if (!verifier) throw new Error('That Bluesky connection attempt has expired. Connect Bluesky again.');
    const code = params.get('code');
    if (!code) throw new Error('Bluesky did not return an authorization code. Try connecting again.');
    const blob = JSON.parse(await decryptSecret(env.ENCRYPTION_SECRET, verifier)) as AtprotoAuthBlob;

    const tokenUrl = `${AUTH_SERVER}/oauth/token`;
    const assertion = await clientAssertion(env, AUTH_SERVER);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(env),
      client_id: clientId(env),
      code_verifier: blob.pkce,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    });
    const tok = await oauthTokenRequest(env, blob.dpop, body);
    const data = (tok.data ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; sub?: unknown };
    if (!tok.ok || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
      // Surface the authorization server's real rejection (e.g. invalid_grant,
      // invalid_client) — a generic message here cost real debugging time.
      throw new Error(`Bluesky rejected the connection attempt (${providerErrorDetail(tok)}). Verify the app credentials and try again.`);
    }
    const did = typeof data.sub === 'string' ? data.sub : '';
    if (!did) throw new Error('Bluesky did not return an account id. Try connecting again.');

    // Resolve the account's PDS for repo writes, and read the handle.
    const { pdsUrl } = await resolveDidDocument(did);
    const meta: Record<string, unknown> = { pdsUrl, dpopKeyEnc: await encryptSecret(env.ENCRYPTION_SECRET, JSON.stringify(blob.dpop)) };
    let handle = '';
    try {
      const probe = await dpopXrpc(env, meta, data.access_token, 'GET', `${pdsUrl}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
      const profile = (probe.data as { handle?: unknown } | null) ?? {};
      if (typeof profile.handle === 'string') handle = profile.handle;
    } catch {
      // profile read is best-effort; the connection itself succeeded
    }

    const expiresAt = typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : undefined;
    return {
      account: {
        externalId: did,
        displayName: handle || 'Bluesky account',
        meta,
      },
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        ...(expiresAt ? { expiresAt } : {}),
      },
      scopes: SCOPE,
    };
  }

  // AT Protocol refresh rotates the refresh token; the caller must persist the
  // returned pair. Signed with the server key + the account's DPoP key.
  async refresh(env: Env, tokens: AccountTokens, account?: SocialAccountRecord): Promise<AccountTokens> {
    const meta = account?.meta ?? {};
    const dpopEnc = typeof meta.dpopKeyEnc === 'string' ? meta.dpopKeyEnc : '';
    if (!tokens.refreshToken || !dpopEnc) {
      throw new Error('Bluesky authorization expired. Reconnect Bluesky and retry.');
    }
    const jwk = JSON.parse(await decryptSecret(env.ENCRYPTION_SECRET, dpopEnc)) as DpopPrivateJwk;
    const assertion = await clientAssertion(env, AUTH_SERVER);
    const resp = await oauthTokenRequest(
      env,
      jwk,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: clientId(env),
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      }),
    );
    const data = (resp.data ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (!resp.ok || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
      // Real provider reason first (e.g. invalid_grant — rotated refresh token
      // replayed), then the reconnect advice.
      throw new Error(`Bluesky authorization expired (${providerErrorDetail(resp)}). Reconnect Bluesky and retry.`);
    }
    const expiresAt = typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : undefined;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  // Revoke the issued tokens at the authorization server (best-effort).
  async revoke(env: Env, account: SocialAccountRecord): Promise<void> {
    try {
      const assertion = await clientAssertion(env, AUTH_SERVER);
      await httpJson(`${AUTH_SERVER}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: account.accessToken,
          client_id: clientId(env),
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: assertion,
        }),
      });
    } catch {
      // revocation is best-effort; Cotly deletes its credentials regardless
    }
  }

  async testConnection(env: Env, account: SocialAccountRecord): Promise<TestConnectionResult> {
    const secrets = secretsOf(account.accessToken, account.refreshToken);
    try {
      // Rows connected before the ATProto OAuth rework carry no DPoP key, so
      // no XRPC call can be signed for them — say so instead of a generic crash.
      if (typeof account.meta.dpopKeyEnc !== 'string' || !account.meta.dpopKeyEnc) {
        return { ok: false, detail: 'This Bluesky connection predates Cotly’s current sign-in and cannot be renewed. Reconnect Bluesky.' };
      }
      const pds = typeof account.meta.pdsUrl === 'string' ? account.meta.pdsUrl : AUTH_SERVER;
      const resp = await dpopXrpc(env, account.meta, account.accessToken, 'GET', `${pds}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(account.externalId)}`);
      if (resp.ok) {
        const raw = (resp.data as { handle?: unknown } | null)?.handle;
        const handle = redact(typeof raw === 'string' && raw ? raw : account.displayName, secrets);
        return { ok: true, detail: `Token valid — identity ${handle}.` };
      }
      if (isAuthFailure(resp)) {
        console.error('[bluesky-test] profile read rejected:', resp.status, resp.raw.slice(0, 200));
        try {
          const renewed = await this.refresh(env, { accessToken: account.accessToken, refreshToken: account.refreshToken }, account);
          // ATProto rotates the refresh token on every refresh: a renewed pair
          // that is not persisted here leaves the stored refresh token dead and
          // the account unusable once the access token's hour is up.
          const enc = await encryptSecret(env.ENCRYPTION_SECRET, renewed.accessToken);
          const encRefresh = renewed.refreshToken ? await encryptSecret(env.ENCRYPTION_SECRET, renewed.refreshToken) : null;
          await env.DB
            .prepare(
              `UPDATE social_accounts SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), token_expires_at = ?, status = 'connected', updated_at = ? WHERE id = ?`,
            )
            .bind(enc, encRefresh, renewed.expiresAt ?? null, Math.floor(Date.now() / 1000), account.id)
            .run();
          return { ok: true, detail: `Session renewed and saved — token valid for ${account.displayName}.` };
        } catch {
          return { ok: false, detail: 'Authorization expired and could not be renewed. Reconnect Bluesky.' };
        }
      }
      const message = (resp.data as { message?: unknown } | null)?.message;
      return { ok: false, detail: testErrorDetail(typeof message === 'string' ? message : '', secrets, 'Bluesky') };
    } catch (e) {
      return testNetworkResult(e, 'Bluesky') ?? { ok: false, detail: 'Bluesky connection test failed unexpectedly. Try again.' };
    }
  }

  async publish(env: Env, input: PublishInput): Promise<PublishOutcome> {
    const secrets = secretsOf(input.account.accessToken, input.account.refreshToken);
    try {
      if (input.caption.length > MAX_CHARS) {
        throw fail(secrets, 'CAPTION_TOO_LONG', `Bluesky posts are limited to ${MAX_CHARS} characters. Shorten the post and retry.`);
      }
      const images = input.media.filter((m) => m.mime.startsWith('image/'));
      if (input.media.some((m) => m.mime.startsWith('video/'))) {
        throw fail(secrets, 'VIDEO_UNSUPPORTED', 'Bluesky does not support video posts from Cotly yet. Publish without the video.');
      }
      if (images.length > MAX_IMAGES) {
        throw fail(secrets, 'TOO_MANY_IMAGES', `Bluesky posts support at most ${MAX_IMAGES} images. Remove the extras and retry.`);
      }
      const did = input.account.externalId;
      // A pre-OAuth row has no DPoP key: sign-in is impossible, only reconnect fixes it.
      if (typeof input.account.meta.dpopKeyEnc !== 'string' || !input.account.meta.dpopKeyEnc) {
        throw needsReconnect(secrets, 'This Bluesky connection predates Cotly’s current sign-in. Reconnect Bluesky and retry.');
      }
      const record: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text: input.caption,
        createdAt: new Date().toISOString(),
      };
      if (images.length > 0) record.embed = await this.uploadImages(env, input.account, images);

      const pds = typeof input.account.meta.pdsUrl === 'string' ? input.account.meta.pdsUrl : AUTH_SERVER;
      let resp = await dpopXrpc(
        env,
        input.account.meta,
        input.account.accessToken,
        'POST',
        `${pds}/xrpc/com.atproto.repo.createRecord`,
        {
          contentType: 'application/json',
          body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
        },
      );
      if (isAuthFailure(resp)) {
        throw needsReconnect(secrets, 'Your Bluesky authorization expired. Reconnect Bluesky and retry.');
      }
      if (!resp.ok) mapXrpcError(resp, secrets);
      const uri = (resp.data as { uri?: unknown } | null)?.uri;
      if (typeof uri !== 'string' || !uri) throw fail(secrets, 'NO_POST_ID', 'Bluesky did not return a post uri.', resp.raw);
      const rkey = uri.split('/').pop() ?? '';
      return {
        kind: 'confirmed',
        externalId: uri,
        permalink: `https://bsky.app/profile/${did}/post/${rkey}`,
        ...(resp.raw ? { raw: resp.raw } : {}),
      };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  private async uploadImages(env: Env, account: SocialAccountRecord, images: MediaRecord[]) {
    const out: Array<{ alt: string; image: Record<string, unknown> }> = [];
    const pds = typeof account.meta.pdsUrl === 'string' ? account.meta.pdsUrl : AUTH_SERVER;
    for (const m of images) {
      const bytes = await mediaBytes(env, m);
      const secrets = secretsOf(account.accessToken, account.refreshToken);
      const resp = await dpopXrpc(env, account.meta, account.accessToken, 'POST', `${pds}/xrpc/com.atproto.repo.uploadBlob`, {
        contentType: m.mime,
        body: bytes,
      });
      if (!resp.ok) mapXrpcError(resp, secrets);
      const blob = (resp.data as { blob?: Record<string, unknown> | null } | null)?.blob;
      if (!blob) throw fail(secrets, 'BLOB_UPLOAD_FAILED', 'Bluesky did not accept the image upload.', resp.raw);
      // Older XRPC responses return {cid,...}; normalize both shapes to a blob object.
      const image =
        blob.$type === 'blob'
          ? blob
          : { $type: 'blob', ref: { $link: blob.cid }, mimeType: blob.mimeType, size: blob.size };
      out.push({ alt: '', image });
    }
    return { $type: 'app.bsky.embed.images', images: out };
  }
}
