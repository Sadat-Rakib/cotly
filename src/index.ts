import type { Env } from './contracts/env';
import { handleApi } from './api/router';
import { runSchedulerTick } from './engine/cron';
import { HttpError } from './lib/http';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/')) {
        return await handleApi(req, env, ctx);
      }
      return await env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      console.error('unhandled:', e instanceof Error ? e.message : String(e));
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSchedulerTick(env));
  },
} satisfies ExportedHandler<Env>;
