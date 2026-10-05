export interface Env {
  DB: D1Database;
  // R2 binding (local dev / miniflare). Production uses the S3-compatible
  // MEDIA_S3_* credentials below; the binding is optional and may be absent.
  MEDIA?: R2Bucket;
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
  INSTAGRAM_CLIENT_ID?: string;
  INSTAGRAM_CLIENT_SECRET?: string;
  // X is pay-per-post: publishing stays off until explicitly enabled, and a
  // hard monthly cap (USD, default 5) blocks further posts when reached.
  X_API_ENABLED?: string;
  X_MAX_MONTHLY_SPEND_USD?: string;

  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;

  // S3-compatible object storage (Neon Object Storage). Preferred production
  // backend: presigned PUT/GET/DELETE against any SigV4 endpoint.
  MEDIA_S3_ENDPOINT?: string;
  MEDIA_S3_BUCKET?: string;
  MEDIA_S3_REGION?: string;
  MEDIA_S3_ACCESS_KEY_ID?: string;
  MEDIA_S3_SECRET_ACCESS_KEY?: string;
}
