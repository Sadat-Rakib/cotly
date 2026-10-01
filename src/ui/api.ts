import type { PostStatus, Provider, TargetStatus } from '../contracts/types';

export type { PostStatus, Provider, TargetStatus };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('cotly_csrf');
    if (csrf) headers['x-csrf'] = csrf;
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Network error — is the Cotly server running?');
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    const here = window.location.pathname;
    if (here !== '/login' && here !== '/setup') window.location.assign('/login');
    throw new ApiError(401, 'Session expired. Please sign in again.');
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    let message = typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `Request failed (${res.status})`;
    let fieldErrors: Record<string, string> | undefined;
    if (data && typeof data === 'object' && Array.isArray((data as { errors?: unknown }).errors)) {
      const list = (data as { errors: unknown[] }).errors;
      fieldErrors = {};
      const msgs: string[] = [];
      for (const e of list) {
        if (e && typeof e === 'object' && 'field' in e && 'message' in e) {
          const field = String((e as { field: unknown }).field);
          const msg = String((e as { message: unknown }).message);
          fieldErrors[field] = msg;
          msgs.push(msg);
        }
      }
      if (msgs.length > 0) message = msgs.join('; ');
    }
    throw new ApiError(res.status, message, fieldErrors);
  }
  return data as T;
}

// ---- Shared API shapes (CONTRACT.md "API spec") ----

export interface Me {
  email: string;
  timezone: string;
  isSetup: boolean;
}

export type AccountStatus = 'connected' | 'needs_reconnect' | 'disabled';

export interface Account {
  id: string;
  provider: Provider;
  displayName: string;
  avatarUrl?: string;
  status: AccountStatus;
  externalId?: string;
  lastVerifiedAt?: number;
}

export interface MediaRow {
  id: string;
  mime: string;
  filename?: string;
  size?: number;
  url?: string;
}

export interface TargetRow {
  id: string;
  accountId: string;
  provider: Provider;
  accountName?: string;
  status: TargetStatus;
  lastError?: string;
}

export interface PostRow {
  id: string;
  baseCaption: string;
  status: PostStatus;
  scheduledAt: number;
  timezone?: string;
  media?: MediaRow[];
  targets: TargetRow[];
}

export interface PostTargetInput {
  accountId: string;
  captionOverride?: string;
}

export interface Settings {
  timezone: string;
  mediaRetentionHours: number | null;
  xBudgetMode: 'disabled' | 'warn' | 'hard';
  xBudgetMonthlyUsd: number;
}

export interface RecentAttempt {
  attemptedAt?: number;
  provider?: string;
  result?: string;
  errorMessage?: string;
}

export interface Diagnostics {
  lastTickAt?: number | null;
  dueCount: number;
  activeCount: number;
  failedCount: number;
  needsReconnectCount: number;
  recentAttempts: RecentAttempt[];
  providers?: Record<string, string | boolean>;
  r2Ok?: boolean;
}

// Tolerate both `T[]` and `{posts: T[]}` list responses.
export function asRows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { posts?: unknown }).posts)) {
    return (data as { posts: T[] }).posts;
  }
  return [];
}

export function providerLabel(p: Provider): string {
  if (p === 'mock') return 'MockSocial';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

// Upload via XHR to expose progress; no extra headers (presigned URL is self-contained).
export function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
}
