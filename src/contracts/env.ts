export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;

  APP_URL: string;
  ALLOW_REGISTRATION: string;
  MOCK_SOCIAL_ENABLED: string;
  MEDIA_RETENTION_HOURS: string;

  ENCRYPTION_SECRET: string;
  SESSION_SECRET: string;

  META_CLIENT_ID?: string;
  META_CLIENT_SECRET?: string;
  THREADS_CLIENT_ID?: string;
  THREADS_CLIENT_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;

  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}
