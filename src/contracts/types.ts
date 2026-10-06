import type { Env } from './env';

export type Provider =
  | 'facebook'
  | 'threads'
  | 'linkedin'
  | 'bluesky'
  | 'instagram'
  | 'x'
  | 'reddit'
  | 'mock'
  | 'assisted';

// post_targets status. Never use booleans for state.
export type TargetStatus =
  | 'draft'
  | 'scheduled'
  | 'claimed'
  | 'publishing'
  | 'retrying'
  | 'published'
  | 'failed'
  | 'needs_reconnect'
  | 'assisted'
  | 'cancelled';

// posts status (rollup of targets).
export type PostStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

export interface PlatformCapabilities {
  text: boolean;
  images: boolean;
  maxImages: number;
  video: boolean;
  maxVideoMB: number;
  maxCaptionChars: number;
  mediaRequired: boolean;
  directPublish: boolean; // false => ASSISTED mode only
}

export interface AccountTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch seconds
}

export interface SocialAccountRecord {
  id: string;
  provider: Provider;
  externalId: string;
  displayName: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  scopes?: string;
  meta: Record<string, unknown>;
  status: 'connected' | 'needs_reconnect' | 'disabled';
  lastVerifiedAt?: number;
}

export interface MediaRecord {
  id: string;
  mime: string;
  size: number;
  originalFilename?: string;
  r2Key: string;
  width?: number;
  height?: number;
  durationS?: number;
}

export interface PublishInput {
  account: SocialAccountRecord;
  caption: string;
  media: MediaRecord[];
  idempotencyKey: string; // `${postTargetId}:${publishGeneration}`
  scheduledAt: number;
}

export type PublishOutcome =
  | { kind: 'confirmed'; externalId: string; permalink?: string; raw?: string }
  | { kind: 'pending'; externalId: string; raw?: string }
  | { kind: 'assisted'; reason?: string }
  | { kind: 'needs_reconnect'; reason: string }
  | { kind: 'failed'; retryable: boolean; errorCode: string; errorMessage: string; raw?: string };

export interface AdapterAccount {
  externalId: string;
  displayName: string;
  avatarUrl?: string;
  meta?: Record<string, unknown>;
}

// A provider whose OAuth returns several possible destinations (Facebook Pages)
// reports them here instead of silently binding to the first one. The API layer
// parks the user token in an encrypted short-lived cookie and asks the user.
export interface AdapterPageChoice {
  userToken: string;
  pages: Array<{ id: string; name: string }>;
}

export type AdapterCallbackResult =
  | { account: AdapterAccount; tokens: AccountTokens; scopes: string; pageChoice?: undefined }
  | { account?: undefined; tokens?: undefined; scopes?: undefined; pageChoice: AdapterPageChoice };

export interface PlatformAdapter {
  readonly provider: Provider;
  readonly capabilities: PlatformCapabilities;
  buildAuthUrl?(env: Env, redirectUri: string, state: string): Promise<{ url: string; verifier?: string }>;
  handleCallback?(env: Env, params: URLSearchParams, verifier?: string): Promise<AdapterCallbackResult>;
  // Read-only listing + exchange used by the Facebook Page picker.
  listPages?(env: Env, userToken: string): Promise<Array<{ id: string; name: string }>>;
  pickPage?(env: Env, userToken: string, pageId: string): Promise<{ account: AdapterAccount; tokens: AccountTokens; scopes: string }>;
  connectDirect?(env: Env, input: Record<string, string>): Promise<{
    account: AdapterAccount;
    tokens: AccountTokens;
    scopes: string;
  }>;
  refresh?(env: Env, tokens: AccountTokens, account?: SocialAccountRecord): Promise<AccountTokens>;
  publish(env: Env, input: PublishInput): Promise<PublishOutcome>;
  resolvePending?(env: Env, account: SocialAccountRecord, externalId: string): Promise<PublishOutcome>;
  testConnection?(env: Env, account: SocialAccountRecord): Promise<{ ok: boolean; detail: string }>;
}
