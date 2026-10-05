import type { Env } from '../contracts/env';
import { HttpError, errJson } from '../lib/http';
import { requireCsrf, requireSession } from '../lib/sessions';
import * as accounts from './accounts';
import * as auth from './auth';
import * as media from './media';
import * as posts from './posts';
import * as settings from './settings';
import * as setup from './setup';

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
    if (method === 'POST' && seg.length === 3 && seg[1] === 'threads' && seg[2] === 'deauthorize') {
      return accounts.threadsDeauthorize(req, env);
    }
    throw new HttpError(404, 'Not found');
  }

  if (seg[0] !== 'api') throw new HttpError(404, 'Not found');

  if (method === 'POST' && path === '/api/setup') return auth.setup(req, env);
  if (method === 'POST' && path === '/api/auth/login') return auth.login(req, env);
  if (method === 'POST' && path === '/api/auth/register') return auth.register(req, env);
  // CSRF double-submit on every other mutating route, including logout.
  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') requireCsrf(req);
  if (method === 'POST' && path === '/api/auth/logout') return auth.logout(req, env);
  if (method === 'GET' && path === '/api/me') return auth.me(req, env);

  const userId = await requireSession(env, req);

  if (method === 'GET' && path === '/api/setup/status') return setup.getSetupStatus(req, env);
  if (method === 'GET' && path === '/api/accounts') return accounts.listAccounts(env, userId);
  if (method === 'DELETE' && seg.length === 3 && seg[1] === 'accounts') return accounts.removeAccount(env, userId, seg[2] as string);
  if (method === 'POST' && seg.length === 4 && seg[1] === 'accounts' && seg[3] === 'test') {
    return accounts.testAccount(env, userId, seg[2] as string);
  }
  if (method === 'POST' && path === '/api/accounts/bluesky') return accounts.connectBluesky(req, env);
  if (method === 'POST' && path === '/api/accounts/mock') return accounts.connectMock(req, env);
  if (method === 'GET' && path === '/api/accounts/facebook/pages') return accounts.listFacebookPages(req, env);
  if (method === 'POST' && path === '/api/accounts/facebook/pages') return accounts.selectFacebookPage(req, env);
  if (method === 'POST' && path === '/api/setup/test-meta') return setup.testMeta(env);
  if (method === 'GET' && seg.length === 4 && seg[1] === 'oauth' && seg[3] === 'start') {
    return accounts.oauthStart(req, env, seg[2] as string);
  }

  if (method === 'POST' && path === '/api/media/upload-url') return media.uploadUrl(req, env);
  // Worker-relayed upload (binding-only stores) and session-authenticated read.
  if (method === 'PUT' && seg.length === 4 && seg[1] === 'media' && seg[2] === 'upload') {
    return media.relayUpload(req, env, userId);
  }
  if (method === 'POST' && path === '/api/media/confirm') return media.confirm(req, env, userId);
  if (method === 'GET' && seg.length === 4 && seg[1] === 'media' && seg[3] === 'url') {
    return media.mediaUrl(env, seg[2] as string, userId);
  }
  if (method === 'GET' && seg.length === 4 && seg[1] === 'media' && seg[3] === 'raw') {
    return media.mediaRaw(env, seg[2] as string, userId);
  }

  if (method === 'POST' && path === '/api/posts') return posts.create(req, env, userId);
  if (method === 'GET' && path === '/api/posts') return posts.list(req, env);
  if (method === 'GET' && seg.length === 3 && seg[1] === 'posts') return posts.getOne(env, userId, seg[2] as string);
  if (method === 'PATCH' && seg.length === 3 && seg[1] === 'posts') return posts.patch(req, env, userId, seg[2] as string);
  if (method === 'DELETE' && seg.length === 3 && seg[1] === 'posts') return posts.remove(env, userId, seg[2] as string);
  if (method === 'POST' && seg.length === 4 && seg[1] === 'posts') {
    const id = seg[2] as string;
    switch (seg[3]) {
      case 'reschedule':
        return posts.reschedule(req, env, userId, id);
      case 'cancel':
        return posts.cancel(env, userId, id);
      case 'publish-now':
        return posts.publishNow(env, userId, id);
      case 'duplicate':
        return posts.duplicate(env, userId, id);
      default:
        throw new HttpError(404, 'Not found');
    }
  }
  if (method === 'POST' && seg.length === 4 && seg[1] === 'targets' && seg[3] === 'retry') {
    return posts.retryTarget(env, userId, seg[2] as string);
  }

  if (method === 'GET' && path === '/api/settings') return settings.getSettings(env, userId);
  if (method === 'PUT' && path === '/api/settings') return settings.putSettings(req, env, userId);
  if (method === 'GET' && path === '/api/diagnostics') return settings.getDiagnostics(env);

  throw new HttpError(404, 'Not found');
}
