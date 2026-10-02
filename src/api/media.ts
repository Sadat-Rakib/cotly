import type { Env } from '../contracts/env';
import { AwsClient } from 'aws4fetch';
import { randomId } from '../lib/crypto';
import { HttpError, json, readJson } from '../lib/http';
import { nowS } from './_shared';

// Strip any path components and unsafe characters; keep a readable basename.
export function sanitizeFilename(name: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^A-Za-z0-9._() -]/g, '_').replace(/^[.\s]+/, '').trim();
  return (clean || 'upload.bin').slice(0, 120);
}

export async function uploadUrl(req: Request, env: Env): Promise<Response> {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new HttpError(503, 'Media storage is not configured yet. Add the R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) and try again.');
  }
  const body = await readJson(req);
  const filename = sanitizeFilename(String(body.filename ?? ''));
  const key = `media/${randomId(8)}/${filename}`;
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/cotly-media/${key}`);
  url.searchParams.set('X-Amz-Expires', '3600');
  const signed = await client.sign(new Request(url, { method: 'PUT' }), { aws: { signQuery: true } });
  return json({ mediaId: `med_${randomId(8)}`, uploadUrl: signed.url, r2Key: key });
}

export async function confirm(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const r2Key = String(body.r2Key ?? '');
  if (!r2Key.startsWith('media/') || r2Key.includes('..')) throw new HttpError(400, 'That upload reference is invalid.');
  if (!env.MEDIA) throw new HttpError(503, 'Media storage is not enabled on this deployment yet. Text-only posts still work.');
  const obj = await env.MEDIA.head(r2Key);
  if (!obj) throw new HttpError(400, 'That upload did not complete. Upload the file again and retry.');
  const id = typeof body.mediaId === 'string' && body.mediaId ? body.mediaId : `med_${randomId(8)}`;
  const mime = String(body.mime ?? '') || obj.httpMetadata?.contentType || 'application/octet-stream';
  const size = Number(body.size) > 0 ? Number(body.size) : obj.size;
  const filename = sanitizeFilename(String(body.filename ?? ''));
  const r = await env.DB
    .prepare('INSERT INTO media (id, owner_id, mime, size, original_filename, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'owner', mime, size, filename, r2Key, nowS())
    .run();
  if (!r.success) throw new HttpError(500, 'The upload could not be recorded. Try again.');
  return json({ ok: true });
}

// Owner-only presigned read URL (1h). A foreign or missing media id is a plain
// 404 so the existence of other owners' media is never disclosed.
export async function mediaUrl(env: Env, id: string, userId: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT owner_id, r2_key FROM media WHERE id = ?').bind(id).first<{ owner_id: string; r2_key: string }>();
  if (!row || row.owner_id !== userId) throw new HttpError(404, 'That media item does not exist.');
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new HttpError(503, 'Media storage is not configured yet. Add the R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) and try again.');
  }
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/cotly-media/${row.r2_key}`);
  url.searchParams.set('X-Amz-Expires', '3600');
  const signed = await client.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
  return json({ url: signed.url });
}
