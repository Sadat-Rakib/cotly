import { getCapabilities } from '../contracts/capabilities';
import type { Env } from '../contracts/env';
import type { MediaRecord, PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../contracts/types';
import {
  fail,
  failRetryable,
  httpJson,
  mediaBytes,
  needsReconnect,
  oauthError,
  outcomeFromError,
  redact,
  testErrorDetail,
  testNetworkResult,
  type ProviderResponse,
  type Secrets,
  type TestConnectionResult,
} from './_shared';

const AUTH = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const REST = 'https://api.linkedin.com';
const API_VERSION = '202504';
export const SCOPE = 'openid profile w_member_social';

const secretsOf = (env: Env, token?: string): Secrets => [token, env.LINKEDIN_CLIENT_SECRET];

function mapRestError(resp: ProviderResponse, secrets: Secrets): never {
  if (resp.status === 401 || resp.status === 403) {
    throw needsReconnect(secrets, 'Your LinkedIn connection expired. Reconnect LinkedIn and retry.');
  }
  if (resp.status === 429) {
    throw failRetryable(secrets, 'RATE_LIMITED', 'LinkedIn is temporarily rate limiting this account. Cotly will retry automatically.', resp.raw);
  }
  const message =
    (typeof (resp.data as { message?: unknown } | null)?.message === 'string'
      ? String((resp.data as { message: string }).message)
      : '') || 'LinkedIn rejected this request.';
  throw fail(secrets, `LINKEDIN_${resp.status}`, message, resp.raw);
}

export class LinkedInAdapter implements PlatformAdapter {
  readonly provider = 'linkedin' as const;
  readonly capabilities = getCapabilities('linkedin');

  async buildAuthUrl(env: Env, redirectUri: string, state: string): Promise<{ url: string }> {
    if (!env.LINKEDIN_CLIENT_ID) {
      throw new Error('LinkedIn OAuth is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET first.');
    }
    // Manual query build: scope must be %20-encoded (some OAuth parsers reject '+').
    const url =
      `${AUTH}?response_type=code` +
      `&client_id=${encodeURIComponent(env.LINKEDIN_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent(SCOPE)}`;
    return { url };
  }

  async handleCallback(env: Env, params: URLSearchParams) {
    const secrets = secretsOf(env);
    oauthError(params, 'LinkedIn');
    const code = params.get('code');
    if (!code) throw new Error('LinkedIn did not return an authorization code. Try connecting again.');
    const tok = await httpJson(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${env.APP_URL}/oauth/linkedin/callback`,
        client_id: env.LINKEDIN_CLIENT_ID ?? '',
        client_secret: env.LINKEDIN_CLIENT_SECRET ?? '',
      }),
    });
    if (!tok.ok || typeof (tok.data as { access_token?: unknown } | null)?.access_token !== 'string') {
      throw new Error('LinkedIn rejected the connection attempt. Verify the app credentials and try again.');
    }
    const accessToken = String((tok.data as { access_token: string }).access_token);
    const me = await httpJson(`${REST}/v2/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!me.ok) throw new Error('Cotly could not read your LinkedIn profile. Confirm the Sign In with LinkedIn product is enabled.');
    const data = (me.data ?? {}) as { sub?: string; name?: string };
    if (!data.sub) throw new Error('LinkedIn did not return a member id. Try connecting again.');
    return {
      account: { externalId: data.sub, displayName: data.name || 'LinkedIn member' },
      tokens: { accessToken },
      scopes: SCOPE,
    };
  }

  // Probes the member token via the same userinfo endpoint used at connect time.
  async testConnection(env: Env, account: SocialAccountRecord): Promise<TestConnectionResult> {
    const secrets = secretsOf(env, account.accessToken);
    let resp: ProviderResponse;
    try {
      resp = await httpJson(`${REST}/v2/userinfo`, { headers: { authorization: `Bearer ${account.accessToken}` } });
    } catch (e) {
      return testNetworkResult(e, 'LinkedIn') ?? { ok: false, detail: 'LinkedIn connection test failed unexpectedly. Try again.' };
    }
    if (resp.ok) {
      const data = (resp.data ?? {}) as Record<string, unknown>;
      if (typeof data.sub === 'string' && data.sub) {
        const raw = data.name;
        const identity = redact(typeof raw === 'string' && raw ? raw : account.displayName, secrets);
        return { ok: true, detail: `Token valid — identity ${identity}.` };
      }
      return { ok: false, detail: 'LinkedIn returned an unexpected response. Try again.' };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, detail: 'Your LinkedIn connection expired. Reconnect LinkedIn.' };
    }
    const message = (resp.data as { message?: unknown } | null)?.message;
    return { ok: false, detail: testErrorDetail(typeof message === 'string' ? message : '', secrets, 'LinkedIn') };
  }

  // LinkedIn returns no permalink from this API — confirm on provider_post_id evidence only.
  async publish(env: Env, input: PublishInput): Promise<PublishOutcome> {
    const secrets = secretsOf(env, input.account.accessToken);
    try {
      const sub = input.account.externalId;
      const images = input.media.filter((m) => m.mime.startsWith('image/'));
      const firstImage = images[0];
      if (input.media.some((m) => m.mime.startsWith('video/'))) {
        throw fail(secrets, 'VIDEO_UNSUPPORTED', 'LinkedIn video publishing is not supported by Cotly yet. Remove the video or publish without it.');
      }
      if (images.length > 1) {
        throw fail(secrets, 'TOO_MANY_IMAGES', 'Cotly currently publishes one image per LinkedIn post. Remove the extra images and retry.');
      }
      const body: Record<string, unknown> = {
        author: `urn:li:person:${sub}`,
        commentary: input.caption,
        visibility: 'PUBLIC',
        distribution: { linkedInDistributionSource: 'NONE' },
      };
      if (firstImage) {
        body.content = { media: { id: await this.registerImage(env, sub, firstImage, secrets) } };
      }
      const resp = await this.post(secrets, '/rest/posts', JSON.stringify(body), 'application/json');
      const id = resp.headers.get('x-restli-id');
      if (!id) throw fail(secrets, 'NO_POST_ID', 'LinkedIn did not return a post id for the published content.', resp.raw);
      return { kind: 'confirmed', externalId: id, ...(resp.raw ? { raw: resp.raw } : {}) };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  private restHeaders(secrets: Secrets, contentType?: string): Record<string, string> {
    return {
      authorization: `Bearer ${secrets[0] ?? ''}`,
      'LinkedIn-Version': API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      ...(contentType ? { 'content-type': contentType } : {}),
    };
  }

  private async post(secrets: Secrets, path: string, body: string, contentType: string): Promise<ProviderResponse> {
    const resp = await httpJson(`${REST}${path}`, {
      method: 'POST',
      headers: this.restHeaders(secrets, contentType),
      body,
    });
    if (!resp.ok) mapRestError(resp, secrets);
    return resp;
  }

  // registerUpload -> PUT bytes -> asset urn used in the post body.
  private async registerImage(env: Env, sub: string, media: MediaRecord, secrets: Secrets): Promise<string> {
    const reg = await this.post(
      secrets,
      '/rest/actions/registerUpload?action=registerUpload',
      JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: `urn:li:person:${sub}`,
          serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        },
      }),
      'application/json',
    );
    const value = (reg.data as { value?: { asset?: unknown; uploadMechanism?: Record<string, { uploadUrl?: unknown }> } | null })?.value;
    const asset = value?.asset;
    const uploadUrl = value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
    if (typeof asset !== 'string' || !asset || typeof uploadUrl !== 'string' || !uploadUrl) {
      throw fail(secrets, 'UPLOAD_REGISTER_FAILED', 'LinkedIn did not provide an upload location for the image.', reg.raw);
    }
    const bytes = await mediaBytes(env, media);
    const put = await httpJson(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': media.mime },
      body: bytes,
    });
    if (!put.ok) {
      throw failRetryable(secrets, 'IMAGE_UPLOAD_FAILED', 'Cotly could not upload the image to LinkedIn. Cotly will retry automatically.', put.raw);
    }
    return asset;
  }
}
