import type { Env } from '../contracts/env';
import { randomId } from '../lib/crypto';
import { HttpError, json, readJson } from '../lib/http';
import { mediaSigningReady, mediaStorageReady, objectGet, objectHead, objectPut, presignGet, presignPut } from '../lib/objectstore';
import { nowS } from './_shared';

// Strip any path components and unsafe characters; keep a readable basename.
export function sanitizeFilename(name: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^A-Za-z0-9._() -]/g, '_').replace(/^[.\s]+/, '').trim();
  return (clean || 'upload.bin').slice(0, 120);
}

export function isValidMediaKey(key: string): boolean {
  return key.startsWith('media/') && !key.includes('..');
}

// Retention for the uploading user: explicit setting first, then the
// deployment default, then 7 days. 'never'/invalid disables stamping (cleanup
// also treats those as disabled).
export async function retentionHoursFor(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'media_retention_hours'`).first<{ value: string }>();
  const fromSettings = row ? Number.parseInt(row.value, 10) : NaN;
  if (Number.isFinite(fromSettings)) return fromSettings;
  const fromEnv = Number.parseInt(env.MEDIA_RETENTION_HOURS ?? '', 10);
  if (Number.isFinite(fromEnv)) return fromEnv;
  return 168; // 7 days
}

export async function uploadUrl(req: Request, env: Env): Promise<Response> {
  if (!mediaStorageReady(env)) {
    throw new HttpError(503, 'Media storage is not configured yet. Text-only posts still work.');
  }
  const body = await readJson(req);
  const filename = sanitizeFilename(String(body.filename ?? ''));
  const key = `media/${randomId(8)}/${filename}`;
  const mediaId = `med_${randomId(8)}`;
  if (mediaSigningReady(env)) {
    const uploadUrl = await presignPut(env, key);
    return json({ mediaId, uploadUrl, r2Key: key });
  }
  // Binding-only store (local dev): relay the bytes through the worker.
  return json({ mediaId, uploadUrl: `/api/media/upload/${mediaId}?key=${encodeURIComponent(key)}`, r2Key: key });
}

// Worker-relayed upload for stores without browser-side presigning (the R2
// binding in dev). The key must have been issued by upload-url.
export async function relayUpload(req: Request, env: Env, _userId: string): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? '';
  if (!isValidMediaKey(key)) throw new HttpError(400, 'That upload reference is invalid.');
  if (!req.body) throw new HttpError(400, 'That upload was empty.');
  const ok = await objectPut(env, key, req.body, req.headers.get('content-type') ?? undefined);
  if (!ok) throw new HttpError(502, 'The upload could not be stored. Try again.');
  return json({ ok: true });
}

export async function confirm(req: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson(req);
  const r2Key = String(body.r2Key ?? '');
  if (!isValidMediaKey(r2Key)) throw new HttpError(400, 'That upload reference is invalid.');
  if (!mediaStorageReady(env)) throw new HttpError(503, 'Media storage is not enabled on this deployment yet. Text-only posts still work.');
  const obj = await objectHead(env, r2Key);
  if (!obj.exists) throw new HttpError(400, 'That upload did not complete. Upload the file again and retry.');
  const id = typeof body.mediaId === 'string' && body.mediaId ? body.mediaId : `med_${randomId(8)}`;
  const mime = String(body.mime ?? '') || obj.contentType || 'application/octet-stream';
  const size = Number(body.size) > 0 ? Number(body.size) : obj.size ?? 0;
  const filename = sanitizeFilename(String(body.filename ?? ''));
  const now = nowS();
  const retention = await retentionHoursFor(env);
  const expiresAt = retention > 0 ? now + retention * 3600 : null;
  const r = await env.DB
    .prepare('INSERT INTO media (id, owner_id, mime, size, original_filename, r2_key, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, mime, size, filename, r2Key, now, expiresAt, 'ready')
    .run();
  if (!r.success) throw new HttpError(500, 'The upload could not be recorded. Try again.');
  return json({ ok: true, expiresAt });
}

// Owner-only read URL (1h when presigned). A foreign or missing media id is a
// plain 404 so the existence of other owners' media is never disclosed.
export async function mediaUrl(env: Env, id: string, userId: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT owner_id, r2_key FROM media WHERE id = ?').bind(id).first<{ owner_id: string; r2_key: string }>();
  if (!row || row.owner_id !== userId) throw new HttpError(404, 'That media item does not exist.');
  if (mediaSigningReady(env)) {
    return json({ url: await presignGet(env, row.r2_key) });
  }
  // Binding-only store (local dev): stream through the worker with the session.
  return json({ url: `/api/media/${id}/raw` });
}

// Session-authenticated object stream for binding-only stores.
export async function mediaRaw(env: Env, id: string, userId: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT owner_id, r2_key, mime FROM media WHERE id = ?').bind(id).first<{ owner_id: string; r2_key: string; mime: string }>();
  if (!row || row.owner_id !== userId) throw new HttpError(404, 'That media item does not exist.');
  const obj = await objectGet(env, row.r2_key);
  if (!obj) throw new HttpError(404, 'That media item does not exist.');
  const headers = new Headers();
  headers.set('content-type', row.mime || 'application/octet-stream');
  const len = obj.headers?.get?.('content-length');
  if (len) headers.set('content-length', len);
  return new Response(obj.body, { headers });
}
