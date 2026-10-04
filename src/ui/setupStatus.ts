// Local types for GET /api/setup/status (CONTRACT_V2 "API agent" shape).
// Kept in src/ui because the UI agent owns only this directory.

export interface SetupDeploymentStatus {
  d1: boolean;
  r2: boolean;
  cron: boolean | 'unknown';
  appUrl: string;
  encryptionSecretSet: boolean;
  sessionSecretSet: boolean;
  mediaPresignReady: boolean;
}

export interface SetupAccountEntry {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  lastVerifiedAt: number | null;
}

export type SetupBadge = 'not_configured' | 'ready_to_connect' | 'connected' | 'needs_reconnect';

export interface SetupProviderStatus {
  provider: string;
  implemented: boolean;
  configured: boolean;
  reason: string;
  connected: boolean;
  badge: SetupBadge;
}

export interface SetupChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

export interface SetupStatus {
  deployment: SetupDeploymentStatus;
  owner: { exists: boolean; email: string | null };
  accounts: SetupAccountEntry[];
  providers: SetupProviderStatus[];
  checklist: SetupChecklistItem[];
}

// What the owner must set up themselves for each OAuth provider.
export interface OAuthProviderMeta {
  portal: string;
  portalName: string;
  appType: string;
  idEnv: string;
  secretEnv: string;
}

export const OAUTH_PROVIDER_META: Record<string, OAuthProviderMeta> = {
  facebook: {
    portal: 'https://developers.facebook.com/apps',
    portalName: 'developers.facebook.com',
    appType: 'Business',
    idEnv: 'META_CLIENT_ID',
    secretEnv: 'META_CLIENT_SECRET',
  },
  threads: {
    portal: 'https://developers.facebook.com/apps',
    portalName: 'developers.facebook.com',
    appType: 'Threads',
    idEnv: 'THREADS_CLIENT_ID',
    secretEnv: 'THREADS_CLIENT_SECRET',
  },
  linkedin: {
    portal: 'https://www.linkedin.com/developers',
    portalName: 'linkedin.com/developers',
    appType: 'LinkedIn app with "Share on LinkedIn"',
    idEnv: 'LINKEDIN_CLIENT_ID',
    secretEnv: 'LINKEDIN_CLIENT_SECRET',
  },
  x: {
    portal: 'https://developer.x.com/en/portal/dashboard',
    portalName: 'developer.x.com',
    appType: 'X app with OAuth 2.0 (PKCE) and user authentication enabled',
    idEnv: 'X_CLIENT_ID',
    secretEnv: 'X_CLIENT_SECRET',
  },
};

export function isOAuthProvider(provider: string): boolean {
  return provider in OAUTH_PROVIDER_META;
}

// Exact OAuth callback for the host Cotly is currently served from.
export function callbackUrlFor(deploymentAppUrl: string, provider: string): string {
  const base = (deploymentAppUrl || window.location.origin).replace(/\/+$/, '');
  return `${base}/oauth/${provider}/callback`;
}
