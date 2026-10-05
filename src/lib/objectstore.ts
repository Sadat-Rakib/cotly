import { AwsClient } from 'aws4fetch';
import type { Env } from '../contracts/env';

// Object storage resolution for media blobs. One store is active per
// deployment; the metadata always lives in D1, never the bytes.
//
//   1. MEDIA_S3_*  — any S3-compatible endpoint (Neon Object Storage in
//      production; presigned PUT/GET/DELETE work from both the browser and
//      the worker).
//   2. R2_*        — Cloudflare R2 via its S3 API (legacy configuration).
//   3. MEDIA       — the R2 binding itself (local dev / miniflare): uploads
//      and reads relay through the worker, cleanup deletes via the binding.

export interface ObjectStore {
  kind: 's3' | 'binding';
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
}

export function objectStore(env: Env): ObjectStore | null {
  if (env.MEDIA_S3_ENDPOINT && env.MEDIA_S3_BUCKET && env.MEDIA_S3_ACCESS_KEY_ID && env.MEDIA_S3_SECRET_ACCESS_KEY) {
    return {
      kind: 's3',
      bucket: env.MEDIA_S3_BUCKET,
      region: env.MEDIA_S3_REGION || 'us-east-2',
      accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
      endpoint: env.MEDIA_S3_ENDPOINT.replace(/\/+$/, ''),
    };
  }
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return {
      kind: 's3',
      bucket: 'cotly-media',
      region: 'auto',
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    };
  }
  if (env.MEDIA) return { kind: 'binding', bucket: 'cotly-media', region: 'auto' };
  return null;
}

// True when uploads/reads/cleanup can operate at all on this deployment.
export function mediaStorageReady(env: Env): boolean {
  return objectStore(env) !== null;
}

// True when platform-shareable presigned GET URLs can be minted (URL-based
// providers fetch media over HTTPS, so a binding-only store cannot serve them).
export function mediaSigningReady(env: Env): boolean {
  const store = objectStore(env);
  return store?.kind === 's3';
}

function bucketBase(store: ObjectStore): string {
  return `${store.endpoint}/${store.bucket}`;
}

function s3Client(store: ObjectStore): AwsClient {
  return new AwsClient({
    accessKeyId: store.accessKeyId as string,
    secretAccessKey: store.secretAccessKey as string,
    service: 's3',
    region: store.region,
  });
}

// Worker-side requests use presigned query auth (signature in the URL), never
// header auth: runtimes may add transport headers (accept-encoding etc.) after
// signing, which breaks SigV4 header signatures against strict S3 gateways.
export async function signedFetch(store: ObjectStore, method: string, key: string): Promise<Response> {
  const url = new URL(`${bucketBase(store)}/${key}`);
  url.searchParams.set('X-Amz-Expires', '3600');
  const signed = await s3Client(store).sign(new Request(url, { method }), { aws: { signQuery: true } });
  return fetch(signed.url, { method });
}

export async function presignPut(env: Env, key: string, expiresIn = 3600): Promise<string> {
  const store = objectStore(env);
  if (!store || store.kind !== 's3') throw new Error('object store signing is not configured');
  const url = new URL(`${bucketBase(store)}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(expiresIn));
  const signed = await s3Client(store).sign(new Request(url, { method: 'PUT' }), { aws: { signQuery: true } });
  return signed.url;
}

export async function presignGet(env: Env, key: string, expiresIn = 3600): Promise<string> {
  const store = objectStore(env);
  if (!store || store.kind !== 's3') throw new Error('object store signing is not configured');
  const url = new URL(`${bucketBase(store)}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(expiresIn));
  const signed = await s3Client(store).sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
  return signed.url;
}

export interface ObjectHead {
  exists: boolean;
  size?: number;
  contentType?: string;
}

export async function objectHead(env: Env, key: string): Promise<ObjectHead> {
  const store = objectStore(env);
  if (!store) return { exists: false };
  if (store.kind === 'binding') {
    const obj = await (env.MEDIA as R2Bucket).head(key);
    return obj ? { exists: true, size: obj.size, contentType: obj.httpMetadata?.contentType } : { exists: false };
  }
  // The S3 gateway rejects presigned HEADs on existing objects with 403, so
  // existence is probed with a GET whose body is cancelled immediately.
  const res = await signedFetch(store, 'GET', key);
  if (!res.ok) return { exists: false };
  const head = {
    exists: true,
    size: Number(res.headers.get('content-length')) || undefined,
    contentType: res.headers.get('content-type') || undefined,
  };
  await res.body?.cancel().catch(() => {});
  return head;
}

export async function objectGet(env: Env, key: string): Promise<Response | null> {
  const store = objectStore(env);
  if (!store) return null;
  if (store.kind === 'binding') {
    const obj = await (env.MEDIA as R2Bucket).get(key);
    if (!obj) return null;
    const headers = new Headers();
    if (obj.httpMetadata?.contentType) headers.set('content-type', obj.httpMetadata.contentType);
    headers.set('content-length', String(obj.size));
    return new Response(obj.body, { headers });
  }
  const res = await signedFetch(store, 'GET', key);
  return res.ok ? res : null;
}

export async function objectPut(env: Env, key: string, body: ReadableStream, contentType?: string): Promise<boolean> {
  const store = objectStore(env);
  if (!store) return false;
  if (store.kind === 'binding') {
    await (env.MEDIA as R2Bucket).put(key, body, contentType ? { httpMetadata: { contentType } } : undefined);
    return true;
  }
  const res = await signedFetch(store, 'PUT', key);
  return res.ok;
}

// Deleting an already-deleted object is fine — cleanup must be idempotent.
export async function objectDelete(env: Env, key: string): Promise<void> {
  const store = objectStore(env);
  if (!store) return;
  if (store.kind === 'binding') {
    await (env.MEDIA as R2Bucket).delete(key);
    return;
  }
  try {
    await signedFetch(store, 'DELETE', key);
  } catch {
    // the row is what matters; a missing object is not an error
  }
}
