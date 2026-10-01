import type { Env } from '../contracts/env';
import { HttpError, errJson } from '../lib/http';
import { requireCsrf, requireSession } from '../lib/sessions';
import * as accounts from './accounts';
import * as auth from './auth';
import * as media from './media';
import * as posts from './posts';
import * as settings from './settings';

export async function handleApi(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  try {
    return await route(req, env);
  } catch (e) {
    if (e instanceof HttpError) return errJson(e.status, e.message);
    return errJson(500, 'Something went wrong on our side. Please try again in a moment.');
  }
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  const seg = path.split('/').filter(Boolean);

  // /oauth/:provider/callback lives outside /api and is intentionally sessionless.
  if (seg[0] === 'oauth') {
    if (method === 'GET' && seg.length === 3 && seg[1] !== undefined && seg[2] === 'callback') {
      return accounts.oauthCallback(req, env, seg[1]);
    }
    throw new HttpError(404, 'Not found');
  }

  if (seg[0] !== 'api') throw new HttpError(404, 'Not found');

  if (method === 'POST' && path === '/api/setup') return auth.setup(req, env);
  if (method === 'POST' && path === '/api/auth/login') return auth.login(req, env);
  // CSRF double-submit on every other mutating route, including logout.
  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') requireCsrf(req);
  if (method === 'POST' && path === '/api/auth/logout') return auth.logout(req);
  if (method === 'GET' && path === '/api/me') return auth.me(req, env);

  await requireSession(env, req);

  if (method === 'GET' && path === '/api/accounts') return accounts.listAccounts(env);
  if (method === 'DELETE' && seg.length === 3 && seg[1] === 'accounts') return accounts.removeAccount(env, seg[2] as string);
  if (method === 'POST' && path === '/api/accounts/bluesky') return accounts.connectBluesky(req, env);
  if (method === 'POST' && path === '/api/accounts/mock') return accounts.connectMock(req, env);
  if (method === 'GET' && seg.length === 4 && seg[1] === 'oauth' && seg[3] === 'start') {
    return accounts.oauthStart(req, env, seg[2] as string);
  }

  if (method === 'POST' && path === '/api/media/upload-url') return media.uploadUrl(req, env);
  if (method === 'POST' && path === '/api/media/confirm') return media.confirm(req, env);

  if (method === 'POST' && path === '/api/posts') return posts.create(req, env);
  if (method === 'GET' && path === '/api/posts') return posts.list(req, env);
  if (method === 'GET' && seg.length === 3 && seg[1] === 'posts') return posts.getOne(env, seg[2] as string);
  if (method === 'PATCH' && seg.length === 3 && seg[1] === 'posts') return posts.patch(req, env, seg[2] as string);
  if (method === 'DELETE' && seg.length === 3 && seg[1] === 'posts') return posts.remove(env, seg[2] as string);
  if (method === 'POST' && seg.length === 4 && seg[1] === 'posts') {
    const id = seg[2] as string;
    switch (seg[3]) {
      case 'reschedule':
        return posts.reschedule(req, env, id);
      case 'cancel':
        return posts.cancel(env, id);
      case 'publish-now':
        return posts.publishNow(env, id);
      case 'duplicate':
        return posts.duplicate(env, id);
      default:
        throw new HttpError(404, 'Not found');
    }
  }
  if (method === 'POST' && seg.length === 4 && seg[1] === 'targets' && seg[3] === 'retry') {
    return posts.retryTarget(env, seg[2] as string);
  }

  if (method === 'GET' && path === '/api/settings') return settings.getSettings(env);
  if (method === 'PUT' && path === '/api/settings') return settings.putSettings(req, env);
  if (method === 'GET' && path === '/api/diagnostics') return settings.getDiagnostics(env);

  throw new HttpError(404, 'Not found');
}
