import { getCapabilities } from '../contracts/capabilities';
import type { Env } from '../contracts/env';
import type { MediaRecord, PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../contracts/types';
import {
  fail,
  graphError,
  graphTestConnection,
  httpJson,
  oauthError,
  outcomeFromError,
  presignMediaGet,
  requireId,
  type ProviderResponse,
  type Secrets,
  type TestConnectionResult,
} from './_shared';

const GRAPH = 'https://graph.facebook.com/v21.0';
const DIALOG = 'https://www.facebook.com/v21.0/dialog/oauth';
export const SCOPE = 'pages_show_list,pages_manage_posts,pages_read_engagement';

const secretsOf = (env: Env, token?: string): Secrets => [token, env.META_CLIENT_SECRET];

export class FacebookAdapter implements PlatformAdapter {
  readonly provider = 'facebook' as const;
  readonly capabilities = getCapabilities('facebook');

  async buildAuthUrl(env: Env, redirectUri: string, state: string): Promise<{ url: string }> {
    if (!env.META_CLIENT_ID) {
      throw new Error('Facebook OAuth is not configured. Set META_CLIENT_ID and META_CLIENT_SECRET first.');
    }
    const u = new URL(DIALOG);
    u.searchParams.set('client_id', env.META_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', SCOPE);
    return { url: u.toString() };
  }

  async handleCallback(env: Env, params: URLSearchParams) {
    const secrets = secretsOf(env);
    oauthError(params, 'Facebook');
    const code = params.get('code');
    if (!code) throw new Error('Facebook did not return an authorization code. Try connecting again.');
    const redirectUri = `${env.APP_URL}/oauth/facebook/callback`;
    const tok = await httpJson(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: env.META_CLIENT_ID ?? '',
        client_secret: env.META_CLIENT_SECRET ?? '',
        redirect_uri: redirectUri,
        code,
      })}`,
    );
    if (!tok.ok || typeof (tok.data as { access_token?: unknown } | null)?.access_token !== 'string') {
      throw new Error('Facebook rejected the connection attempt. Verify the app credentials and try again.');
    }
    const userToken = String((tok.data as { access_token: string }).access_token);
    const pages = await httpJson(`${GRAPH}/me/accounts?fields=id,name,access_token`, {
      headers: { authorization: `Bearer ${userToken}` },
    });
    if (!pages.ok) {
      throw new Error('Cotly could not read your Facebook Pages. Confirm the app has pages_show_list and try again.');
    }
    const all = ((pages.data as { data?: Array<{ id?: string; name?: string; access_token?: string }> | null })?.data ?? [])
      .filter((p): p is { id: string; name?: string; access_token?: string } => typeof p.id === 'string' && p.id.length > 0);
    if (all.length === 0) {
      throw new Error('No Facebook Page was found on this account. Cotly publishes to Pages — create a Page and connect again.');
    }
    // More than one Page: the user picks which one Cotly posts to. We hand the
    // candidates back instead of silently binding to whichever Page came first.
    if (all.length > 1) {
      return {
        pageChoice: {
          userToken,
          pages: all.map((p) => ({ id: p.id, name: p.name || 'Facebook Page' })),
        },
      };
    }
    const page = all[0] as { id: string; name?: string; access_token?: string };
    return {
      account: {
        externalId: page.id,
        displayName: page.name || 'Facebook Page',
        meta: { pageId: page.id },
      },
      tokens: { accessToken: page.access_token ?? userToken },
      scopes: SCOPE,
    };
  }

  // Re-reads the Page list with the stored user token so the picker never has
  // to carry page tokens around. Read-only.
  async listPages(env: Env, userToken: string): Promise<Array<{ id: string; name: string }>> {
    const res = await httpJson(`${GRAPH}/me/accounts?fields=id,name`, {
      headers: { authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) {
      throw new Error('Facebook refused to list your Pages. The connection attempt has expired — connect again from the Accounts page.');
    }
    return ((res.data as { data?: Array<{ id?: string; name?: string }> | null })?.data ?? [])
      .filter((p): p is { id: string; name?: string } => typeof p.id === 'string' && p.id.length > 0)
      .map((p) => ({ id: p.id, name: p.name || 'Facebook Page' }));
  }

  // Exchanges the stored user token for the chosen Page's own token.
  async pickPage(env: Env, userToken: string, pageId: string) {
    const res = await httpJson(`${GRAPH}/me/accounts?fields=id,name,access_token`, {
      headers: { authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) {
      throw new Error('Facebook refused to read your Pages. The connection attempt has expired — connect again from the Accounts page.');
    }
    const page = ((res.data as { data?: Array<{ id?: string; name?: string; access_token?: string }> | null })?.data ?? [])
      .find((p) => p.id === pageId);
    if (!page?.id) {
      throw new Error('That Page is no longer available on this account. Connect Facebook again and pick a Page.');
    }
    return {
      account: {
        externalId: page.id,
        displayName: page.name || 'Facebook Page',
        meta: { pageId: page.id },
      },
      tokens: { accessToken: page.access_token ?? userToken },
      scopes: SCOPE,
    };
  }

  // Probes the page token; page publishing rights can only be proven by a real publish.
  async testConnection(env: Env, account: SocialAccountRecord): Promise<TestConnectionResult> {
    return graphTestConnection({
      url: `${GRAPH}/me?fields=id,name`,
      token: account.accessToken,
      secrets: secretsOf(env, account.accessToken),
      platformName: 'Facebook',
      identityField: 'name',
      fallbackIdentity: account.displayName,
      okSuffix: 'Page publishing permission (pages_manage_posts) can only be fully verified by an actual publish.',
    });
  }

  async publish(env: Env, input: PublishInput): Promise<PublishOutcome> {
    const secrets = secretsOf(env, input.account.accessToken);
    try {
      const pageId = String(input.account.meta?.pageId ?? input.account.externalId);
      const images = input.media.filter((m) => m.mime.startsWith('image/'));
      const video = input.media.find((m) => m.mime.startsWith('video/'));
      const firstImage = images[0];
      let postId: string;
      if (video) {
        postId = await this.publishVideo(env, input, pageId, video, secrets);
      } else if (firstImage) {
        postId = await this.publishImages(env, input, pageId, images, secrets);
      } else {
        const resp = await this.post(secrets, `/${pageId}/feed`, new URLSearchParams({ message: input.caption }));
        postId = requireId(resp, secrets, 'Facebook');
      }
      return { kind: 'confirmed', externalId: postId, permalink: await this.permalink(secrets, postId) };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  private async post(secrets: Secrets, path: string, body: URLSearchParams): Promise<ProviderResponse> {
    const resp = await httpJson(`${GRAPH}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      body,
    });
    if (!resp.ok) throw graphError(resp, secrets, 'Facebook');
    return resp;
  }

  // Best effort — a failed permalink lookup must never fail the publish.
  private async permalink(secrets: Secrets, postId: string): Promise<string | undefined> {
    try {
      const resp = await httpJson(`${GRAPH}/${postId}?fields=permalink_url`, {
        headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      });
      const p = (resp.data as { permalink_url?: unknown } | null)?.permalink_url;
      if (typeof p === 'string' && p) return p.startsWith('http') ? p : `https://www.facebook.com${p}`;
    } catch {
      /* best effort */
    }
    return undefined;
  }

  private async publishImages(
    env: Env,
    input: PublishInput,
    pageId: string,
    images: MediaRecord[],
    secrets: Secrets,
  ): Promise<string> {
    const mediaFbids: string[] = [];
    for (const m of images) {
      const url = await presignMediaGet(env, m.r2Key);
      // No per-photo caption: the message goes on the feed post only.
      const resp = await this.post(secrets, `/${pageId}/photos`, new URLSearchParams({ url, published: 'false' }));
      const fbid = (resp.data as { id?: unknown } | null)?.id;
      if (typeof fbid !== 'string' || !fbid) {
        throw fail(secrets, 'NO_MEDIA_FBID', 'Facebook did not return an id for the attached photo.', resp.raw);
      }
      mediaFbids.push(fbid);
    }
    const body = new URLSearchParams({ message: input.caption });
    mediaFbids.forEach((fbid, i) => body.set(`attached_media[${i}][media_fbid]`, fbid));
    const resp = await this.post(secrets, `/${pageId}/feed`, body);
    return requireId(resp, secrets, 'Facebook');
  }

  private async publishVideo(
    env: Env,
    input: PublishInput,
    pageId: string,
    video: MediaRecord,
    secrets: Secrets,
  ): Promise<string> {
    const url = await presignMediaGet(env, video.r2Key);
    const resp = await this.post(
      secrets,
      `/${pageId}/videos`,
      new URLSearchParams({ file_url: url, description: input.caption }),
    );
    return requireId(resp, secrets, 'Facebook');
  }
}
