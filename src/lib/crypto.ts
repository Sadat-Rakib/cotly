// Shared crypto helpers. Never log inputs/outputs of token functions.

const te = new TextEncoder();

async function deriveKey(secret: string, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: te.encode(info), iterations: 100_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Format: v1.<ivB64>.<ctB64>
export async function encryptSecret(secret: string, plaintext: string): Promise<string> {
  const key = await deriveKey(secret, 'cotly-token-enc');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(secret: string, blob: string): Promise<string> {
  const [v, ivB64, ctB64] = blob.split('.');
  if (v !== 'v1' || !ivB64 || !ctB64) throw new Error('malformed encrypted blob');
  const key = await deriveKey(secret, 'cotly-token-enc');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(ctB64));
  return new TextDecoder().decode(pt);
}

export function randomId(bytes = 16): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, te.encode(msg)));
}

// Stateless session token: `${userId}.${exp}.${sig}`
export async function signSession(secret: string, userId: string, ttlSeconds: number, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const exp = now + ttlSeconds;
  const payload = `${userId}.${exp}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(secret: string, token: string, now = Math.floor(Date.now() / 1000)): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts as [string, string, string];
  const payload = `${userId}.${expStr}`;
  if ((await hmac(secret, payload)) !== sig) return null;
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp <= now) return null;
  return userId;
}

// PBKDF2-SHA256 password hash: pbkdf2.<iter>.<saltB64>.<hashB64>
export async function hashPassword(password: string): Promise<string> {
  const iter = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
  return `pbkdf2.${iter}.${b64(salt)}.${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split('.');
  if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: Number(iterStr), hash: 'SHA-256' }, key, 256);
  return b64(bits) === hashB64;
}
